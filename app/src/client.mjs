import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import {
  DEFAULT_PHYSICS_SETTINGS,
  PHYSICS_MODEL,
  activePhysicsEdges,
  clonePositions,
  initialPositions,
  physicsMetrics
} from "./physics-core.mjs";
import { fcoseOptions } from "./physics-engines.mjs";
import { createDrawioExport } from "./physics-export.mjs";
import {
  createDefaultWorkspace,
  fingerprintSchema,
  mergeWorkspace,
  normalizeProject,
  normalizeSchema,
  normalizeWorkspace,
  proposalSummary,
  serializeProject,
  serializeWorkspace
} from "./project-format.mjs";
import { buildGraphData } from "./graph-data.mjs";
import {
  AutomationRequestError,
  automationResponse,
  normalizeImportSelection,
  parseAutomationDocuments
} from "./automation-api.mjs";
import { loadStoredWorkspace as loadWorkspace, saveStoredWorkspace as saveWorkspace } from "./workspace-store.mjs";

cytoscape.use(fcose);

const AUTOSAVE_DELAY = 700;
const DIAGNOSTICS_INTERVAL = 500;
const app = document.getElementById("gravityerd-app");
const graphElement = document.getElementById("graph");
const graphLabels = document.getElementById("graph-labels");
const workspaceElement = graphElement.parentElement;
const viewSelect = document.getElementById("view-select");
const seedInput = document.getElementById("seed");
const runToggle = document.getElementById("run-toggle");
const runStatus = document.getElementById("run-status");
const message = document.getElementById("message");
const settingInputs = [...document.querySelectorAll("[data-setting]")];
const importDialog = document.getElementById("import-dialog");
const configDialog = document.getElementById("config-dialog");

let schema = null;
let schemaFingerprint = null;
let workspace = null;
let data = null;
let cy = null;
let running = false;
let phase = "idle";
let frame = 0;
let layout = null;
let disposedLayoutGeneration = 0;
let currentView = "all";
let lastDiagnosticsAt = 0;
let lastMovement = 0;
let autosaveTimer = 0;
let dirtyRevision = 0;
let savedRevision = 0;
let pendingProposal = null;
let configSection = "domains";
const snapshots = new Map();
let physicsWorker = null;
let workerRequestSequence = 0;
const workerRequests = new Map();
let rightPan = null;
let labelRenderFrame = 0;
const nodeLabels = new Map();
const grabbedNodePositions = new Map();
let activeForeignKeyRow = null;

function setRootState() {
  app.dataset.ready = "true";
  app.dataset.projectLoaded = String(Boolean(schema));
  app.dataset.simulationPhase = phase;
  app.dataset.dirty = String(dirtyRevision !== savedRevision);
  app.dataset.importProposal = pendingProposal ? "pending" : "none";
}

function markDirty({ immediate = false } = {}) {
  dirtyRevision += 1;
  setRootState();
  if (immediate) persistWorkspace();
  else scheduleAutosave();
}

function ensurePhysicsWorker() {
  if (physicsWorker) return physicsWorker;
  physicsWorker = new Worker(new URL("./physics-worker.js", import.meta.url), { type: "module" });
  physicsWorker.addEventListener("message", (event) => {
    const pending = workerRequests.get(event.data.id);
    if (!pending) return;
    workerRequests.delete(event.data.id);
    if (event.data.error) pending.reject(new Error(event.data.error));
    else pending.resolve(event.data.result);
  });
  physicsWorker.addEventListener("error", (event) => {
    const error = new Error(event.message || "Physics worker failed");
    for (const pending of workerRequests.values()) pending.reject(error);
    workerRequests.clear();
  });
  return physicsWorker;
}

function terminatePhysicsWorker() {
  if (physicsWorker) physicsWorker.terminate();
  physicsWorker = null;
  for (const pending of workerRequests.values()) pending.resolve({ cancelled: true });
  workerRequests.clear();
}

function runPhysicsTask(type, payload) {
  const id = ++workerRequestSequence;
  return new Promise((resolve, reject) => {
    workerRequests.set(id, { resolve, reject });
    ensurePhysicsWorker().postMessage({ id, type, payload });
  });
}

