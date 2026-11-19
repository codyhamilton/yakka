package serve

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/scorer"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func scoreSeriesWindow(t *testing.T, s *Server) string {
	m := aok(t, s, "/v1/analytics/summary")
	return "from=" + m["from"].(string) + "&to=" + m["to"].(string)
}

func TestScoreSeriesErrors(t *testing.T) {
	s, _ := queryFixture(t)
	win := scoreSeriesWindow(t, s)
	aerr(t, s, "/v1/analytics/score-series?"+win, 400, "kind required")
	aerr(t, s, "/v1/analytics/score-series?kind=nope&bucket=day&"+win, 400, "kind must be design, brief or report")
	aerr(t, s, "/v1/analytics/score-series?kind=design&"+win, 400, "bucket required")
	aerr(t, s, "/v1/analytics/score-series?kind=design&bucket=hour&"+win, 400, "bucket must be day, week, or month")
}

func TestScoreSeriesShape(t *testing.T) {
	s, _ := queryFixture(t)
	win := scoreSeriesWindow(t, s)
	m := aok(t, s, "/v1/analytics/score-series?kind=design&bucket=day&"+win)
	if m["kind"] != "design" || m["bucket"] != "day" {
		t.Fatalf("meta: %v", m)
	}
	if _, ok := m["checks"].([]any); !ok {
		t.Fatalf("checks missing or wrong type: %v", m["checks"])
	}
}

func TestScoreSeriesLensPopulation(t *testing.T) {
	catalog, err := scorer.LoadChecks("../../catalogue")
	if err != nil {
		t.Fatal(err)
	}
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", "ka"}}}, Options{DisableWorker: true, Checks: &catalog})
	t.Cleanup(func() { s.Close() })
	ts, err := s.tenant("a")
	if err != nil {
		t.Fatal(err)
	}
	check := catalog.For("design")[0].Name
	content := []byte("score-series-lens")
	hash := keys.ContentHash(content)
	if err := ts.t.WritePending(hash, content); err != nil {
		t.Fatal(err)
	}
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "series-session", Harness: "harness-a", RepoID: "repo-a", Path: "docs/plans/p/DESIGN.md", ContentHash: hash, TS: float64(time.Date(2026, 11, 8, 2, 0, 0, 0, time.UTC).Unix())}, nil)
	if err := ts.t.Promote(context.Background(), hash, store.Screen{Verdict: "pass"}, store.Score{Check: check, Result: .75, Scorer: "scorer-a"}); err != nil {
		t.Fatal(err)
	}
	win := "from=2026-11-08T00:00:00Z&to=2026-11-09T00:00:00Z"
	m := aok(t, s, "/v1/analytics/score-series?kind=design&bucket=day&dim=repo_id&check="+check+"&"+win)
	checks := rowsOf(m, "checks")
	if len(checks) != 1 {
		t.Fatalf("checks=%v", m)
	}
	points := checks[0]["points"].([]any)
	if len(points) != 1 {
		t.Fatalf("points=%v", checks[0])
	}
	point := points[0].(map[string]any)
	groups := point["groups"].([]any)
	if point["n"] != float64(1) || len(groups) != 1 || groups[0].(map[string]any)["key"] != "repo-a" {
		t.Fatalf("lens point=%v", point)
	}
}

func TestScoreProvenanceBatchesConversationIDs(t *testing.T) {
	_, ts := queryTenant(t)
	ids := make([]string, 501)
	for i := range ids {
		ids[i] = fmt.Sprintf("score-session-%d", i)
	}
	got, err := scoreSessionProvenance(context.Background(), ts.t, ids)
	if err != nil || len(got) != len(ids) {
		t.Fatalf("batched provenance: got %d of %d, err=%v", len(got), len(ids), err)
	}
}

func TestScoreSeriesAcceptsWideRange(t *testing.T) {
	s, _ := queryFixture(t)
	from := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	to := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	m := aok(t, s, "/v1/analytics/score-series?kind=design&bucket=day&from="+from+"&to="+to)
	if m["kind"] != "design" {
		t.Fatalf("wide-range response: %v", m)
	}
}
