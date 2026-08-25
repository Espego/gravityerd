# GravityERD JSON formats

GravityERD format version 1 defines two compatible workspace envelopes. Both use UTF-8 JSON and stable IDs that do not include a development or production database name.

The UI uses two plain concepts:

- **Schema** is refreshable database structure: tables, columns, constraints, and relationships.
- **Workspace** is everything created while exploring that schema: views, domains, relationship groups, gravity settings, positions, and pins.

A saved workspace can include its schema or omit it. The serialized kind names below remain unchanged for version 1 compatibility: `gravityerd-project` means a workspace **with** schema, while `gravityerd-workspace` means a workspace **without** schema.

## Workspace with schema: `gravityerd-project`

A `gravityerd-project` always contains one schema namespace and may embed a workspace:

Use this variant when the recipient must be able to open the diagram without separately obtaining the database schema.

```json
{
  "kind": "gravityerd-project",
  "version": 1,
  "schema": {
    "engine": "postgresql",
    "namespace": "public",
    "tables": [],
    "foreignKeys": []
  },
  "workspace": {}
}
```

Table IDs are table names within the one exported PostgreSQL schema or MySQL database. A foreign-key ID is semantic: `source_table(source_columns)>target_table(target_columns)`. The schema contains metadata only—never row data or credentials.

## Workspace without schema: `gravityerd-workspace`

A workspace is bound to the normalized schema SHA-256 fingerprint and contains:

Use a workspace when the schema is already available and only the human layout and visualization configuration should be reviewed or versioned separately.

- domains with colors and table membership;
- the built-in `all` view plus custom views;
- relationship groups with explicit relationship IDs and/or source-column rules;
- physical settings, positions, and pins per calculated view.

`secondary: true` excludes a relationship group from angular fan forces. `visible: false` hides it. `weight` scales attraction. Explicit relationship membership takes precedence over source-column rules; otherwise the relationship belongs to `primary`.

Color strings remain round-trip compatible. Rendering and draw.io export use a color only when it is a six-digit `#RRGGBB` value; unsupported values safely fall back to the built-in palette.

See the normative schemas in `schemas/`.

## Load workspace and update schema

**Load workspace** accepts one combined file, a schema-only file plus a workspace in either order, or a workspace-only file for the currently open schema. A separate workspace takes precedence over an embedded one. Loading starts with an explicit replacement warning and then creates a non-mutating proposal.

**Update schema** accepts one schema-bearing file and ignores any embedded workspace. The current workspace remains authoritative: matching views, settings, positions, and pins survive, removed table IDs are filtered out, and new tables receive deterministic bootstrap positions.

Workspace configuration, positions, and pins can be approved separately in a load proposal. When fingerprints differ, merge uses stable IDs:

- matching objects retain eligible workspace data;
- removed objects are reported and discarded;
- new tables receive deterministic initial positions and are bootstrapped around temporarily fixed retained nodes;
- invalid IDs are filtered and reported by the preview counts.

Autosave stores only the workspace in IndexedDB under the fingerprint. The schema is not persisted unless the user explicitly exports a workspace with schema.

## Legacy imports

GravityERD accepts the former PePa6 schema JSON and workspace state version 2. A legacy `combined` snapshot becomes `all`; `topologyTension` becomes `fanTension`; obsolete edge/node and edge/edge forces are ignored. Coordinates and exact matching pins remain intact. Non-portable view classifications are not inferred from table names.
