package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"

	"github.com/Espego/gravityerd/internal/exporter"
)

type repeated []string

func (value *repeated) String() string { return strings.Join(*value, ",") }
func (value *repeated) Set(item string) error {
	if item == "" {
		return fmt.Errorf("table name must not be empty")
	}
	*value = append(*value, item)
	return nil
}

func main() {
	if len(os.Args) < 2 || (os.Args[1] != "postgres" && os.Args[1] != "mysql") {
		fmt.Fprintln(os.Stderr, "usage: gravityerd-schema <postgres|mysql> [options]")
		os.Exit(2)
	}
	engine := os.Args[1]
	flags := flag.NewFlagSet(engine, flag.ExitOnError)
	var namespace, output string
	var excluded repeated
	if engine == "postgres" {
		flags.StringVar(&namespace, "schema", "public", "PostgreSQL schema namespace")
	} else {
		flags.StringVar(&namespace, "database", "", "MySQL database")
	}
	flags.StringVar(&output, "output", "-", "output path or - for stdout")
	flags.Var(&excluded, "exclude-table", "table name to exclude; repeatable")
	_ = flags.Parse(os.Args[2:])
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		fatal("DATABASE_URL is required")
	}
	driver := "pgx"
	if engine == "mysql" {
		driver = "mysql"
		configuration, parseErr := mysqldriver.ParseDSN(databaseURL)
		if parseErr != nil {
			fatal(fmt.Sprintf("parse MySQL DATABASE_URL: %v", parseErr))
		}
		configuration.Collation = "utf8mb4_bin"
		if configuration.Params == nil {
			configuration.Params = map[string]string{}
		}
		configuration.Params["charset"] = "utf8mb4"
		databaseURL = configuration.FormatDSN()
	}
	database, err := sql.Open(driver, databaseURL)
	if err != nil {
		fatal(err.Error())
	}
	defer database.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := database.PingContext(ctx); err != nil {
		fatal(fmt.Sprintf("connect: %v", err))
	}
	options := exporter.Options{Namespace: namespace, Excluded: map[string]bool{}}
	for _, table := range excluded {
		options.Excluded[table] = true
	}
	var schema exporter.Schema
	if engine == "postgres" {
		schema, err = exporter.PostgreSQL(ctx, database, options)
	} else {
		schema, err = exporter.MySQL(ctx, database, options)
	}
	if err != nil {
		fatal(err.Error())
	}
	contents, err := exporter.MarshalProject(schema)
	if err != nil {
		fatal(err.Error())
	}
	if output == "-" {
		_, err = os.Stdout.Write(contents)
	} else {
		err = writeProjectFile(output, contents)
	}
	if err != nil {
		fatal(fmt.Sprintf("write output: %v", err))
	}
}

func writeProjectFile(output string, contents []byte) (resultErr error) {
	directory := filepath.Dir(output)
	temporary, err := os.CreateTemp(directory, ".gravityerd-*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	closed := false
	defer func() {
		if !closed {
			if closeErr := temporary.Close(); resultErr == nil && closeErr != nil {
				resultErr = closeErr
			}
		}
		if resultErr != nil {
			_ = os.Remove(temporaryName)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		return err
	}
	if _, err := temporary.Write(contents); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	closed = true
	if err := os.Rename(temporaryName, output); err != nil {
		return err
	}
	return nil
}

func fatal(message string) { fmt.Fprintln(os.Stderr, message); os.Exit(1) }
