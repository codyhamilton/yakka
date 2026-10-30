package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func openT(t *testing.T, opts Options) *Tenant {
	t.Helper()
	tn, err := Open(filepath.Join(t.TempDir(), "tenant"), opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tn.Close() })
	return tn
}

func row(i int, typ string) FactRow {
	raw := []byte(fmt.Sprintf(`{"type":%q,"n":%d,"source":"test"}`, typ, i))
	h := keys.ContentHash(raw)
	return FactRow{RowHash: h, Type: typ, ConversationID: "c1", Harness: "h", Event: "e", TS: float64(i), Raw: raw}
}

func TestAppendIdempotent(t *testing.T) {
	tn := openT(t, Options{})
	rows := []FactRow{row(1, "x"), row(2, "x")}
	ins, err := tn.Append(context.Background(), rows)
	if err != nil || len(ins) != 2 || !ins[0] || !ins[1] {
		t.Fatalf("first: %v %v", ins, err)
	}
	ins, err = tn.Append(context.Background(), append(rows, row(3, "x")))
	if err != nil || ins[0] || ins[1] || !ins[2] {
		t.Fatalf("second: %v %v", ins, err)
	}
	// duplicate within one call
	ins, _ = tn.Append(context.Background(), []FactRow{row(9, "x"), row(9, "x")})
	if !ins[0] || ins[1] {
		t.Fatalf("dup in call: %v", ins)
	}
}

func TestConcurrentAppend(t *testing.T) {
	tn := openT(t, Options{})
	var wg sync.WaitGroup
	errs := make(chan error, 50)
	for g := 0; g < 50; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			var rows []FactRow
			for i := 0; i < 5; i++ {
				rows = append(rows, row(g*100+i, "x"))
			}
			ins, err := tn.Append(context.Background(), rows)
			if err == nil {
				for _, b := range ins {
					if !b {
						err = errors.New("not inserted")
					}
				}
			}
			errs <- err
		}(g)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var n int
	tn.rdb.QueryRow(`SELECT count(*) FROM facts`).Scan(&n)
	if n != 250 {
		t.Fatalf("facts=%d", n)
	}
}

func TestAppendFailingRequestIsolated(t *testing.T) {
	tn := openT(t, Options{GroupWindow: 300 * time.Millisecond})
	var wg sync.WaitGroup
	results := make([]error, 5)
	for g := 0; g < 5; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			r := row(g, "x")
			if g == 2 {
				r.Raw = nil // fails inside the transaction
			}
			_, results[g] = tn.Append(context.Background(), []FactRow{r})
		}(g)
	}
	wg.Wait()
	for g, err := range results {
		if (g == 2) != (err != nil) {
			t.Fatalf("g=%d err=%v", g, err)
		}
	}
	var n int
	tn.rdb.QueryRow(`SELECT count(*) FROM facts`).Scan(&n)
	if n != 4 {
		t.Fatalf("facts=%d want 4", n)
	}
}

func TestAppendRejection(t *testing.T) {
	tn := openT(t, Options{})
	if err := tn.AppendRejection(context.Background(), Rejection{Stage: "precheck", FactType: "x", Pattern: "sk_key", Reason: "r"}); err != nil {
		t.Fatal(err)
	}
	var n int
	tn.rdb.QueryRow(`SELECT count(*) FROM rejections WHERE stage='precheck'`).Scan(&n)
	if n != 1 {
		t.Fatal(n)
	}
}

