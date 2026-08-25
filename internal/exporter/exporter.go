package exporter

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
)

type Database interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

type Options struct {
	Namespace string
	Excluded  map[string]bool
}

func excluded(options Options, table string) bool { return options.Excluded[table] }

func tableMap(tables []Table) map[string]*Table {
	result := make(map[string]*Table, len(tables))
	for index := range tables {
		result[tables[index].Name] = &tables[index]
	}
	return result
}

func placeholders(count int) string {
	items := make([]string, count)
	for i := range items { items[i] = "?" }
	return strings.Join(items, ",")
}

func deleteRule(code string) string {
	return map[string]string{"a": "NO ACTION", "r": "RESTRICT", "c": "CASCADE", "n": "SET NULL", "d": "SET DEFAULT"}[code]
}

func sortedKeys[T any](values map[string]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values { keys = append(keys, key) }
	sort.Strings(keys)
	return keys
}

func requireNamespace(namespace string) error {
	if namespace == "" { return fmt.Errorf("database namespace is required") }
	return nil
}
