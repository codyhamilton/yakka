package compact

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/archive"
	"github.com/codyhamilton/yakka/packages/yakka/internal/ingest"
	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

var errStop = errors.New("compact_test: stop")

var conversations = []string{"fx-conv-claude", "fx-conv-codex", "fx-conv-opencode", "fx-conv-cursor"}

func openExclusive(t *testing.T) *store.Tenant {
	t.Helper()
	dir := t.TempDir()
	tn, err := store.OpenExclusive(dir, store.Options{})
	if err != nil {
		t.Fatalf("OpenExclusive: %v", err)
	}
	t.Cleanup(func() { tn.Close() })
	return tn
}

func fixtureFacts(t *testing.T) []json.RawMessage {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "hooklog", "tests", "fixtures", "ingest_policy.json"))
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	var fx struct {
		Facts json.RawMessage `json:"facts"`
	}
	if err := json.Unmarshal(b, &fx); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	var facts []json.RawMessage
	if err := json.Unmarshal(fx.Facts, &facts); err != nil {
		t.Fatalf("fixture facts: %v", err)
	}
	return facts
}

type factMeta struct {
	Type           string  `json:"type"`
	ConversationID string  `json:"conversation_id"`
	Harness        string  `json:"harness"`
	Event          string  `json:"event"`
	TS             float64 `json:"ts"`
	Path           string  `json:"path"`
	RepoID         string  `json:"repo_id"`
	ContentHash    string  `json:"content_hash"`
	Source         string  `json:"source"`
	SHA            string  `json:"sha"`
}

func factOf(t *testing.T, fact json.RawMessage) factMeta {
	t.Helper()
	var m factMeta
	if err := json.Unmarshal(fact, &m); err != nil {
		t.Fatalf("fact meta: %v", err)
	}
	return m
}

func insertRow(t *testing.T, tn *store.Tenant, rh, typ, conv, harness, event string, ts float64, raw []byte) {
	t.Helper()
	if _, err := tn.Raw().Exec(`INSERT INTO facts
		(row_hash,type,conversation_id,harness,event,ts,received_at,repo_id,path,content_hash,raw)
		VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		rh, typ, conv, harness, event, ts, int64(12345), "", "", "", raw); err != nil {
		t.Fatalf("insert row: %v", err)
	}
}

// insertLegacy stores fact as an old-style row: canonical raw (payload kept), full row hash,
// analytics columns at defaults.
func insertLegacy(t *testing.T, tn *store.Tenant, fact json.RawMessage) {
	t.Helper()
	m := factOf(t, fact)
	canon, err := keys.Canonical(fact)
	if err != nil {
		t.Fatal(err)
	}
	rh, err := keys.RowHash(fact)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tn.Raw().Exec(`INSERT INTO facts
		(row_hash,type,conversation_id,harness,event,ts,received_at,repo_id,path,content_hash,raw)
		VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
		rh, m.Type, m.ConversationID, m.Harness, m.Event, m.TS, int64(12345), m.RepoID, m.Path, "", canon); err != nil {
		t.Fatalf("insert legacy: %v", err)
	}
}

// appendFactA appends fact the way ingest/store would: canonical raw, analytics columns computed.
func appendFactA(t *testing.T, tn *store.Tenant, fact json.RawMessage) {
	t.Helper()
	m := factOf(t, fact)
	canon, err := keys.Canonical(fact)
	if err != nil {
		t.Fatal(err)
	}
	rh, err := keys.RowHash(fact)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tn.Append(context.Background(), []store.FactRow{{
		RowHash: rh, Type: m.Type, ConversationID: m.ConversationID, Harness: m.Harness,
		Event: m.Event, TS: m.TS, RepoID: m.RepoID, Path: m.Path, ContentHash: m.ContentHash,
		Raw: canon, Source: m.Source, SHA: m.SHA,
	}}); err != nil {
		t.Fatalf("append A: %v", err)
	}
}