func TestPendingPromoteDrop(t *testing.T) {
	tn := openT(t, Options{})
	ctx := context.Background()
	c := []byte("hello artifact")
	h := keys.ContentHash(c)
	if tn.HasBlob(h) {
		t.Fatal("blob before")
	}
	if err := tn.WritePending(h, c); err != nil {
		t.Fatal(err)
	}
	if err := tn.WritePending(h, c); err != nil {
		t.Fatal(err)
	}
	ph, _ := tn.PendingHashes()
	if len(ph) != 1 || ph[0] != h {
		t.Fatalf("pending %v", ph)
	}
	if got, err := tn.ReadPending(h); err != nil || string(got) != string(c) {
		t.Fatal(got, err)
	}
	if err := tn.Promote(ctx, h, Screen{Verdict: "unscreened", Scorer: "none"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(tn.dir, "pending", h)); !os.IsNotExist(err) {
		t.Fatal("pending remains")
	}
	bp := filepath.Join(tn.dir, "blobs", h[:2], h)
	st, err := os.Stat(bp)
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatal(err, st)
	}
	if !tn.HasBlob(h) {
		t.Fatal("HasBlob")
	}
	if got, _ := tn.ReadBlob(h); string(got) != string(c) {
		t.Fatal("ReadBlob")
	}
	var v string
	tn.rdb.QueryRow(`SELECT verdict FROM screens WHERE content_hash=?`, h).Scan(&v)
	if v != "unscreened" {
		t.Fatal(v)
	}
	// existing blob: WritePending is a no-op, Promote just records the screen.
	tn.WritePending(h, c)
	if ph, _ := tn.PendingHashes(); len(ph) != 0 {
		t.Fatal("pending for existing blob")
	}
	if err := tn.Promote(ctx, h, Screen{Verdict: "pass", Scorer: "jev"}); err != nil {
		t.Fatal(err)
	}

	// drop
	d := []byte("secret-ish")
	dh := keys.ContentHash(d)
	tn.WritePending(dh, d)
	if err := tn.DropPending(ctx, dh, Rejection{Stage: "screen", ContentHash: dh, Reason: "flagged"}); err != nil {
		t.Fatal(err)
	}
	if _, err := tn.ReadPending(dh); !os.IsNotExist(err) {
		t.Fatal("pending not removed", err)
	}
	var n int
	tn.rdb.QueryRow(`SELECT count(*) FROM rejections WHERE content_hash=?`, dh).Scan(&n)
	if n != 1 {
		t.Fatal(n)
	}
}

func TestPendingOrderAndBadHash(t *testing.T) {
	tn := openT(t, Options{})
	var hs []string
	for i := 0; i < 4; i++ {
		c := []byte(fmt.Sprint("c", i))
		h := keys.ContentHash(c)
		hs = append(hs, h)
		tn.WritePending(h, c)
		time.Sleep(5 * time.Millisecond)
	}
	got, _ := tn.PendingHashes()
	if strings.Join(got, ",") != strings.Join(hs, ",") {
		t.Fatalf("order %v vs %v", got, hs)
	}
	for _, bad := range []string{"", "../x", strings.Repeat("A", 64), strings.Repeat("a", 63)} {
		if err := tn.WritePending(bad, []byte("x")); err == nil {
			t.Fatalf("accepted %q", bad)
		}
		if _, err := tn.ReadBlob(bad); err == nil || tn.HasBlob(bad) {
			t.Fatalf("accepted %q", bad)
		}
	}
}

func TestArtifact(t *testing.T) {
	tn := openT(t, Options{})
	ctx := context.Background()
	if a, err := tn.Artifact(ctx, "r", "p.md"); a != nil || err != nil {
		t.Fatal(a, err)
	}
	mk := func(i int, content string) FactRow {
		raw := []byte(fmt.Sprintf(`{"type":"artifact_version","n":%d,"source":"src%d"}`, i, i))
		return FactRow{RowHash: keys.ContentHash(raw), Type: "artifact_version", ConversationID: fmt.Sprint("conv", i),
			RepoID: "r", Path: "p.md", ContentHash: keys.ContentHash([]byte(content)), Raw: raw}
	}
	for _, r := range []FactRow{mk(1, "a"), mk(2, "b"), mk(3, "a")} {
		if _, err := tn.Append(ctx, []FactRow{r}); err != nil {
			t.Fatal(err)
		}
	}
	// a non-artifact fact at the same path must not count
	o := row(50, "other")
	o.RepoID, o.Path, o.ContentHash = "r", "p.md", keys.ContentHash([]byte("zzz"))
	tn.Append(ctx, []FactRow{o})

	ha := keys.ContentHash([]byte("a"))
	if err := tn.WritePending(ha, []byte("a")); err != nil {
		t.Fatal(err)
	}
	if err := tn.Promote(ctx, ha, Screen{Verdict: "unscreened", Scorer: "none"}); err != nil {
		t.Fatal(err)
	}
	if err := tn.Promote(ctx, ha, Screen{Verdict: "pass", Scorer: "jev"}); err != nil {
		t.Fatal(err)
	}
	tn.AppendScores(ctx, ha, []Score{{"c1", 0.5, "jev"}, {"c2", 1, "jev"}})
	tn.AppendScores(ctx, ha, []Score{{"c1", 0.75, "jev"}})

	a, err := tn.Artifact(ctx, "r", "p.md")
	if err != nil || a == nil {
		t.Fatal(a, err)
	}
	if a.Versions != 2 || a.Latest.ContentHash != ha || a.Latest.ConversationID != "conv3" || a.Latest.Source != "src3" {
		t.Fatalf("%+v", a)
	}
	if a.Latest.ReceivedAt.IsZero() {
		t.Fatal("received_at")
	}
	if a.Latest.Screen == nil || a.Latest.Screen.Verdict != "pass" || a.Latest.Screen.Scorer != "jev" {
		t.Fatalf("%+v", a.Latest.Screen)
	}
	sort.Slice(a.Latest.Scores, func(i, j int) bool { return a.Latest.Scores[i].Check < a.Latest.Scores[j].Check })
	if len(a.Latest.Scores) != 2 || a.Latest.Scores[0].Score != 0.75 || a.Latest.Scores[1].Score != 1 {
		t.Fatalf("%+v", a.Latest.Scores)
	}
	// latest with no screen
	tn.Append(ctx, []FactRow{mk(4, "new")})
	a, _ = tn.Artifact(ctx, "r", "p.md")
	if a.Versions != 3 || a.Latest.Screen != nil || len(a.Latest.Scores) != 0 {
		t.Fatalf("%+v", a)
	}
}

