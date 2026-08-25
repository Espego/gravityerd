import assert from "node:assert/strict";
import test from "node:test";
import { createWebMcpToolDefinitions, registerWebMcpTools, WEBMCP_TOOL_NAMES } from "../app/src/webmcp.mjs";

function automationStub() {
  return {
    getStatus: () => ({ status: true }),
    getImportProposal: () => ({ proposal: true }),
    getWorkspaceJson: () => "workspace",
    getProjectJson: () => "project",
    getNode: (id) => ({ id }),
    proposeImport: (documents) => ({ proposed: documents.length }),
    proposeSchemaUpdate: (document) => ({ schema: document }),
    applyImportProposal: (selection) => ({ applied: selection.expectedFingerprint }),
    discardImportProposal: () => ({ discarded: true })
  };
}

test("WebMCP definitions expose the complete stable automation surface", async () => {
  const definitions = createWebMcpToolDefinitions(automationStub());
  assert.equal(definitions.length, 9);
  assert.deepEqual(definitions.map((tool) => tool.name).sort(), Object.values(WEBMCP_TOOL_NAMES).sort());
  for (const tool of definitions) {
    assert.match(tool.name, /^[A-Za-z0-9_.-]{1,128}$/u);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(typeof tool.execute, "function");
  }
  assert.equal(definitions.find((tool) => tool.name === WEBMCP_TOOL_NAMES.getProjectJson).annotations.untrustedContentHint, true);
  assert.equal(definitions.find((tool) => tool.name === WEBMCP_TOOL_NAMES.proposeImport).annotations.untrustedContentHint, true);
  assert.equal(definitions.find((tool) => tool.name === WEBMCP_TOOL_NAMES.getStatus).annotations.readOnlyHint, true);
  assert.equal(definitions.find((tool) => tool.name === WEBMCP_TOOL_NAMES.applyImportProposal).annotations.readOnlyHint, false);
  assert.deepEqual(await definitions.find((tool) => tool.name === WEBMCP_TOOL_NAMES.getNode).execute({ stableTableId: "tickets" }), { id: "tickets" });
  assert.deepEqual(await definitions.find((tool) => tool.name === WEBMCP_TOOL_NAMES.proposeImport).execute({ documents: ["{}"] }), { proposed: 1 });
});

test("WebMCP registration is feature-detected and unregisters partial failure", async () => {
  assert.equal(await registerWebMcpTools(null, automationStub()), null);
  const registered = [];
  const modelContext = { async registerTool(tool, options) { registered.push({ tool, options }); } };
  const controller = await registerWebMcpTools(modelContext, automationStub());
  assert.equal(registered.length, 9);
  assert.equal(registered.every(({ options }) => options.signal === controller.signal), true);
  assert.equal(controller.signal.aborted, false);
  controller.abort();
  assert.equal(controller.signal.aborted, true);

  const signals = [];
  let attempts = 0;
  await assert.rejects(registerWebMcpTools({
    async registerTool(_tool, options) {
      signals.push(options.signal);
      attempts += 1;
      if (attempts === 2) throw new DOMException("blocked", "NotAllowedError");
    }
  }, automationStub()), { name: "NotAllowedError" });
  assert.equal(signals[0].aborted, true);
});
