package serve

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// legacyLedger writes a tenant dir whose ledger.db is a pre-migration-5 database holding one fact.
// Migration 5 then creates meta without seeding "complete" (facts is not empty), so the tenant is
// reported as "required" until compaction records completion.
func legacyLedger(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	dsn := "file:" + filepath.Join(dir, "ledger.db") + "?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE facts (row_hash TEXT PRIMARY KEY, type TEXT NOT NULL, harness TEXT NOT NULL DEFAULT '', event TEXT NOT NULL DEFAULT '')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO facts(row_hash,type) VALUES('x','hook')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`PRAGMA user_version = 4`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestCompactionStateHealth(t *testing.T) {
	root := t.TempDir()
	legacyLedger(t, filepath.Join(root, "a"))

	s := New(Config{Data: root, Keys: []KeyPair{{"a", "ka"}}}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	h := s.Handler()

	if code, body := do(t, h, "GET", "/v1/health", "", ""); code != 200 || !strings.Contains(body, `"compaction":"required"`) {
		t.Fatalf("before compaction: %d %s", code, body)
	}

	ts, err := s.tenant("a") // open the tenant under serve
	if err != nil {
		t.Fatal(err)
	}
	if err := ts.t.SetMeta(t.Context(), "compaction", "complete"); err != nil {
		t.Fatal(err)
	}
	if code, body := do(t, h, "GET", "/v1/health", "", ""); code != 200 || !strings.Contains(body, `"compaction":"complete"`) {
		t.Fatalf("after compaction: %d %s", code, body)
	}
}

func TestCompactionStatePreflightAndLockedRequest(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "a")
	ex, err := store.OpenExclusive(dir, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer ex.Close()

	err = Preflight(root)
	if err == nil {
		t.Fatal("Preflight: want error while exclusive holder exists")
	}
	if !strings.Contains(err.Error(), `"a"`) || !strings.Contains(err.Error(), "compaction") {
		t.Fatalf("Preflight error must name the tenant and compaction: %v", err)
	}

	s := New(Config{Data: root, Keys: []KeyPair{{"a", "ka"}}}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	code, body := do(t, s.Handler(), "GET", "/v1/artifacts?repo_id=r&path=x", "ka", "")
	if code != 503 || !strings.Contains(body, "locked") {
		t.Fatalf("locked tenant request: %d %s", code, body)
	}
}
