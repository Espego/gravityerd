import { readFile, writeFile } from "node:fs/promises";
import { fingerprintSchema, normalizeSchema, normalizeWorkspace, serializeProject, serializeWorkspace } from "../app/src/project-format.mjs";

const source = JSON.parse(await readFile(new URL("../examples/helpdesk.source.json", import.meta.url), "utf8"));
const schema = normalizeSchema(source.schema);
const fingerprint = await fingerprintSchema(schema);
const workspace = normalizeWorkspace({ ...source.workspace, schemaFingerprint: fingerprint }, fingerprint, schema);
await writeFile(new URL("../examples/helpdesk.schema.gravityerd.json", import.meta.url), serializeProject(schema));
await writeFile(new URL("../examples/helpdesk.workspace.gravityerd.json", import.meta.url), serializeWorkspace(workspace));
await writeFile(new URL("../examples/helpdesk.project.gravityerd.json", import.meta.url), serializeProject(schema, workspace));
console.log(`Generated helpdesk example ${fingerprint}: ${schema.tables.length} tables, ${schema.foreignKeys.length} relationships`);