function currentSnapshot() {
  if (!data?.views[currentView]) return null;
  if (!snapshots.has(currentView)) {
    const source = workspace.snapshots.find((snapshot) => snapshot.view === currentView);
    const effectiveSeed = source?.seed ?? (Number(seedInput.value) || 1);
    const initial = initialPositions(data.views[currentView], effectiveSeed);
    const retained = Object.fromEntries(Object.entries(source?.positions ?? {}).filter(([id]) => initial[id]));
    const missing = data.views[currentView].nodes.map((node) => node.id).filter((id) => !retained[id]);
    snapshots.set(currentView, {
      view: currentView,
      model: PHYSICS_MODEL,
      seed: effectiveSeed,
      settings: { ...DEFAULT_PHYSICS_SETTINGS, ...(source?.settings ?? {}) },
      positions: { ...initial, ...retained },
      pinned: [...new Set((source?.pinned ?? []).filter((id) => initial[id]))].sort(),
      bootstrapAnchors: missing.length ? Object.keys(retained) : [],
      needsBootstrap: !source || missing.length > 0
    });
  }
  return snapshots.get(currentView);
}

function snapshotPayload(snapshot) {
  return {
    view: snapshot.view,
    model: PHYSICS_MODEL,
    seed: snapshot.seed,
    settings: { ...snapshot.settings },
    positions: clonePositions(snapshot.positions),
    pinned: [...snapshot.pinned].sort()
  };
}

function exportSnapshots({ sync = true } = {}) {
  if (sync) syncSnapshotFromGraph();
  for (const view of workspace.views) {
    if (!snapshots.has(view.id)) continue;
  }
  return [...snapshots.values()].map(snapshotPayload).sort((first, second) => first.view.localeCompare(second.view));
}

function currentWorkspacePayload({ sync = true } = {}) {
  if (!workspace) return null;
  return {
    ...workspace,
    schemaFingerprint,
    activeView: currentView,
    snapshots: exportSnapshots({ sync })
  };
}

function ensureWorkerStoppedForExport() {
  syncSnapshotFromGraph();
  return currentWorkspacePayload({ sync: true });
}

function columnText(column) {
  const markers = column.markers.join("·").padEnd(5, " ");
  return `${markers}${column.name}${column.nullable ? "?" : ""} : ${column.type}`;
}

function nodeLabel(node) {
  return node.columns.map((column) => columnText(column)).join("\n");
}

function cytoscapeElements(view, snapshot) {
  return [
    ...view.nodes.map((node) => ({
      group: "nodes",
      data: { id: node.id, columnsLabel: nodeLabel(node), width: node.width, height: node.height, fill: node.fillColor, stroke: node.strokeColor, domain: node.domain },
      position: snapshot.positions[node.id],
      classes: snapshot.pinned.includes(node.id) ? "pinned" : ""
    })),
    ...activePhysicsEdges(view, snapshot.settings).map((edge) => ({
      group: "edges",
      data: {
        id: edge.id, source: edge.source, target: edge.target,
        weight: edge.weight, color: edge.color, tooltip: edge.definitions.join("\n")
      },
      classes: [edge.secondary ? "secondary" : "", edge.cardinality.nullable ? "nullable" : ""].filter(Boolean).join(" ")
    }))
  ];
}

function graphStyle() {
  return [
    { selector: "node", style: { width: "data(width)", height: "data(height)", shape: "roundrectangle", "background-color": "data(fill)", "border-color": "data(stroke)", "border-width": 2, "overlay-opacity": 0 } },
    { selector: "node.pinned", style: { "border-width": 5, "underlay-color": "#86d5e6", "underlay-opacity": .35, "underlay-padding": 8 } },
    { selector: "edge", style: { width: 1.7, "curve-style": "straight", "line-color": "data(color)", "target-arrow-color": "data(color)", "target-arrow-shape": "triangle", "arrow-scale": 1.2, "overlay-padding": 10, "overlay-opacity": 0 } },
    { selector: "edge.nullable", style: { "source-arrow-shape": "circle", "source-arrow-color": "data(color)", "source-arrow-fill": "hollow" } },
    { selector: "edge.secondary", style: { "line-style": "dashed", opacity: .55 } },
    { selector: "node.focus-node", style: { "border-width": 5, "border-color": "#28798a" } },
    { selector: "node.focus-neighbor", style: { "border-width": 3, "border-color": "#5eaec0" } },
    { selector: "edge.focus-edge", style: { width: 3, opacity: 1, "line-color": "#28798a", "source-arrow-color": "#28798a", "target-arrow-color": "#28798a", "z-index": 20 } },
    { selector: ".focus-muted", style: { opacity: .12 } }
  ];
}

