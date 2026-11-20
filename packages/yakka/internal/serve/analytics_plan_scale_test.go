package serve

import (
	"context"
	"math"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func planScaleFixture(t *testing.T) (*Server, *tenantState, time.Time) {
	t.Helper()
	s, ts := queryTenant(t)
	now := time.Now().UTC().Truncate(time.Second)
	cost := 0.10
	add := func(conv, harness, path, hash string, at time.Time) {
		t.Helper()
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: conv, Harness: harness, RepoID: "repo",
			Path: path, ContentHash: hash, TS: float64(at.Unix())}, nil)
	}
	add("writer-a", "opencode", "docs/plans/plan-a/DESIGN.md", keys.ContentHash([]byte("plan-a-design")), now.Add(-10*time.Minute))
	add("writer-a", "opencode", "docs/plans/plan-a/briefs/b.md", keys.ContentHash([]byte("plan-a-brief")), now.Add(-9*time.Minute))
	add("shared", "cursor", "docs/plans/plan-a/reports/b.md", keys.ContentHash([]byte("plan-a-report")), now.Add(-8*time.Minute))
	add("writer-a", "opencode", "docs/plans/plan-a/reports/old.md", keys.ContentHash([]byte("plan-a-old")), now.Add(-48*time.Hour))
	add("shared", "cursor", "docs/plans/plan-b/DESIGN.md", keys.ContentHash([]byte("plan-b-design")), now.Add(-7*time.Minute))
	add("writer-b", "claude", "docs/plans/plan-b/briefs/b.md", keys.ContentHash([]byte("plan-b-brief")), now.Add(-6*time.Minute))
	add("writer-c", "", "docs/plans/plan-c/DESIGN.md", keys.ContentHash([]byte("plan-c-design")), now.Add(-time.Minute))
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "writer-a", Harness: "opencode", RepoID: "repo",
		Event: "usage", NormEvent: "usage", Model: "gpt-5", CostReported: &cost, TS: float64(now.Add(-5 * time.Minute).Unix())}, nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "shared", Harness: "cursor", RepoID: "repo",
		Event: "usage", NormEvent: "usage", Model: "opus", TokIn: 50, TS: float64(now.Add(-4 * time.Minute).Unix())}, nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "writer-b", Harness: "claude", RepoID: "repo",
		Event: "usage", NormEvent: "usage", Model: "sonnet", TokIn: 40, TS: float64(now.Add(-2 * time.Minute).Unix())}, nil)
	if err := ts.t.AppendScores(context.Background(), keys.ContentHash([]byte("plan-a-design")), []store.Score{
		{Check: "clarity", Result: .4, Scorer: "fixture"},
		{Check: "coverage", Result: .8, Scorer: "fixture"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := ts.t.AppendScores(context.Background(), keys.ContentHash([]byte("plan-b-design")), []store.Score{
		{Check: "clarity", Result: .9, Scorer: "fixture"},
	}); err != nil {
		t.Fatal(err)
	}
	return s, ts, now
}

func planScaleWindow(now time.Time) string {
	from, to := now.Add(-time.Hour), now.Add(time.Hour)
	return "&from=" + url.QueryEscape(from.Format(time.RFC3339)) + "&to=" + url.QueryEscape(to.Format(time.RFC3339))
}

func kindCounts(v any) map[string]int {
	out := map[string]int{}
	if v == nil {
		return out
	}
	for k, n := range v.(map[string]any) {
		out[k] = int(n.(float64))
	}
	return out
}

func planRowKey(row fx) (string, string) {
	id := row["id"].(map[string]any)
	return id["repo_id"].(string), id["plan"].(string)
}

// TestAnalyticsPlanPageBatchesEnrichment asserts the page-wide enrichment path equals a per-plan
// reference oracle for artifact kinds, latest design scores, associated cost/unpriced and the
// harness/session-model lenses, including an all-unpriced plan and a shared session.
func TestAnalyticsPlanPageBatchesEnrichment(t *testing.T) {
	s, ts, now := planScaleFixture(t)
	window := planScaleWindow(now)
	base := "/v1/analytics/entities?grain=plan" + window
	page := aok(t, s, base+"&limit=10")
	rows := rowsOf(page, "rows")
	if len(rows) != 3 {
		t.Fatalf("plan page rows=%d, want 3: %v", len(rows), rows)
	}

	from, to := now.Add(-time.Hour), now.Add(time.Hour)
	f := store.AnalyticsFilter{From: from, To: to}
	order := []string{}
	for _, row := range rows {
		repo, plan := planRowKey(row)
		order = append(order, plan)
		m := row["m"].(map[string]any)
		l := row["l"].(map[string]any)

		wantKinds, err := ts.t.PlanArtifactKinds(context.Background(), f, repo, plan)
		if err != nil {
			t.Fatal(err)
		}
		if got := kindCounts(m["artifacts_by_kind"]); !reflect.DeepEqual(got, wantKinds) {
			t.Errorf("%s artifacts_by_kind=%v, oracle=%v", plan, got, wantKinds)
		}
		for kind, n := range wantKinds {
			if m["artifacts:"+kind] != float64(n) {
				t.Errorf("%s artifacts:%s=%v, oracle=%d", plan, kind, m["artifacts:"+kind], n)
			}
		}
		wantScores, err := ts.t.PlanDesignScores(context.Background(), repo, plan)
		if err != nil {
			t.Fatal(err)
		}
		for check, score := range wantScores {
			if got := m["design_score:"+check]; got != score {
				t.Errorf("%s design_score:%s=%v, oracle=%v", plan, check, got, score)
			}
		}
		if n := countPrefix(m, "design_score:"); n != len(wantScores) {
			t.Errorf("%s has %d design scores, oracle=%d", plan, n, len(wantScores))
		}

		wantCost, wantUnpriced, wantCalls, err := ts.t.PlanAssociatedCost(context.Background(), f, repo, plan)
		if err != nil {
			t.Fatal(err)
		}
		flags := row["flags"].(map[string]any)
		switch {
		case wantCalls == 0:
			if m["associated_cost_usd"] != float64(0) {
				t.Errorf("%s no-call cost=%v, want 0", plan, m["associated_cost_usd"])
			}
		case wantUnpriced == wantCalls:
			if m["associated_cost_usd"] != nil || flags["associated_cost_null_reason"] != "all_unpriced" || flags["associated_cost_lower_bound"] != true {
				t.Errorf("%s all-unpriced semantics m=%v flags=%v", plan, m["associated_cost_usd"], flags)
			}
		default:
			if wantCost == nil || m["associated_cost_usd"] == nil || math.Abs(m["associated_cost_usd"].(float64)-*wantCost) > 1e-9 {
				t.Errorf("%s cost=%v, oracle=%v", plan, m["associated_cost_usd"], wantCost)
			}
			if wantUnpriced > 0 && flags["associated_cost_lower_bound"] != true {
				t.Errorf("%s missing lower-bound flag: %v", plan, flags)
			}
		}
		if m["unpriced_calls"] != float64(wantUnpriced) {
			t.Errorf("%s unpriced_calls=%v, oracle=%d", plan, m["unpriced_calls"], wantUnpriced)
		}

		ids, err := ts.t.PlanSessionIDs(context.Background(), f, repo, plan)
		if err != nil {
			t.Fatal(err)
		}
		prov, err := ts.t.SessionProvenanceFor(context.Background(), ids)
		if err != nil {
			t.Fatal(err)
		}
		harnesses, models := map[string]int{}, map[string]int{}
		for _, id := range ids {
			harnesses[prov[id].Harness]++
			models[prov[id].Model]++
		}
		if got, want := l["harness"], modeLens(harnesses); got != want {
			t.Errorf("%s harness lens=%v, oracle=%v", plan, got, want)
		}
		if got, want := l["session_model"], dominantModelLens(models, len(ids)); got != want {
			t.Errorf("%s session_model lens=%v, oracle=%v", plan, got, want)
		}
	}

	if !reflect.DeepEqual(order, []string{"plan-c", "plan-b", "plan-a"}) {
		t.Errorf("plan order=%v", order)
	}
	byPlan := map[string]fx{}
	for _, row := range rows {
		_, plan := planRowKey(row)
		byPlan[plan] = row
	}
	if a := byPlan["plan-a"]; a["m"].(map[string]any)["shared_sessions"] != float64(1) ||
		a["m"].(map[string]any)["artifacts_by_kind"].(map[string]any)["report"] != float64(1) {
		t.Errorf("plan-a shared/kind semantics=%v", a)
	}
	if b := byPlan["plan-b"]; b["m"].(map[string]any)["shared_sessions"] != float64(1) {
		t.Errorf("plan-b shared_sessions=%v", b["m"])
	}
	if c := byPlan["plan-c"]; c["l"].(map[string]any)["harness"] != "unknown" || c["l"].(map[string]any)["session_model"] != "(none)" {
		t.Errorf("plan-c no-provenance lens=%v", c["l"])
	}

	// Keyset continuation returns the same rows in the same order, then a changed snapshot is stale.
	seen := []string{}
	cur := ""
	for {
		u := base + "&limit=1"
		if cur != "" {
			u += "&cursor=" + url.QueryEscape(cur)
		}
		p := aok(t, s, u)
		for _, row := range rowsOf(p, "rows") {
			_, plan := planRowKey(row)
			seen = append(seen, plan)
		}
		next, ok := p["next"].(string)
		if !ok {
			break
		}
		cur = next
	}
	if !reflect.DeepEqual(seen, order) {
		t.Errorf("paged plan order=%v, first page=%v", seen, order)
	}
	first := aok(t, s, base+"&limit=1")
	cursor := first["next"].(string)
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "late", Harness: "h", RepoID: "repo",
		Path: "docs/plans/plan-d/DESIGN.md", ContentHash: keys.ContentHash([]byte("late")), TS: float64(now.Add(-30 * time.Second).Unix())}, nil)
	code, stale := aget(t, s, base+"&limit=1&cursor="+url.QueryEscape(cursor))
	if code != 409 || stale["code"] != "cursor_stale" {
		t.Fatalf("changed snapshot continuation=%d %v, want 409 cursor_stale", code, stale)
	}
}

