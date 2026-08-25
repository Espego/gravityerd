import { DEFAULT_PHYSICS_SETTINGS, PHYSICS_MODEL, normalizePhysicsSettings } from "./physics-core.mjs";

export const PROJECT_KIND = "gravityerd-project";
export const WORKSPACE_KIND = "gravityerd-workspace";
export const FORMAT_VERSION = 1;
export const DEFAULT_DOMAIN = Object.freeze({ id: "ungrouped", name: "Ungrouped", color: "#E7EEF2", stroke: "#687B88" });
export const PRIMARY_EDGE_GROUP = Object.freeze({ id: "primary", name: "Primary relationships", color: "#52606D", weight: 1, visible: true, secondary: false, edgeIds: [], sourceColumns: [] });
export const SECONDARY_EDGE_GROUP = Object.freeze({ id: "secondary", name: "Secondary relationships", color: "#9AA5B1", weight: 0.15, visible: false, secondary: true, edgeIds: [], sourceColumns: [] });

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedObject(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(sortedObject(value));
}

function sha256Fallback(value) {
  const rightRotate = (number, amount) => number >>> amount | number << (32 - amount);
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 2 ** 32));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const constants = [];
  const initial = [];
  let candidate = 2;
  while (constants.length < 64) {
    let prime = true;
    for (let factor = 2; factor * factor <= candidate; factor++) if (candidate % factor === 0) { prime = false; break; }
    if (prime) {
      if (initial.length < 8) initial.push(Math.floor(Math.sqrt(candidate) * 2 ** 32) >>> 0);
      constants.push(Math.floor(Math.cbrt(candidate) * 2 ** 32) >>> 0);
    }
    candidate += 1;
  }
  const hash = [...initial];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index++) {
      const first = rightRotate(words[index - 15], 7) ^ rightRotate(words[index - 15], 18) ^ words[index - 15] >>> 3;
      const second = rightRotate(words[index - 2], 17) ^ rightRotate(words[index - 2], 19) ^ words[index - 2] >>> 10;
      words[index] = (words[index - 16] + first + words[index - 7] + second) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index++) {
      const first = (h + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) + (e & f ^ ~e & g) + constants[index] + words[index]) >>> 0;
      const second = ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + (a & b ^ a & c ^ b & c)) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + first) >>> 0, c, b, a, (first + second) >>> 0];
    }
    [a, b, c, d, e, f, g, h].forEach((word, index) => { hash[index] = (hash[index] + word) >>> 0; });
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

export async function fingerprintSchema(schema) {
  const canonical = canonicalJson(schema);
  if (!globalThis.crypto?.subtle) return sha256Fallback(canonical);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requiredString(value, path) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
  return value;
}

