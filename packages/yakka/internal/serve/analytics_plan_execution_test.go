package serve

import (
	"context"
	"net/url"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func TestAnalyticsPlanEntitiesExposeScopedIdentityAndDetails(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC().Truncate(time.Second)
	add := func(conv, path string, at time.Time, extra fx) {
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: conv, Harness: "h", RepoID: "repo", Path: path, ContentHash: keys.ContentHash([]byte(path + conv)), TS: float64(at.Unix())}, extra)
	}
	add("shared", "docs/plans/p/DESIGN.md", now.Add(-time.Minute), nil)
	add("shared", "docs/plans/q/DESIGN.md", now.Add(-30*time.Second), nil)
	add("outside", "docs/plans/p/reports/b.md", now.Add(-24*time.Hour), nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "shared", Harness: "missing-price-provider", NormEvent: "usage", Event: "usage", TS: float64(now.Add(-time.Second).Unix()), TokIn: 50}, nil)
	base := "/v1/analytics/entities?grain=plan&from=" + url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339)) + "&to=" + url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339))
	page := aok(t, s, base+"&limit=1")
	rows := rowsOf(page, "rows")
	if len(rows) != 1 || rows[0]["id"].(map[string]any)["repo_id"] != "repo" {
		t.Fatalf("plan page=%v", page)
	}
	if _, ok := page["next"].(string); !ok {
		t.Fatalf("missing plan cursor: %v", page)
	}
	if rows[0]["m"].(map[string]any)["shared_sessions"] != float64(1) {
		t.Fatalf("shared-session overlap missing: %v", rows[0])
	}
	if _, ok := rows[0]["m"].(map[string]any)["artifacts_by_kind"]; !ok {
		t.Fatalf("plan artifact-kind counts missing: %v", rows[0])
	}
	if _, ok := rows[0]["l"].(map[string]any)["harness"]; !ok {
		t.Fatalf("plan harness lens missing: %v", rows[0])
	}
	if rows[0]["m"].(map[string]any)["unpriced_calls"] != float64(1) || rows[0]["m"].(map[string]any)["associated_cost_usd"] != nil || rows[0]["flags"].(map[string]any)["associated_cost_lower_bound"] != true {
		t.Fatalf("missing-pricing semantics=%v", rows[0])
	}
	detail := aok(t, s, "/v1/analytics/entity?grain=plan&repo_id=repo&plan=p&collection=sessions&limit=1&from="+url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339))+"&to="+url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339)))
	if detail["collection"] != "sessions" || len(rowsOf(detail, "rows")) != 1 {
		t.Fatalf("plan detail=%v", detail)
	}
	if detail["population"].(map[string]any)["scope_n"] != float64(1) {
		t.Fatalf("plan session population=%v", detail)
	}
}

func TestAnalyticsExecutionEntitiesUseProcessShapeAndIdentityTie(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC().Truncate(time.Second)
	for _, p := range []string{"a.md", "b.md"} {
		hash := keys.ContentHash([]byte(p))
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "same", Harness: "h", RepoID: "repo", Path: "docs/plans/p/briefs/" + p, ContentHash: hash, TS: float64(now.Unix())}, fx{"content_hash": hash})
	}
	base := "/v1/analytics/entities?grain=execution&from=" + url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339)) + "&to=" + url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339))
	first := aok(t, s, base+"&limit=1")
	rows := rowsOf(first, "rows")
	if len(rows) != 1 || rows[0]["l"].(map[string]any)["shape"] != "started" {
		t.Fatalf("execution rows=%v", first)
	}
	if _, ok := rows[0]["l"].(map[string]any)["session_model"]; !ok {
		t.Fatalf("execution session-model lens missing: %v", rows[0])
	}
	next := first["next"].(string)
	second := aok(t, s, base+"&limit=1&cursor="+url.QueryEscape(next))
	if len(rowsOf(second, "rows")) != 1 {
		t.Fatalf("execution cursor=%v", second)
	}
}

