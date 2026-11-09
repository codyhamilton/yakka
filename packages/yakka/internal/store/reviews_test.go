package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func TestReviewInputContentAddressingIsolationAndBlobInventory(t *testing.T) {
	root := t.TempDir()
	a, err := Open(filepath.Join(root, "a"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := Open(filepath.Join(root, "b"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	content := []byte("post-scan captured diff\n")
	hash := keys.ContentHash(content)
	if err := a.WriteReviewInput(hash, content); err != nil {
		t.Fatal(err)
	}
	got, err := a.ReadReviewInput(hash)
	if err != nil || string(got) != string(content) {
		t.Fatalf("round trip = %q, %v", got, err)
	}
	if _, err := b.ReadReviewInput(hash); !os.IsNotExist(err) {
		t.Fatalf("other tenant read = %v", err)
	}
	if err := a.WriteReviewInput(hash, []byte("wrong")); err == nil {
		t.Fatal("accepted mismatched input hash")
	}
	if err := os.WriteFile(filepath.Join(a.Dir(), "review-inputs", hash[:2], hash), []byte("corrupt"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.ReadReviewInput(hash); err == nil {
		t.Fatal("read accepted corrupted input")
	}
	entries, err := os.ReadDir(filepath.Join(a.Dir(), "blobs"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("blob screening inventory = %v, %v", entries, err)
	}
	if _, err := os.Stat(filepath.Join(a.Dir(), "pending", hash)); !os.IsNotExist(err) {
		t.Fatalf("review input entered pending: %v", err)
	}
}

func TestReviewRecordFiltersAreTenantScopedAndBounded(t *testing.T) {
	root := t.TempDir()
	a, err := Open(filepath.Join(root, "a"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := Open(filepath.Join(root, "b"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	rows := []FactRow{{RowHash: "one", Type: "review_run", ConversationID: "review:a", RepoID: "r", TS: 10,
		Raw: []byte(`{"repo_id":"r","plan":"p","phase":4,"kind":"phase","status":"ok","effective_effort":"high","profile":"historical_trial","manifest_hash":"mh"}`)},
		{RowHash: "two", Type: "review_run", ConversationID: "review:b", RepoID: "r", TS: 20,
			Raw: []byte(`{"repo_id":"r","plan":"p","phase":4,"kind":"phase","status":"unavailable","effective_effort":"high","profile":"historical_trial","manifest_hash":"mh"}`)}}
	inserted, err := a.AppendReviewRuns(context.Background(), rows)
	if err != nil || len(inserted) != 2 || !inserted[0] || !inserted[1] {
		t.Fatalf("append = %v, %v", inserted, err)
	}
	dup, err := a.AppendReviewRuns(context.Background(), rows[:1])
	if err != nil || dup[0] {
		t.Fatalf("duplicate append = %v, %v", dup, err)
	}
	phase := 4
	got, err := a.ReviewRecords(context.Background(), ReviewRecordFilter{RepoID: "r", Plan: "p", Kind: "phase", Effort: "high", Profile: "historical_trial", ManifestHash: "mh", Phase: &phase, Since: 15, Limit: 1})
	if err != nil || len(got) != 1 || got[0].TS != 20 {
		t.Fatalf("filtered records = %+v, %v", got, err)
	}
	other, err := b.ReviewRecords(context.Background(), ReviewRecordFilter{})
	if err != nil || len(other) != 0 {
		t.Fatalf("tenant b records = %+v, %v", other, err)
	}
}
