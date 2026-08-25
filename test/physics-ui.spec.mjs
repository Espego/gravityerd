import { readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

async function loadExample(page) {
  await page.goto("/?example=helpdesk");
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("import-proposal-dialog")).toBeVisible();
  await page.getByTestId("apply-import").click();
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-project-loaded", "true");
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
  await expect(page.locator('[data-for="domainAttraction"]')).toHaveText("1.25");
  await expect.poll(() => page.evaluate(() => globalThis.gravityErdAutomation.getStatus().simulationPhase), { timeout: 45_000 }).toBe("realtime");

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
  await page.getByTestId("fit-view").click();
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
    "/workspace/examples/helpdesk.workspace.gravityerd.json",
    "/workspace/examples/helpdesk.schema.gravityerd.json"
  ]);
  await expect(page.getByTestId("import-proposal-dialog")).toBeVisible();
  await expect(page.locator("#import-summary")).toContainText("Matching tables");
  await page.getByTestId("apply-pins").uncheck();
  await page.getByTestId("apply-import").click();
  await expect(page.getByTestId("schema-status")).toContainText("7 tables · 8 relationships");
  await expect.poll(() => page.evaluate(() => globalThis.gravityErdAutomation.getNode("users").pinned)).toBe(false);
});

test("automation API imports and exports without file or clipboard access", async ({ page }) => {
  const projectJson = await readFile("/workspace/examples/helpdesk.project.gravityerd.json", "utf8");
  await page.goto("/");
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-ready", "true");
  expect(await page.evaluate(() => globalThis.gravityErdAutomation.version)).toBe("1.1.0");
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
});

test("workspace configuration is editable through stable controls", async ({ page }) => {
  await loadExample(page);
  await page.getByTestId("configure-workspace").click();
  await expect(page.getByTestId("workspace-config-dialog")).toBeVisible();
  const dialogBounds = await page.getByTestId("workspace-config-dialog").boundingBox();
  const applyBounds = await page.getByTestId("apply-config").boundingBox();
  expect(applyBounds.x + applyBounds.width).toBeLessThanOrEqual(dialogBounds.x + dialogBounds.width);
  expect(await page.getByTestId("workspace-config-dialog").evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  const domains = JSON.parse(await page.getByTestId("config-json").inputValue());
  domains.find((domain) => domain.id === "support").name = "Support workflow";
  await page.getByTestId("config-json").fill(JSON.stringify(domains));
  await page.getByTestId("apply-config").click();
  const project = JSON.parse(await page.evaluate(() => globalThis.gravityErdAutomation.getProjectJson()));
  expect(project.workspace.domains.find((domain) => domain.id === "support").name).toBe("Support workflow");
});