func TestMigrationsVersioned(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "t")
	tn, err := Open(dir, Options{})
	if err != nil {
		t.Fatal(err)
	}
	var v int
	tn.rdb.QueryRow(`PRAGMA user_version`).Scan(&v)
	if v != len(migrations) || v == 0 {
		t.Fatal(v)
	}
	tn.Close()
	tn, err = Open(dir, Options{}) // reopen is a no-op
	if err != nil {
		t.Fatal(err)
	}
	tn.Close()
}

func TestWriterBurst(t *testing.T) {
	const tenants, clients, bursts, per = 8, 10, 3, 20
	root := t.TempDir()
	var ts []*Tenant
	for i := 0; i < tenants; i++ {
		tn, err := Open(filepath.Join(root, fmt.Sprint("t", i)), Options{})
		if err != nil {
			t.Fatal(err)
		}
		ts = append(ts, tn)
	}
	pad := strings.Repeat("x", 800)
	var mu sync.Mutex
	var lat []time.Duration
	var wg sync.WaitGroup
	total := 0
	for ti, tn := range ts {
		for c := 0; c < clients; c++ {
			wg.Add(1)
			go func(ti, c int, tn *Tenant) {
				defer wg.Done()
				for b := 0; b < bursts; b++ {
					rows := make([]FactRow, per)
					for i := range rows {
						raw := []byte(fmt.Sprintf(`{"type":"message","t":%d,"c":%d,"b":%d,"i":%d,"text":%q}`, ti, c, b, i, pad))
						rows[i] = FactRow{RowHash: keys.ContentHash(raw), Type: "message", ConversationID: fmt.Sprint("conv", c), Harness: "claude", Event: "msg", TS: float64(i), Raw: raw}
					}
					start := time.Now()
					if _, err := tn.Append(context.Background(), rows); err != nil {
						t.Error(err)
						return
					}
					d := time.Since(start)
					mu.Lock()
					lat = append(lat, d)
					mu.Unlock()
				}
			}(ti, c, tn)
		}
		total += clients * bursts * per
	}
	wg.Wait()
	for _, tn := range ts {
		tn.Close()
	}
	sort.Slice(lat, func(i, j int) bool { return lat[i] < lat[j] })
	var bytes int64
	filepath.Walk(root, func(p string, i os.FileInfo, err error) error {
		if err == nil && !i.IsDir() && strings.Contains(filepath.Base(p), "ledger.db") {
			bytes += i.Size()
		}
		return nil
	})
	fmt.Printf("writer-burst: tenants=%d facts=%d p50=%v p99=%v db_bytes=%d\n", tenants, total,
		lat[len(lat)/2], lat[len(lat)*99/100], bytes)
}