function rebuildNodeLabels() {
  activeForeignKeyRow = null;
  graphLabels.replaceChildren();
  nodeLabels.clear();
  for (const node of data.views[currentView].nodes) {
    const label = document.createElement("div");
    label.className = "node-card-label";
    label.dataset.nodeId = node.id;
    const title = document.createElement("strong");
    title.textContent = node.name;
    const columns = document.createElement("div");
    columns.className = "node-card-columns";
    for (const column of node.columns) {
      const row = document.createElement("div");
      row.className = "node-card-column";
      row.textContent = columnText(column);
      const matching = data.views[currentView].edges.filter((edge) => edge.source === node.id && edge.columns.includes(column.name) && cy.getElementById(edge.id).length);
      if (matching.length) {
        row.classList.add("fk");
        row.dataset.fkEdges = matching.map((edge) => edge.id).join("\u001f");
        row.tabIndex = 0;
        row.setAttribute("aria-label", `${column.name}: foreign key to ${matching.map((edge) => edge.target).join(", ")}`);
        row.addEventListener("pointerenter", () => activateForeignKeyRow(row, matching.map((edge) => edge.id)));
        row.addEventListener("pointerleave", (event) => leaveForeignKeyRow(row, event));
        row.addEventListener("focus", () => activateForeignKeyRow(row, matching.map((edge) => edge.id)));
        row.addEventListener("blur", () => deactivateForeignKeyRow(row));
        row.addEventListener("dblclick", (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleNodePin(cy.getElementById(node.id).filter("node"));
        });
      }
      columns.append(row);
    }
    label.append(title, columns);
    graphLabels.append(label);
    nodeLabels.set(node.id, label);
  }
  scheduleNodeLabelRender();
}

function renderNodeLabels() {
  labelRenderFrame = 0;
  if (!cy) return;
  const zoom = cy.zoom();
  for (const node of cy.nodes()) {
    const label = nodeLabels.get(node.id());
    if (!label) continue;
    const point = node.renderedPosition();
    const width = Number(node.data("width"));
    const height = Number(node.data("height"));
    label.style.width = `${width}px`;
    label.style.height = `${height}px`;
    label.style.transform = `translate(${point.x - width * zoom / 2}px, ${point.y - height * zoom / 2}px) scale(${zoom})`;
  }
}

function scheduleNodeLabelRender() {
  if (!labelRenderFrame) labelRenderFrame = requestAnimationFrame(renderNodeLabels);
}

function clearGraphFocus() {
  if (!cy) return;
  cy.elements().removeClass("focus-node focus-neighbor focus-edge focus-muted");
  for (const label of nodeLabels.values()) label.classList.remove("focused", "neighbor", "dimmed");
}

function activateForeignKeyRow(row, edgeIds) {
  activeForeignKeyRow = row;
  focusForeignKeyEdges(edgeIds);
}

function deactivateForeignKeyRow(row) {
  if (activeForeignKeyRow !== row || document.activeElement === row || row.matches(":hover")) return;
  activeForeignKeyRow = null;
  clearGraphFocus();
}

function leaveForeignKeyRow(row, event) {
  if (activeForeignKeyRow !== row || document.activeElement === row) return;
  activeForeignKeyRow = null;
  const label = row.closest(".node-card-label");
  const rect = label.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (inside) {
    const node = cy.getElementById(label.dataset.nodeId).filter("node");
    if (node.length) return focusGraphNode(node);
  }
  clearGraphFocus();
}

function focusGraphNode(node) {
  clearGraphFocus();
  const edges = node.connectedEdges();
  const neighbors = edges.connectedNodes().not(node);
  node.addClass("focus-node");
  neighbors.addClass("focus-neighbor");
  edges.addClass("focus-edge");
  cy.nodes().not(node.union(neighbors)).addClass("focus-muted");
  cy.edges().not(edges).addClass("focus-muted");
  nodeLabels.get(node.id())?.classList.add("focused");
  for (const neighbor of neighbors) nodeLabels.get(neighbor.id())?.classList.add("neighbor");
  for (const other of cy.nodes().not(node.union(neighbors))) nodeLabels.get(other.id())?.classList.add("dimmed");
}

function focusForeignKeyEdges(edgeIds) {
  clearGraphFocus();
  let edges = cy.collection();
  for (const id of edgeIds) edges = edges.union(cy.getElementById(id).filter("edge"));
  if (!edges.length) return;
  const sources = edges.sources();
  const targets = edges.targets();
  const context = sources.union(targets);
  edges.addClass("focus-edge");
  targets.addClass("focus-node");
  sources.addClass("focus-neighbor");
  cy.edges().not(edges).addClass("focus-muted");
  cy.nodes().not(context).addClass("focus-muted");
  for (const target of targets) nodeLabels.get(target.id())?.classList.add("focused");
  for (const source of sources) nodeLabels.get(source.id())?.classList.add("neighbor");
  for (const other of cy.nodes().not(context)) nodeLabels.get(other.id())?.classList.add("dimmed");
}

