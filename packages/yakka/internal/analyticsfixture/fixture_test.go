package analyticsfixture

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
	_ "modernc.org/sqlite"
)

func TestCommittedManifestMatchesGeneratedLedger(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "fixture")
	s, err := Create(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", "file:"+filepath.Join(dir, "ledger.db")+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	checks := map[string]string{
		"hook_events":              `SELECT count(*) FROM facts WHERE type='hook_event'`,
		"model_calls":              `SELECT count(*) FROM facts WHERE type='hook_event' AND model<>''`,
		"artifact_design_versions": `SELECT count(*) FROM facts WHERE type='artifact_version' AND kind='design'`,
		"artifact_brief_versions":  `SELECT count(*) FROM facts WHERE type='artifact_version' AND kind='brief'`,
		"artifact_report_versions": `SELECT count(*) FROM facts WHERE type='artifact_version' AND kind='report'`,
		"rejections_precheck":      `SELECT count(*) FROM rejections WHERE stage='precheck'`,
		"rejections_screen":        `SELECT count(*) FROM rejections WHERE stage='screen'`,
		"scored_hashes":            `SELECT count(DISTINCT content_hash) FROM scores`,
	}
	for name, q := range checks {
		var n int
		if err := db.QueryRow(q).Scan(&n); err != nil {
			t.Fatalf("%s query: %v", name, err)
		}
		if want := s.Manifest.Populations[name]; n != want {
			t.Errorf("%s=%d want %d", name, n, want)
		}
	}
	for conv, want := range map[string]int{"session-one": 1, "session-many": 2, "session-none": 0} {
		var n int
		if err := db.QueryRow(`SELECT count(DISTINCT repo_id) FROM facts WHERE conversation_id=? AND repo_id<>''`, conv).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != want {
			t.Errorf("%s distinct repos=%d want %d", conv, n, want)
		}
	}
	var sharedPaths, rescoreChecks, tail int
	if err := db.QueryRow(`SELECT count(DISTINCT repo_id||':'||path) FROM facts WHERE content_hash=(SELECT content_hash FROM facts WHERE path='docs/plans/plan-a/DESIGN.md' ORDER BY ts LIMIT 1)`).Scan(&sharedPaths); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM (SELECT check_name FROM scores GROUP BY check_name HAVING count(DISTINCT scorer)>1)`).Scan(&rescoreChecks); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM facts WHERE conversation_id='session-many' AND model='unpriced-model' AND event='model_call' AND ts>(SELECT ts FROM facts WHERE conversation_id='session-many' ORDER BY ts LIMIT 1 OFFSET 4999)`).Scan(&tail); err != nil {
		t.Fatal(err)
	}
	if sharedPaths != s.Manifest.Populations["shared_content_paths"] || rescoreChecks != s.Manifest.Populations["scorer_rescore_checks"] || tail != 1 {
		t.Fatalf("sharing=%d rescored checks=%d unpriced tail=%d", sharedPaths, rescoreChecks, tail)
	}
	var minTS, maxTS float64
	if err := db.QueryRow(`SELECT min(ts),max(ts) FROM facts`).Scan(&minTS, &maxTS); err != nil {
		t.Fatal(err)
	}
	if minTS != float64(s.Manifest.Bounds["min_timestamp"]) || maxTS != float64(s.Manifest.Bounds["max_timestamp"]) {
		t.Fatalf("timestamp bounds=(%.0f, %.0f)", minTS, maxTS)
	}
	var rejections int
	if err := db.QueryRow(`SELECT count(*) FROM rejections`).Scan(&rejections); err != nil || rejections != 2 {
		t.Fatalf("rejections=%d err=%v", rejections, err)
	}
	db.Close()
	tn, err := store.Open(dir, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer tn.Close()
	executions, err := tn.Executions(context.Background(), store.AnalyticsFilter{From: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC), To: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)})
	if err != nil {
		t.Fatal(err)
	}
	shapes := map[string]int{}
	for _, row := range executions {
		shapes[row.Shape]++
	}
	for _, shape := range []string{"complete", "unreported", "started"} {
		if shapes[shape] != 1 {
			t.Errorf("execution shape %s=%d", shape, shapes[shape])
		}
	}
	if len(executions) != s.Manifest.Populations["execution_shapes"] {
		t.Fatalf("execution rows=%d want %d", len(executions), s.Manifest.Populations["execution_shapes"])
	}
}

// This compares two local candidates against the same fixed hook-event population oracle.
// Batch Append preserves all store rollups while reducing writer transactions.
func TestCandidateAppendBatchVsSingle(t *testing.T) {
	manifest, err := ReadManifest()
	if err != nil {
		t.Fatal(err)
	}
	rows := make([]store.FactRow, manifest.Populations["hook_events"])
	for i := range rows {
		raw, _ := json.Marshal(map[string]any{"type": "hook_event", "id": i, "source": "analyticsfixture"})
		h := sha256.Sum256(raw)
		rows[i] = store.FactRow{RowHash: hex.EncodeToString(h[:]), Type: "hook_event", ConversationID: "candidate", Harness: "fixture", Event: "tool_call", TS: float64(i), Raw: raw, NormEvent: "tool_call"}
	}
	for _, mode := range []string{"batch", "single"} {
		t.Run(mode, func(t *testing.T) {
			tn, err := store.Open(filepath.Join(t.TempDir(), "ledger"), store.Options{})
			if err != nil {
				t.Fatal(err)
			}
			start := time.Now()
			if mode == "batch" {
				if _, err = tn.Append(context.Background(), rows); err != nil {
					t.Fatal(err)
				}
			} else {
				for _, row := range rows {
					if _, err = tn.Append(context.Background(), []store.FactRow{row}); err != nil {
						t.Fatal(err)
					}
				}
			}
			elapsed := time.Since(start)
			var n int
			reader, err := sql.Open("sqlite", "file:"+filepath.Join(tn.Dir(), "ledger.db")+"?mode=ro")
			if err != nil {
				t.Fatal(err)
			}
			if err := reader.QueryRow(`SELECT count(*) FROM facts`).Scan(&n); err != nil {
				t.Fatal(err)
			}
			reader.Close()
			if n != manifest.Populations["hook_events"] {
				t.Fatalf("candidate population=%d", n)
			}
			t.Logf("candidate=%s rows=%d elapsed=%s", mode, n, elapsed)
			if err := tn.Close(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func ExampleReadManifest() {
	m, _ := ReadManifest()
	fmt.Println(m.Version, m.Populations["scored_hashes"])
	// Output: 1 32767
}
