# Playwright and agent workflow

GravityERD exposes a frozen, versioned browser automation surface. Normal browser work uses real controls. Agents that cannot access a file chooser or clipboard may use the narrow two-phase import bridge; it opens the same visible proposal and applies through the same validation and merge functions as a UI import.

## Open and import through the UI

1. Open the GitHub Pages URL (or local URL) and wait for `[data-testid="app-root"][data-ready="true"]`.
2. Create the file-chooser wait before clicking the real `Open project files` label/input.
3. Set absolute local paths with `filechooser.setFiles()`. A project and workspace may be selected together in either order.
4. Wait for `data-import-proposal="pending"` and inspect the proposal dialog.
5. Select configuration, positions, and pins separately. Apply only when the user-authorized task includes applying the import; otherwise leave the proposal open for review.

```js
const chooserPromise = tab.playwright.waitForEvent("filechooser");
await tab.getByTestId("open-project-files").click();
const chooser = await chooserPromise;
await chooser.setFiles([absoluteProjectPath, absoluteWorkspacePath]);
await tab.getByTestId("import-proposal-dialog").waitFor({ state: "visible" });
```

Use supported browser operations and real mouse/keyboard input. Do not synthesize DOM events.

## Import from a terminal without file upload

`globalThis.gravityErdAutomation.proposeImport()` accepts an array containing one project JSON string and optionally one workspace JSON string. Each document must be a JSON object and is limited to 16 MiB. The method validates through the normal import path and opens the normal proposal dialog without changing the current project.

Every mutation returns `{ ok: true, value }` or `{ ok: false, error: { code, message } }`. Applying requires the exact proposal fingerprint and explicit boolean choices; this prevents a stale or replaced proposal from being applied accidentally.

```js
import { readFile, writeFile } from "node:fs/promises";

const projectText = await readFile(absoluteProjectPath, "utf8");
const proposed = await page.evaluate(
  (json) => globalThis.gravityErdAutomation.proposeImport([json]),
  projectText
);
if (!proposed.ok) throw new Error(`${proposed.error.code}: ${proposed.error.message}`);

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
if (!applied.ok) throw new Error(`${applied.error.code}: ${applied.error.message}`);

// No clipboard or download path is required for export.
await page.getByTestId("simulation-toggle").click(); // Stop before capturing exact live positions.
const exported = await page.evaluate(() => globalThis.gravityErdAutomation.getProjectJson());
await writeFile(absoluteOutputPath, exported, { mode: 0o600 });
```

When application is not authorized, leave the proposal visible for human review or call `discardImportProposal()`. Calling `proposeImport()` while another proposal is pending is rejected rather than replacing it.

## Inspect state

The inspection methods do not mutate the project:

```js
const status = await tab.playwright.evaluate(() => globalThis.gravityErdAutomation.getStatus());
const proposal = await tab.playwright.evaluate(() => globalThis.gravityErdAutomation.getImportProposal());
const node = await tab.playwright.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets"));
```

Use `getStatus()` to verify the schema fingerprint, active view, simulation phase, movement, pending proposal, and dirty revision. `getImportProposal()` returns its fingerprint and summary. `getNode(id)` returns stored and rendered positions, pin state, and domain.

## Human in the loop

After an agent imports and optionally configures domains, views, or relationship groups, it can leave the tab open. The user may stop the simulation, drag and pin tables, tune parameters, and then tell the agent “done.” The agent then:

1. reclaims the same tab;
2. checks fingerprint, revision, dirty state, and pending proposal;
3. stops the simulation through the real button;
4. reads `getWorkspaceJson()` or `getProjectJson()`;
5. writes that exact string with a filesystem tool using private permissions;
6. proposes the stored JSON again and verifies a fingerprint- and content-exact round trip.

Browser downloads and clipboard remain available to people, but neither is required by the agent contract. The complete test IDs, status fields, method signatures, sequences, and error identifiers are versioned in `automation-contract.json`.