function syncSnapshotFromGraph(snapshot = currentSnapshot()) {
  if (!cy || !snapshot) return;
  cy.nodes().forEach((node) => {
    const position = node.position();
    snapshot.positions[node.id()] = { x: position.x, y: position.y };
  });
  snapshot.pinned = cy.nodes(".pinned").map((node) => node.id()).sort();
}

function applyPositions(positions) {
  cy.batch(() => cy.nodes().positions((node) => positions[node.id()]));
}

function renderControls() {
  const snapshot = currentSnapshot();
  if (!snapshot) return;
  seedInput.value = String(snapshot.seed);
  for (const input of settingInputs) {
    input.value = String(snapshot.settings[input.dataset.setting]);
    const output = document.querySelector(`[data-for="${input.dataset.setting}"]`);
    if (output) output.value = String(snapshot.settings[input.dataset.setting]);
  }
  runToggle.textContent = running ? "Stop" : "Run";
  runStatus.textContent = !running ? "Simulation stopped" : phase === "bootstrap" ? "Running · fCoSE bootstrap" : "Running · realtime gravity";
  setRootState();
}

function renderMetricValues(metrics) {
  lastMovement = Number(metrics.movement ?? lastMovement);
  for (const [name, value] of Object.entries(metrics)) {
    const element = document.querySelector(`[data-metric="${name}"]`);
    if (element) element.textContent = Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
  }
}

function renderMetrics(movement = 0) {
  const snapshot = currentSnapshot();
  if (snapshot) renderMetricValues(physicsMetrics(data.views[currentView], snapshot.positions, snapshot.settings, movement));
}

async function persistWorkspace() {
  if (!workspace || !schemaFingerprint) return;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = 0;
  try {
    workspace = currentWorkspacePayload({ sync: true });
    await saveWorkspace(schemaFingerprint, workspace);
    savedRevision = dirtyRevision;
    setRootState();
  } catch (error) {
    message.textContent = `Autosave failed: ${error.message}`;
  }
}

function scheduleAutosave() {
  if (!autosaveTimer) autosaveTimer = setTimeout(persistWorkspace, AUTOSAVE_DELAY);
}

function cancelSimulation() {
  disposedLayoutGeneration += 1;
  terminatePhysicsWorker();
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  if (layout) {
    const stopped = layout;
    layout = null;
    stopped.stop();
  }
  phase = running ? "idle" : "stopped";
  setRootState();
}

function hasMovableNodes(snapshot = currentSnapshot()) {
  return snapshot && snapshot.pinned.length < data.views[snapshot.view].nodes.length;
}

async function realtimeLoop() {
  if (!running) return;
  const generation = disposedLayoutGeneration;
  const snapshot = currentSnapshot();
  const now = performance.now();
  const includeDiagnostics = now - lastDiagnosticsAt >= DIAGNOSTICS_INTERVAL;
  try {
    const result = await runPhysicsTask("relax", { view: data.views[currentView], positions: snapshot.positions, pinned: snapshot.pinned, settings: snapshot.settings, options: { includeDiagnostics } });
    if (result.cancelled || generation !== disposedLayoutGeneration || !running) return;
    snapshot.positions = result.positions;
    applyPositions(snapshot.positions);
    renderMetricValues({ ...result.metrics, movement: result.movement });
    if (includeDiagnostics) lastDiagnosticsAt = now;
    markDirty();
    frame = requestAnimationFrame(realtimeLoop);
  } catch (error) {
    message.textContent = `Simulation failed: ${error.message}`;
    running = false;
    phase = "stopped";
    renderControls();
  }
}

function startRealtime() {
  if (!running) return;
  const snapshot = currentSnapshot();
  if (!hasMovableNodes(snapshot)) {
    running = false;
    phase = "stopped";
    renderControls();
    persistWorkspace();
    return;
  }
  phase = "realtime";
  renderControls();
  frame = requestAnimationFrame(realtimeLoop);
}

function startFcose() {
  if (!running) return;
  const generation = disposedLayoutGeneration;
  const snapshot = currentSnapshot();
  phase = "bootstrap";
  renderControls();
  const fixed = new Set([...snapshot.pinned, ...snapshot.bootstrapAnchors]);
  layout = cy.elements().layout(fcoseOptions(snapshot.settings, fixed, snapshot.positions, {
    stop: () => {
      if (generation !== disposedLayoutGeneration) return;
      layout = null;
      syncSnapshotFromGraph(snapshot);
      snapshot.bootstrapAnchors = [];
      snapshot.needsBootstrap = false;
      markDirty({ immediate: true });
      if (running) startRealtime();
    }
  }));
  layout.run();
}

