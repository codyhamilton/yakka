package store

import (
	"context"
	"strings"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func promoteContent(t *testing.T, tn *Tenant, content, verdict string, scores ...Score) string {
	t.Helper()
	h := keys.ContentHash([]byte(content))
	if err := tn.WritePending(h, []byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := tn.Promote(context.Background(), h, Screen{Verdict: verdict}, scores...); err != nil {
		t.Fatal(err)
	}
	return h
}

func TestFootprintCountsParts(t *testing.T) {
	tn := openT(t, Options{})
	promoteContent(t, tn, "# one\n", "pass")
	pend := keys.ContentHash([]byte("pending content"))
	if err := tn.WritePending(pend, []byte("pending content")); err != nil {
		t.Fatal(err)
	}
	f, err := tn.Footprint()
	if err != nil {
		t.Fatal(err)
	}
	if f.Blobs != 1 || f.BlobBytes != int64(len("# one\n")) {
		t.Fatalf("blobs: %+v", f)
	}
	if f.Pending != 1 || f.PendingBytes != int64(len("pending content")) {
		t.Fatalf("pending: %+v", f)
	}
	if f.LedgerBytes == 0 {
		t.Fatalf("ledger not measured: %+v", f)
	}
}

func TestScreenSummaryAndUnscored(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	a := promoteContent(t, tn, "a", "unscreened")
	promoteContent(t, tn, "b", "pass", Score{Check: "c1", Result: 1}, Score{Check: "c2", Result: 0})
	// a is screened again and passes: only the latest verdict counts
	c := promoteContent(t, tn, "c", "unscreened")
	if err := tn.Promote(ctx, c, Screen{Verdict: "pass"}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := tn.AppendRejection(ctx, Rejection{Stage: "screen", Pattern: "screen_error", Reason: "boom", Path: "x.md"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := tn.AppendRejection(ctx, Rejection{Stage: "ingest", Pattern: "secret", Reason: "key"}); err != nil {
		t.Fatal(err)
	}

	s, err := tn.ScreenSummary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if s.Verdicts["unscreened"] != 1 || s.Verdicts["pass"] != 2 {
		t.Fatalf("verdicts: %v", s.Verdicts)
	}
	if s.ScoredContent != 1 || s.ScoreRows != 2 {
		t.Fatalf("scores: %+v", s)
	}
	if s.TotalRejection != 3 || len(s.Rejections) != 2 || s.Rejections[0].Pattern != "screen_error" || s.Rejections[0].Count != 2 || s.Rejections[0].Last == 0 {
		t.Fatalf("rejections: %+v", s.Rejections)
	}

	un, err := tn.UnscoredBlobs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(un) != 1 || un[0] != a {
		t.Fatalf("unscored: %v", un)
	}

	recent, err := tn.RecentRejections(ctx, "screen", 1)
	if err != nil || len(recent) != 1 || recent[0].Stage != "screen" || !strings.HasSuffix(recent[0].Path, "x.md") {
		t.Fatalf("recent: %+v %v", recent, err)
	}
	all, err := tn.RecentRejections(ctx, "", 10)
	if err != nil || len(all) != 3 || all[0].Stage != "ingest" {
		t.Fatalf("all recent (newest first): %+v %v", all, err)
	}
}

func TestFactCount(t *testing.T) {
	tn := openT(t, Options{})
	if _, err := tn.Append(context.Background(), []FactRow{row(1, "x"), row(2, "x")}); err != nil {
		t.Fatal(err)
	}
	n, err := tn.FactCount(context.Background())
	if err != nil || n != 2 {
		t.Fatalf("count %d %v", n, err)
	}
}
