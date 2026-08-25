import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();
const workspaceFile = (...parts) => path.join(workspaceRoot, ...parts);

async function ensurePanelOpen(page) {
  if (await page.getByTestId("panel-toggle").getAttribute("aria-expanded") === "false") {
    await page.getByTestId("panel-toggle").click();
  }
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-panel-open", "true");
}

async function openClipboardExports(page) {
  await ensurePanelOpen(page);
  const details = page.locator(".compact-details");
  if (!await details.evaluate((element) => element.open)) await details.locator("summary").click();
}

async function loadExample(page) {
  await page.goto("/?example=helpdesk");
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("import-proposal-dialog")).toBeVisible();
  await page.getByTestId("apply-import").click();
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-project-loaded", "true");
  await ensurePanelOpen(page);
}

test("example supports realtime work, right-drag pan, pins, hover and clipboard round trip", async ({ context, page }, testInfo) => {
  test.setTimeout(120_000);
  const externalRequests = [];
  page.on("request", (request) => {
    const target = new URL(request.url());
    if (target.origin !== new URL(process.env.BASE_URL || "http://127.0.0.1:18116").origin) externalRequests.push(request.url());
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value) => sessionStorage.setItem("__gravityerd_clipboard", value),
      readText: async () => sessionStorage.getItem("__gravityerd_clipboard") ?? ""
    } });
  });
  await loadExample(page);
  const rootResponse = await page.request.get("/");
  expect(rootResponse.headers()["content-security-policy"]).toContain("default-src 'none'");
  expect(rootResponse.headers()["x-content-type-options"]).toBe("nosniff");
  await expect(page.getByRole("heading", { name: "GravityERD" })).toBeVisible();
  await expect(page.getByTestId("schema-status")).toContainText("7 tables · 8 relationships");
  await expect(page.locator('[data-for="edgeContraction"]')).toHaveText("1.5");
  await expect(page.locator('[data-for="domainAttraction"]')).toHaveText("1.25");
  await expect(page.locator('[data-for="fanTension"]')).toHaveText("0.1");
  await expect(page.locator('[data-setting="edgeContraction"]')).toHaveAttribute("max", "6");
  await expect(page.locator('[data-setting="repulsionRange"]')).toHaveAttribute("max", "1000");
  await expect(page.getByTestId("advanced-layout-settings")).not.toHaveAttribute("open", "");
  await expect(page.getByTestId("seed-input")).toBeHidden();
  await expect(page.locator("#workspace-bar")).toHaveCount(0);
  await expect(page.getByTestId("simulation-toggle")).toHaveText("Pause");
  await expect.poll(() => page.evaluate(() => globalThis.gravityErdAutomation.getStatus().simulationPhase), { timeout: 45_000 }).toBe("realtime");

  await page.getByTestId("unlock-all").click();
  await expect(page.getByTestId("unlock-confirmation-dialog")).toBeVisible();
  await page.getByTestId("unlock-confirmation-dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByTestId("unlock-confirmation-dialog")).toBeHidden();

  if (testInfo.project.name === "desktop-chromium") {
    await page.getByTestId("fit-view").click();
    const liveTitle = page.locator('[data-node-id="tickets"] strong');
    await expect(liveTitle).toBeVisible();
    const liveTitleBox = await liveTitle.boundingBox();
    const liveDragX = liveTitleBox.x + liveTitleBox.width / 2;
    const liveDragY = liveTitleBox.y + liveTitleBox.height / 2;
    await page.mouse.move(liveDragX, liveDragY);
    await page.mouse.down();
    await page.mouse.move(liveDragX + 24, liveDragY + 16, { steps: 4 });
    await expect(page.getByTestId("app-root")).toHaveAttribute("data-simulation-phase", "idle");
    const heldPosition = await page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets").position);
    await page.waitForTimeout(300);
    const heldPositionAfterWait = await page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets").position);
    expect(heldPositionAfterWait.x).toBeCloseTo(heldPosition.x, 5);
    expect(heldPositionAfterWait.y).toBeCloseTo(heldPosition.y, 5);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets").pinned)).toBe(true);
    await expect.poll(() => page.evaluate(() => globalThis.gravityErdAutomation.getStatus().simulationPhase)).toBe("realtime");
  }

  await page.getByTestId("simulation-toggle").click();
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-simulation-phase", "stopped");
  await expect(page.getByTestId("simulation-toggle")).toHaveText("Play");
  await page.getByTestId("fit-view").click();
  if (testInfo.project.name === "mobile-chromium") {
    await page.getByTestId("panel-toggle").click();
    await expect(page.getByTestId("app-root")).toHaveAttribute("data-panel-open", "false");
  }
  const graphElement = page.locator("#graph");
  await expect(graphElement).toBeVisible();
  const graph = await graphElement.boundingBox();
  const before = await page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets").renderedPosition);
  await page.mouse.move(graph.x + graph.width / 2, graph.y + graph.height / 2);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(graph.x + graph.width / 2 + 70, graph.y + graph.height / 2 + 40, { steps: 5 });
  await page.mouse.up({ button: "right" });
  const after = await page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets").renderedPosition);
  expect(after.x - before.x).toBeCloseTo(70, 3);
  expect(after.y - before.y).toBeCloseTo(40, 3);

  if (testInfo.project.name === "desktop-chromium") {
    await page.getByTestId("fit-view").click();
    const title = page.locator('[data-node-id="tickets"] strong');
    await expect(title).toBeVisible();
    const titleBox = await title.boundingBox();
    const dragX = titleBox.x + titleBox.width / 2;
    const dragY = titleBox.y + titleBox.height / 2;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX + 55, dragY + 35, { steps: 7 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets").pinned)).toBe(true);

    const firstPinnedPosition = await page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets").position);
    const pinnedTitleBox = await page.locator('[data-node-id="tickets"] strong').boundingBox();
    const pinnedDragX = pinnedTitleBox.x + pinnedTitleBox.width / 2;
    const pinnedDragY = pinnedTitleBox.y + pinnedTitleBox.height / 2;
    await page.mouse.move(pinnedDragX, pinnedDragY);
    await page.mouse.down();
    await page.mouse.move(pinnedDragX + 40, pinnedDragY - 25, { steps: 7 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets").pinned)).toBe(true);
    await expect.poll(async () => {
      const position = await page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets").position);
      return Math.hypot(position.x - firstPinnedPosition.x, position.y - firstPinnedPosition.y);
    }).toBeGreaterThan(20);

    const pinnedRendered = await page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets").renderedPosition);
    await page.mouse.dblclick(graph.x + pinnedRendered.x, graph.y + pinnedRendered.y);
    await expect.poll(() => page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets").pinned)).toBe(false);
    await page.mouse.dblclick(graph.x + pinnedRendered.x, graph.y + pinnedRendered.y);
    await expect.poll(() => page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets").pinned)).toBe(true);

    const ticketLabel = page.locator('[data-node-id="tickets"]');
    await expect(ticketLabel.locator("strong")).toHaveCSS("font-weight", "800");
    await expect(ticketLabel).toHaveCSS("text-align", "left");
    const hoveredTable = await page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets").renderedPosition);
    await page.mouse.move(graph.x + hoveredTable.x, graph.y + hoveredTable.y);
    await expect(page.locator('.node-card-label.dimmed')).not.toHaveCount(0);
    await ticketLabel.locator('.node-card-column.fk').first().hover();
    await expect(page.locator('.node-card-label.dimmed')).not.toHaveCount(0);
  }

  await openClipboardExports(page);
  await page.getByTestId("copy-project-json").click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const parsed = JSON.parse(copied);
  expect(parsed.kind).toBe("gravityerd-project");
  expect(parsed.schema.tables).toHaveLength(7);
  expect(parsed.workspace.snapshots[0].pinned).toContain(testInfo.project.name === "desktop-chromium" ? "tickets" : "users");
  const drawioDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-drawio").click();
  const drawioDownload = await drawioDownloadPromise;
  expect(drawioDownload.suggestedFilename()).toBe("gravityerd.drawio");
  const drawioPath = testInfo.outputPath("gravityerd.drawio");
  await drawioDownload.saveAs(drawioPath);
  const drawio = await readFile(drawioPath, "utf8");
  expect(drawio).toContain("<mxfile");
  expect(drawio).not.toContain("<mxPoint");
  const roundTrip = testInfo.outputPath("round-trip.gravityerd.json");
  await writeFile(roundTrip, copied);
  await page.getByTestId("project-files-input").setInputFiles(roundTrip);
  await expect(page.getByTestId("import-proposal-dialog")).toBeVisible();
  await page.getByTestId("apply-import").click();
  await page.getByTestId("simulation-toggle").click();
  await page.getByTestId("copy-project-json").click();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).schema).toEqual(parsed.schema);
  expect(externalRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("gravityerd.png"), fullPage: true });
});

test("file chooser preview supports schema plus separate workspace in either order", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("project-files-input").setInputFiles([
    workspaceFile("examples", "helpdesk.workspace.gravityerd.json"),
    workspaceFile("examples", "helpdesk.schema.gravityerd.json")
  ]);
  await expect(page.getByTestId("import-proposal-dialog")).toBeVisible();
  await expect(page.locator("#import-summary")).toContainText("Matching tables");
  await page.getByTestId("apply-pins").uncheck();
  await page.getByTestId("apply-import").click();
  await expect(page.getByTestId("schema-status")).toContainText("7 tables · 8 relationships");
  await expect.poll(() => page.evaluate(() => globalThis.gravityErdAutomation.getNode("users").pinned)).toBe(false);
});

