//go:build integration

package exporter

import (
	"bytes"
	"context"
	"database/sql"
	"os"
	"testing"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestDatabaseExporters(t *testing.T) {
	tests := []struct {
		name, driver, url, namespace string
		export                       func(context.Context, Database, Options) (Schema, error)
	}{
		{"postgresql", "pgx", os.Getenv("POSTGRES_TEST_URL"), "public", PostgreSQL},
		{"mysql", "mysql", os.Getenv("MYSQL_TEST_URL"), "gravityerd", MySQL},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if test.url == "" {
				t.Fatal("integration database URL is required")
			}
			database, err := sql.Open(test.driver, test.url)
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			first, err := test.export(context.Background(), database, Options{Namespace: test.namespace, Excluded: map[string]bool{}})
			if err != nil {
				t.Fatal(err)
			}
			if len(first.Tables) != 3 {
				t.Fatalf("got %d tables", len(first.Tables))
			}
			if len(first.ForeignKeys) != 2 {
				t.Fatalf("got %d foreign keys", len(first.ForeignKeys))
			}
			if first.Tables[2].Name != "případy" {
				t.Fatalf("UTF-8 table was not preserved: %#v", first.Tables)
			}
			firstJSON, err := MarshalProject(first)
			if err != nil {
				t.Fatal(err)
			}
			second, err := test.export(context.Background(), database, Options{Namespace: test.namespace, Excluded: map[string]bool{}})
			if err != nil {
				t.Fatal(err)
			}
			secondJSON, err := MarshalProject(second)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(firstJSON, secondJSON) {
				t.Fatal("repeated export differs")
			}
			excluded, err := test.export(context.Background(), database, Options{Namespace: test.namespace, Excluded: map[string]bool{"case_events": true}})
			if err != nil {
				t.Fatal(err)
			}
			if len(excluded.Tables) != 2 || len(excluded.ForeignKeys) != 1 {
				t.Fatalf("exclude did not preserve integrity: %d tables, %d FKs", len(excluded.Tables), len(excluded.ForeignKeys))
			}
			untrusted, err := test.export(context.Background(), database, Options{Namespace: test.namespace + "' OR '1'='1", Excluded: map[string]bool{}})
			if err != nil {
				t.Fatal(err)
			}
			if len(untrusted.Tables) != 0 || len(untrusted.ForeignKeys) != 0 {
				t.Fatal("namespace was not treated as an exact query parameter")
			}
		})
	}
}
