package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteProjectFileIsAtomicAndPrivate(t *testing.T) {
	directory := t.TempDir()
	output := filepath.Join(directory, "schema.gravityerd.json")
	if err := os.WriteFile(output, []byte("old\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeProjectFile(output, []byte("new\n")); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new\n" {
		t.Fatalf("unexpected contents %q", contents)
	}
	info, err := os.Stat(output)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("output permissions are %o", info.Mode().Perm())
	}
	matches, err := filepath.Glob(filepath.Join(directory, ".gravityerd-*.tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temporary files were not removed: %v", matches)
	}
}

func TestWriteProjectFileReplacesSymlinkWithoutFollowingIt(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "target.json")
	output := filepath.Join(directory, "schema.gravityerd.json")
	if err := os.WriteFile(target, []byte("target\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, output); err != nil {
		t.Skipf("symlinks are unavailable: %v", err)
	}
	if err := writeProjectFile(output, []byte("project\n")); err != nil {
		t.Fatal(err)
	}
	targetContents, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(targetContents) != "target\n" {
		t.Fatal("symlink target was overwritten")
	}
	outputContents, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(outputContents) != "project\n" {
		t.Fatalf("unexpected output contents %q", outputContents)
	}
}
