package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func listing(t *testing.T, dir string) []string {
	t.Helper()
	var out []string
	filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err == nil {
			out = append(out, p)
		}
		return nil
	})
	return out
}

func TestOpenReadOnly(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "tenant")
	tn, err := Open(dir, Options{})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := tn.Append(ctx, []FactRow{row(1, "x"), row(2, "x"), row(3, "x")}); err != nil {
		t.Fatal(err)
	}
	body := []byte("hello")
	h := keys.ContentHash(body)
	if err := tn.WritePending(h, body); err != nil {
		t.Fatal(err)
	}
	tn.Close()
	before := listing(t, dir)

	r, err := OpenReadOnly(dir)
	if err != nil {
		t.Fatal(err)
	}
	if v, err := r.UserVersion(ctx); err != nil || v != SchemaVersion() {
		t.Fatalf("user_version %d %v, want %d", v, err, SchemaVersion())
	}
	first, err := r.FactsAfter(ctx, 0, 2)
	if err != nil || len(first) != 2 || first[0].Rowid >= first[1].Rowid {
		t.Fatalf("first page: %+v %v", first, err)
	}
	rest, err := r.FactsAfter(ctx, first[1].Rowid, 10)
	if err != nil || len(rest) != 1 || rest[0].Rowid <= first[1].Rowid {
		t.Fatalf("rest: %+v %v", rest, err)
	}
	if got, ok, err := r.Content(h); err != nil || !ok || string(got) != "hello" {
		t.Fatalf("pending content: %q %v %v", got, ok, err)
	}
	if _, ok, err := r.Content(keys.ContentHash([]byte("absent"))); err != nil || ok {
		t.Fatalf("absent content: %v %v", ok, err)
	}
	if _, _, err := r.Content("../etc/passwd"); err == nil {
		t.Fatal("invalid hash accepted")
	}

	// The shared lock refuses compaction's exclusive lock while open, and serve may still open.
	if _, err := OpenExclusive(dir, Options{}); !errors.Is(err, ErrLocked) {
		t.Fatalf("exclusive while read-only open: %v", err)
	}
	other, err := Open(dir, Options{})
	if err != nil {
		t.Fatalf("shared open alongside read-only: %v", err)
	}
	other.Close()
	r.Close()
	before = listing(t, dir) // the second Open may have created WAL files; compare around the read-only open alone
	r, err = OpenReadOnly(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.FactsAfter(ctx, 0, 10); err != nil {
		t.Fatal(err)
	}
	r.Close()
	if after := listing(t, dir); !reflect.DeepEqual(before, after) {
		t.Fatalf("read-only open changed the directory:\n before %v\n after  %v", before, after)
	}
	if ex, err := OpenExclusive(dir, Options{}); err != nil {
		t.Fatalf("exclusive after close: %v", err)
	} else {
		ex.Close()
	}
}

func TestOpenReadOnlyMissing(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nope")
	if _, err := OpenReadOnly(dir); err == nil {
		t.Fatal("missing dir opened")
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("OpenReadOnly created %s", dir)
	}
	empty := t.TempDir()
	if _, err := OpenReadOnly(empty); err == nil {
		t.Fatal("dir without ledger.db opened")
	}
	if got := listing(t, empty); len(got) != 1 {
		t.Fatalf("OpenReadOnly wrote into an empty dir: %v", got)
	}
}
