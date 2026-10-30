package sync

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/archive"
	"github.com/codyhamilton/yakka/packages/yakka/internal/clientconfig"
	"github.com/codyhamilton/yakka/packages/yakka/internal/ingest"
	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/serve"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func art(id, conv, path, content string) map[string]any {
	return map[string]any{"id": id, "type": "artifact_version", "conversation_id": conv, "harness": "h", "event": "write",
		"ts": 1700000000.5, "repo_id": "r", "path": path, "content": content,
		"content_hash": keys.ContentHash([]byte(content)), "source": "worktree"}
}

func hook(id, conv string, ts int, event string, payload map[string]any) map[string]any {
	return map[string]any{"id": id, "type": "hook_event", "conversation_id": conv, "harness": "opencode", "event": event, "ts": ts, "payload": payload}
}

func commit(id, conv, sha string) map[string]any {
	return map[string]any{"id": id, "type": "commit", "conversation_id": conv, "harness": "h", "event": "commit", "ts": 1700000002,
		"repo_id": "r", "sha": sha, "paths": []string{"a"}, "renames": []map[string]string{{"from": "a", "to": "b"}}}
}

func ingestInto(t *testing.T, dir string, facts ...map[string]any) {
	t.Helper()
	tn, err := store.Open(dir, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer tn.Close()
	var raws []json.RawMessage
	for _, f := range facts {
		b, _ := json.Marshal(f)
		raws = append(raws, b)
	}
	res, err := ingest.Ingest(context.Background(), tn, raws)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range res {
		if r.Status == ingest.Rejected {
			t.Fatalf("fixture rejected: %+v", r)
		}
	}
}

func toolDone(id string) map[string]any {
	return hook(id, "c1", 1700000001, "tool.execute.after", map[string]any{"hook_event_name": "tool.execute.after",
		"tool_name": "read", "tool_response": "ok"})
}

// remote starts a keyed-mode collector with one tenant "t" and returns its URL and tenant dir.
func remote(t *testing.T) (url, dir string) {
	t.Helper()
	data := t.TempDir()
	s := serve.New(serve.Config{Data: data, Keys: []serve.KeyPair{{Tenant: "t", Key: "kt"}}}, serve.Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return srv.URL, filepath.Join(data, "t")
}

func opts(t *testing.T, src, url string) Options {
	return Options{Source: src, To: "t", Cred: clientconfig.Config{Endpoint: url, Key: "kt"},
		StateDir: t.TempDir(), AllowLoopback: true, BackoffMin: time.Millisecond, BackoffMax: 5 * time.Millisecond}
}

func remoteFacts(t *testing.T, dir string) []store.SyncRow {
	t.Helper()
	if _, err := os.Stat(filepath.Join(dir, "ledger.db")); err != nil {
		return nil // the collector opens a tenant on its first request
	}
	ro, err := store.OpenReadOnly(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer ro.Close()
	rows, err := ro.FactsAfter(context.Background(), 0, 100000)
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func total(c TypeCounts) int {
	n := 0
	for _, v := range c {
		n += v
	}
	return n
}

func TestSyncCopiesDedupsAndIsIncremental(t *testing.T) {
	src := t.TempDir()
	ingestInto(t, src,
		art("a#0", "c1", "docs/plans/01-x/DESIGN.md", "# one\n"),
		toolDone("a#1"),
		commit("a#2", "c1", "abc"),
		art("a#3", "c1", "docs/plans/01-x/DESIGN.md", "# two\n"),
	)
	// A promoted artifact reads from blobs/, a pending one from pending/.
	tn, err := store.Open(src, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if err := tn.Promote(context.Background(), keys.ContentHash([]byte("# one\n")), store.Screen{Verdict: "pass", Scorer: "t"}); err != nil {
		t.Fatal(err)
	}
	tn.Close()

	url, rdir := remote(t)
	o := opts(t, src, url)

	o.DryRun = true
	rep, err := Run(context.Background(), o)
	if err != nil || total(rep.Accepted) != 4 || len(remoteFacts(t, rdir)) != 0 {
		t.Fatalf("dry run: %v %+v remote=%d", err, rep, len(remoteFacts(t, rdir)))
	}
	if _, err := os.Stat(o.cursorPath()); err == nil {
		t.Fatal("dry run wrote a cursor")
	}

	o.DryRun = false
	rep, err = Run(context.Background(), o)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Accepted["hook_event"] != 1 || rep.Accepted["artifact_version"] != 2 || rep.Accepted["commit"] != 1 || rep.Contents != 2 {
		t.Fatalf("report: %+v", rep)
	}
	if n := len(remoteFacts(t, rdir)); n != 4 {
		t.Fatalf("remote facts %d", n)
	}
	blob := filepath.Join(rdir, "pending", keys.ContentHash([]byte("# two\n")))
	if b, err := os.ReadFile(blob); err != nil || string(b) != "# two\n" {
		t.Fatalf("remote content: %q %v", b, err)
	}

	// A rerun sends nothing; only new facts go next.
	rep, err = Run(context.Background(), o)
	if err != nil || total(rep.Accepted)+total(rep.Duplicate) != 0 {
		t.Fatalf("rerun: %v %+v", err, rep)
	}
	ingestInto(t, src, commit("a#4", "c1", "def"))
	rep, err = Run(context.Background(), o)
	if err != nil || rep.Accepted["commit"] != 1 || total(rep.Accepted)+total(rep.Duplicate) != 1 {
		t.Fatalf("incremental: %v %+v", err, rep)
	}

	// Losing the cursor resends everything as duplicates.
	if err := os.Remove(o.cursorPath()); err != nil {
		t.Fatal(err)
	}
	rep, err = Run(context.Background(), o)
	if err != nil || total(rep.Duplicate) != 5 || total(rep.Accepted) != 0 {
		t.Fatalf("full resend: %v %+v", err, rep)
	}
	if n := len(remoteFacts(t, rdir)); n != 5 {
		t.Fatalf("remote facts after resend %d", n)
	}
}

func mustRead(t *testing.T, dir, conv string) []archive.Line {
	t.Helper()
	l, err := archive.Read(dir, conv)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func TestSyncSkipsFactsWithoutBodyOrContent(t *testing.T) {
	src := t.TempDir()
	ingestInto(t, src,
		art("a#0", "c1", "docs/plans/01-x/DESIGN.md", "# gone\n"),
		toolDone("a#1"),
		commit("a#2", "c1", "abc"),
	)
	if err := os.Remove(filepath.Join(src, "pending", keys.ContentHash([]byte("# gone\n")))); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(src, "archive")); err != nil {
		t.Fatal(err)
	}
	url, rdir := remote(t)
	rep, err := Run(context.Background(), opts(t, src, url))
	if err != nil || rep.NoBody != 1 || rep.NoContent != 1 || rep.Accepted["commit"] != 1 || len(remoteFacts(t, rdir)) != 1 {
		t.Fatalf("%v %+v", err, rep)
	}
}

// stub is a collector double that counts ingest posts.
func stub(t *testing.T, whoami func(w http.ResponseWriter), ingestH func(w http.ResponseWriter, ids []string, call int32)) (string, *int32) {
	t.Helper()
	var posts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/whoami":
			whoami(w)
		case "/v1/ingest":
			n := atomic.AddInt32(&posts, 1)
			var body struct {
				Facts []map[string]any `json:"facts"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			ids := make([]string, len(body.Facts))
			for i, f := range body.Facts {
				ids[i], _ = f["id"].(string)
			}
			ingestH(w, ids, n)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv.URL, &posts
}

func acceptAll(w http.ResponseWriter, ids []string, _ int32) {
	res := make([]ingest.Result, len(ids))
	for i, id := range ids {
		res[i] = ingest.Result{ID: id, Status: ingest.Accepted}
	}
	json.NewEncoder(w).Encode(map[string]any{"results": res})
}

func whoamiOK(w http.ResponseWriter) {
	w.Write([]byte(`{"tenant":"t","scope":"read_write","expires_at":0}`))
}

func TestSyncPreflightRefusals(t *testing.T) {
	src := t.TempDir()
	ingestInto(t, src, commit("a#0", "c1", "abc"))
	cases := map[string]struct {
		whoami func(w http.ResponseWriter)
		mut    func(o *Options)
		want   string
	}{
		"no whoami":     {func(w http.ResponseWriter) { w.WriteHeader(404) }, nil, "no /v1/whoami"},
		"bad token":     {func(w http.ResponseWriter) { w.WriteHeader(401) }, nil, "not accepted"},
		"wrong tenant":  {func(w http.ResponseWriter) { w.Write([]byte(`{"tenant":"u","scope":"read_write"}`)) }, nil, `bound to tenant "u"`},
		"read scope":    {func(w http.ResponseWriter) { w.Write([]byte(`{"tenant":"t","scope":"read"}`)) }, nil, "needs read_write"},
		"loopback":      {whoamiOK, func(o *Options) { o.AllowLoopback = false }, "loopback"},
		"no credential": {whoamiOK, func(o *Options) { o.Cred = clientconfig.Config{} }, "no sync credential"},
		"no --to":       {whoamiOK, func(o *Options) { o.To = "" }, "--to is required"},
	}
	for name, c := range cases {
		url, posts := stub(t, c.whoami, acceptAll)
		o := opts(t, src, url)
		if c.mut != nil {
			c.mut(&o)
		}
		_, err := Run(context.Background(), o)
		if !errors.Is(err, ErrPreflight) || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: %v", name, err)
		}
		if *posts != 0 {
			t.Errorf("%s: %d ingest posts", name, *posts)
		}
	}
	// A ledger at another schema version is refused.
	url, posts := stub(t, whoamiOK, acceptAll)
	db := filepath.Join(t.TempDir(), "x")
	ingestInto(t, db, commit("a#0", "c1", "abc"))
	tn, _ := store.OpenExclusive(db, store.Options{})
	if _, err := tn.Raw().Exec("PRAGMA user_version = 3"); err != nil {
		t.Fatal(err)
	}
	tn.Close()
	if _, err := Run(context.Background(), opts(t, db, url)); !errors.Is(err, ErrPreflight) || !strings.Contains(err.Error(), "schema version 3") || *posts != 0 {
		t.Errorf("schema: %v posts=%d", err, *posts)
	}
}

func TestSyncSplitsRetriesAndSkipsOversize(t *testing.T) {
	src := t.TempDir()
	ingestInto(t, src,
		commit("a#0", "c1", "a1"), commit("a#1", "c1", "a2"), commit("a#2", "c1", "a3"), commit("a#3", "c1", "a4"))
	// 500 on the first post, 413 for any batch over one fact and for the fact sync:3 alone.
	url, _ := stub(t, whoamiOK, func(w http.ResponseWriter, ids []string, call int32) {
		switch {
		case call == 1:
			w.WriteHeader(500)
		case len(ids) > 1:
			w.WriteHeader(413)
		case ids[0] == "sync:3":
			w.WriteHeader(413)
		default:
			acceptAll(w, ids, call)
		}
	})
	rep, err := Run(context.Background(), opts(t, src, url))
	if err != nil || rep.Accepted["commit"] != 3 || rep.TooLarge != 1 {
		t.Fatalf("%v %+v", err, rep)
	}
}

func TestSyncRateLimitAndAuthFailure(t *testing.T) {
	src := t.TempDir()
	ingestInto(t, src, commit("a#0", "c1", "a1"), commit("a#1", "c1", "a2"))
	url, posts := stub(t, whoamiOK, func(w http.ResponseWriter, ids []string, call int32) {
		if call == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(429)
			return
		}
		acceptAll(w, ids, call)
	})
	start := time.Now()
	rep, err := Run(context.Background(), opts(t, src, url))
	if err != nil || total(rep.Accepted) != 2 || *posts != 2 || time.Since(start) < time.Second {
		t.Fatalf("%v %+v posts=%d in %v", err, rep, *posts, time.Since(start))
	}

	url, _ = stub(t, whoamiOK, func(w http.ResponseWriter, ids []string, call int32) { w.WriteHeader(403) })
	o := opts(t, src, url)
	if _, err := Run(context.Background(), o); !errors.Is(err, ErrAuth) {
		t.Fatalf("mid-run 403: %v", err)
	}
	if _, err := os.Stat(o.cursorPath()); err == nil {
		t.Fatal("cursor advanced past an unsent page")
	}
}

func TestSyncReportsRejections(t *testing.T) {
	src := t.TempDir()
	ingestInto(t, src, commit("a#0", "c1", "a1"))
	url, _ := stub(t, whoamiOK, func(w http.ResponseWriter, ids []string, _ int32) {
		json.NewEncoder(w).Encode(map[string]any{"results": []ingest.Result{{ID: ids[0], Status: ingest.Rejected, Reason: "precheck: aws-key in paths[0] line 1"}}})
	})
	rep, err := Run(context.Background(), opts(t, src, url))
	if err != nil || rep.Rejected["commit"] != 1 || len(rep.Rejects) != 1 || rep.Rejects[0].ID != "sync:1" {
		t.Fatalf("%v %+v", err, rep)
	}
}

func TestSyncInterruptAndResume(t *testing.T) {
	src := t.TempDir()
	var facts []map[string]any
	for i := 0; i < 6; i++ {
		facts = append(facts, commit("a#"+string(rune('0'+i)), "c1", "sha"+string(rune('a'+i))))
	}
	ingestInto(t, src, facts...)
	url, rdir := remote(t)
	o := opts(t, src, url)
	o.PageRows, o.MaxFacts = 2, 2
	boom := errors.New("interrupted")
	o.Stop = func(sent int) error {
		if sent >= 4 {
			return boom
		}
		return nil
	}
	if _, err := Run(context.Background(), o); !errors.Is(err, boom) {
		t.Fatalf("interrupt: %v", err)
	}
	if got := o.loadCursor(); got != 2 {
		t.Fatalf("cursor after interrupt %d, want the end of the last finished page (2)", got)
	}
	o.Stop = nil
	rep, err := Run(context.Background(), o)
	if err != nil || total(rep.Accepted)+total(rep.Duplicate) != 4 {
		t.Fatalf("resume: %v %+v", err, rep)
	}
	if n := len(remoteFacts(t, rdir)); n != 6 {
		t.Fatalf("remote facts %d", n)
	}
}

func TestSyncDoesNotModifySource(t *testing.T) {
	src := t.TempDir()
	ingestInto(t, src, commit("a#0", "c1", "a1"), art("a#1", "c1", "docs/plans/01-x/DESIGN.md", "# x\n"))
	snap := func() map[string]int64 {
		m := map[string]int64{}
		filepath.Walk(src, func(p string, fi os.FileInfo, err error) error {
			if err == nil && !fi.IsDir() && !strings.HasSuffix(p, "-shm") && !strings.HasSuffix(p, "-wal") {
				m[p] = fi.Size()
			}
			return nil
		})
		return m
	}
	before := snap()
	url, _ := remote(t)
	if _, err := Run(context.Background(), opts(t, src, url)); err != nil {
		t.Fatal(err)
	}
	after := snap()
	if len(before) != len(after) {
		t.Fatalf("files changed: %v -> %v", before, after)
	}
	for p, n := range before {
		if after[p] != n {
			t.Fatalf("%s changed size %d -> %d", p, n, after[p])
		}
	}
}

// A row whose event the ingest policy removes is counted and skipped before any archive read, so a
// ledger stored before the rule is not sent. The nil ReadOnly proves no archive is touched.
func TestBuildSkipsEventsTheRemoveListDrops(t *testing.T) {
	rows := []store.SyncRow{
		{Rowid: 1, Type: "hook_event", ConversationID: "c1", Harness: "opencode", Event: "message.part.updated", RowHash: "h1"},
		{Rowid: 2, Type: "hook_event", ConversationID: "c1", Harness: "opencode", Event: "message.updated", RowHash: "h2"},
		{Rowid: 3, Type: "hook_event", ConversationID: "c1", Harness: "opencode", Event: "session.diff", RowHash: "h3"},
	}
	var rep Report
	out, err := build(nil, rows, &rep)
	if err != nil || len(out) != 0 || rep.Removed != 3 || rep.NoBody != 0 {
		t.Fatalf("%v out=%d %+v", err, len(out), rep)
	}
}