test("automation API imports and exports without file or clipboard access", async ({ page }) => {
  const project = JSON.parse(await readFile(workspaceFile("examples", "helpdesk.project.gravityerd.json"), "utf8"));
  project.workspace.snapshots.push({
    ...structuredClone(project.workspace.snapshots[0]),
    view: "support-flow",
    pinned: []
  });
  const projectJson = JSON.stringify(project);
  await page.goto("/");
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-ready", "true");
  expect(await page.evaluate(() => globalThis.gravityErdAutomation.version)).toBe("1.3.0");
  expect(await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "gravityErdAutomation");
    return { frozen: Object.isFrozen(globalThis.gravityErdAutomation), writable: descriptor.writable, configurable: descriptor.configurable };
  })).toEqual({ frozen: true, writable: false, configurable: false });

  const malformed = await page.evaluate(() => globalThis.gravityErdAutomation.proposeImport(["{"]));
  expect(malformed).toEqual({ ok: false, error: { code: "invalid-json", message: "documents[0] is not valid JSON" } });
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-import-proposal", "none");

  let proposed = await page.evaluate((contents) => globalThis.gravityErdAutomation.proposeImport([contents]), projectJson);
  expect(proposed.ok).toBe(true);
  expect(proposed.value.summary).toMatchObject({ tables: 7, relationships: 8, pins: 2 });
  expect(await page.evaluate(() => globalThis.gravityErdAutomation.getImportProposal())).toEqual(proposed.value);
  await expect(page.getByTestId("import-proposal-dialog")).toBeVisible();

  const duplicate = await page.evaluate((contents) => globalThis.gravityErdAutomation.proposeImport([contents]), projectJson);
  expect(duplicate.error.code).toBe("proposal-pending");
  expect((await page.evaluate(() => globalThis.gravityErdAutomation.discardImportProposal())).ok).toBe(true);
  await expect(page.getByTestId("import-proposal-dialog")).toBeHidden();
  proposed = await page.evaluate((contents) => globalThis.gravityErdAutomation.proposeImport([contents]), projectJson);
  expect(proposed.ok).toBe(true);

  const stale = await page.evaluate(() => globalThis.gravityErdAutomation.applyImportProposal({
    expectedFingerprint: "0".repeat(64), configuration: true, layout: true, pins: true
  }));
  expect(stale).toEqual({ ok: false, error: { code: "stale-proposal", message: "expectedFingerprint does not match the pending import proposal" } });
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-project-loaded", "false");

  const applied = await page.evaluate((expectedFingerprint) => globalThis.gravityErdAutomation.applyImportProposal({
    expectedFingerprint, configuration: true, layout: true, pins: true
  }), proposed.value.fingerprint);
  expect(applied.ok).toBe(true);
  await expect(page.getByTestId("schema-status")).toContainText("7 tables · 8 relationships");
  const exported = JSON.parse(await page.evaluate(() => globalThis.gravityErdAutomation.getProjectJson()));
  expect(exported.kind).toBe("gravityerd-project");
  expect(exported.schema.tables).toHaveLength(7);
  expect(exported.workspace.snapshots[0].pinned).toContain("users");
  expect(exported.workspace.snapshots.map((snapshot) => snapshot.view).sort()).toEqual(["all", "support-flow"]);

  const schemaProposal = await page.evaluate((contents) => globalThis.gravityErdAutomation.proposeSchemaUpdate(contents), projectJson);
  expect(schemaProposal.ok).toBe(true);
  expect(schemaProposal.value.mode).toBe("schema");
  const rejectedSelection = await page.evaluate((expectedFingerprint) => globalThis.gravityErdAutomation.applyImportProposal({
    expectedFingerprint, configuration: true, layout: false, pins: false
  }), schemaProposal.value.fingerprint);
  expect(rejectedSelection.error.code).toBe("invalid-selection");
  const schemaApplied = await page.evaluate((expectedFingerprint) => globalThis.gravityErdAutomation.applyImportProposal({
    expectedFingerprint, configuration: false, layout: false, pins: false
  }), schemaProposal.value.fingerprint);
  expect(schemaApplied.ok).toBe(true);
});

