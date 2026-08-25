import assert from "node:assert/strict";
import test from "node:test";
import { createStoredWorkspaceRecord, normalizeStoredWorkspaceRecord } from "../app/src/workspace-store.mjs";

const workspace = { kind: "gravityerd-workspace", version: 1, schemaFingerprint: "a".repeat(64) };

test("workspace storage reads legacy values and timestamped envelopes", () => {
  assert.deepEqual(normalizeStoredWorkspaceRecord(workspace), { workspace, savedAt: null });
  assert.deepEqual(normalizeStoredWorkspaceRecord({ workspace, savedAt: "2026-08-25T12:00:00.000Z" }), {
    workspace,
    savedAt: "2026-08-25T12:00:00.000Z"
  });
  assert.deepEqual(normalizeStoredWorkspaceRecord({ workspace, savedAt: 123 }), { workspace, savedAt: null });
  assert.equal(normalizeStoredWorkspaceRecord(null), null);
});

test("workspace storage creates an ISO-timestamped envelope", () => {
  const record = createStoredWorkspaceRecord(workspace, "2026-08-25T12:00:00.000Z");
  assert.deepEqual(record, { workspace, savedAt: "2026-08-25T12:00:00.000Z" });
});