func TestSearchIndex(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	put := func(content string, verdict string) string {
		h := keys.ContentHash([]byte(content))
		raw := []byte(fmt.Sprintf(`{"type":"artifact_version","content_hash":%q}`, h))
		if _, err := tn.Append(ctx, []FactRow{{RowHash: keys.ContentHash(raw), Type: "artifact_version", ConversationID: "c", Harness: "h",
			Event: "w", TS: 1, RepoID: "r", Path: "docs/plans/01-x/DESIGN.md", ContentHash: h, Raw: raw}}); err != nil {
			t.Fatal(err)
		}
		if err := tn.WritePending(h, []byte(content)); err != nil {
			t.Fatal(err)
		}
		if err := tn.Promote(ctx, h, Screen{Verdict: verdict}); err != nil {
			t.Fatal(err)
		}
		return h
	}
	count := func() int {
		var n int
		if err := tn.rdb.QueryRow(`SELECT count(*) FROM search`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	h1 := put("alpha\n", "pass")
	put("\xff\xfe not utf8\n", "unscreened")
	if n := count(); n != 1 {
		t.Fatalf("index rows %d, want 1 (invalid UTF-8 skipped)", n)
	}
	if err := tn.Reindex(ctx); err != nil || count() != 1 {
		t.Fatalf("reindex: %v %d", err, count())
	}
	if _, err := tn.wdb.Exec(`DELETE FROM search`); err != nil {
		t.Fatal(err)
	}
	if err := tn.Reindex(ctx); err != nil || count() != 1 {
		t.Fatalf("rebuild: %v %d", err, count())
	}
	if err := tn.DropBlob(ctx, h1, Rejection{Stage: "screen"}); err != nil || count() != 0 {
		t.Fatalf("drop: %v %d", err, count())
	}
}

func TestMigrationFromPreviousVersion(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "t")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", dsn(filepath.Join(dir, "ledger.db")))
	if err != nil {
		t.Fatal(err)
	}
	for i, m := range migrations[:len(migrations)-1] {
		if _, err := db.Exec(m); err != nil {
			t.Fatal(err)
		}
		db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, i+1))
	}
	r := row(1, "x")
	if _, err := db.Exec(`INSERT INTO facts (row_hash,type,conversation_id,harness,event,ts,received_at,repo_id,path,content_hash,raw)
		VALUES (?,?,?,?,?,?,?,?,?,?,?)`, r.RowHash, r.Type, "c", "h", "e", 1.0, 1, "", "", "", r.Raw); err != nil {
		t.Fatal(err)
	}
	db.Close()
	tn, err := Open(dir, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer tn.Close()
	var ne, kind, plan string
	var tin int64
	var cost sql.NullFloat64
	if err := tn.rdb.QueryRow(`SELECT norm_event,kind,plan,tok_in,cost_reported FROM facts`).Scan(&ne, &kind, &plan, &tin, &cost); err != nil {
		t.Fatal(err)
	}
	if ne != "" || kind != "" || plan != "" || tin != 0 || cost.Valid {
		t.Fatal(ne, kind, plan, tin, cost)
	}
}

func TestAppendNewColumns(t *testing.T) {
	tn := openT(t, Options{})
	c := 0.25
	r := row(1, "artifact_version")
	r.Path = "docs/plans/01-x/DESIGN.md"
	r.NormEvent, r.Tool, r.Model, r.Source, r.SHA = "ne", "Bash", "m", "src", "abc"
	r.TokIn, r.TokOut, r.TokCacheRead, r.TokCacheWrite, r.TokReasoning = 1, 2, 3, 4, 5
	r.CostReported = &c
	h := row(2, "hook")
	if _, err := tn.Append(context.Background(), []FactRow{r, h}); err != nil {
		t.Fatal(err)
	}
	var ne, tool, model, src, sha, kind, plan string
	var a, b, cr, cw, rs int64
	var cost sql.NullFloat64
	err := tn.rdb.QueryRow(`SELECT norm_event,tool,model,source,sha,kind,plan,tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported
		FROM facts WHERE row_hash=?`, r.RowHash).Scan(&ne, &tool, &model, &src, &sha, &kind, &plan, &a, &b, &cr, &cw, &rs, &cost)
	if err != nil {
		t.Fatal(err)
	}
	if ne != "ne" || tool != "Bash" || model != "m" || src != "src" || sha != "abc" || a != 1 || b != 2 || cr != 3 || cw != 4 || rs != 5 || !cost.Valid || cost.Float64 != 0.25 {
		t.Fatal(ne, tool, model, src, sha, a, b, cr, cw, rs, cost)
	}
	if kind == "" || plan != "01-x" {
		t.Fatalf("kind=%q plan=%q", kind, plan)
	}
	if err := tn.rdb.QueryRow(`SELECT kind,plan,cost_reported FROM facts WHERE row_hash=?`, h.RowHash).Scan(&kind, &plan, &cost); err != nil {
		t.Fatal(err)
	}
	if kind != "" || plan != "" || cost.Valid {
		t.Fatal(kind, plan, cost)
	}
	ins, _ := tn.Append(context.Background(), []FactRow{r})
	if ins[0] {
		t.Fatal("re-append inserted")
	}
}

