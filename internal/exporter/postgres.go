package exporter

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

func PostgreSQL(ctx context.Context, database Database, options Options) (Schema, error) {
	if err := requireNamespace(options.Namespace); err != nil { return Schema{}, err }
	schema := Schema{Engine: "postgresql", Namespace: options.Namespace}
	rows, err := database.QueryContext(ctx, `
SELECT c.relname, COALESCE(obj_description(c.oid, 'pg_class'), '')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relkind IN ('r','p') ORDER BY c.relname`, options.Namespace)
	if err != nil { return Schema{}, fmt.Errorf("list PostgreSQL tables: %w", err) }
	for rows.Next() {
		var table Table
		if err := rows.Scan(&table.Name, &table.Comment); err != nil { rows.Close(); return Schema{}, err }
		if !excluded(options, table.Name) { schema.Tables = append(schema.Tables, table) }
	}
	if err := rows.Close(); err != nil { return Schema{}, err }
	if err := rows.Err(); err != nil { return Schema{}, err }
	tables := tableMap(schema.Tables)

	rows, err = database.QueryContext(ctx, `
SELECT c.relname, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
       pg_get_expr(d.adbin, d.adrelid), COALESCE(col_description(c.oid, a.attnum), ''), a.attnum
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = $1 AND c.relkind IN ('r','p') ORDER BY c.relname, a.attnum`, options.Namespace)
	if err != nil { return Schema{}, fmt.Errorf("list PostgreSQL columns: %w", err) }
	for rows.Next() {
		var tableName string
		var column Column
		var defaultValue sql.NullString
		if err := rows.Scan(&tableName, &column.Name, &column.Type, &column.Nullable, &defaultValue, &column.Comment, &column.Ordinal); err != nil { rows.Close(); return Schema{}, err }
		if defaultValue.Valid { column.Default = &defaultValue.String }
		if table := tables[tableName]; table != nil { table.Columns = append(table.Columns, column) }
	}
	if err := rows.Close(); err != nil { return Schema{}, err }

	rows, err = database.QueryContext(ctx, `
SELECT c.relname, con.conname, con.contype,
       to_json(ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum ORDER BY k.ord))::text,
       pg_get_constraintdef(con.oid, true)
FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND con.contype IN ('p','u','c') ORDER BY c.relname, con.conname`, options.Namespace)
	if err != nil { return Schema{}, fmt.Errorf("list PostgreSQL constraints: %w", err) }
	for rows.Next() {
		var tableName, constraintType string
		var constraint Constraint
		var columnsJSON string
		if err := rows.Scan(&tableName, &constraint.Name, &constraintType, &columnsJSON, &constraint.Definition); err != nil { rows.Close(); return Schema{}, err }
		if err := json.Unmarshal([]byte(columnsJSON), &constraint.Columns); err != nil { rows.Close(); return Schema{}, fmt.Errorf("decode columns for %s: %w", constraint.Name, err) }
		constraint.ID = constraint.Name
		constraint.Type = map[string]string{"p": "primary_key", "u": "unique", "c": "check"}[constraintType]
		if table := tables[tableName]; table != nil { table.Constraints = append(table.Constraints, constraint) }
	}
	if err := rows.Close(); err != nil { return Schema{}, err }

	rows, err = database.QueryContext(ctx, `
SELECT con.conname, src.relname, tgt.relname,
       to_json(ARRAY_AGG(sa.attname ORDER BY keys.ord))::text, to_json(ARRAY_AGG(ta.attname ORDER BY keys.ord))::text,
       con.confdeltype::text, con.confupdtype::text, pg_get_constraintdef(con.oid, true)
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid JOIN pg_namespace n ON n.oid = src.relnamespace
JOIN pg_class tgt ON tgt.oid = con.confrelid
CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS keys(srcnum, tgtnum, ord)
JOIN pg_attribute sa ON sa.attrelid = src.oid AND sa.attnum = keys.srcnum
JOIN pg_attribute ta ON ta.attrelid = tgt.oid AND ta.attnum = keys.tgtnum
WHERE n.nspname = $1 AND con.contype = 'f'
GROUP BY con.oid, con.conname, src.relname, tgt.relname, con.confdeltype, con.confupdtype
ORDER BY src.relname, con.conname`, options.Namespace)
	if err != nil { return Schema{}, fmt.Errorf("list PostgreSQL foreign keys: %w", err) }
	for rows.Next() {
		var fk ForeignKey
		var onDelete, onUpdate, sourceColumnsJSON, targetColumnsJSON string
		if err := rows.Scan(&fk.Name, &fk.SourceTable, &fk.TargetTable, &sourceColumnsJSON, &targetColumnsJSON, &onDelete, &onUpdate, &fk.Definition); err != nil { rows.Close(); return Schema{}, err }
		if err := json.Unmarshal([]byte(sourceColumnsJSON), &fk.SourceColumns); err != nil { rows.Close(); return Schema{}, fmt.Errorf("decode source columns for %s: %w", fk.Name, err) }
		if err := json.Unmarshal([]byte(targetColumnsJSON), &fk.TargetColumns); err != nil { rows.Close(); return Schema{}, fmt.Errorf("decode target columns for %s: %w", fk.Name, err) }
		if tables[fk.SourceTable] == nil || tables[fk.TargetTable] == nil { continue }
		fk.OnDelete, fk.OnUpdate = deleteRule(onDelete), deleteRule(onUpdate)
		schema.ForeignKeys = append(schema.ForeignKeys, fk)
	}
	if err := rows.Close(); err != nil { return Schema{}, err }
	Normalize(&schema)
	return schema, nil
}