function startSimulation() {
  if (!running) return;
  if (currentSnapshot().needsBootstrap) startFcose();
  else startRealtime();
}

function toggleNodePin(node) {
  if (!node?.length) return;
  cancelSimulation();
  if (node.hasClass("pinned")) node.removeClass("pinned");
  else node.addClass("pinned");
  syncSnapshotFromGraph();
  markDirty({ immediate: true });
  if (running) startSimulation();
}

function bindGraphEvents() {
  cy.on("grab", "node", (event) => {
    const current = currentSnapshot();
    current.needsBootstrap = false;
    grabbedNodePositions.set(event.target.id(), { ...event.target.position() });
    cancelSimulation();
    syncSnapshotFromGraph(current);
  });
  cy.on("drag", "node", (event) => {
    const start = grabbedNodePositions.get(event.target.id());
    const current = event.target.position();
    if (start && Math.hypot(current.x - start.x, current.y - start.y) >= 3) event.target.addClass("pinned");
    syncSnapshotFromGraph();
  });
  cy.on("free", "node", (event) => {
    const start = grabbedNodePositions.get(event.target.id());
    grabbedNodePositions.delete(event.target.id());
    const end = event.target.position();
    if (start && Math.hypot(end.x - start.x, end.y - start.y) >= 3) event.target.addClass("pinned");
    syncSnapshotFromGraph();
    renderMetrics();
    markDirty({ immediate: true });
    if (running) startSimulation();
  });
  cy.on("dbltap", "node", (event) => {
    toggleNodePin(event.target);
  });
  cy.on("mouseover", "node", (event) => { if (!activeForeignKeyRow) focusGraphNode(event.target); });
  cy.on("mouseout", "node", () => { if (!activeForeignKeyRow) clearGraphFocus(); });
  cy.on("mouseover", "edge", (event) => { if (!activeForeignKeyRow) focusForeignKeyEdges([event.target.id()]); });
  cy.on("mouseout", "edge", () => { if (!activeForeignKeyRow) clearGraphFocus(); });
  cy.on("render", scheduleNodeLabelRender);
}

function rebuildGraph({ fit = false } = {}) {
  const snapshot = currentSnapshot();
  if (cy) cy.destroy();
  cy = cytoscape({ container: graphElement, elements: cytoscapeElements(data.views[currentView], snapshot), style: graphStyle(), layout: { name: "preset", fit: false }, minZoom: .03, maxZoom: 3, boxSelectionEnabled: false });
  bindGraphEvents();
  rebuildNodeLabels();
  if (fit) cy.fit(cy.elements(), 70);
  renderControls();
  renderMetrics();
}

function populateViews() {
  viewSelect.replaceChildren(...workspace.views.map((view) => {
    const option = document.createElement("option");
    option.value = view.id;
    option.textContent = view.name;
    return option;
  }));
  if (!data.views[currentView]) currentView = workspace.views[0].id;
  viewSelect.value = currentView;
}

function loadAppliedProject(nextSchema, fingerprint, nextWorkspace) {
  cancelSimulation();
  if (cy) cy.destroy();
  schema = nextSchema;
  schemaFingerprint = fingerprint;
  workspace = { ...nextWorkspace, schemaFingerprint: fingerprint };
  data = buildGraphData(schema, workspace);
  snapshots.clear();
  currentView = data.views[workspace.activeView] ? workspace.activeView : "all";
  populateViews();
  document.getElementById("simulation-controls").hidden = false;
  document.getElementById("workspace-bar").hidden = false;
  document.getElementById("empty-state").hidden = true;
  document.getElementById("schema-status").textContent = `${schema.tables.length} tables · ${schema.foreignKeys.length} relationships · ${schemaFingerprint.slice(0, 12)}`;
  running = true;
  currentSnapshot();
  rebuildGraph({ fit: true });
  startSimulation();
  markDirty({ immediate: true });
}

function switchView() {
  syncSnapshotFromGraph();
  markDirty({ immediate: true });
  cancelSimulation();
  currentView = viewSelect.value;
  workspace.activeView = currentView;
  currentSnapshot();
  rebuildGraph({ fit: true });
  if (running) startSimulation();
}

function resetCurrent(seed) {
  cancelSimulation();
  const snapshot = currentSnapshot();
  snapshot.seed = seed;
  snapshot.positions = initialPositions(data.views[currentView], seed);
  snapshot.pinned = [];
  snapshot.bootstrapAnchors = [];
  snapshot.needsBootstrap = true;
  rebuildGraph({ fit: true });
  markDirty({ immediate: true });
  if (running) startSimulation();
}

function download(name, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  Object.assign(input.style, { position: "fixed", opacity: "0" });
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard permission was denied");
}