test("workspace configuration is editable through stable controls", async ({ page }, testInfo) => {
  await loadExample(page);
  await page.getByTestId("simulation-toggle").click();
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-autosave-state", "saved");
  const before = JSON.parse(await page.evaluate(() => globalThis.gravityErdAutomation.getProjectJson()));
  const nodeBefore = await page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets"));
  await page.getByTestId("configure-workspace").click();
  await expect(page.getByTestId("workspace-config-dialog")).toBeVisible();
  const dialogBounds = await page.getByTestId("workspace-config-dialog").boundingBox();
  const applyBounds = await page.getByTestId("apply-config").boundingBox();
  expect(applyBounds.x + applyBounds.width).toBeLessThanOrEqual(dialogBounds.x + dialogBounds.width);
  expect(await page.getByTestId("workspace-config-dialog").evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  await page.getByRole("tab", { name: "Relationship groups" }).click();
  await expect(page.getByTestId("config-impact-summary")).toContainText("8 relationships are assigned");
  await expect(page.locator("#config-impact-details")).toContainText("2 relationships (0 explicit, 2 by rule)");
  const impactScreenshot = testInfo.outputPath("configuration-impact.png");
  await page.screenshot({ path: impactScreenshot });
  await testInfo.attach("configuration impact", { path: impactScreenshot, contentType: "image/png" });
  await page.getByTestId("config-json").fill("{");
  await expect(page.getByTestId("apply-config")).toBeDisabled();
  await expect(page.locator("#config-error")).not.toBeEmpty();
  await page.getByRole("tab", { name: "Domains" }).click();
  const domains = JSON.parse(await page.getByTestId("config-json").inputValue());
  domains.find((domain) => domain.id === "support").name = "Support workflow";
  await page.getByTestId("config-json").fill(JSON.stringify(domains));
  await expect(page.getByTestId("apply-config")).toBeEnabled();
  await expect(page.getByTestId("config-impact-summary")).toContainText("7 tables across 4 domains");
  await page.getByTestId("apply-config").click();
  const project = JSON.parse(await page.evaluate(() => globalThis.gravityErdAutomation.getProjectJson()));
  expect(project.workspace.domains.find((domain) => domain.id === "support").name).toBe("Support workflow");
  expect(project.workspace.activeView).toBe(before.workspace.activeView);
  expect(project.workspace.snapshots.find((snapshot) => snapshot.view === "all").settings).toEqual(before.workspace.snapshots.find((snapshot) => snapshot.view === "all").settings);
  const nodeAfter = await page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets"));
  expect(nodeAfter.position).toEqual(nodeBefore.position);
  expect(nodeAfter.pinned).toBe(nodeBefore.pinned);
  await expect(page.locator("#message")).toContainText("Active view, positions, pins, and gravity settings were preserved");
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-autosave-state", "saved");
  await expect(page.getByTestId("autosave-status")).toContainText("Autosaved locally");
  const status = await page.evaluate(() => globalThis.gravityErdAutomation.getStatus());
  expect(status.autosaveState).toBe("saved");
  expect(status.lastAutosavedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
});

test("WebMCP tools reuse the visible fingerprint-bound proposal flow", async ({ page }) => {
  const projectJson = await readFile(workspaceFile("examples", "helpdesk.project.gravityerd.json"), "utf8");
  await page.addInitScript(() => {
    const tools = new Map();
    const modelContext = {
      async registerTool(tool) { tools.set(tool.name, tool); }
    };
    Object.defineProperty(document, "modelContext", { configurable: true, value: modelContext });
    globalThis.__gravityerdWebMcpTools = tools;
  });
  await page.goto("/");
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-webmcp", "ready");
  const names = await page.evaluate(() => [...globalThis.__gravityerdWebMcpTools.keys()].sort());
  expect(names).toHaveLength(9);
  expect(names).toContain("gravityerd_propose_import");

  const proposed = await page.evaluate(async (documentText) => {
    const tool = globalThis.__gravityerdWebMcpTools.get("gravityerd_propose_import");
    return tool.execute({ documents: [documentText] });
  }, projectJson);
  expect(proposed.ok).toBe(true);
  expect(proposed.value.summary).toMatchObject({ tables: 7, relationships: 8 });
  await expect(page.getByTestId("import-proposal-dialog")).toBeVisible();

  const stale = await page.evaluate(async () => {
    const tool = globalThis.__gravityerdWebMcpTools.get("gravityerd_apply_import_proposal");
    return tool.execute({ expectedFingerprint: "0".repeat(64), configuration: true, layout: true, pins: true });
  });
  expect(stale.error.code).toBe("stale-proposal");
  const applied = await page.evaluate(async (expectedFingerprint) => {
    const tool = globalThis.__gravityerdWebMcpTools.get("gravityerd_apply_import_proposal");
    return tool.execute({ expectedFingerprint, configuration: true, layout: true, pins: true });
  }, proposed.value.fingerprint);
  expect(applied.ok).toBe(true);
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-project-loaded", "true");
});

test("autosave reads legacy workspace values and reports storage failures", async ({ page }) => {
  await loadExample(page);
  await page.getByTestId("simulation-toggle").click();
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-autosave-state", "saved");
  const project = JSON.parse(await page.evaluate(() => globalThis.gravityErdAutomation.getProjectJson()));
  const fingerprint = project.workspace.schemaFingerprint;
  await page.evaluate(async ({ key, value }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("gravityerd", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const request = database.transaction("workspaces", "readwrite").objectStore("workspaces").put(value, key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
    database.close();
  }, { key: fingerprint, value: project.workspace });
  delete project.workspace;
  await page.goto("/");
  const proposed = await page.evaluate((contents) => globalThis.gravityErdAutomation.proposeImport([contents]), JSON.stringify(project));
  expect(proposed.ok).toBe(true);
  expect(proposed.value.summary.pins).toBe(2);
  await page.evaluate(() => globalThis.gravityErdAutomation.discardImportProposal());

  await page.addInitScript(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put(value, key) {
      if (key && typeof key === "string" && key.length === 64) throw new DOMException("Storage blocked for test", "QuotaExceededError");
      return originalPut.call(this, value, key);
    };
  });
  await page.reload();
  const failureProposal = await page.evaluate((contents) => globalThis.gravityErdAutomation.proposeImport([contents]), JSON.stringify(project));
  expect(failureProposal.ok).toBe(true);
  await page.evaluate((expectedFingerprint) => globalThis.gravityErdAutomation.applyImportProposal({
    expectedFingerprint, configuration: true, layout: true, pins: true
  }), failureProposal.value.fingerprint);
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-autosave-state", "error");
  await expect(page.getByTestId("autosave-status")).toContainText("Autosave failed");
});

test("visible interactive controls have accessible names", async ({ page }) => {
  await loadExample(page);
  await page.getByTestId("configure-workspace").click();
  const controls = page.locator('button:visible, select:visible, textarea:visible, input[type="range"]:visible, input[type="number"]:visible');
  const count = await controls.count();
  expect(count).toBeGreaterThan(10);
  for (let index = 0; index < count; index += 1) await expect(controls.nth(index)).toHaveAccessibleName(/\S/u);
});

test("off-canvas controls, replacement warning, and schema-only update preserve workspace state", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-panel-open", testInfo.project.name === "mobile-chromium" ? "false" : "true");
  await page.getByTestId("panel-toggle").click();
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-panel-open", testInfo.project.name === "mobile-chromium" ? "true" : "false");
  await page.getByTestId("panel-toggle").click();
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-panel-open", testInfo.project.name === "mobile-chromium" ? "false" : "true");
  await expect(page.getByTestId("load-example")).toBeVisible();

  await loadExample(page);
  const workspaceChooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("open-project-files").click();
  await expect(page.getByTestId("workspace-warning-dialog")).toBeVisible();
  await expect(page.getByTestId("workspace-warning-dialog")).toContainText("Export this workspace first");
  await page.getByTestId("continue-workspace-load").click();
  const workspaceChooser = await workspaceChooserPromise;
  await workspaceChooser.setFiles(workspaceFile("examples", "helpdesk.project.gravityerd.json"));
  await expect(page.getByTestId("import-proposal-dialog")).toBeVisible();
  await page.getByTestId("cancel-import").click();

  await page.getByTestId("simulation-toggle").click();
  await page.getByTestId("configure-workspace").click();
  const domains = JSON.parse(await page.getByTestId("config-json").inputValue());
  domains.find((domain) => domain.id === "support").name = "Preserved support";
  await page.getByTestId("config-json").fill(JSON.stringify(domains));
  await page.getByTestId("apply-config").click();
  const pinnedBefore = await page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets"));

  await page.getByTestId("schema-file-input").setInputFiles(workspaceFile("examples", "helpdesk.project.gravityerd.json"));
  await expect(page.getByTestId("import-proposal-dialog")).toBeVisible();
  expect((await page.evaluate(() => globalThis.gravityErdAutomation.getImportProposal())).mode).toBe("schema");
  await expect(page.locator("#workspace-merge-options")).toBeHidden();
  await expect(page.getByTestId("import-proposal-dialog")).toContainText("Embedded workspace values");
  await page.getByTestId("apply-import").click();
  await expect(page.getByTestId("simulation-toggle")).toHaveText("Play");

  const after = JSON.parse(await page.evaluate(() => globalThis.gravityErdAutomation.getProjectJson()));
  expect(after.workspace.domains.find((domain) => domain.id === "support").name).toBe("Preserved support");
  expect(after.workspace.snapshots.find((snapshot) => snapshot.view === "all").pinned).toEqual(["tickets", "users"]);
  const pinnedAfter = await page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets"));
  expect(pinnedAfter.position).toEqual(pinnedBefore.position);
});
