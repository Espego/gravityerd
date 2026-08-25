import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createDefaultWorkspace,
  fingerprintSchema,
  mergeWorkspace,
  normalizeProject,
  normalizeSchema,
  normalizeWorkspace,
  serializeProject,
  serializeWorkspace
} from "../app/src/project-format.mjs";
import { buildGraphData } from "../app/src/graph-data.mjs";
import { createDrawioExport } from "../app/src/physics-export.mjs";

const source = JSON.parse(await readFile(new URL("../examples/helpdesk.source.json", import.meta.url)));
const schema = normalizeSchema(source.schema);
const fingerprint = await fingerprintSchema(schema);
const workspace = normalizeWorkspace({ ...source.workspace, schemaFingerprint: fingerprint }, fingerprint, schema);

test("public example has stable documented counts and fingerprint", () => {
  assert.equal(schema.tables.length, 7);
  assert.equal(schema.foreignKeys.length, 8);
  assert.equal(workspace.domains.length, 4);
  assert.equal(workspace.views.length, 2);
  assert.equal(workspace.edgeGroups.length, 3);
  assert.equal(workspace.snapshots[0].pinned.length, 2);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
});

test("schema and workspace import separately or as one project", () => {
  const schemaOnly = normalizeProject(JSON.parse(serializeProject(schema)));
  const combined = normalizeProject(JSON.parse(serializeProject(schema, workspace)));
  const standalone = normalizeProject(JSON.parse(serializeWorkspace(workspace)));
  assert.equal(schemaOnly.type, "project");
  assert.equal(schemaOnly.workspace, null);
  assert.deepEqual(combined.workspace, workspace);
  assert.equal(standalone.type, "workspace");
});

test("partial merge preserves configuration when only layout is approved", () => {
  const current = createDefaultWorkspace(fingerprint, schema);
  const merged = mergeWorkspace(current, workspace, schema, { configuration: false, layout: true, pins: false });
  assert.equal(merged.domains.length, 1);
  assert.equal(merged.snapshots.length, 1);
  assert.deepEqual(merged.snapshots[0].pinned, []);
});

test("configuration approval applies physics settings without importing positions", () => {
  const current = createDefaultWorkspace(fingerprint, schema);
  const merged = mergeWorkspace(current, workspace, schema, { configuration: true, layout: false, pins: false });
  assert.equal(merged.snapshots[0].settings.domainAttraction, 1.25);
  assert.deepEqual(merged.snapshots[0].positions, {});
  assert.deepEqual(merged.snapshots[0].pinned, []);
});

test("edge groups apply explicit membership before source-column rules", () => {
  const data = buildGraphData(schema, workspace);
  const ownership = data.views.all.edges.find((edge) => edge.id === "tickets(assigned_team_id)>teams(id)");
  const secondary = data.views.all.edges.find((edge) => edge.id === "tickets(created_by)>users(id)");
  assert.equal(ownership.groupId, "ownership");
  assert.equal(ownership.cardinality.nullable, true);
  assert.equal(secondary.groupId, "secondary");
  assert.equal(secondary.secondary, true);
  assert.equal(secondary.cardinality.nullable, false);
});

test("draw.io pages use direct unlabeled node-to-node edges without ports or waypoints", () => {
  const data = buildGraphData(schema, workspace);
  const xml = createDrawioExport(data, workspace.snapshots);
  assert.doesNotMatch(xml, /Array as="points"|<mxPoint/);
  assert.match(xml, /edgeStyle=none;rounded=0/);
  assert.doesNotMatch(xml, /exitX=|exitY=|entryX=|entryY=/);
  assert.doesNotMatch(xml, /→/);
  assert.match(xml, /startArrow=oval;startFill=0;startSize=8/);
  assert.match(xml, /endArrow=block;endFill=1;endSize=10/);
  assert.equal((xml.match(/ edge="1"/g) ?? []).length, 8);
});

test("legacy PePa workspace state maps the combined view and topology tension", () => {
  const legacy = normalizeWorkspace({ version: 2, schemaHash: fingerprint, activeView: "combined", snapshots: [{ view: "combined", seed: 1, settings: { topologyTension: 0.9 }, positions: { users: { x: 1, y: 2 } }, pinned: ["users"] }] }, fingerprint, schema);
  assert.equal(legacy.snapshots[0].view, "all");
  assert.equal(legacy.snapshots[0].settings.fanTension, 0.9);
  assert.deepEqual(legacy.snapshots[0].pinned, ["users"]);
});