function proposalPairs(summary) {
  return [
    ["Tables", summary.tables], ["Relationships", summary.relationships], ["Matching tables", summary.matchedTables],
    ["New tables", summary.addedTables], ["Removed tables", summary.removedTables], ["Domains", summary.domains],
    ["Views", summary.views], ["Relationship groups", summary.edgeGroups], ["Pins", summary.pins]
  ];
}

function importProposalStatus() {
  if (!pendingProposal) return null;
  return {
    fingerprint: pendingProposal.fingerprint,
    fingerprintMismatch: pendingProposal.fingerprintMismatch,
    hasWorkspace: pendingProposal.hasWorkspace,
    summary: proposalSummary(pendingProposal.schema, pendingProposal.baseWorkspace, pendingProposal.proposedWorkspace, pendingProposal.previousSchema)
  };
}

function showProposal(proposal) {
  pendingProposal = proposal;
  const summary = proposalSummary(proposal.schema, proposal.baseWorkspace, proposal.proposedWorkspace, proposal.previousSchema);
  document.getElementById("import-fingerprint").textContent = `Schema fingerprint: ${proposal.fingerprint}`;
  document.getElementById("import-summary").replaceChildren(...proposalPairs(summary).map(([label, value]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt"); term.textContent = label;
    const description = document.createElement("dd"); description.textContent = String(value);
    item.append(term, description);
    return item;
  }));
  document.getElementById("apply-layout").checked = proposal.hasWorkspace;
  document.getElementById("apply-pins").checked = proposal.hasWorkspace;
  document.getElementById("apply-configuration").checked = proposal.hasWorkspace;
  document.getElementById("import-warning").textContent = proposal.fingerprintMismatch
    ? "The workspace fingerprint differs. Only matching stable IDs are eligible for merge."
    : "Nothing changes until you apply this proposal.";
  setRootState();
  importDialog.showModal();
}

async function prepareImport(objects) {
  let project = null;
  let embeddedWorkspace = null;
  let separateWorkspace = null;
  for (const object of objects) {
    const normalized = normalizeProject(object);
    if (normalized.type === "workspace") {
      if (separateWorkspace) throw new Error("Only one workspace file can be imported at a time");
      separateWorkspace = normalized.workspace;
    }
    else {
      if (project) throw new Error("Only one schema/project file can be imported at a time");
      project = normalized.project;
      embeddedWorkspace = normalized.workspace;
    }
  }
  const nextSchema = project?.schema ?? schema;
  if (!nextSchema) throw new Error("Import a GravityERD project containing a schema first");
  const fingerprint = await fingerprintSchema(nextSchema);
  const baseWorkspace = workspace
    ? normalizeWorkspace({ ...currentWorkspacePayload(), schemaFingerprint: fingerprint }, fingerprint, nextSchema)
    : createDefaultWorkspace(fingerprint, nextSchema);
  const rawWorkspace = separateWorkspace ?? embeddedWorkspace;
  let proposedWorkspace = baseWorkspace;
  let fingerprintMismatch = false;
  if (rawWorkspace) {
    const declared = String(rawWorkspace.schemaFingerprint ?? rawWorkspace.schemaHash ?? "");
    fingerprintMismatch = Boolean(declared && declared !== fingerprint);
    proposedWorkspace = normalizeWorkspace(rawWorkspace, fingerprint, nextSchema);
    proposedWorkspace.schemaFingerprint = fingerprint;
  } else {
    const stored = await loadWorkspace(fingerprint);
    if (stored) proposedWorkspace = normalizeWorkspace(stored, fingerprint, nextSchema);
  }
  showProposal({ schema: nextSchema, previousSchema: schema, fingerprint, baseWorkspace, proposedWorkspace, hasWorkspace: Boolean(rawWorkspace || proposedWorkspace !== baseWorkspace), fingerprintMismatch });
}

async function importFiles(files) {
  const objects = [];
  for (const file of files) objects.push(JSON.parse(await file.text()));
  await prepareImport(objects);
}

async function proposeAutomationImport(documents) {
  if (pendingProposal) throw new AutomationRequestError("proposal-pending", "Apply or discard the current import proposal first");
  if (configDialog.open) throw new AutomationRequestError("dialog-open", "Close the workspace configuration dialog first");
  await prepareImport(parseAutomationDocuments(documents));
  message.textContent = "Import proposal created by automation.";
  return importProposalStatus();
}

