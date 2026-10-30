package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/compact"
	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

type ledgerFactMeta struct {
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

// ledgerFixtureFacts loads the shared Phase 1 ingest fixture (copied, not imported, from the
// compact package's tests).
func ledgerFixtureFacts(t *testing.T) []json.RawMessage {
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

func insertLegacyFact(t *testing.T, tn *store.Tenant, fact json.RawMessage) {
	t.Helper()
	var m ledgerFactMeta
	if err := json.Unmarshal(fact, &m); err != nil {
		t.Fatalf("fact meta: %v", err)
	}
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

// buildLegacyLedger writes the fixture into a fresh tenant dir as legacy rows (payload kept) and
// returns the dir with no open handle.
func buildLegacyLedger(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	tn, err := store.OpenExclusive(dir, store.Options{})
	if err != nil {
		t.Fatalf("open exclusive: %v", err)
	}
	for _, f := range ledgerFixtureFacts(t) {
		insertLegacyFact(t, tn, f)
	}
	if _, err := tn.Raw().Exec(`DELETE FROM meta WHERE key IN ('compaction','compact_cursor')`); err != nil {
		t.Fatalf("clear meta: %v", err)
	}
	tn.Close()
	return dir
}

// captureRun runs the command in-process with stdout and stderr redirected to pipes and returns
// the exit code and the combined output.
func captureRun(t *testing.T, args ...string) (int, string) {
	t.Helper()
	ro, wo, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	re, we, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	oldOut, oldErr := os.Stdout, os.Stderr
	os.Stdout, os.Stderr = wo, we
	defer func() { os.Stdout, os.Stderr = oldOut, oldErr }()
	code := run(args)
	wo.Close()
	we.Close()
	out, _ := io.ReadAll(ro)
	ro.Close()
	er, _ := io.ReadAll(re)
	re.Close()
	return code, string(out) + string(er)
}

func countFacts(t *testing.T, tn *store.Tenant) int {
	t.Helper()
	var n int
	if err := tn.Raw().QueryRow(`SELECT count(*) FROM facts`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func dumpFacts(t *testing.T, dir string) []string {
	t.Helper()
	tn, err := store.OpenExclusive(dir, store.Options{})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer tn.Close()
	rows, err := tn.Raw().Query(`SELECT row_hash,type,event,ts,raw FROM facts ORDER BY row_hash`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var rh, typ, ev string
		var ts float64
		var raw []byte
		if err := rows.Scan(&rh, &typ, &ev, &ts, &raw); err != nil {
			t.Fatal(err)
		}
		out = append(out, fmt.Sprintf("%s|%s|%s|%v|%s", rh, typ, ev, ts, raw))
	}
	return out
}

func rowCountAt(t *testing.T, out, prefix string) int {
	t.Helper()
	i := strings.Index(out, prefix)
	if i < 0 {
		t.Fatalf("output missing %q:\n%s", prefix, out)
	}
	s := out[i+len(prefix):]
	j := 0
	for j < len(s) && s[j] >= '0' && s[j] <= '9' {
		j++
	}
	n, err := strconv.Atoi(s[:j])
	if err != nil {
		t.Fatalf("parse %q: %v", s[:j], err)
	}
	return n
}

func TestLedgerCompactSuccess(t *testing.T) {
	dir := buildLegacyLedger(t)
	code, out := captureRun(t, "ledger", "compact", "--tenant-dir", dir)
	if code != 0 {
		t.Fatalf("exit %d:\n%s", code, out)
	}
	for _, want := range []string{"before: rows=", "types=", "ledger.db=", "archive=", "space: need", "after: rows=", "elapsed="} {
		if !strings.Contains(out, want) {
			t.Fatalf("output missing %q:\n%s", want, out)
		}
	}
	before := rowCountAt(t, out, "before: rows=")
	after := rowCountAt(t, out, "after: rows=")
	if after <= 0 || after >= before {
		t.Fatalf("rows did not shrink: before=%d after=%d\n%s", before, after, out)
	}
	if n := strings.Count(out, "ledger.db="); n < 2 {
		t.Fatalf("want before and after byte reports, got %d:\n%s", n, out)
	}
	tn, err := store.OpenExclusive(dir, store.Options{})
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer tn.Close()
	var removed int
	if err := tn.Raw().QueryRow(`SELECT count(*) FROM facts WHERE harness='opencode' AND
		event IN ('experimental.chat.system.transform','chat.params','chat.headers','shell.env')`).Scan(&removed); err != nil {
		t.Fatal(err)
	}
	if removed != 0 {
		t.Fatalf("removed-event rows remain: %d", removed)
	}
}

func TestLedgerPurgeDeltasSuccess(t *testing.T) {
	dir := buildLegacyLedger(t)
	tn, err := store.OpenExclusive(dir, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	var deltas int
	if err := tn.Raw().QueryRow(`SELECT count(*) FROM facts
		WHERE harness='opencode' AND event='message.part.delta'`).Scan(&deltas); err != nil {
		t.Fatal(err)
	}
	tn.Close()
	if deltas == 0 {
		t.Fatal("fixture has no delta facts; test proves nothing")
	}

	code, out := captureRun(t, "ledger", "purge-deltas", "--tenant-dir", dir)
	if code != 0 {
		t.Fatalf("exit %d:\n%s", code, out)
	}
	for _, want := range []string{"before: rows=", "purge: facts=", "archive-lines=", "after: rows=", "elapsed="} {
		if !strings.Contains(out, want) {
			t.Fatalf("output missing %q:\n%s", want, out)
		}
	}
	if got := rowCountAt(t, out, "purge: facts="); got != deltas {
		t.Fatalf("purge reported facts=%d, want %d\n%s", got, deltas, out)
	}
	tn, err = store.OpenExclusive(dir, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer tn.Close()
	var left int
	if err := tn.Raw().QueryRow(`SELECT count(*) FROM facts
		WHERE harness='opencode' AND event='message.part.delta'`).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Fatalf("%d delta facts remain", left)
	}
}

func TestLedgerPurgeDeltasMissingTenantDir(t *testing.T) {
	if code, out := captureRun(t, "ledger", "purge-deltas"); code != 2 || !strings.Contains(out, "usage") {
		t.Fatalf("no flag: code=%d out=%s", code, out)
	}
	parent := t.TempDir()
	missing := filepath.Join(parent, "nope")
	code, out := captureRun(t, "ledger", "purge-deltas", "--tenant-dir", missing)
	if code != 1 {
		t.Fatalf("missing dir exit %d:\n%s", code, out)
	}
	if _, err := os.Stat(missing); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("purge-deltas created the missing tenant dir: %v", err)
	}
}

func TestLedgerPurgeDeltasLocked(t *testing.T) {
	dir := buildLegacyLedger(t)
	hold, err := store.OpenExclusive(dir, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer hold.Close()
	before := countFacts(t, hold)
	code, out := captureRun(t, "ledger", "purge-deltas", "--tenant-dir", dir)
	if code != 1 {
		t.Fatalf("exit %d:\n%s", code, out)
	}
	if !strings.Contains(out, "locked") {
		t.Fatalf("no lock message:\n%s", out)
	}
	if got := countFacts(t, hold); got != before {
		t.Fatalf("database changed: %d -> %d", before, got)
	}
}

func TestLedgerCompactMissingTenantDir(t *testing.T) {
	if code, out := captureRun(t, "ledger", "compact"); code != 2 || !strings.Contains(out, "usage") {
		t.Fatalf("no flag: code=%d out=%s", code, out)
	}
	if code, out := captureRun(t, "ledger"); code != 2 || !strings.Contains(out, "usage") {
		t.Fatalf("bare ledger: code=%d out=%s", code, out)
	}
	dir := buildLegacyLedger(t)
	if code, out := captureRun(t, "ledger", "compact", "--tenant-dir", dir, "extra"); code != 2 || !strings.Contains(out, "usage") {
		t.Fatalf("extra arg: code=%d out=%s", code, out)
	}
}

func TestLedgerCompactLocked(t *testing.T) {
	dir := buildLegacyLedger(t)
	hold, err := store.OpenExclusive(dir, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer hold.Close()
	before := countFacts(t, hold)
	code, out := captureRun(t, "ledger", "compact", "--tenant-dir", dir)
	if code != 1 {
		t.Fatalf("exit %d:\n%s", code, out)
	}
	if !strings.Contains(out, "locked") {
		t.Fatalf("no lock message:\n%s", out)
	}
	if got := countFacts(t, hold); got != before {
		t.Fatalf("database changed: %d -> %d", before, got)
	}
}

func TestLedgerCompactFreeSpace(t *testing.T) {
	dir := buildLegacyLedger(t)
	hold, err := store.OpenExclusive(dir, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	before := countFacts(t, hold)
	hold.Close()

	old := compact.FreeBytes
	compact.FreeBytes = func(string) (uint64, error) { return 1, nil }
	defer func() { compact.FreeBytes = old }()

	code, out := captureRun(t, "ledger", "compact", "--tenant-dir", dir)
	if code != 1 {
		t.Fatalf("exit %d:\n%s", code, out)
	}
	if !strings.Contains(out, "need") || !strings.Contains(out, "have") {
		t.Fatalf("no space message:\n%s", out)
	}
	if !strings.Contains(out, "have 0 MiB") {
		t.Fatalf("free-space message not in MiB:\n%s", out)
	}
	tn, err := store.OpenExclusive(dir, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer tn.Close()
	if got := countFacts(t, tn); got != before {
		t.Fatalf("database changed: %d -> %d", before, got)
	}
}

func TestLedgerCompactInterrupt(t *testing.T) {
	ref := buildLegacyLedger(t)
	base := newCompactSession
	defer func() { newCompactSession = base }()
	newCompactSession = func() (context.Context, context.CancelFunc, compact.Options) {
		return context.Background(), func() {}, compact.Options{Progress: os.Stdout, Batch: 3}
	}
	if code, out := captureRun(t, "ledger", "compact", "--tenant-dir", ref); code != 0 {
		t.Fatalf("ref exit %d:\n%s", code, out)
	}
	want := dumpFacts(t, ref)

	dir := buildLegacyLedger(t)
	ctx, cancel := context.WithCancel(context.Background())
	newCompactSession = func() (context.Context, context.CancelFunc, compact.Options) {
		return ctx, cancel, compact.Options{Progress: os.Stdout, Batch: 3,
			AfterCommit: func(b int) error {
				if b == 2 {
					cancel()
				}
				return nil
			}}
	}
	code, out := captureRun(t, "ledger", "compact", "--tenant-dir", dir)
	if code != 1 {
		t.Fatalf("interrupt exit %d:\n%s", code, out)
	}
	if !strings.Contains(out, "interrupted") {
		t.Fatalf("no interrupt message:\n%s", out)
	}

	newCompactSession = func() (context.Context, context.CancelFunc, compact.Options) {
		return context.Background(), func() {}, compact.Options{Progress: os.Stdout, Batch: 3}
	}
	if code, out := captureRun(t, "ledger", "compact", "--tenant-dir", dir); code != 0 {
		t.Fatalf("resume exit %d:\n%s", code, out)
	}
	got := dumpFacts(t, dir)
	if len(got) != len(want) {
		t.Fatalf("fact counts differ: got %d want %d", len(got), len(want))
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("fact %d differs:\n got %s\nwant %s", i, got[i], want[i])
		}
	}
}

func TestLedgerCompactRerunComplete(t *testing.T) {
	dir := buildLegacyLedger(t)
	if code, out := captureRun(t, "ledger", "compact", "--tenant-dir", dir); code != 0 {
		t.Fatalf("first exit %d:\n%s", code, out)
	}
	code, out := captureRun(t, "ledger", "compact", "--tenant-dir", dir)
	if code != 0 {
		t.Fatalf("rerun exit %d:\n%s", code, out)
	}
	if !strings.Contains(out, "after: rows=") {
		t.Fatalf("no after counts on rerun:\n%s", out)
	}
}

func TestSyncCommandRefusals(t *testing.T) {
	t.Setenv("YAKKA_SYNC_ENDPOINT", "")
	t.Setenv("YAKKA_SYNC_KEY", "")
	t.Setenv("YAKKA_SYNC_CONFIG", filepath.Join(t.TempDir(), "none.toml"))
	if code, out := captureRun(t, "sync"); code != 2 || !strings.Contains(out, "usage") {
		t.Fatalf("no --to: %d %s", code, out)
	}
	code, out := captureRun(t, "sync", "--to", "t-abc", "--tenant-dir", t.TempDir())
	if code != 1 || !strings.Contains(out, "no sync credential") {
		t.Fatalf("no credential: %d %s", code, out)
	}
}
