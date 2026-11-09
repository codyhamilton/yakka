package store

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

func openReviewTenant(t *testing.T, dir string) *Tenant {
	t.Helper()
	tn, err := Open(dir, Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tn.Close() })
	return tn
}

func reviewFactRow(hash, conv string, ts float64, tags []string) FactRow {
	obj := map[string]any{
		"repo_id": "r", "plan": "p", "kind": "phase", "status": "ok",
		"effective_effort": "high", "profile": "shadow", "manifest_hash": "mh",
		"conversation_id": conv,
	}
	if tags != nil {
		obj["tags"] = tags
	}
	b, _ := json.Marshal(obj)
	return FactRow{RowHash: hash, Type: "review_run", ConversationID: conv, RepoID: "r", TS: ts, Raw: b}
}

func reviewConversations(rows []ReviewRecord) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.ConversationID
	}
	return out
}

func TestReviewPageWalkIsFixedAtHighWaterAndComplete(t *testing.T) {
	root := t.TempDir()
	a := openReviewTenant(t, filepath.Join(root, "a"))
	b := openReviewTenant(t, filepath.Join(root, "b"))
	ctx := context.Background()

	var rowsA []FactRow
	for i := 0; i < 1001; i++ {
		rowsA = append(rowsA, reviewFactRow(fmt.Sprintf("a-%04d", i), fmt.Sprintf("a-conv-%04d", i), 100, nil))
	}
	if _, err := a.AppendReviewRuns(ctx, rowsA); err != nil {
		t.Fatal(err)
	}
	var rowsB []FactRow
	for i := 0; i < 25; i++ {
		rowsB = append(rowsB, reviewFactRow(fmt.Sprintf("b-%04d", i), fmt.Sprintf("b-conv-%04d", i), 100, nil))
	}
	if _, err := b.AppendReviewRuns(ctx, rowsB); err != nil {
		t.Fatal(err)
	}

	hw, err := a.BeginReviewWalk(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if hw != 1001 {
		t.Fatalf("high water = %d, want 1001", hw)
	}

	seen := map[int64]string{}
	var after *ReviewPageKey
	appended := 0
	for page := 0; ; page++ {
		if page > 20 {
			t.Fatal("walk did not terminate")
		}
		records, more, err := a.ReviewPage(ctx, ReviewRecordFilter{}, hw, after, 100)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range records {
			if _, dup := seen[r.InsertionID]; dup {
				t.Fatalf("rowid %d returned twice", r.InsertionID)
			}
			seen[r.InsertionID] = r.ConversationID
			if strings.HasPrefix(r.ConversationID, "late-") {
				t.Fatalf("late row %s entered the fixed walk", r.ConversationID)
			}
		}
		if !more {
			break
		}
		if len(records) != 100 {
			t.Fatalf("nonterminal page of %d rows", len(records))
		}
		last := records[len(records)-1]
		after = &ReviewPageKey{TS: last.TS, InsertionID: last.InsertionID}
		if page == 0 {
			late := []FactRow{
				reviewFactRow("late-1", "late-conv-1", 50, nil),
				reviewFactRow("late-2", "late-conv-2", 1, nil),
			}
			if _, err := a.AppendReviewRuns(ctx, late); err != nil {
				t.Fatal(err)
			}
			appended = len(late)
		}
	}
	if appended != 2 {
		t.Fatal("late rows were not appended after the first page")
	}
	if len(seen) != 1001 {
		t.Fatalf("walk returned %d rows, want 1001", len(seen))
	}
	for _, conv := range seen {
		if strings.HasPrefix(conv, "b-conv-") {
			t.Fatalf("tenant b row %s leaked into tenant a walk", conv)
		}
	}

	hwb, err := b.BeginReviewWalk(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if hwb != 25 {
		t.Fatalf("tenant b high water = %d, want 25", hwb)
	}
}

func TestReviewPageTagFiltersAreConjunctive(t *testing.T) {
	tn := openReviewTenant(t, filepath.Join(t.TempDir(), "a"))
	ctx := context.Background()
	rows := []FactRow{
		reviewFactRow("t1", "conv-ab", 10, []string{"a", "b"}),
		reviewFactRow("t2", "conv-a", 20, []string{"a"}),
		reviewFactRow("t3", "conv-bc", 30, []string{"b", "c"}),
		reviewFactRow("t4", "conv-none", 40, nil),
		reviewFactRow("t5", "conv-empty", 50, []string{}),
	}
	if _, err := tn.AppendReviewRuns(ctx, rows); err != nil {
		t.Fatal(err)
	}
	hw, err := tn.BeginReviewWalk(ctx)
	if err != nil {
		t.Fatal(err)
	}
	page := func(f ReviewRecordFilter) []string {
		t.Helper()
		got, more, err := tn.ReviewPage(ctx, f, hw, nil, 100)
		if err != nil {
			t.Fatal(err)
		}
		if more {
			t.Fatalf("single page reported more rows for %+v", f.Tags)
		}
		return reviewConversations(got)
	}

	if got := page(ReviewRecordFilter{}); len(got) != 5 {
		t.Fatalf("empty filter conversations = %v, want all 5", got)
	}
	if got := page(ReviewRecordFilter{Tags: []string{}}); len(got) != 5 {
		t.Fatalf("empty tag list conversations = %v, want all 5", got)
	}
	if got := page(ReviewRecordFilter{Tags: []string{"a", "b"}}); len(got) != 1 || got[0] != "conv-ab" {
		t.Fatalf("tags a AND b = %v, want [conv-ab]", got)
	}
	if got := page(ReviewRecordFilter{Tags: []string{"a"}}); len(got) != 2 || got[1] != "conv-ab" || got[0] != "conv-a" {
		t.Fatalf("tags a = %v, want [conv-a conv-ab]", got)
	}
	if got := page(ReviewRecordFilter{Tags: []string{"missing"}}); len(got) != 0 {
		t.Fatalf("unknown tag = %v, want none", got)
	}
}

func TestReviewPageCompletesOnExactMultipleAndEmpty(t *testing.T) {
	root := t.TempDir()
	exact := openReviewTenant(t, filepath.Join(root, "exact"))
	empty := openReviewTenant(t, filepath.Join(root, "empty"))
	ctx := context.Background()

	var rows []FactRow
	for i := 0; i < 200; i++ {
		rows = append(rows, reviewFactRow(fmt.Sprintf("e-%03d", i), fmt.Sprintf("conv-%03d", i), 100, nil))
	}
	if _, err := exact.AppendReviewRuns(ctx, rows); err != nil {
		t.Fatal(err)
	}
	hw, err := exact.BeginReviewWalk(ctx)
	if err != nil {
		t.Fatal(err)
	}
	first, more, err := exact.ReviewPage(ctx, ReviewRecordFilter{}, hw, nil, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 100 || !more {
		t.Fatalf("first page = %d rows, more=%v, want 100, true", len(first), more)
	}
	after := &ReviewPageKey{TS: first[99].TS, InsertionID: first[99].InsertionID}
	second, more, err := exact.ReviewPage(ctx, ReviewRecordFilter{}, hw, after, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(second) != 100 || more {
		t.Fatalf("second page = %d rows, more=%v, want 100, false", len(second), more)
	}

	hwEmpty, err := empty.BeginReviewWalk(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got, more, err := empty.ReviewPage(ctx, ReviewRecordFilter{}, hwEmpty, nil, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 || more {
		t.Fatalf("empty population = %d rows, more=%v, want 0, false", len(got), more)
	}
}

func TestReviewPageRejectsCorruptRaw(t *testing.T) {
	tn := openReviewTenant(t, filepath.Join(t.TempDir(), "a"))
	ctx := context.Background()
	bad := FactRow{RowHash: "bad", Type: "review_run", ConversationID: "conv-bad", RepoID: "r", TS: 1, Raw: []byte(`{"tags":`)}
	if _, err := tn.AppendReviewRuns(ctx, []FactRow{bad}); err != nil {
		t.Fatal(err)
	}
	hw, err := tn.BeginReviewWalk(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := tn.ReviewPage(ctx, ReviewRecordFilter{}, hw, nil, 10); err == nil {
		t.Fatal("corrupt raw row did not fail the page")
	}
}
