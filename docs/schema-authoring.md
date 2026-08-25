# Create GravityERD schema JSON

GravityERD never needs database credentials. Create schema-only input with tooling you already trust, then let an agent transform that local metadata into the public `gravityerd-project` version 1 format.

Schema metadata can still be sensitive: names, comments, defaults, and constraint definitions may reveal business concepts. Keep the input and generated JSON local and review them before sharing.

## 1. Create metadata-only input

For PostgreSQL, a plain schema-only dump contains object definitions but no table rows or statistics:

```sh
pg_dump --schema-only --no-owner --no-privileges --schema=public --file=schema.sql "$CLIENT_DATABASE_URL"
```

For MySQL, use its definition-only mode:

```sh
mysqldump --no-data app > schema.sql
```

Use credentials and connection configuration managed by your own environment. Check standard error for warnings. Do not restore or execute an untrusted dump merely to convert it; an agent can read the DDL as text. Alternatively, provide metadata collected by your own read-only catalog queries.

Official references: [PostgreSQL `pg_dump`](https://www.postgresql.org/docs/18/app-pgdump.html) documents `--schema-only`, `--schema`, `--no-owner`, and `--no-privileges`; [MySQL `mysqldump`](https://dev.mysql.com/doc/refman/8.4/en/mysqldump-definition-data-dumps.html) documents `--no-data` as producing table definitions without table contents.

## 2. Produce the project envelope

The output is UTF-8 JSON:

```json
{
  "kind": "gravityerd-project",
  "version": 1,
  "schema": {
    "engine": "postgresql",
    "namespace": "public",
    "tables": [],
    "foreignKeys": []
  }
}
```

Use `engine: "postgresql"` for PostgreSQL, `engine: "mysql"` for MySQL, or `engine: "manual"` when no database engine applies. Export one schema/database namespace per file. The namespace and database connection name are not part of table or relationship IDs.

## 3. Map objects deterministically

### Tables and columns

- Include ordinary and partitioned base tables, not views, materialized views, sequences, routines, triggers, indexes as standalone objects, or row data.
- Set both table `id` and `name` to the exact case-sensitive table name within the selected namespace.
- Preserve UTF-8 and quoted identifiers exactly after SQL unquoting.
- Sort tables by `id` using ascending Unicode code-unit order.
- Emit columns in physical ordinal order. `ordinal` is one-based.
- Preserve the database's formatted type string, nullability, textual default, and comment. Omit `default` or `comment` when unavailable; do not invent values.

### Constraints

- Emit primary keys as `primary_key`, unique constraints as `unique`, and check constraints as `check`.
- Preserve constraint column order. A check constraint may use an empty `columns` array when its referenced columns cannot be determined safely.
- Use the exact non-empty database constraint name for `id` and `name`. For a genuinely unnamed source, generate a deterministic non-empty identifier from its type, ordered columns, and normalized definition.
- Preserve a normalized textual definition and sort constraints by `id`.

### Foreign keys

- Include a foreign key only when both source and target tables are present in the selected namespace.
- Preserve the paired source and target column order. Both arrays must be non-empty and have the same length.
- Set the stable relationship ID to `source_table(source_column_1,source_column_2)>target_table(target_column_1,target_column_2)` with no spaces.
- Preserve the database constraint name separately in `name` and preserve the textual definition.
- Normalize referential actions to uppercase strings such as `NO ACTION`, `RESTRICT`, `CASCADE`, `SET NULL`, or `SET DEFAULT`.
- Sort foreign keys by their semantic `id`.

Do not include credentials, hostnames, database URLs, row samples, value distributions, or inferred business classifications.

## 4. Validate

1. Validate the file against `schemas/gravityerd-project.schema.json` with its sibling workspace schema available for reference resolution.
2. Import the file into GravityERD.
3. Inspect the visible proposal and compare its table and relationship counts with the source metadata.
4. Apply only after the counts and schema fingerprint are visible and plausible.
5. Export with schema and compare a normalized round trip if the file will be versioned or shared.

`examples/helpdesk.schema.gravityerd.json` is a complete synthetic schema-only example. `examples/helpdesk.project.gravityerd.json` shows the same schema with a workspace.

## Agent prompt

```text
Read the provided schema-only DDL or metadata locally. Never query or infer row data and never copy credentials, hostnames, or connection strings into output. Create UTF-8 gravityerd-project version 1 JSON according to docs/schema-authoring.md and schemas/gravityerd-project.schema.json. Preserve exact case-sensitive identifiers and ordered composite keys, generate semantic foreign-key IDs, sort output deterministically, validate it, and report only the resulting table and relationship counts plus validation errors.
```