func TestAnalyticsPlanExecutionSchemaMatchesImplementedMeasuresAndOrders(t *testing.T) {
	s, _ := queryFixture(t)
	schema := aok(t, s, "/v1/analytics/schema")
	features := schema["features"].(map[string]any)
	if features["entities_plan"] != true || features["entities_execution"] != true {
		t.Fatalf("plan/execution capabilities missing: %v", features)
	}
	grains := schema["grains"].(map[string]any)
	plan := grains["plan"].(map[string]any)
	execution := grains["execution"].(map[string]any)
	planMeasures := plan["measures"].([]any)
	for _, want := range []string{"artifacts:<kind>", "design_score:<check>", "associated_cost_usd", "complete_share", "span_days"} {
		found := false
		for _, got := range planMeasures {
			if got == want {
				found = true
			}
		}
		if !found {
			t.Errorf("plan schema lacks measure %q: %v", want, planMeasures)
		}
	}
	if execution["order"] == nil || plan["sort"] == nil {
		t.Fatalf("plan/execution order declarations missing: %v", grains)
	}
	planSort := plan["sort"].([]any)
	for _, want := range []string{"artifacts:<kind>", "design_score:<check>", "associated_cost_usd", "unpriced_calls", "complete_share"} {
		found := false
		for _, got := range planSort {
			found = found || got == want
		}
		if !found {
			t.Errorf("plan schema lacks sort %q: %v", want, planSort)
		}
	}
	if features["cohort"] != true {
		t.Fatalf("cohort feature not advertised after the proof: %v", features)
	}
}

func TestAnalyticsPlanSortAndCursorSnapshot(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC().Truncate(time.Second)
	for _, item := range []struct{ plan, path string }{{"a", "DESIGN.md"}, {"b", "DESIGN.md"}, {"b", "briefs/x.md"}} {
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: item.plan + item.path, Harness: "h", RepoID: "repo", Path: "docs/plans/" + item.plan + "/" + item.path, ContentHash: keys.ContentHash([]byte(item.plan + item.path)), TS: float64(now.Unix())}, nil)
	}
	base := "/v1/analytics/entities?grain=plan&sort=versions:asc&from=" + url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339)) + "&to=" + url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339))
	first := aok(t, s, base+"&limit=1")
	rows := rowsOf(first, "rows")
	if len(rows) != 1 || rows[0]["id"].(map[string]any)["plan"] != "a" {
		t.Fatalf("plan sort by versions=%v", first)
	}
	cursor := first["next"].(string)
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "late", Harness: "h", RepoID: "repo", Path: "docs/plans/c/DESIGN.md", ContentHash: keys.ContentHash([]byte("late")), TS: float64(now.Unix())}, nil)
	code, stale := aget(t, s, base+"&limit=1&cursor="+url.QueryEscape(cursor))
	if code != 409 {
		t.Fatalf("changed receive watermark continuation status=%d body=%v", code, stale)
	}
}

func TestAnalyticsPlanDerivedSortMeasures(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC().Truncate(time.Second)
	for _, item := range []struct {
		plan, path string
		score      float64
	}{{"a", "DESIGN.md", .4}, {"b", "DESIGN.md", .8}, {"b", "briefs/x.md", 0}, {"c", "DESIGN.md", 0}} {
		hash := keys.ContentHash([]byte(item.plan + item.path))
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: item.plan + item.path, Harness: "h", RepoID: "repo", Path: "docs/plans/" + item.plan + "/" + item.path, ContentHash: hash, TS: float64(now.Unix())}, nil)
		if item.path == "DESIGN.md" && item.plan != "c" {
			if err := ts.t.AppendScores(t.Context(), hash, []store.Score{{Check: "clarity", Result: item.score, Scorer: "fixture"}}); err != nil {
				t.Fatal(err)
			}
		}
	}
	base := "/v1/analytics/entities?grain=plan&from=" + url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339)) + "&to=" + url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339)) + "&limit=1"
	for _, measure := range []string{"artifacts:design", "design_score:clarity", "associated_cost_usd", "unpriced_calls", "complete_share"} {
		for _, direction := range []string{"asc", "desc"} {
			baseURL := base + "&sort=" + url.QueryEscape(measure+":"+direction)
			page := aok(t, s, baseURL)
			seen := []string{}
			for {
				for _, row := range rowsOf(page, "rows") {
					seen = append(seen, row["id"].(map[string]any)["plan"].(string))
				}
				next, ok := page["next"].(string)
				if !ok {
					break
				}
				page = aok(t, s, baseURL+"&cursor="+url.QueryEscape(next))
			}
			if len(seen) != 3 || seen[0] == seen[1] || seen[1] == seen[2] || seen[0] == seen[2] {
				t.Errorf("sort %s:%s continuation has gaps or duplicates: %v", measure, direction, seen)
			}
			if measure == "design_score:clarity" {
				want := []string{"a", "b", "c"}
				if direction == "desc" {
					want = []string{"b", "a", "c"}
				}
				for i := range want {
					if seen[i] != want[i] {
						t.Errorf("nullable score sort %s order=%v, want %v", direction, seen, want)
						break
					}
				}
			}
		}
	}
}

