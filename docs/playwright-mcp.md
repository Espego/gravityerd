# Playwright MCP workflow

GravityERD exposes a stable browser automation surface without a mutation API. Agents and people use the same controls, import preview, and confirmation.

## Open and import

1. Open the GitHub Pages URL (or local URL) and wait for `[data-testid="app-root"][data-ready="true"]`.
2. Create the file-chooser wait **before** clicking the real `Open project files` label/input.
3. Set absolute local paths with `filechooser.setFiles()`. A project and workspace may be selected together in either order.
4. Wait for `data-import-proposal="pending"` and inspect the proposal dialog.
5. Select configuration, positions, and pins separately. Click `Apply proposal` only when the user-authorized task includes applying the import. For human review, leave the dialog open.

Conceptual Playwright sequence:

```js
const chooserPromise = tab.playwright.waitForEvent("filechooser");
await tab.getByTestId("open-project-files").click();
const chooser = await chooserPromise;
await chooser.setFiles([absoluteProjectPath, absoluteWorkspacePath]);
await tab.getByTestId("import-proposal-dialog").waitFor({ state: "visible" });
```

Use supported browser operations and real mouse/keyboard input. Do not invoke DOM events synthetically.

## Inspect without mutating

`globalThis.gravityErdAutomation` is frozen and read-only:

```js
const status = await tab.playwright.evaluate(() => globalThis.gravityErdAutomation.getStatus());
const node = await tab.playwright.evaluate(() => globalThis.gravityErdAutomation.getNode("tickets"));
```

Use `getStatus()` to verify the schema fingerprint, active view, simulation phase, movement, pending proposal, and dirty revision. `getNode(id)` returns stored and rendered positions, pin state, and domain. The API must not be used to mutate a workspace.

## Human in the loop

After an agent imports and optionally configures domains, views, or relationship groups, it can leave the tab open. The user may stop the simulation, drag and pin tables, tune parameters, and then tell Codex “done.” The agent then:

1. reclaims the same tab;
2. checks fingerprint, revision, dirty state, and pending proposal;
3. stops the simulation through the real button if needed;
4. clicks `Copy workspace JSON`;
5. reads `tab.clipboard.readText()`;
6. writes that exact JSON to the user-selected repository with a filesystem tool;
7. imports the saved file through the file chooser and confirms a fingerprint- and content-exact round trip.

## Export

For repository automation, use `Copy workspace JSON` or `Copy project JSON`, then read the clipboard. Browser download paths are deliberately not part of the contract because Playwright MCP does not guarantee a usable filesystem path. Human users can still use the download buttons.

The complete test IDs, status fields, sequences, and error identifiers are versioned in `automation-contract.json`.
