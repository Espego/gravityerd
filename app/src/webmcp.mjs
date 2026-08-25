const emptyInputSchema = Object.freeze({ type: "object", properties: {}, additionalProperties: false });

const toolNames = Object.freeze({
  getStatus: "gravityerd_get_status",
  getImportProposal: "gravityerd_get_import_proposal",
  getWorkspaceJson: "gravityerd_get_workspace_json",
  getProjectJson: "gravityerd_get_project_json",
  getNode: "gravityerd_get_node",
  proposeImport: "gravityerd_propose_import",
  proposeSchemaUpdate: "gravityerd_propose_schema_update",
  applyImportProposal: "gravityerd_apply_import_proposal",
  discardImportProposal: "gravityerd_discard_import_proposal"
});

export const WEBMCP_TOOL_NAMES = toolNames;

function readOnlyAnnotations(untrustedContentHint = false) {
  return { readOnlyHint: true, untrustedContentHint };
}

function mutationAnnotations(untrustedContentHint = false) {
  return { readOnlyHint: false, untrustedContentHint };
}

export function createWebMcpToolDefinitions(automation) {
  return [
    {
      name: toolNames.getStatus,
      title: "Get GravityERD status",
      description: "Read the current GravityERD schema fingerprint, view, simulation, autosave, WebMCP, dirty, and proposal status without changing state.",
      inputSchema: emptyInputSchema,
      annotations: readOnlyAnnotations(),
      execute: () => automation.getStatus()
    },
    {
      name: toolNames.getImportProposal,
      title: "Get GravityERD import proposal",
      description: "Read the current visible import proposal and its fingerprint-bound summary without changing state.",
      inputSchema: emptyInputSchema,
      annotations: readOnlyAnnotations(),
      execute: () => automation.getImportProposal()
    },
    {
      name: toolNames.getWorkspaceJson,
      title: "Get GravityERD workspace JSON",
      description: "Return the current workspace-only JSON string, or null when no workspace is loaded. The output may contain untrusted imported identifiers.",
      inputSchema: emptyInputSchema,
      annotations: readOnlyAnnotations(true),
      execute: () => automation.getWorkspaceJson()
    },
    {
      name: toolNames.getProjectJson,
      title: "Get GravityERD project JSON",
      description: "Return the current workspace-with-schema JSON string, or null when no schema is loaded. The output contains untrusted imported schema metadata.",
      inputSchema: emptyInputSchema,
      annotations: readOnlyAnnotations(true),
      execute: () => automation.getProjectJson()
    },
    {
      name: toolNames.getNode,
      title: "Get GravityERD table state",
      description: "Read position, pin, domain, and rendered position for one stable table ID in the active view without changing state.",
      inputSchema: {
        type: "object",
        properties: { stableTableId: { type: "string", minLength: 1 } },
        required: ["stableTableId"],
        additionalProperties: false
      },
      annotations: readOnlyAnnotations(true),
      execute: ({ stableTableId }) => automation.getNode(stableTableId)
    },
    {
      name: toolNames.proposeImport,
      title: "Propose GravityERD import",
      description: "Validate one or two serialized GravityERD JSON documents and open the normal visible proposal without changing the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          documents: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } }
        },
        required: ["documents"],
        additionalProperties: false
      },
      annotations: mutationAnnotations(true),
      execute: ({ documents }) => automation.proposeImport(documents)
    },
    {
      name: toolNames.proposeSchemaUpdate,
      title: "Propose GravityERD schema update",
      description: "Validate one serialized schema-bearing GravityERD document and open a visible schema-only proposal that preserves matching workspace state.",
      inputSchema: {
        type: "object",
        properties: { document: { type: "string" } },
        required: ["document"],
        additionalProperties: false
      },
      annotations: mutationAnnotations(true),
      execute: ({ document }) => automation.proposeSchemaUpdate(document)
    },
    {
      name: toolNames.applyImportProposal,
      title: "Apply GravityERD import proposal",
      description: "Apply only the current visible proposal using its exact fingerprint and explicit configuration, layout, and pin choices.",
      inputSchema: {
        type: "object",
        properties: {
          expectedFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
          configuration: { type: "boolean" },
          layout: { type: "boolean" },
          pins: { type: "boolean" }
        },
        required: ["expectedFingerprint", "configuration", "layout", "pins"],
        additionalProperties: false
      },
      annotations: mutationAnnotations(),
      execute: (selection) => automation.applyImportProposal(selection)
    },
    {
      name: toolNames.discardImportProposal,
      title: "Discard GravityERD import proposal",
      description: "Close and discard the current visible proposal without changing the workspace.",
      inputSchema: emptyInputSchema,
      annotations: mutationAnnotations(),
      execute: () => automation.discardImportProposal()
    }
  ];
}

export async function registerWebMcpTools(modelContext, automation) {
  if (!modelContext || typeof modelContext.registerTool !== "function") return null;
  const controller = new AbortController();
  try {
    for (const tool of createWebMcpToolDefinitions(automation)) {
      await modelContext.registerTool(tool, { signal: controller.signal });
    }
  } catch (error) {
    controller.abort(error);
    throw error;
  }
  return controller;
}
