package exporter

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const ProjectKind = "gravityerd-project"

type Project struct {
	Kind    string `json:"kind"`
	Version int    `json:"version"`
	Schema  Schema `json:"schema"`
}

type Schema struct {
	Engine      string       `json:"engine"`
	Namespace   string       `json:"namespace"`
	Tables      []Table      `json:"tables"`
	ForeignKeys []ForeignKey `json:"foreignKeys"`
}

type Table struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Comment     string       `json:"comment,omitempty"`
	Columns     []Column     `json:"columns"`
	Constraints []Constraint `json:"constraints"`
}

type Column struct {
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	Nullable bool    `json:"nullable"`
	Default  *string `json:"default,omitempty"`
	Comment  string  `json:"comment,omitempty"`
	Ordinal  int     `json:"ordinal"`
}

type Constraint struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Type       string   `json:"type"`
	Columns    []string `json:"columns"`
	Definition string   `json:"definition"`
}

type ForeignKey struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	SourceTable   string   `json:"sourceTable"`
	SourceColumns []string `json:"sourceColumns"`
	TargetTable   string   `json:"targetTable"`
	TargetColumns []string `json:"targetColumns"`
	OnDelete      string   `json:"onDelete"`
	OnUpdate      string   `json:"onUpdate"`
	Definition    string   `json:"definition"`
}

func StableForeignKeyID(source string, sourceColumns []string, target string, targetColumns []string) string {
	return fmt.Sprintf("%s(%s)>%s(%s)", source, strings.Join(sourceColumns, ","), target, strings.Join(targetColumns, ","))
}

func Normalize(schema *Schema) {
	for i := range schema.Tables {
		table := &schema.Tables[i]
		table.ID = table.Name
		sort.Slice(table.Columns, func(i, j int) bool { return table.Columns[i].Ordinal < table.Columns[j].Ordinal })
		sort.Slice(table.Constraints, func(i, j int) bool { return table.Constraints[i].ID < table.Constraints[j].ID })
	}
	sort.Slice(schema.Tables, func(i, j int) bool { return schema.Tables[i].ID < schema.Tables[j].ID })
	for i := range schema.ForeignKeys {
		fk := &schema.ForeignKeys[i]
		fk.ID = StableForeignKeyID(fk.SourceTable, fk.SourceColumns, fk.TargetTable, fk.TargetColumns)
	}
	sort.Slice(schema.ForeignKeys, func(i, j int) bool { return schema.ForeignKeys[i].ID < schema.ForeignKeys[j].ID })
}

func MarshalProject(schema Schema) ([]byte, error) {
	Normalize(&schema)
	var output bytes.Buffer
	encoder := json.NewEncoder(&output)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(Project{Kind: ProjectKind, Version: 1, Schema: schema}); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func Fingerprint(schema Schema) (string, error) {
	Normalize(&schema)
	value, err := json.Marshal(schema)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:]), nil
}
