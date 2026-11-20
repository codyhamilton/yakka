package analyticsfixture

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

// TestRetainedFixture is the ungated oracle check for the synthetic retained-history workload. It
// asserts the EVIDENCE Phase 2 scale floors, both association fan-out maxima, priced/unpriced
// session classes, the mixed-attribution identity and generator determinism, then verifies the
// counts against the ledger the generator actually wrote.
func TestRetainedFixture(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "bench")
	summary, err := CreateRetained(context.Background(), dir)
	if err != nil {
		t.Fatalf("CreateRetained: %v", err)
	}
	if err := validateRetained(summary); err != nil {
		t.Fatal(err)
	}
	if summary.Version != RetainedVersion || summary.Seed != retainedSeed {
		t.Fatalf("summary identity = version %d seed %q", summary.Version, summary.Seed)
	}
	c := summary.Generated
	if c.MaxSessionsPerPlan < 57 || c.MaxPlansPerSession < 43 {
		t.Fatalf("fan-out = %d sessions/plan, %d plans/session", c.MaxSessionsPerPlan, c.MaxPlansPerSession)
	}
	if c.HarnessModelGroups != 32 {
		t.Fatalf("harness/model groups = %d, want the EVIDENCE 32", c.HarnessModelGroups)
	}
	if c.Scores != retainedFiles*len(retainedCheckNames) {
		t.Fatalf("scores = %d, want %d", c.Scores, retainedFiles*len(retainedCheckNames))
	}
	o := summary.Oracle
	if o.MixedPlan != "plan-000" || o.MixedSession != "sess-00000" || o.MixedRepoID != "repo-00" {
		t.Fatalf("mixed identity = %s/%s session %s", o.MixedRepoID, o.MixedPlan, o.MixedSession)
	}
	if o.MixedPlanAssociatedCostUSD <= 0 || o.MixedPlanAssociatedCostUSD != o.MixedSessionCostUSD {
		t.Fatalf("mixed plan cost %v != session cost %v", o.MixedPlanAssociatedCostUSD, o.MixedSessionCostUSD)
	}
	if o.LatestUsageTS >= time.Now().Add(-30*24*time.Hour).Unix() {
		t.Fatalf("latest usage is not older than 30 days: %s", time.Unix(o.LatestUsageTS, 0).UTC())
	}
	if o.PricedSessions == 0 || o.PartiallyPricedSessions == 0 || o.AllUnpricedSessions == 0 {
		t.Fatalf("session price classes = %d priced, %d partial, %d unpriced", o.PricedSessions, o.PartiallyPricedSessions, o.AllUnpricedSessions)
	}

	digestA, err := RetainedDigest()
	if err != nil {
		t.Fatal(err)
	}
	digestB, err := RetainedDigest()
	if err != nil {
		t.Fatal(err)
	}
	if digestA == "" || digestA != digestB {
		t.Fatalf("generator is not deterministic: %q vs %q", digestA, digestB)
	}

	db, err := sql.Open("sqlite", "file:"+filepath.Join(dir, "ledger.db")+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	queryInt := func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := db.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		return n
	}
	if got := queryInt(`SELECT COUNT(*) FROM facts`); got != c.Facts {
		t.Errorf("facts = %d, summary %d", got, c.Facts)
	}
	if got := queryInt(`SELECT COUNT(*) FROM scores`); got != c.Scores {
		t.Errorf("scores = %d, summary %d", got, c.Scores)
	}
	if got := queryInt(`SELECT COUNT(DISTINCT conversation_id) FROM facts`); got != c.Sessions {
		t.Errorf("sessions = %d, summary %d", got, c.Sessions)
	}
	if got := queryInt(`SELECT COUNT(*) FROM (SELECT repo_id,plan FROM facts WHERE type='artifact_version' AND plan<>'' GROUP BY repo_id,plan)`); got != c.PlanIdentities {
		t.Errorf("plan identities = %d, summary %d", got, c.PlanIdentities)
	}
	if got := queryInt(`SELECT COUNT(*) FROM (SELECT repo_id,path FROM facts WHERE type='artifact_version' GROUP BY repo_id,path)`); got != c.ArtifactFiles {
		t.Errorf("artifact files = %d, summary %d", got, c.ArtifactFiles)
	}
	if got := queryInt(`SELECT COUNT(*) FROM (SELECT DISTINCT a.repo_id,a.plan,s.conversation_id FROM facts a JOIN facts s ON s.conversation_id=a.conversation_id WHERE a.type='artifact_version' AND a.plan<>'')`); got != c.PlanSessionAssociations {
		t.Errorf("associations = %d, summary %d", got, c.PlanSessionAssociations)
	}
	if got := queryInt(`SELECT COUNT(*) FROM (SELECT DISTINCT harness,model FROM facts WHERE norm_event='usage' GROUP BY harness,model)`); got != c.HarnessModelGroups {
		t.Errorf("harness/model groups = %d, summary %d", got, c.HarnessModelGroups)
	}
	var latest sql.NullFloat64
	if err := db.QueryRow(`SELECT MAX(ts) FROM facts WHERE norm_event='usage'`).Scan(&latest); err != nil {
		t.Fatal(err)
	}
	if !latest.Valid || int64(latest.Float64) != o.LatestUsageTS {
		t.Errorf("latest usage ts = %v, oracle %d", latest, o.LatestUsageTS)
	}
}