func TestAnalyticsPlanDetailExecutionAndEventTiesPageDeterministically(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC().Truncate(time.Second)
	base := float64(now.Unix())
	for _, item := range []struct{ conv, path string }{{"b", "docs/plans/p/briefs/b.md"}, {"a", "docs/plans/p/briefs/a.md"}} {
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: item.conv, Harness: "h", RepoID: "repo", Path: item.path, ContentHash: keys.ContentHash([]byte(item.path)), TS: base}, nil)
	}
	window := "&from=" + url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339)) + "&to=" + url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339))
	first := aok(t, s, "/v1/analytics/entity?grain=plan&repo_id=repo&plan=p&collection=executions&limit=1"+window)
	firstRows := rowsOf(first, "rows")
	if len(firstRows) != 1 || firstRows[0]["path"] != "docs/plans/p/briefs/a.md" {
		t.Fatalf("execution detail first page=%v", first)
	}
	second := aok(t, s, "/v1/analytics/entity?grain=plan&repo_id=repo&plan=p&collection=executions&limit=1&cursor="+url.QueryEscape(first["next"].(string))+window)
	if rows := rowsOf(second, "rows"); len(rows) != 1 || rows[0]["path"] != "docs/plans/p/briefs/b.md" {
		t.Fatalf("execution detail second page=%v", second)
	}
	eventURL := "/v1/analytics/entity?grain=plan&repo_id=repo&plan=p&collection=events&limit=1" + window
	page := aok(t, s, eventURL)
	seen := []fx{}
	for {
		seen = append(seen, rowsOf(page, "rows")...)
		next, ok := page["next"].(string)
		if !ok {
			break
		}
		page = aok(t, s, eventURL+"&cursor="+url.QueryEscape(next))
	}
	if len(seen) != 2 {
		t.Fatalf("event tie pages returned %d rows: %v", len(seen), seen)
	}
	if seen[0]["event_type"] != "artifact_version" || seen[1]["event_type"] != "artifact_version" {
		t.Fatalf("event type ties were lost across pages: %v", seen)
	}
}

func TestAnalyticsPlanExecutionCursorRejectsScoreRevisionChange(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC().Truncate(time.Second)
	for _, plan := range []string{"a", "b"} {
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: plan, Harness: "h", RepoID: "repo", Path: "docs/plans/" + plan + "/DESIGN.md", ContentHash: keys.ContentHash([]byte(plan)), TS: float64(now.Unix())}, nil)
	}
	base := "/v1/analytics/entities?grain=plan&from=" + url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339)) + "&to=" + url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339))
	first := aok(t, s, base+"&limit=1")
	if err := ts.t.AppendScores(context.Background(), keys.ContentHash([]byte("derived")), []store.Score{{Check: "check", Result: 0.9, Scorer: "fixture"}}); err != nil {
		t.Fatal(err)
	}
	code, body := aget(t, s, base+"&limit=1&cursor="+url.QueryEscape(first["next"].(string)))
	if code != 409 || body["code"] != "cursor_stale" {
		t.Fatalf("changed derivation revision status=%d body=%v", code, body)
	}
}
