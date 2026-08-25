package exporter

import (
	"context"
	"database/sql"
	"fmt"
)

func MySQL(ctx context.Context, database Database, options Options) (Schema, error) {
	if err := requireNamespace(options.Namespace); err != nil { return Schema{}, err }
	schema := Schema{Engine: "mysql", Namespace: options.Namespace}
	rows, err := database.QueryContext(ctx, `SELECT TABLE_NAME, COALESCE(TABLE_COMMENT, '') FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`, options.Namespace)
	if err != nil { return Schema{}, fmt.Errorf("list MySQL tables: %w", err) }
	for rows.Next() {
		var table Table
		if err := rows.Scan(&table.Name, &table.Comment); err != nil { rows.Close(); return Schema{}, err }
		if !excluded(options, table.Name) { schema.Tables = append(schema.Tables, table) }
	}
	if err := rows.Close(); err != nil { return Schema{}, err }
	tables := tableMap(schema.Tables)

	rows, err = database.QueryContext(ctx, `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COALESCE(COLUMN_COMMENT, ''), ORDINAL_POSITION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`, options.Namespace)
	if err != nil { return Schema{}, fmt.Errorf("list MySQL columns: %w", err) }
	for rows.Next() {
		var tableName, nullable string
		var column Column
		var defaultValue sql.NullString
		if err := rows.Scan(&tableName, &column.Name, &column.Type, &nullable, &defaultValue, &column.Comment, &column.Ordinal); err != nil { rows.Close(); return Schema{}, err }
		column.Nullable = nullable == "YES"
		if defaultValue.Valid { column.Default = &defaultValue.String }
		if table := tables[tableName]; table != nil { table.Columns = append(table.Columns, column) }
	}
	if err := rows.Close(); err != nil { return Schema{}, err }

	type groupedConstraint struct { table, name, kind string; columns []string }
	groups := map[string]*groupedConstraint{}
	rows, err = database.QueryContext(ctx, `
SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, kcu.COLUMN_NAME
FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.KEY_COLUMN_USAGE kcu
  ON kcu.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND kcu.TABLE_NAME=tc.TABLE_NAME AND kcu.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
WHERE tc.CONSTRAINT_SCHEMA=? AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY','UNIQUE')
ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`, options.Namespace)
	if err != nil { return Schema{}, fmt.Errorf("list MySQL constraints: %w", err) }
	for rows.Next() {
		var tableName, name, kind, column string
		if err := rows.Scan(&tableName, &name, &kind, &column); err != nil { rows.Close(); return Schema{}, err }
		key := tableName + "\x00" + name
		if groups[key] == nil { groups[key] = &groupedConstraint{table: tableName, name: name, kind: kind} }
		groups[key].columns = append(groups[key].columns, column)
	}
	if err := rows.Close(); err != nil { return Schema{}, err }
	for _, key := range sortedKeys(groups) {
		group := groups[key]
		if table := tables[group.table]; table != nil {
			typeName := "unique"; if group.kind == "PRIMARY KEY" { typeName = "primary_key" }
			table.Constraints = append(table.Constraints, Constraint{ID: group.name, Name: group.name, Type: typeName, Columns: group.columns, Definition: group.kind})
		}
	}

	rows, err = database.QueryContext(ctx, `SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=? AND tc.CONSTRAINT_TYPE='CHECK' ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME`, options.Namespace)
	if err != nil { return Schema{}, fmt.Errorf("list MySQL checks: %w", err) }
	for rows.Next() {
		var tableName, name, definition string
		if err := rows.Scan(&tableName, &name, &definition); err != nil { rows.Close(); return Schema{}, err }
		if table := tables[tableName]; table != nil { table.Constraints = append(table.Constraints, Constraint{ID: name, Name: name, Type: "check", Columns: []string{}, Definition: definition}) }
	}
	if err := rows.Close(); err != nil { return Schema{}, err }

	type groupedFK struct { fk ForeignKey }
	fks := map[string]*groupedFK{}
	rows, err = database.QueryContext(ctx, `
SELECT kcu.CONSTRAINT_NAME, kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
       rc.DELETE_RULE, rc.UPDATE_RULE, kcu.ORDINAL_POSITION
FROM information_schema.KEY_COLUMN_USAGE kcu JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
 ON rc.CONSTRAINT_SCHEMA=kcu.CONSTRAINT_SCHEMA AND rc.TABLE_NAME=kcu.TABLE_NAME AND rc.CONSTRAINT_NAME=kcu.CONSTRAINT_NAME
WHERE kcu.CONSTRAINT_SCHEMA=? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`, options.Namespace)
	if err != nil { return Schema{}, fmt.Errorf("list MySQL foreign keys: %w", err) }
	for rows.Next() {
		var name, source, sourceColumn, target, targetColumn, onDelete, onUpdate string
		var ordinal int
		if err := rows.Scan(&name, &source, &sourceColumn, &target, &targetColumn, &onDelete, &onUpdate, &ordinal); err != nil { rows.Close(); return Schema{}, err }
		key := source + "\x00" + name
		if fks[key] == nil { fks[key] = &groupedFK{fk: ForeignKey{Name: name, SourceTable: source, TargetTable: target, OnDelete: onDelete, OnUpdate: onUpdate}} }
		fks[key].fk.SourceColumns = append(fks[key].fk.SourceColumns, sourceColumn)
		fks[key].fk.TargetColumns = append(fks[key].fk.TargetColumns, targetColumn)
	}
	if err := rows.Close(); err != nil { return Schema{}, err }
	for _, key := range sortedKeys(fks) {
		fk := fks[key].fk
		if tables[fk.SourceTable] == nil || tables[fk.TargetTable] == nil { continue }
		fk.Definition = fmt.Sprintf("FOREIGN KEY (%s) REFERENCES %s (%s)", joinColumns(fk.SourceColumns), fk.TargetTable, joinColumns(fk.TargetColumns))
		schema.ForeignKeys = append(schema.ForeignKeys, fk)
	}
	Normalize(&schema)
	return schema, nil
}

func joinColumns(columns []string) string {
	result := ""
	for index, column := range columns { if index > 0 { result += ", " }; result += column }
	return result
}