function stringArray(value, path) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${path} must be an array of strings`);
  return [...value];
}

function nonnegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function normalizeColumn(column, index, path) {
  if (!plainObject(column)) throw new Error(`${path} must be an object`);
  return {
    name: requiredString(column.name, `${path}.name`),
    type: requiredString(column.type, `${path}.type`),
    nullable: Boolean(column.nullable),
    ...(column.default == null ? {} : { default: String(column.default) }),
    ordinal: Number.isInteger(column.ordinal) && column.ordinal > 0 ? column.ordinal : index + 1
  };
}

function normalizeConstraint(constraint, path) {
  if (!plainObject(constraint)) throw new Error(`${path} must be an object`);
  const type = requiredString(constraint.type, `${path}.type`);
  if (!["primary_key", "unique", "check"].includes(type)) throw new Error(`${path}.type is unsupported`);
  return {
    id: requiredString(constraint.id ?? constraint.name, `${path}.id`),
    name: requiredString(constraint.name ?? constraint.id, `${path}.name`),
    type,
    columns: Array.isArray(constraint.columns) ? stringArray(constraint.columns, `${path}.columns`) : [],
    definition: String(constraint.definition ?? "")
  };
}

function normalizeTable(table, index) {
  const path = `schema.tables[${index}]`;
  if (!plainObject(table)) throw new Error(`${path} must be an object`);
  const name = requiredString(table.name, `${path}.name`);
  const id = requiredString(table.id ?? name, `${path}.id`);
  if (!Array.isArray(table.columns) || !table.columns.length) throw new Error(`${path}.columns must not be empty`);
  return {
    id,
    name,
    comment: String(table.comment ?? ""),
    columns: table.columns.map((column, columnIndex) => normalizeColumn(column, columnIndex, `${path}.columns[${columnIndex}]`))
      .sort((first, second) => first.ordinal - second.ordinal || first.name.localeCompare(second.name)),
    constraints: (table.constraints ?? []).map((constraint, constraintIndex) => normalizeConstraint(constraint, `${path}.constraints[${constraintIndex}]`))
      .sort((first, second) => first.id.localeCompare(second.id))
  };
}

function semanticForeignKeyId(foreignKey) {
  return `${foreignKey.sourceTable}(${foreignKey.sourceColumns.join(",")})>${foreignKey.targetTable}(${foreignKey.targetColumns.join(",")})`;
}

function normalizeForeignKey(foreignKey, index) {
  const path = `schema.foreignKeys[${index}]`;
  if (!plainObject(foreignKey)) throw new Error(`${path} must be an object`);
  const result = {
    name: requiredString(foreignKey.name, `${path}.name`),
    sourceTable: requiredString(foreignKey.sourceTable ?? foreignKey.source_table, `${path}.sourceTable`),
    sourceColumns: stringArray(foreignKey.sourceColumns ?? foreignKey.source_columns, `${path}.sourceColumns`),
    targetTable: requiredString(foreignKey.targetTable ?? foreignKey.target_table, `${path}.targetTable`),
    targetColumns: stringArray(foreignKey.targetColumns ?? foreignKey.target_columns, `${path}.targetColumns`),
    onDelete: String(foreignKey.onDelete ?? foreignKey.on_delete ?? "NO ACTION"),
    onUpdate: String(foreignKey.onUpdate ?? foreignKey.on_update ?? "NO ACTION"),
    definition: String(foreignKey.definition ?? "")
  };
  result.id = requiredString(foreignKey.id ?? semanticForeignKeyId(result), `${path}.id`);
  return result;
}

export function normalizeSchema(source) {
  if (!plainObject(source)) throw new Error("schema must be an object");
  const engine = requiredString(source.engine ?? "manual", "schema.engine").toLowerCase();
  const namespace = requiredString(source.namespace ?? source.schema ?? "default", "schema.namespace");
  const foreignKeysSource = source.foreignKeys ?? source.foreign_keys ?? [];
  if (!Array.isArray(source.tables) || !source.tables.length) throw new Error("schema.tables must not be empty");
  if (!Array.isArray(foreignKeysSource)) throw new Error("schema.foreignKeys must be an array");
  const tables = source.tables.map(normalizeTable).sort((first, second) => first.id.localeCompare(second.id));
  const tableIds = new Set();
  for (const table of tables) {
    if (tableIds.has(table.id)) throw new Error(`Duplicate table id ${table.id}`);
    tableIds.add(table.id);
  }
  const foreignKeys = foreignKeysSource.map(normalizeForeignKey).sort((first, second) => first.id.localeCompare(second.id));
  const edgeIds = new Set();
  const columnsByTable = new Map(tables.map((table) => [table.id, new Set(table.columns.map((column) => column.name))]));
  for (const table of tables) {
    for (const constraint of table.constraints) {
      if (constraint.columns.some((column) => !columnsByTable.get(table.id).has(column))) throw new Error(`Constraint ${constraint.id} references an unknown column`);
    }
  }
  for (const edge of foreignKeys) {
    if (edgeIds.has(edge.id)) throw new Error(`Duplicate foreign key id ${edge.id}`);
    edgeIds.add(edge.id);
    if (!tableIds.has(edge.sourceTable) || !tableIds.has(edge.targetTable)) throw new Error(`Foreign key ${edge.id} references an unknown table`);
    if (!edge.sourceColumns.length || edge.sourceColumns.length !== edge.targetColumns.length) throw new Error(`Foreign key ${edge.id} has invalid column cardinality`);
    if (edge.sourceColumns.some((column) => !columnsByTable.get(edge.sourceTable).has(column))) throw new Error(`Foreign key ${edge.id} references an unknown source column`);
    if (edge.targetColumns.some((column) => !columnsByTable.get(edge.targetTable).has(column))) throw new Error(`Foreign key ${edge.id} references an unknown target column`);
  }
  return { engine, namespace, tables, foreignKeys };
}

function normalizeDomains(domains, tableIds) {
  const source = Array.isArray(domains) ? domains : [];
  const result = source.map((domain, index) => ({
    id: requiredString(domain.id, `workspace.domains[${index}].id`),
    name: requiredString(domain.name, `workspace.domains[${index}].name`),
    color: String(domain.color || "#E7EEF2"),
    stroke: String(domain.stroke || "#687B88"),
    tableIds: [...new Set((domain.tableIds ?? []).filter((id) => tableIds.has(id)))].sort()
  }));
  if (!result.some((domain) => domain.id === DEFAULT_DOMAIN.id)) result.unshift({ ...DEFAULT_DOMAIN, tableIds: [] });
  if (new Set(result.map((domain) => domain.id)).size !== result.length) throw new Error("workspace.domains contains duplicate IDs");
  const assigned = new Set();
  for (const domain of result) domain.tableIds = domain.tableIds.filter((id) => !assigned.has(id) && assigned.add(id));
  const ungrouped = result.find((domain) => domain.id === DEFAULT_DOMAIN.id);
  ungrouped.tableIds.push(...[...tableIds].filter((id) => !assigned.has(id)).sort());
  return result;
}

function normalizeViews(views, tableIds) {
  const result = [{ id: "all", name: "All tables", tableIds: [...tableIds].sort(), builtIn: true }];
  for (const [index, view] of (Array.isArray(views) ? views : []).entries()) {
    if (view.id === "all") continue;
    result.push({
      id: requiredString(view.id, `workspace.views[${index}].id`),
      name: requiredString(view.name, `workspace.views[${index}].name`),
      tableIds: [...new Set((view.tableIds ?? []).filter((id) => tableIds.has(id)))].sort(),
      builtIn: false
    });
  }
  if (new Set(result.map((view) => view.id)).size !== result.length) throw new Error("workspace.views contains duplicate IDs");
  return result;
}

function normalizeEdgeGroups(groups, edgeIds) {
  const supplied = new Map((Array.isArray(groups) ? groups : []).map((group) => [group.id, group]));
  const source = [
    { ...PRIMARY_EDGE_GROUP, ...(supplied.get("primary") ?? {}) },
    { ...SECONDARY_EDGE_GROUP, ...(supplied.get("secondary") ?? {}) },
    ...(Array.isArray(groups) ? groups : []).filter((group) => !["primary", "secondary"].includes(group.id))
  ];
  const result = source.map((group, index) => ({
    id: requiredString(group.id, `workspace.edgeGroups[${index}].id`),
    name: requiredString(group.name, `workspace.edgeGroups[${index}].name`),
    color: String(group.color || "#52606D"),
    weight: nonnegativeNumber(group.weight, 1),
    visible: group.visible !== false,
    secondary: Boolean(group.secondary),
    edgeIds: [...new Set((group.edgeIds ?? []).filter((id) => edgeIds.has(id)))].sort(),
    sourceColumns: [...new Set((group.sourceColumns ?? []).map(String))].sort()
  }));
  if (new Set(result.map((group) => group.id)).size !== result.length) throw new Error("workspace.edgeGroups contains duplicate IDs");
  return result;
}

export function createDefaultWorkspace(schemaFingerprint, schema) {
  const tableIds = new Set(schema.tables.map((table) => table.id));
  const edgeIds = new Set(schema.foreignKeys.map((edge) => edge.id));
  return {
    kind: WORKSPACE_KIND,
    version: FORMAT_VERSION,
    schemaFingerprint,
    activeView: "all",
    domains: normalizeDomains([], tableIds),
    views: normalizeViews([], tableIds),
    edgeGroups: normalizeEdgeGroups([], edgeIds),
    snapshots: []
  };
}

export function normalizeWorkspace(source, schemaFingerprint, schema) {
  if (!plainObject(source)) return createDefaultWorkspace(schemaFingerprint, schema);
  const body = source.kind === WORKSPACE_KIND ? source : source.workspace ?? source;
  const tableIds = new Set(schema.tables.map((table) => table.id));
  const edgeIds = new Set(schema.foreignKeys.map((edge) => edge.id));
  const legacySnapshots = Array.isArray(body.snapshots) ? body.snapshots : [];
  const snapshotsByView = new Map();
  for (const snapshot of legacySnapshots) {
    const legacyView = typeof snapshot.view === "string" ? snapshot.view : "all";
    const view = legacyView === "combined" || legacyView === "center" || legacyView === "identity" ? "all" : legacyView;
    if (snapshotsByView.has(view) && legacyView !== "combined") continue;
    snapshotsByView.set(view, {
    view,
    model: PHYSICS_MODEL,
    seed: Math.max(1, Number(snapshot.seed) >>> 0),
    settings: normalizePhysicsSettings(snapshot.settings ?? DEFAULT_PHYSICS_SETTINGS),
    positions: Object.fromEntries(Object.entries(snapshot.positions ?? {}).filter(([id, point]) =>
      tableIds.has(id) && Number.isFinite(point?.x) && Number.isFinite(point?.y)
    ).map(([id, point]) => [id, { x: Number(point.x), y: Number(point.y) }])),
    pinned: [...new Set((snapshot.pinned ?? []).filter((id) => tableIds.has(id)))].sort()
    });
  }
  const snapshots = [...snapshotsByView.values()];
  return {
    kind: WORKSPACE_KIND,
    version: FORMAT_VERSION,
    schemaFingerprint: String(body.schemaFingerprint ?? source.schemaHash ?? schemaFingerprint),
    activeView: String(body.activeView ?? "all"),
    domains: normalizeDomains(body.domains, tableIds),
    views: normalizeViews(body.views, tableIds),
    edgeGroups: normalizeEdgeGroups(body.edgeGroups, edgeIds),
    snapshots
  };
}

export function normalizeProject(source) {
  if (!plainObject(source)) throw new Error("Project JSON must be an object");
  if (source.kind === WORKSPACE_KIND || (!source.tables && !source.schema && Array.isArray(source.snapshots))) {
    return { type: "workspace", workspace: source };
  }
  const legacySchema = Array.isArray(source.tables) ? source : null;
  const schema = normalizeSchema(legacySchema ?? source.schema);
  return { type: "project", project: { kind: PROJECT_KIND, version: FORMAT_VERSION, schema }, workspace: source.workspace ?? null };
}

export function mergeWorkspace(current, proposed, schema, include = { configuration: true, layout: true, pins: true }) {
  const fingerprint = current.schemaFingerprint;
  const base = normalizeWorkspace(structuredClone(current), fingerprint, schema);
  const next = normalizeWorkspace(structuredClone(proposed), fingerprint, schema);
  if (include.configuration) {
    base.domains = next.domains;
    base.views = next.views;
    base.edgeGroups = next.edgeGroups;
    base.activeView = next.activeView;
  }
  const currentSnapshots = new Map(base.snapshots.map((snapshot) => [snapshot.view, snapshot]));
  for (const proposedSnapshot of next.snapshots) {
    const target = currentSnapshots.get(proposedSnapshot.view) ?? {
      view: proposedSnapshot.view,
      model: PHYSICS_MODEL,
      seed: proposedSnapshot.seed,
      settings: { ...DEFAULT_PHYSICS_SETTINGS },
      positions: {},
      pinned: []
    };
    if (include.configuration) target.settings = structuredClone(proposedSnapshot.settings);
    if (include.layout) {
      target.seed = proposedSnapshot.seed;
      target.positions = structuredClone(proposedSnapshot.positions);
    }
    if (include.pins) target.pinned = [...proposedSnapshot.pinned];
    currentSnapshots.set(target.view, target);
  }
  base.snapshots = [...currentSnapshots.values()];
  base.schemaFingerprint = fingerprint;
  return normalizeWorkspace(base, fingerprint, schema);
}

export function proposalSummary(schema, currentWorkspace, proposedWorkspace, previousSchema = null) {
  const currentIds = new Set(previousSchema?.tables?.map((table) => table.id)
    ?? Object.keys(currentWorkspace?.snapshots?.[0]?.positions ?? {}));
  const schemaIds = new Set(schema.tables.map((table) => table.id));
  return {
    tables: schema.tables.length,
    relationships: schema.foreignKeys.length,
    matchedTables: [...currentIds].filter((id) => schemaIds.has(id)).length,
    addedTables: [...schemaIds].filter((id) => !currentIds.has(id)).length,
    removedTables: [...currentIds].filter((id) => !schemaIds.has(id)).length,
    currentPositions: currentIds.size,
    domains: proposedWorkspace.domains.length,
    views: proposedWorkspace.views.length,
    edgeGroups: proposedWorkspace.edgeGroups.length,
    pins: proposedWorkspace.snapshots.reduce((sum, snapshot) => sum + snapshot.pinned.length, 0)
  };
}

export function serializeWorkspace(workspace) {
  return `${JSON.stringify(workspace, null, 2)}\n`;
}

export function serializeProject(schema, workspace = null) {
  return `${JSON.stringify({ kind: PROJECT_KIND, version: FORMAT_VERSION, schema, ...(workspace ? { workspace } : {}) }, null, 2)}\n`;
}