func TestTypeTsIndexUsed(t *testing.T) {
	tn := openT(t, Options{})
	rows, err := tn.rdb.Query(`EXPLAIN QUERY PLAN SELECT * FROM facts WHERE type=? AND ts BETWEEN ? AND ?`, "hook", 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var all string
	for rows.Next() {
		var a, b, c int
		var d string
		rows.Scan(&a, &b, &c, &d)
		all += d
	}
	if !strings.Contains(all, "facts_type_ts") {
		t.Fatal(all)
	}
}

func TestMigrationFast100k(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "t")
	tn, err := Open(dir, Options{})
	if err != nil {
		t.Fatal(err)
	}
	tn.Close()
	db, _ := sql.Open("sqlite", dsn(filepath.Join(dir, "ledger.db")))
	// Rebuild at the previous version: drop the new indexes and columns' version marker is enough for timing the ALTERs.
	db.Exec(`DROP TABLE facts; DROP TABLE rejections`)
	db.Exec(migrations[0][:strings.Index(migrations[0], "CREATE INDEX facts_artifact")])
	if _, err := db.Exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<100000)
		INSERT INTO facts SELECT i,'hook','c','h','e',i,i,'','','','x' FROM n`); err != nil {
		t.Fatal(err)
	}
	db.Exec(`CREATE TABLE rejections (id INTEGER PRIMARY KEY, stage TEXT NOT NULL, fact_type TEXT NOT NULL, conversation_id TEXT NOT NULL,
		path TEXT NOT NULL, content_hash TEXT NOT NULL, pattern TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL)`)
	db.Exec(`PRAGMA user_version = 3`)
	db.Close()
	start := time.Now()
	tn, err = Open(dir, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer tn.Close()
	t.Logf("migration of 100k rows: %v", time.Since(start))
	if !raceEnabled && time.Since(start) > 3*time.Second {
		t.Fatal("migration too slow")
	}
}

// A ledger written before the remove list grew keeps those hook rows until migration 9 deletes
// them, and the rollups that already exist stop counting them.
func TestMigrationPurgesRemovedHookEvents(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "t")
	tn, err := Open(dir, Options{})
	if err != nil {
		t.Fatal(err)
	}
	hook := func(i int, conv, harness, event, typ string) FactRow {
		r := row(i, typ)
		r.ConversationID, r.Harness, r.Event, r.NormEvent = conv, harness, event, "other"
		return r
	}
	rows := []FactRow{
		hook(1, "keep", "opencode", "tool.execute.after", "hook_event"),
		hook(2, "keep", "opencode", "message.updated", "hook_event"),
		hook(3, "keep", "claude", "PreToolUse", "hook_event"),
		hook(4, "gone", "opencode", "session.status", "hook_event"),
		hook(5, "gone", "codex", "PreToolUse", "hook_event"),
		hook(6, "keep", "opencode", "message.updated", "artifact_version"), // not a hook fact: stays
	}
	if _, err := tn.Append(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
	if err := tn.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", dsn(filepath.Join(dir, "ledger.db")))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA user_version = 8`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	tn, err = Open(dir, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer tn.Close()
	count := func(q string) (n int) {
		t.Helper()
		if err := tn.rdb.QueryRow(q).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(`SELECT count(*) FROM facts`); n != 2 {
		t.Fatalf("facts after purge %d want 2", n)
	}
	if n := count(`SELECT count(*) FROM facts WHERE event='tool.execute.after' OR type='artifact_version'`); n != 2 {
		t.Fatalf("kept rows %d want 2", n)
	}
	if n := count(`SELECT COALESCE(sum(n),0) FROM hook_events_hourly`); n != 1 {
		t.Fatalf("hook rollup counts %d want 1", n)
	}
	if n := count(`SELECT count(*) FROM conversations_hourly WHERE conversation_id='gone'`); n != 0 {
		t.Fatalf("conversation rollup still holds a purged conversation: %d rows", n)
	}
	if n := count(`PRAGMA user_version`); n != len(migrations) {
		t.Fatalf("user_version %d want %d", n, len(migrations))
	}
}
