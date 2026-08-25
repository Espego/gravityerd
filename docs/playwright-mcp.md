# Playwright and agent workflow

GravityERD exposes a frozen, versioned browser automation surface and feature-detected WebMCP tools. Normal browser work uses real controls. Agents that cannot access a file chooser or clipboard may use WebMCP or the compatible page-global bridge; both open the same visible proposal and apply through the same validation and merge functions as a UI import.

## Concepts

- **Schema** is refreshable database structure.
- **Workspace** contains views, domains, relationship groups, gravity settings, positions, and pins.
- A workspace exported **with schema** has the version 1 kind `gravityerd-project`.
- A workspace exported **without schema** has the version 1 kind `gravityerd-workspace`.

The left control panel is off-canvas on small screens. If a required control is not visible, click `[data-testid="panel-toggle"]` and wait for `data-panel-open="true"`.

## Prefer WebMCP when available

Wait for `[data-testid="app-root"]` and inspect `data-webmcp`. When it is `ready`, use the discovered `gravityerd_*` tools. Read-only tools inspect status, proposal, exports, and one table. Mutation tools propose an import or schema update, apply the exact fingerprint-bound proposal, or discard it.

WebMCP is an adapter over the same versioned automation facade. `gravityerd_propose_import` and `gravityerd_propose_schema_update` always open the normal visible proposal. `gravityerd_apply_import_proposal` still requires the exact returned fingerprint and explicit `configuration`, `layout`, and `pins` booleans. No WebMCP method bypasses validation or human-visible state.

If `data-webmcp` is `unsupported` or `error`, use the real file chooser. Use `globalThis.gravityErdAutomation` only when the automation environment can execute in the actual page realm.

## Load a workspace through the UI

1. Open the GitHub Pages URL or local URL and wait for `[data-testid="app-root"][data-ready="true"]`.
2. Create the file-chooser wait before clicking `Load workspace`.
3. If a workspace is already open, review the replacement warning and click `Continue`.
4. Set one workspace-with-schema path, one schema plus one workspace path in either order, or a workspace-only path for the open schema.
5. Wait for `data-import-proposal="pending"`, inspect the proposal, and choose configuration, positions, and pins.
6. Apply only when the task authorizes mutation; otherwise leave the proposal visible.

```js
if (await tab.getByTestId("panel-toggle").getAttribute("aria-expanded") === "false") {
  await tab.getByTestId("panel-toggle").click();
}
const chooserPromise = tab.playwright.waitForEvent("filechooser");
await tab.getByTestId("open-project-files").click();
if (await tab.getByTestId("workspace-warning-dialog").isVisible()) {
  await tab.getByTestId("continue-workspace-load").click();
}
const chooser = await chooserPromise;
await chooser.setFiles([absoluteProjectPath, absoluteWorkspacePath]);
await tab.getByTestId("import-proposal-dialog").waitFor({ state: "visible" });
```

Use supported browser operations and real mouse/keyboard input. Do not synthesize DOM events.

## Update only the schema

`Update schema` accepts one schema-bearing JSON file. An embedded workspace is deliberately ignored. The visible proposal reports matching, added, and removed tables; applying it retains workspace data for matching stable IDs.

Agents without file upload may call `proposeSchemaUpdate(schemaJsonString)`. Apply the returned proposal with the exact fingerprint and all merge booleans set to `false`.

```js
const schemaText = await readFile(absoluteSchemaPath, "utf8");
const proposed = await page.evaluate(
  (json) => globalThis.gravityErdAutomation.proposeSchemaUpdate(json),
  schemaText
);
if (!proposed.ok || proposed.value.mode !== "schema") throw new Error("Schema proposal failed");

const applied = await page.evaluate(
  (fingerprint) => globalThis.gravityErdAutomation.applyImportProposal({
    expectedFingerprint: fingerprint,
    configuration: false,
    layout: false,
    pins: false
  }),
  proposed.value.fingerprint
);
if (!applied.ok) throw new Error(applied.error.message);
```

## Page-global fallback without file upload

`globalThis.gravityErdAutomation.proposeImport()` accepts an array containing one workspace-with-schema JSON string and optionally one workspace-only JSON string. Each document must be a JSON object and is limited to 16 MiB. It validates through the normal path and opens the normal proposal without changing current state.

Every mutation returns `{ ok: true, value }` or `{ ok: false, error: { code, message } }`. Applying requires the exact proposal fingerprint and three explicit boolean choices.

```js
import { readFile, writeFile } from "node:fs/promises";

const workspaceText = await readFile(absoluteWorkspacePath, "utf8");
const proposed = await page.evaluate(
  (json) => globalThis.gravityErdAutomation.proposeImport([json]),
  workspaceText
);
if (!proposed.ok) throw new Error(proposed.error.message);

// Inspect proposed.value.summary and the visible dialog first.
const applied = await page.evaluate(
  (fingerprint) => globalThis.gravityErdAutomation.applyImportProposal({
    expectedFingerprint: fingerprint,
    configuration: true,
    layout: true,
    pins: true
  }),
  proposed.value.fingerprint
);
if (!applied.ok) throw new Error(applied.error.message);

await page.getByTestId("simulation-toggle").click(); // Pause before exact export.
const exported = await page.evaluate(() => globalThis.gravityErdAutomation.getProjectJson());
await writeFile(absoluteOutputPath, exported, { mode: 0o600 });
```

When application is not authorized, leave the proposal visible for human review or call `discardImportProposal()`. A second proposal is rejected while one is pending.

## Create a useful view slice

Views are the main agent-friendly unit of work. A custom view is a small stable object:

```json
{
  "id": "ticket-lifecycle",
  "name": "Ticket lifecycle",
  "tableIds": ["customers", "tickets", "ticket_comments", "ticket_labels"]
}
```

Use this exact workflow:

1. Read `getProjectJson()` and take table IDs only from `schema.tables[].id`.
2. Read `getWorkspaceJson()`, parse it, and append or replace one entry in `views`. Do not edit the built-in `all` view.
3. Keep the view ID short, lowercase, stable, and semantic. Do not infer IDs from display text.
4. Pass the updated serialized workspace to `proposeImport([workspaceJson])`.
5. Inspect the visible proposal and its table/view counts.
6. Apply with `configuration: true`, `layout: false`, and `pins: false`. This creates the view without replacing existing physical placement.
7. Select the new view through `[data-testid="view-select"]`, let new nodes bootstrap, then use real drag and double-click interactions for manual placement and pins.
8. Pause and export the resulting workspace with `getWorkspaceJson()`.

If the schema changes first, use the schema-only workflow above, re-read stable IDs, and then update the view. Never add unknown table IDs; normalization filters them out.

## Inspect state and hand work back

The inspection methods do not mutate the workspace:

```js
const status = await page.evaluate(() => globalThis.gravityErdAutomation.getStatus());
const proposal = await page.evaluate(() => globalThis.gravityErdAutomation.getImportProposal());
const node = await page.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets"));
```

`getStatus()` reports fingerprint, active view, simulation phase, movement, proposal state, dirty revision, autosave state/time, and WebMCP registration state. `getImportProposal()` reports proposal mode, fingerprint, and summary. `getNode(id)` reports stored/rendered position, pin state, and domain.

For a human-in-the-loop handoff, leave the tab open. After the user finishes manual placement, re-read state, pause through the real button, write `getWorkspaceJson()` with private permissions, then propose it again to verify a fingerprint- and content-exact round trip.

Browser downloads and clipboard remain available to people, but neither is required by the agent contract. The complete test IDs, state fields, method signatures, sequences, and errors are versioned in `automation-contract.json`.