func countPrefix(m map[string]any, prefix string) int {
	n := 0
	for k := range m {
		if strings.HasPrefix(k, prefix) {
			n++
		}
	}
	return n
}

// TestAnalyticsPlanReadErrorsAreQueryFailures forces a store read failure on plan list and detail:
// it must be a 500 query failure, never 400 unsupported sort and never a 200 empty page.
func TestAnalyticsPlanReadErrorsAreQueryFailures(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC().Truncate(time.Second)
	window := planScaleWindow(now)
	list := "/v1/analytics/entities?grain=plan" + window
	detail := "/v1/analytics/entity?grain=plan&repo_id=repo&plan=p&collection=sessions" + window
	aok(t, s, list)
	aok(t, s, detail)
	if err := ts.t.Close(); err != nil {
		t.Fatal(err)
	}
	for name, url := range map[string]string{"list": list, "detail": detail} {
		code, body := aget(t, s, url)
		msg, _ := body["error"].(string)
		if code != 500 || msg != "read failed" {
			t.Errorf("%s query failure=%d %v, want 500 read failed", name, code, body)
		}
		if code == 400 || strings.Contains(msg, "unsupported plan sort") {
			t.Errorf("%s query failure mislabeled as unsupported sort: %d %v", name, code, body)
		}
	}
}