function applyPendingImport(include) {
  if (!pendingProposal) throw new AutomationRequestError("no-pending-proposal", "No import proposal is pending");
  const merged = mergeWorkspace(pendingProposal.baseWorkspace, pendingProposal.proposedWorkspace, pendingProposal.schema, include);
  merged.schemaFingerprint = pendingProposal.fingerprint;
  loadAppliedProject(pendingProposal.schema, pendingProposal.fingerprint, merged);
  pendingProposal = null;
  setRootState();
  if (importDialog.open) importDialog.close();
  message.textContent = "Import proposal applied.";
  return automationStatus();
}

function applyAutomationImport(selection) {
  if (!pendingProposal) throw new AutomationRequestError("no-pending-proposal", "No import proposal is pending");
  const normalized = normalizeImportSelection(selection);
  if (normalized.expectedFingerprint !== pendingProposal.fingerprint) {
    throw new AutomationRequestError("stale-proposal", "expectedFingerprint does not match the pending import proposal");
  }
  const include = { configuration: normalized.configuration, layout: normalized.layout, pins: normalized.pins };
  return applyPendingImport(include);
}

function discardAutomationImport() {
  if (!pendingProposal) throw new AutomationRequestError("no-pending-proposal", "No import proposal is pending");
  pendingProposal = null;
  setRootState();
  if (importDialog.open) importDialog.close();
  message.textContent = "Import proposal discarded by automation.";
  return automationStatus();
}

function renderConfig(section = configSection) {
  configSection = section;
  for (const button of document.querySelectorAll("[data-config-tab]")) button.setAttribute("aria-selected", String(button.dataset.configTab === section));
  document.getElementById("config-json").value = JSON.stringify(workspace[section], null, 2);
  document.getElementById("schema-ids").textContent = `Tables\n${schema.tables.map((table) => table.id).join("\n")}\n\nRelationships\n${schema.foreignKeys.map((edge) => `${edge.id}\n  ${edge.sourceTable}.${edge.sourceColumns.join(",")} -> ${edge.targetTable}.${edge.targetColumns.join(",")}`).join("\n")}`;
  document.getElementById("config-error").textContent = "";
}

function applyConfiguration() {
  try {
    const values = JSON.parse(document.getElementById("config-json").value);
    if (!Array.isArray(values)) throw new Error("Configuration must be a JSON array");
    syncSnapshotFromGraph();
    const candidate = normalizeWorkspace({ ...currentWorkspacePayload(), [configSection]: values }, schemaFingerprint, schema);
    workspace = candidate;
    data = buildGraphData(schema, workspace);
    snapshots.clear();
    currentView = data.views[currentView] ? currentView : "all";
    populateViews();
    rebuildGraph({ fit: true });
    if (running) startSimulation();
    markDirty({ immediate: true });
    configDialog.close();
  } catch (error) {
    document.getElementById("config-error").textContent = error.message;
  }
}

function finishRightPan(event) {
  if (!rightPan) return;
  rightPan = null;
  graphElement.classList.remove("right-panning");
  event.preventDefault();
  event.stopPropagation();
}

workspaceElement.addEventListener("contextmenu", (event) => event.preventDefault());
workspaceElement.addEventListener("mousedown", (event) => {
  if (event.button !== 2 || !cy) return;
  rightPan = { x: event.clientX, y: event.clientY, pan: { ...cy.pan() } };
  graphElement.classList.add("right-panning");
  event.preventDefault();
  event.stopPropagation();
}, { capture: true });
window.addEventListener("mousemove", (event) => {
  if (!rightPan || !cy) return;
  cy.pan({ x: rightPan.pan.x + event.clientX - rightPan.x, y: rightPan.pan.y + event.clientY - rightPan.y });
  event.preventDefault();
  event.stopPropagation();
}, { capture: true });
window.addEventListener("mouseup", finishRightPan, { capture: true });
window.addEventListener("blur", () => { rightPan = null; graphElement.classList.remove("right-panning"); });

runToggle.addEventListener("click", () => {
  if (running) {
    running = false;
    currentSnapshot().needsBootstrap = false;
    cancelSimulation();
    syncSnapshotFromGraph();
    renderMetrics();
    markDirty({ immediate: true });
  } else {
    running = true;
    startSimulation();
  }
  renderControls();
});
document.getElementById("fit").addEventListener("click", () => cy?.fit(cy.elements(), 70));
viewSelect.addEventListener("change", switchView);
document.getElementById("reset").addEventListener("click", () => resetCurrent(Math.max(1, Number(seedInput.value) >>> 0)));
document.getElementById("new-seed").addEventListener("click", () => {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  seedInput.value = String(seed);
  resetCurrent(seed);
});
seedInput.addEventListener("change", () => resetCurrent(Math.max(1, Number(seedInput.value) >>> 0)));
document.getElementById("unlock").addEventListener("click", () => {
  cancelSimulation();
  cy.nodes().removeClass("pinned");
  syncSnapshotFromGraph();
  markDirty({ immediate: true });
  if (running) startSimulation();
});
for (const input of settingInputs) {
  input.addEventListener("input", () => {
    const snapshot = currentSnapshot();
    snapshot.settings[input.dataset.setting] = Number(input.value);
    const output = document.querySelector(`[data-for="${input.dataset.setting}"]`);
    if (output) output.value = input.value;
    markDirty();
  });
  input.addEventListener("change", () => { if (!running) renderMetrics(); markDirty({ immediate: true }); });
}

