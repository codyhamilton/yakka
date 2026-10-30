package store

import (
	"context"
	"os"
	"path/filepath"
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

	// A blob with no screen row is the worker's crash-recovery set, not a rescore target.
	orphan := keys.ContentHash([]byte("orphan-no-screen-row"))
	op := tn.blobPath(orphan)
	if err := os.MkdirAll(filepath.Dir(op), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(op, []byte("orphan-no-screen-row"), 0o600); err != nil {
		t.Fatal(err)
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

func TestDropBlobClearsUnscreenedVerdict(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	h := promoteContent(t, tn, "was unscreened", "unscreened", Score{Check: "c", Result: 1})
	if err := tn.DropBlob(ctx, h, Rejection{Stage: "screen", Pattern: "jev_screen", Reason: "flagged"}); err != nil {
		t.Fatal(err)
	}
	s, err := tn.ScreenSummary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if s.Verdicts["unscreened"] != 0 {
		t.Fatalf("stale unscreened verdict: %v", s.Verdicts)
	}
	un, err := tn.UnscoredBlobs(ctx)
	if err != nil || len(un) != 0 {
		t.Fatalf("unscored after flag: %v %v", un, err)
	}
	var screens, scores int
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM screens WHERE content_hash=?`, h).Scan(&screens); err != nil || screens != 0 {
		t.Fatalf("screen rows %d %v", screens, err)
	}
	if err := tn.rdb.QueryRow(`SELECT count(*) FROM scores WHERE content_hash=?`, h).Scan(&scores); err != nil || scores != 0 {
		t.Fatalf("score rows %d %v", scores, err)
	}
	var reason string
	if err := tn.rdb.QueryRow(`SELECT reason FROM rejections WHERE content_hash=?`, h).Scan(&reason); err != nil || reason != "flagged" {
		t.Fatalf("rejection %q %v", reason, err)
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