const hexA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func extraFacts() []json.RawMessage {
	return []json.RawMessage{
		json.RawMessage(`{"id":"art-1","type":"artifact_version","conversation_id":"fx-conv-claude","harness":"claude","event":"","ts":1791100200.0,"repo_id":"github.com/codyhamilton/yakka","path":"docs/plans/99-fixture-plan/reports/2-03-compact-engine.md","content_hash":"` + hexA + `","source":"worktree"}`),
		json.RawMessage(`{"id":"art-2","type":"artifact_version","conversation_id":"fx-conv-codex","harness":"codex","event":"","ts":1791100201.0,"repo_id":"github.com/codyhamilton/yakka","path":"docs/plans/99-fixture-plan/briefs/2-03-compact-engine.md","content_hash":"` + hexA + `","source":"commit"}`),
		json.RawMessage(`{"id":"art-3","type":"artifact_version","conversation_id":"fx-conv-opencode","harness":"opencode","event":"","ts":1791100202.0,"repo_id":"github.com/codyhamilton/yakka","path":"docs/plans/99-fixture-plan/DESIGN.md","content_hash":"` + hexA + `","source":"worktree"}`),
		json.RawMessage(`{"id":"com-1","type":"commit","conversation_id":"fx-conv-claude","harness":"claude","event":"","ts":1791100203.0,"repo_id":"github.com/codyhamilton/yakka","sha":"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"}`),
	}
}

type snap struct {
	RowHash, Type, Event, NormEvent, Tool, Model, Kind, Plan, Source, SHA string
	TS                                                                    float64
	Raw                                                                   []byte
	TokIn, TokOut, TokCacheRead, TokCacheWrite, TokReasoning              int64
	Cost                                                                  sql.NullFloat64
}

