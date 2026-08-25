import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contract = JSON.parse(await readFile(new URL("../automation-contract.json", import.meta.url)));
const html = await readFile(new URL("../app/public/index.html", import.meta.url), "utf8");

test("automation contract references real stable test IDs", () => {
  assert.equal(contract.version, "1.3.0");
  assert.equal(contract.jsonFormatVersion, 1);
  for (const id of Object.values(contract.testIds)) {
    assert.match(html, new RegExp(`data-testid=["']${id}["']`), `missing data-testid ${id}`);
  }
});

test("automation API separates inspection from fingerprint-bound mutation", () => {
  const methodNames = Object.keys(contract.readOnlyApi.methods).sort();
  assert.deepEqual(methodNames, ["getImportProposal", "getNode", "getProjectJson", "getStatus", "getWorkspaceJson"]);
  assert.deepEqual(Object.keys(contract.mutationApi.methods).sort(), ["applyImportProposal", "discardImportProposal", "proposeImport", "proposeSchemaUpdate"]);
  assert.equal(contract.mutationApi.maxDocumentBytes, 16 * 1024 * 1024);
  assert.ok(contract.sequences.export.some((step) => step.includes("clipboard") && step.includes("not required")));
  assert.ok(contract.sequences.agentImport.some((step) => step.includes("exact returned fingerprint")));
  assert.ok(contract.sequences.createView.some((step) => step.includes("layout=false") && step.includes("pins=false")));
  assert.ok(contract.sequences.schemaUpdate.some((step) => step.includes("preserved")));
  assert.ok(contract.sequences.humanLoop.length >= 3);
});

test("automation contract maps the complete WebMCP adapter", () => {
  assert.equal(contract.webMcp.api, "document.modelContext.registerTool");
  assert.equal(Object.keys(contract.webMcp.tools).length, 9);
  assert.deepEqual(contract.webMcp.registrationStates, ["unsupported", "registering", "ready", "error"]);
  assert.equal(contract.webMcp.tools.gravityerd_get_project_json.untrustedContent, true);
  assert.equal(contract.webMcp.tools.gravityerd_propose_import.untrustedContent, true);
  assert.equal(contract.webMcp.tools.gravityerd_apply_import_proposal.readOnly, false);
  assert.ok(contract.sequences.webMcpImport.some((step) => step.includes("exact fingerprint")));
});
