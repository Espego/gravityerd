import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PHYSICS_SETTING_LIMITS, normalizePhysicsSettings } from "../app/src/physics-core.mjs";
import { buildGraphData } from "../app/src/graph-data.mjs";
import { createDrawioExport } from "../app/src/physics-export.mjs";
import { fingerprintSchema, normalizeSchema, normalizeWorkspace } from "../app/src/project-format.mjs";

const source = JSON.parse(await readFile(new URL("../examples/helpdesk.source.json", import.meta.url)));
const schema = normalizeSchema(source.schema);
const fingerprint = await fingerprintSchema(schema);

test("imported physics settings are clamped to supported finite limits", () => {
  const settings = normalizePhysicsSettings({
    fcoseIterations: 1e12,
    collisionPadding: -100,
    edgeContractionExponent: Infinity,
    repulsionRange: "1000000",
    speed: -5
  });
  assert.equal(settings.fcoseIterations, PHYSICS_SETTING_LIMITS.fcoseIterations[1]);
  assert.equal(settings.collisionPadding, PHYSICS_SETTING_LIMITS.collisionPadding[0]);
  assert.equal(settings.edgeContractionExponent, 1.65);
  assert.equal(settings.repulsionRange, PHYSICS_SETTING_LIMITS.repulsionRange[1]);
  assert.equal(settings.speed, PHYSICS_SETTING_LIMITS.speed[0]);
});

test("non-finite relationship weights normalize to a finite default", () => {
  const workspace = normalizeWorkspace({
    ...source.workspace,
    schemaFingerprint: fingerprint,
    edgeGroups: source.workspace.edgeGroups.map((group, index) => ({ ...group, weight: index === 0 ? "1e309" : group.weight }))
  }, fingerprint, schema);
  assert.equal(workspace.edgeGroups[0].weight, 1);
});

test("draw.io export treats imported metadata and styles as untrusted", () => {
  const workspace = normalizeWorkspace({ ...source.workspace, schemaFingerprint: fingerprint }, fingerprint, schema);
  const styledDomain = workspace.domains.find((domain) => domain.tableIds.length);
  styledDomain.color = '#fff";image=data:image/svg+xml,<svg onload=alert(1)>;';
  styledDomain.stroke = "red;html=1;";
  workspace.edgeGroups[0].color = "#000000;image=data:text/html,unsafe;";
  const data = buildGraphData(schema, workspace);
  assert.equal(data.views.all.nodes.find((node) => node.domain === styledDomain.id).fillColor, "#E7EEF2");
  assert.equal(data.views.all.edges[0].color, "#52606D");

  const payload = '<img src=x onerror="alert(1)">';
  data.viewNames.all = payload;
  data.views.all.nodes[0].name = payload;
  data.views.all.nodes[0].columns[0].name = payload;
  data.views.all.nodes[0].constraints = [payload];
  data.views.all.nodes[0].fillColor = '#fff";image=data:text/html,unsafe;';
  data.views.all.edges[0].definitions = [payload];
  data.views.all.edges[0].color = "#000000;image=data:text/html,unsafe;";
  const xml = createDrawioExport(data, workspace.snapshots);
  assert.doesNotMatch(xml, /<img|image=data:text\/html|onload=/iu);
  assert.match(xml, /&amp;lt;img src=x onerror=&quot;alert\(1\)&quot;&amp;gt;/u);
  assert.match(xml, /fillColor=#E7EEF2/u);
  assert.match(xml, /strokeColor=#52606D/u);
});

test("static HTML has an offline-only content security policy", async () => {
  const html = await readFile(new URL("../app/public/index.html", import.meta.url), "utf8");
  assert.match(html, /Content-Security-Policy/u);
  assert.match(html, /default-src 'none'/u);
  assert.match(html, /connect-src 'self'/u);
  assert.doesNotMatch(html, /https?:\/\//u);
});
