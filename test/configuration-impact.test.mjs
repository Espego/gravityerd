import assert from "node:assert/strict";
import test from "node:test";
import { analyzeConfiguration } from "../app/src/configuration-impact.mjs";
import { createDefaultWorkspace } from "../app/src/project-format.mjs";

const schema = {
  engine: "postgresql",
  namespace: "public",
  tables: [
    { id: "accounts", name: "accounts", columns: [{ name: "id", type: "bigint", nullable: false, ordinal: 1 }], constraints: [] },
    { id: "events", name: "events", columns: [{ name: "created_by", type: "bigint", nullable: false, ordinal: 1 }, { name: "updated_by", type: "bigint", nullable: true, ordinal: 2 }], constraints: [] },
    { id: "notes", name: "notes", columns: [{ name: "created_by", type: "bigint", nullable: false, ordinal: 1 }], constraints: [] }
  ],
  foreignKeys: [
    { id: "events(created_by)>accounts(id)", name: "events_created", sourceTable: "events", sourceColumns: ["created_by"], targetTable: "accounts", targetColumns: ["id"], onDelete: "NO ACTION", onUpdate: "NO ACTION", definition: "" },
    { id: "events(updated_by)>accounts(id)", name: "events_updated", sourceTable: "events", sourceColumns: ["updated_by"], targetTable: "accounts", targetColumns: ["id"], onDelete: "NO ACTION", onUpdate: "NO ACTION", definition: "" },
    { id: "notes(created_by)>accounts(id)", name: "notes_created", sourceTable: "notes", sourceColumns: ["created_by"], targetTable: "accounts", targetColumns: ["id"], onDelete: "NO ACTION", onUpdate: "NO ACTION", definition: "" }
  ]
};
const fingerprint = "a".repeat(64);
const workspace = { ...createDefaultWorkspace(fingerprint, schema), activeView: "audit" };

test("domain impact reports unknown, repeated, and cross-domain memberships", () => {
  const impact = analyzeConfiguration("domains", [
    { id: "one", name: "One", tableIds: ["accounts", "accounts", "missing"] },
    { id: "two", name: "Two", tableIds: ["accounts", "events"] }
  ], workspace, fingerprint, schema);
  assert.match(impact.summary, /1 remain Ungrouped/u);
  assert.equal(impact.metrics.find((item) => item.label === "Unknown IDs").value, 1);
  assert.equal(impact.metrics.find((item) => item.label === "Duplicate memberships").value, 2);
  assert.deepEqual(impact.candidate.domains.find((domain) => domain.id === "one").tableIds, ["accounts"]);
  assert.deepEqual(impact.candidate.domains.find((domain) => domain.id === "two").tableIds, ["events"]);
  assert.deepEqual(impact.warnings.map((item) => item.code).sort(), ["duplicate-table-id", "multiple-domains", "unknown-table-id"]);
});

test("view impact reports active-view fallback and generated all view", () => {
  const impact = analyzeConfiguration("views", [
    { id: "all", name: "Ignored", tableIds: ["accounts"] },
    { id: "core", name: "Core", tableIds: ["accounts", "accounts", "missing"] }
  ], workspace, fingerprint, schema);
  assert.equal(impact.candidate.views[0].id, "all");
  assert.equal(impact.metrics.find((item) => item.label === "Active view preserved").value, "No");
  assert.match(impact.preservation, /fall back to All tables/u);
  assert.deepEqual(impact.warnings.map((item) => item.code).sort(), ["built-in-view", "duplicate-table-id", "unknown-table-id"]);
});

test("relationship impact uses renderer precedence and exposes rule conflicts", () => {
  const impact = analyzeConfiguration("edgeGroups", [
    { id: "primary", name: "Primary", edgeIds: [], sourceColumns: [] },
    { id: "secondary", name: "Secondary", secondary: true, edgeIds: [], sourceColumns: ["created_by"] },
    { id: "audit", name: "Audit", edgeIds: ["events(updated_by)>accounts(id)", "missing(edge)>accounts(id)"], sourceColumns: ["created_by", "unused", "unused"] }
  ], workspace, fingerprint, schema);
  assert.equal(impact.metrics.find((item) => item.label === "Assigned after precedence").value, 3);
  assert.equal(impact.metrics.find((item) => item.label === "Conflicts").value, 2);
  assert.equal(impact.details.find((item) => item.label === "Secondary").value, "2 relationships (0 explicit, 2 by rule)");
  assert.equal(impact.details.find((item) => item.label === "Audit").value, "1 relationships (1 explicit, 0 by rule)");
  assert.equal(impact.warnings.some((item) => item.code === "unused-source-column"), true);
  assert.equal(impact.warnings.some((item) => item.code === "unknown-edge-id"), true);
  assert.equal(impact.warnings.some((item) => item.code === "duplicate-source-column"), true);
  assert.match(impact.preservation, /angular fan forces/u);
});
