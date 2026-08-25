package exporter

import (
	"bytes"
	"testing"
)

func TestMarshalProjectIsDeterministicAndUsesSemanticIDs(t *testing.T) {
	schema := Schema{Engine: "postgresql", Namespace: "public", Tables: []Table{
		{Name: "z", Columns: []Column{{Name: "id", Type: "bigint", Ordinal: 1}}},
		{Name: "a", Columns: []Column{{Name: "z_id", Type: "bigint", Ordinal: 1}}},
	}, ForeignKeys: []ForeignKey{{Name: "environment_specific_name", SourceTable: "a", SourceColumns: []string{"z_id"}, TargetTable: "z", TargetColumns: []string{"id"}}}}
	first, err := MarshalProject(schema)
	if err != nil { t.Fatal(err) }
	second, err := MarshalProject(schema)
	if err != nil { t.Fatal(err) }
	if !bytes.Equal(first, second) { t.Fatal("marshal is not deterministic") }
	if !bytes.Contains(first, []byte(`"id": "a(z_id)>z(id)"`)) { t.Fatalf("semantic relationship id is missing: %s", first) }
	if bytes.Contains(first, []byte("DATABASE_URL")) { t.Fatal("output leaked a credential key") }
}

func TestFingerprintIgnoresInputOrdering(t *testing.T) {
	first := Schema{Engine: "mysql", Namespace: "app", Tables: []Table{{Name: "b", Columns: []Column{{Name: "id", Type: "int", Ordinal: 1}}}, {Name: "a", Columns: []Column{{Name: "id", Type: "int", Ordinal: 1}}}}}
	second := Schema{Engine: "mysql", Namespace: "app", Tables: []Table{{Name: "a", Columns: []Column{{Name: "id", Type: "int", Ordinal: 1}}}, {Name: "b", Columns: []Column{{Name: "id", Type: "int", Ordinal: 1}}}}}
	firstHash, err := Fingerprint(first); if err != nil { t.Fatal(err) }
	secondHash, err := Fingerprint(second); if err != nil { t.Fatal(err) }
	if firstHash != secondHash { t.Fatalf("fingerprints differ: %s != %s", firstHash, secondHash) }
}
