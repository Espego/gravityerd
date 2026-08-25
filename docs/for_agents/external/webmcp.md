# WebMCP draft snapshot

Checked: 2026-08-25

Primary source: https://webmachinelearning.github.io/webmcp/

Implementation-relevant draft details:

- The imperative API is exposed as `document.modelContext` in secure contexts.
- Pages register tools with `document.modelContext.registerTool(tool, options)`.
- Tool names are limited to 128 characters and ASCII alphanumeric characters plus `_`, `-`, and `.`.
- A tool has a name, optional title, description, JSON input schema, execute callback, and optional `readOnlyHint` and `untrustedContentHint` annotations.
- Registration returns a promise. An `AbortSignal` can unregister a tool.
- The draft includes a `tools` permissions-policy feature and same-origin exposure defaults.
- Input/output schema validation, output schemas, user elicitation, and several error details remain active design questions.

GravityERD must therefore keep WebMCP in a feature-detected adapter, preserve its existing public automation facade, and treat registration failure as non-fatal.