document.getElementById("project-files").addEventListener("change", async (event) => {
  try { await importFiles([...event.target.files]); } catch (error) { message.textContent = `Import failed: ${error.message}`; }
  finally { event.target.value = ""; }
});
document.getElementById("load-example").addEventListener("click", async () => {
  try {
    const response = await fetch("./examples/helpdesk.project.gravityerd.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await prepareImport([await response.json()]);
  } catch (error) { message.textContent = `Example failed: ${error.message}`; }
});
document.getElementById("apply-import").addEventListener("click", () => {
  if (!pendingProposal) return;
  const include = {
    configuration: document.getElementById("apply-configuration").checked,
    layout: document.getElementById("apply-layout").checked,
    pins: document.getElementById("apply-pins").checked
  };
  applyPendingImport(include);
});
importDialog.addEventListener("close", () => { if (importDialog.returnValue === "cancel") { pendingProposal = null; setRootState(); } });

document.getElementById("configure").addEventListener("click", () => { renderConfig(); configDialog.showModal(); });
for (const button of document.querySelectorAll("[data-config-tab]")) button.addEventListener("click", () => renderConfig(button.dataset.configTab));
document.getElementById("apply-config").addEventListener("click", applyConfiguration);

document.getElementById("copy-workspace").addEventListener("click", async () => {
  try { await copyText(serializeWorkspace(ensureWorkerStoppedForExport())); message.textContent = "Workspace JSON copied."; }
  catch (error) { message.textContent = `Copy failed: ${error.message}`; }
});
document.getElementById("copy-project").addEventListener("click", async () => {
  try { await copyText(serializeProject(schema, ensureWorkerStoppedForExport())); message.textContent = "Project JSON copied."; }
  catch (error) { message.textContent = `Copy failed: ${error.message}`; }
});
document.getElementById("download-workspace").addEventListener("click", () => download("workspace.gravityerd.json", serializeWorkspace(ensureWorkerStoppedForExport()), "application/json"));
document.getElementById("download-project").addEventListener("click", () => download("project.gravityerd.json", serializeProject(schema, ensureWorkerStoppedForExport()), "application/json"));
document.getElementById("export-drawio").addEventListener("click", () => download("gravityerd.drawio", createDrawioExport(data, exportSnapshots()), "application/xml"));

function automationStatus() {
  return {
    schemaFingerprint,
    activeView: currentView,
    simulationPhase: phase,
    running,
    movement: lastMovement,
    dirtyRevision,
    savedRevision,
    dirty: dirtyRevision !== savedRevision,
    pendingImportProposal: Boolean(pendingProposal)
  };
}

const automation = Object.freeze({
  version: "1.1.0",
  getStatus: () => structuredClone(automationStatus()),
  getImportProposal: () => structuredClone(importProposalStatus()),
  getWorkspaceJson: () => workspace ? serializeWorkspace(currentWorkspacePayload({ sync: false })) : null,
  getProjectJson: () => schema ? serializeProject(schema, currentWorkspacePayload({ sync: false })) : null,
  getNode: (id) => {
    if (!cy || !currentSnapshot()?.positions[id]) return null;
    const node = cy.getElementById(id).filter("node");
    if (!node.length) return null;
    return structuredClone({ id, position: currentSnapshot().positions[id], pinned: currentSnapshot().pinned.includes(id), domain: node.data("domain"), renderedPosition: node.renderedPosition() });
  },
  proposeImport: (documents) => automationResponse(() => proposeAutomationImport(documents), "import-rejected"),
  applyImportProposal: (selection) => automationResponse(() => applyAutomationImport(selection), "apply-rejected"),
  discardImportProposal: () => automationResponse(discardAutomationImport, "discard-rejected")
});
Object.defineProperty(globalThis, "gravityErdAutomation", { value: automation, writable: false, configurable: false });

setRootState();
const example = new URL(location.href).searchParams.get("example");
if (example) {
  if (example === "helpdesk") document.getElementById("load-example").click();
  else message.textContent = `Unknown example: ${example}`;
}