func allFacts(t *testing.T, tn *store.Tenant) []snap {
	t.Helper()
	rows, err := tn.Raw().Query(`SELECT row_hash,type,event,ts,raw,norm_event,tool,model,
		tok_in,tok_out,tok_cache_read,tok_cache_write,tok_reasoning,cost_reported,kind,plan,source,sha
		FROM facts ORDER BY row_hash`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []snap
	for rows.Next() {
		var s snap
		if err := rows.Scan(&s.RowHash, &s.Type, &s.Event, &s.TS, &s.Raw, &s.NormEvent, &s.Tool, &s.Model,
			&s.TokIn, &s.TokOut, &s.TokCacheRead, &s.TokCacheWrite, &s.TokReasoning, &s.Cost,
			&s.Kind, &s.Plan, &s.Source, &s.SHA); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func sameFacts(t *testing.T, a, b []snap) {
	t.Helper()
	if len(a) != len(b) {
		t.Fatalf("fact counts differ: %d vs %d", len(a), len(b))
	}
	for i := range a {
		if !reflect.DeepEqual(a[i], b[i]) {
			t.Fatalf("fact %d differs:\n a=%+v\n b=%+v", i, a[i], b[i])
		}
	}
}

func archiveHashes(t *testing.T, dir string, convs []string) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	for _, c := range convs {
		lines, err := archive.Read(dir, c)
		if err != nil {
			t.Fatalf("archive read %q: %v", c, err)
		}
		for _, l := range lines {
			out[l.RowHash] = true
		}
	}
	return out
}

func TestRequiresExclusive(t *testing.T) {
	dir := t.TempDir()
	tn, err := store.Open(dir, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer tn.Close()
	if _, err := Run(context.Background(), tn, Options{}); err == nil {
		t.Fatal("Run must error when Raw() is nil (tenant not opened exclusive)")
	}
}

func TestEquivalence(t *testing.T) {
	facts := fixtureFacts(t)
	ctx := context.Background()
	a := openExclusive(t)
	b := openExclusive(t)
	if _, err := ingest.Ingest(ctx, a, facts); err != nil {
		t.Fatalf("ingest A: %v", err)
	}
	for _, f := range facts {
		insertLegacy(t, b, f)
	}
	for _, f := range extraFacts() {
		appendFactA(t, a, f)
		insertLegacy(t, b, f)
	}
	st, err := Run(ctx, b, Options{})
	if err != nil {
		t.Fatalf("Run B: %v", err)
	}
	if !st.Complete {
		t.Fatalf("Run B not complete: %+v", st)
	}
	sameFacts(t, allFacts(t, a), allFacts(t, b))
	ah := archiveHashes(t, a.Dir(), conversations)
	bh := archiveHashes(t, b.Dir(), conversations)
	if !reflect.DeepEqual(ah, bh) {
		t.Fatalf("archive row_hash sets differ: A=%d B=%d", len(ah), len(bh))
	}
}

func TestOutcome(t *testing.T) {
	facts := fixtureFacts(t)
	ctx := context.Background()
	b := openExclusive(t)
	for _, f := range facts {
		insertLegacy(t, b, f)
	}
	preNonRemoved := 0
	for _, f := range facts {
		var o struct {
			Harness string         `json:"harness"`
			Event   string         `json:"event"`
			Payload map[string]any `json:"payload"`
		}
		if err := json.Unmarshal(f, &o); err != nil {
			t.Fatal(err)
		}
		if ingest.Policy(o.Harness, o.Event, o.Payload) != ingest.Remove {
			preNonRemoved++
		}
	}
	if _, err := Run(ctx, b, Options{}); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := b.Raw().QueryRow(`SELECT count(*) FROM facts WHERE harness='opencode' AND
		event IN ('experimental.chat.system.transform','chat.params','chat.headers','shell.env','message.part.delta','message.part.updated','session.status','session.updated','session.diff')`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("removed-event rows remain: %d", n)
	}
	if err := b.Raw().QueryRow(`SELECT count(*) FROM facts WHERE type='hook_event' AND instr(raw,'"payload"')>0`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("payload remains in %d hook rows", n)
	}
	bh := archiveHashes(t, b.Dir(), conversations)
	if len(bh) != preNonRemoved {
		t.Fatalf("distinct archive row_hash = %d, want pre-run non-removed = %d", len(bh), preNonRemoved)
	}
}

// Compaction treats the trim policy as keep: a legacy message.updated row stored with its diffs
// keeps its row hash and its archive line is untrimmed, so a later sync does not see it as new.
func TestCompactKeepsTrimmedEventHash(t *testing.T) {
	fact := json.RawMessage(`{"id":"q#0","type":"hook_event","conversation_id":"c-trim","harness":"opencode","event":"message.updated","ts":7,
	  "payload":{"event":{"properties":{"info":{"summary":{"diffs":[{"patch":"x"}]}}}}}}`)
	tn := openExclusive(t)
	insertLegacy(t, tn, fact)
	want, err := keys.RowHash(fact)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Run(context.Background(), tn, Options{}); err != nil {
		t.Fatal(err)
	}
	var got string
	if err := tn.Raw().QueryRow(`SELECT row_hash FROM facts WHERE conversation_id='c-trim'`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("row hash changed: %s -> %s", want, got)
	}
	if !archiveHashes(t, tn.Dir(), []string{"c-trim"})[want] {
		t.Fatal("archive line for the original hash is missing")
	}
}

func TestResume(t *testing.T) {
	facts := fixtureFacts(t)
	ctx := context.Background()
	build := func() *store.Tenant {
		tn := openExclusive(t)
		for _, f := range facts {
			insertLegacy(t, tn, f)
		}
		for _, f := range extraFacts() {
			insertLegacy(t, tn, f)
		}
		return tn
	}
	ref := build()
	if _, err := Run(ctx, ref, Options{Batch: 3}); err != nil {
		t.Fatalf("ref run: %v", err)
	}
	refFacts := allFacts(t, ref)
	refArch := archiveHashes(t, ref.Dir(), conversations)

	cases := []struct {
		name    string
		setHook func(*Options)
	}{
		{"AfterArchive", func(o *Options) {
			o.AfterArchive = func(i int) error {
				if i == 2 {
					return errStop
				}
				return nil
			}
		}},
		{"AfterCommit", func(o *Options) {
			o.AfterCommit = func(i int) error {
				if i == 2 {
					return errStop
				}
				return nil
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tn := build()
			o := Options{Batch: 3}
			tc.setHook(&o)
			if _, err := Run(ctx, tn, o); !errors.Is(err, errStop) {
				t.Fatalf("interrupted run: got %v, want errStop", err)
			}
			if _, err := Run(ctx, tn, Options{Batch: 3}); err != nil {
				t.Fatalf("resume run: %v", err)
			}
			sameFacts(t, refFacts, allFacts(t, tn))
			if got := archiveHashes(t, tn.Dir(), conversations); !reflect.DeepEqual(got, refArch) {
				t.Fatalf("archive differs after resume: %d vs %d", len(got), len(refArch))
			}
		})
	}
}

func TestRepair(t *testing.T) {
	facts := fixtureFacts(t)
	ctx := context.Background()
	tn := openExclusive(t)
	for _, f := range facts {
		insertLegacy(t, tn, f)
	}
	entry := archive.Entry{ConversationID: "fx-conv-claude", TS: 1791100000,
		Line: archive.Line{RowHash: strings.Repeat("b", 64), ReceivedAt: 1, Fact: json.RawMessage(`{"x":1}`)}}
	if err := archive.Append(tn.Dir(), []archive.Entry{entry}); err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob(filepath.Join(tn.Dir(), "archive", "*", "*.jsonl.zst"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no archive file: %v %d", err, len(files))
	}
	b, err := os.ReadFile(files[0])
	if err != nil {
		t.Fatal(err)
	}
	if len(b) < 6 {
		t.Fatal("archive file too short to tear")
	}
	if err := os.WriteFile(files[0], b[:len(b)-5], 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Run(ctx, tn, Options{}); err != nil {
		t.Fatalf("Run with torn archive: %v", err)
	}
	if _, err := Run(ctx, tn, Options{}); err != nil {
		t.Fatalf("second Run with torn archive: %v", err)
	}
}

func TestThroughput(t *testing.T) {
	if os.Getenv("COMPACT_THROUGHPUT") != "1" {
		t.Skip("set COMPACT_THROUGHPUT=1 to run")
	}
	tn := openExclusive(t)
	const n = 50000
	tx, err := tn.Raw().Begin()
	if err != nil {
		t.Fatal(err)
	}
	st, err := tx.Prepare(`INSERT INTO facts(row_hash,type,conversation_id,harness,event,ts,received_at,repo_id,path,content_hash,raw) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < n; i++ {
		fact := []byte(`{"id":"r` + itoa(i) + `","type":"hook_event","conversation_id":"c","harness":"claude","event":"PreToolUse","ts":` + itoa(i) + `,"payload":{"cwd":"/x","session_id":"c","tool_name":"Bash","tool_use_id":"t` + itoa(i) + `"}}`)
		canon, err := keys.Canonical(fact)
		if err != nil {
			t.Fatal(err)
		}
		rh, err := keys.RowHash(fact)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := st.Exec(rh, "hook_event", "c", "claude", "PreToolUse", float64(i), int64(1), "", "", "", canon); err != nil {
			t.Fatal(err)
		}
	}
	st.Close()
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	stats, err := Run(context.Background(), tn, Options{})
	if err != nil {
		t.Fatal(err)
	}
	d := time.Since(start)
	t.Logf("throughput: scanned=%d archived=%d in %s = %.0f rows/sec", stats.Scanned, stats.Archived, d, float64(stats.Scanned)/d.Seconds())
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b [20]byte
	p := len(b)
	for i > 0 {
		p--
		b[p] = byte('0' + i%10)
		i /= 10
	}
	return string(b[p:])
}
