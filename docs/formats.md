# GravityERD JSON formats

GravityERD format version 1 defines two envelopes. Both use UTF-8 JSON and stable IDs that do not include a development or production database name.

## `gravityerd-project`

A project always contains one schema namespace and may embed a workspace:

Use a project when the recipient must be able to open the diagram without separately obtaining the database schema.

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

## `gravityerd-workspace`

A workspace is bound to the normalized schema SHA-256 fingerprint and contains:

Use a workspace when the schema is already available and only the human layout and visualization configuration should be reviewed or versioned separately.

- domains with colors and table membership;
- the built-in `all` view plus custom views;
- relationship groups with explicit relationship IDs and/or source-column rules;
- physical settings, positions, and pins per calculated view.

`secondary: true` excludes a relationship group from angular fan forces. `visible: false` hides it. `weight` scales attraction. Explicit relationship membership takes precedence over source-column rules; otherwise the relationship belongs to `primary`.

Color strings remain round-trip compatible. Rendering and draw.io export use a color only when it is a six-digit `#RRGGBB` value; unsupported values safely fall back to the built-in palette.

See the normative schemas in `schemas/`.

## Import and merge

The file chooser accepts one combined project, a schema-only project plus a workspace in either order, or a workspace for the currently open schema. A separate workspace takes precedence over an embedded one.

Every import first creates a non-mutating proposal. Configuration, positions, and pins can be approved separately. When fingerprints differ, merge uses stable IDs:

- matching objects retain eligible workspace data;
- removed objects are reported and discarded;
- new tables receive deterministic initial positions and are bootstrapped around temporarily fixed retained nodes;
- invalid IDs are filtered and reported by the preview counts.

Autosave stores only the workspace in IndexedDB under the fingerprint. The schema is not persisted unless the user explicitly exports a combined project.

## Legacy imports

GravityERD accepts the former PePa6 schema JSON and workspace state version 2. A legacy `combined` snapshot becomes `all`; `topologyTension` becomes `fanTension`; obsolete edge/node and edge/edge forces are ignored. Coordinates and exact matching pins remain intact. Non-portable view classifications are not inferred from table names.
