import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AUTOMATION_DOCUMENT_BYTES,
  automationResponse,
  normalizeImportSelection,
  parseAutomationDocuments
} from "../app/src/automation-api.mjs";

test("automation documents accept one or two serialized objects", () => {
  assert.deepEqual(parseAutomationDocuments(['{"kind":"gravityerd-project"}']), [{ kind: "gravityerd-project" }]);
  assert.equal(parseAutomationDocuments(["{}", "{}"]).length, 2);
});

test("automation documents reject malformed, non-object, and oversized input", () => {
  assert.throws(() => parseAutomationDocuments([]), { code: "invalid-request" });
  assert.throws(() => parseAutomationDocuments(["{}", "{}", "{}"]), { code: "invalid-request" });
  assert.throws(() => parseAutomationDocuments(["{"]), { code: "invalid-json" });
  assert.throws(() => parseAutomationDocuments(["[]"]), { code: "invalid-document" });
  assert.throws(() => parseAutomationDocuments([" ".repeat(MAX_AUTOMATION_DOCUMENT_BYTES + 1)]), { code: "document-too-large" });
});

test("automation import selection is strict and fingerprint-bound", () => {
  const selection = {
    expectedFingerprint: "a".repeat(64),
    configuration: true,
    layout: false,
    pins: true
  };
  assert.deepEqual(normalizeImportSelection(selection), selection);
  assert.throws(() => normalizeImportSelection({ ...selection, layout: 1 }), { code: "invalid-request" });
  assert.throws(() => normalizeImportSelection({ ...selection, extra: true }), { code: "invalid-request" });
});

test("automation responses expose stable errors without stacks", async () => {
  const response = await automationResponse(() => parseAutomationDocuments(["{"]), "import-rejected");
  assert.deepEqual(response, {
    ok: false,
    error: { code: "invalid-json", message: "documents[0] is not valid JSON" }
  });
  assert.equal("stack" in response.error, false);
});
