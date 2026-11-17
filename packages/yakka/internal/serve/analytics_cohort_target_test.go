package serve

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/scorer"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func cohortParam(predicate string) string {
	raw := `{"v":1,"grain":"session","scope":{"from":"2026-01-01T00:00:00Z","to":"2026-12-31T00:00:00Z","tz":"UTC","include":[],"exclude":[]},"predicate":` + predicate + `}`
	return url.QueryEscape(raw)
}

func TestAnalyticsCohortRouteAcceptance(t *testing.T) {
	s, _ := queryFixture(t)
	win := "from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z"
	cohort := "cohort=" + cohortParam(`{"range":{"measure":"commits","lo":0,"hi":1000000}}`)
	accepted := []string{
		"/v1/analytics/query?measure=conversations&bucket=none",
		"/v1/analytics/distribution?measure=cost_usd",
		"/v1/analytics/summary",
		"/v1/analytics/series?metric=commits&bucket=day",
		"/v1/analytics/conversations",
		"/v1/analytics/executions",
		"/v1/analytics/scores?kind=design",
		"/v1/analytics/score-series?kind=design&bucket=day",
		"/v1/analytics/explore",
		"/v1/analytics/activity",
		"/v1/analytics/entities?grain=session",
	}
	join := func(path, query string) string {
		if strings.Contains(path, "?") {
			return path + "&" + query
		}
		return path + "?" + query
	}
	for _, path := range accepted {
		code, body := aget(t, s, join(join(path, win), cohort))
		if code != 200 {
			t.Errorf("%s rejected a valid cohort: %d %v", path, code, body)
		}
	}
	refused := []string{
		"/v1/analytics/facets",
		"/v1/analytics/entity?grain=artifact",
		"/v1/analytics/conversation?id=x",
		"/v1/analytics/content?repo_id=r&path=docs/plans/p/DESIGN.md&hash=" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		"/v1/baselines?kind=design",
		"/v1/analytics/schema",
	}
	for _, path := range refused {
		code, body := aget(t, s, join(path, cohort))
		if code != 400 || body["code"] != "cohort_invalid" || body["reason"] != "route_not_supported" {
			t.Errorf("%s did not refuse the cohort: %d %v", path, code, body)
		}
	}
}

func TestAnalyticsCohortDynamicCheckValidatesCatalogue(t *testing.T) {
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
	at := float64(time.Date(2026, 11, 8, 3, 0, 0, 0, time.UTC).Unix())
	check := catalog.For("design")[0].Name
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "check-session", Harness: "h", RepoID: "r", Path: "docs/plans/p/DESIGN.md", TS: at}, nil)
	win := "from=2026-11-08T00:00:00Z&to=2026-11-09T00:00:00Z"

	known := "cohort=" + url.QueryEscape(`{"v":1,"grain":"artifact","scope":{"from":"2026-11-08T00:00:00Z","to":"2026-11-09T00:00:00Z","tz":"UTC","include":[],"exclude":[]},"predicate":{"range":{"measure":"score:`+check+`","lo":0,"hi":1}}}`)
	if code, body := aget(t, s, "/v1/analytics/entities?grain=artifact&"+win+"&"+known); code != 200 {
		t.Fatalf("known check cohort rejected: %d %v", code, body)
	}
	unknown := "cohort=" + url.QueryEscape(`{"v":1,"grain":"artifact","scope":{"from":"2026-11-08T00:00:00Z","to":"2026-11-09T00:00:00Z","tz":"UTC","include":[],"exclude":[]},"predicate":{"range":{"measure":"score:invented","lo":0,"hi":1}}}`)
	if code, body := aget(t, s, "/v1/analytics/entities?grain=artifact&"+win+"&"+unknown); code != 400 || body["code"] != "cohort_invalid" {
		t.Fatalf("unknown check cohort not rejected: %d %v", code, body)
	}
}

func TestAnalyticsSessionLensFiltersOnScatterAndAggregate(t *testing.T) {
	s, ts := queryTenant(t)
	win := "from=2026-11-08T00:00:00Z&to=2026-11-08T23:59:59Z"
	at := func(hour, minute int) float64 {
		return float64(time.Date(2026, 11, 8, hour, minute, 0, 0, time.UTC).Unix())
	}
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "lens-a", Harness: "alpha", NormEvent: "usage", Model: "model-1", TokIn: 10, TS: at(1, 0)}, nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "lens-a", Harness: "alpha", NormEvent: "usage", Model: "model-1", TokIn: 10, TS: at(1, 5)}, nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "lens-a", Harness: "beta", NormEvent: "usage", Model: "model-2", TokIn: 10, TS: at(1, 10)}, nil)
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "lens-a", Harness: "alpha", RepoID: "repo-1", TS: at(1, 20)}, nil)
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "lens-a", Harness: "beta", RepoID: "repo-2", Path: "docs/plans/p/DESIGN.md", TS: at(1, 30)}, nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "lens-b", Harness: "beta", NormEvent: "usage", Model: "model-2", TokIn: 20, TS: at(2, 0)}, nil)
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "lens-b", Harness: "beta", RepoID: "repo-2", TS: at(2, 10)}, nil)

	scatter := aok(t, s, "/v1/analytics/entities?grain=session&mode=scatter&field=tokens_in&field=tokens_out&harness=beta&"+win)
	if scatter["population_n"] != float64(1) || len(rowsOf(scatter, "rows")) != 1 {
		t.Fatalf("lens scatter population=%v rows=%v", scatter["population_n"], scatter["rows"])
	}
	marginal := scatter["marginals"].(map[string]any)["tokens_in"].([]any)
	total := 0.0
	for _, raw := range marginal {
		total += raw.(map[string]any)["n"].(float64)
	}
	if total != 1 {
		t.Errorf("lens scatter marginal total=%v, want 1", total)
	}

	aggregate := aok(t, s, "/v1/analytics/entities?grain=session&mode=aggregate&stat=count&harness=beta&"+win)
	if aggregate["value"] != float64(1) || aggregate["population"].(map[string]any)["scope_n"] != float64(1) {
		t.Fatalf("lens aggregate=%v", aggregate)
	}
	mixed := aok(t, s, "/v1/analytics/entities?grain=session&mode=aggregate&stat=count&session_model=%28mixed%29&"+win)
	if mixed["value"] != float64(1) {
		t.Fatalf("session_model=(mixed) aggregate=%v", mixed)
	}
	multi := aok(t, s, "/v1/analytics/entities?grain=session&mode=scatter&field=tokens_in&field=tokens_out&session_repo=%28multi%29&"+win)
	if multi["population_n"] != float64(1) {
		t.Fatalf("session_repo=(multi) scatter=%v", multi)
	}
}

func TestAnalyticsArtifactCohortResolves(t *testing.T) {
	s, ts := queryTenant(t)
	win := "from=2026-11-08T00:00:00Z&to=2026-11-08T23:00:00Z"
	at := func(minute int) float64 {
		return float64(time.Date(2026, 11, 8, 1, minute, 0, 0, time.UTC).Unix())
	}
	hash := keys.ContentHash([]byte("artifact-cohort"))
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "art-a", Harness: "h", RepoID: "r", TS: at(0)}, nil)
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "art-a", Harness: "h", RepoID: "r", Path: "docs/plans/p/DESIGN.md", ContentHash: hash, TS: at(1)}, nil)
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "art-b", Harness: "h", RepoID: "r", Path: "docs/plans/p/BRIEF.md", ContentHash: hash, TS: at(2)}, nil)

	cohort := "cohort=" + cohortParam(`{"range":{"measure":"commits","lo":1,"hi":1}}`)
	m := aok(t, s, "/v1/analytics/entities?grain=artifact&"+win+"&"+cohort)
	rows := rowsOf(m, "rows")
	if len(rows) != 1 || rows[0]["id"].(map[string]any)["path"] != "docs/plans/p/DESIGN.md" {
		t.Fatalf("artifact cohort rows=%v, want only the commit session's file", rows)
	}
}

func timeCohortParam(fields, include, exclude, predicate string) string {
	raw := `{"v":1,"grain":"time","scope":{"from":"2026-11-08T00:00:00Z","to":"2026-11-09T00:00:00Z","tz":"UTC","include":` + include + `,"exclude":` + exclude + `},"predicate":` + predicate + `,"source":{"fields":` + fields + `,"bucket":"day","bucket_step":1}}`
	return "cohort=" + url.QueryEscape(raw)
}

func TestAnalyticsTimeCohortTargetSessions(t *testing.T) {
	s, ts := queryTenant(t)
	win := "from=2026-11-08T00:00:00Z&to=2026-11-09T00:00:00Z"
	at := func(h int) float64 { return float64(time.Date(2026, 11, 8, h, 0, 0, 0, time.UTC).Unix()) }
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "c1", Harness: "h", RepoID: "r", Event: "commit", TS: at(3)}, nil)
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "c2", Harness: "h", RepoID: "r", Event: "commit", TS: at(4)}, nil)
	cohort := timeCohortParam(`["commits","hook_events"]`, `[]`, `[]`, `{"range":{"measure":"commits","lo":1,"hi":100}}`)

	m := aok(t, s, "/v1/analytics/entities?grain=time&field=commits&field=hook_events&bucket=day&"+win+"&"+cohort)
	population := m["population"].(map[string]any)
	if population["unit"] != "bucket" || population["grain"] != "time" {
		t.Fatalf("time population=%v", population)
	}
	relation, ok := population["relation"].(map[string]any)
	if !ok {
		t.Fatalf("time population has no relation: %v", population)
	}
	target, ok := relation["target_sessions"].(map[string]any)
	if !ok || target["unit"] != "session" || target["scope_n"] != float64(2) || target["cohort_n"] != float64(2) {
		t.Fatalf("time target_sessions=%v", relation["target_sessions"])
	}
}

func TestAnalyticsTimeCohortRefusesInapplicableFilter(t *testing.T) {
	s, _ := queryTenant(t)
	win := "from=2026-11-08T00:00:00Z&to=2026-11-09T00:00:00Z"
	cohort := timeCohortParam(`["rejections","conversations"]`, `[{"lens":"tool","values":["Read"]}]`, `[]`, `{"range":{"measure":"rejections","lo":0,"hi":100}}`)

	code, body := aget(t, s, "/v1/analytics/entities?grain=time&field=rejections&field=conversations&bucket=day&"+win+"&"+cohort)
	if code != 400 || body["code"] != "unsupported_join" {
		t.Fatalf("inapplicable time filter=%d %v want 400 unsupported_join", code, body)
	}
	message, _ := body["error"].(string)
	if !strings.Contains(message, "tool") || !strings.Contains(message, "source field") {
		t.Fatalf("refusal must name filter and source field: %v", body)
	}
}

func TestAnalyticsActivityByTypeAndTargetSessions(t *testing.T) {
	s, ts := queryTenant(t)
	win := "from=2026-11-08T00:00:00Z&to=2026-11-09T00:00:00Z"
	at := func(h int) float64 { return float64(time.Date(2026, 11, 8, h, 0, 0, 0, time.UTC).Unix()) }
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "c1", Harness: "h", RepoID: "r", Event: "commit", TS: at(3)}, nil)
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "c1", Harness: "h", RepoID: "r", Path: "docs/plans/p/briefs/a.md", Event: "artifact", TS: at(4)}, nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "c2", Harness: "h", Event: "PreToolUse", NormEvent: "tool_use", Tool: "Read", TS: at(2)}, nil)
	cohort := "cohort=" + cohortParam(`{"range":{"measure":"commits","lo":1,"hi":1}}`)

	m := aok(t, s, "/v1/analytics/activity?"+win+"&"+cohort)
	population := m["population"].(map[string]any)
	byType, ok := population["by_type"].(map[string]any)
	if !ok {
		t.Fatalf("activity population has no by_type: %v", population)
	}
	want := map[string]struct {
		unit          string
		scope, cohort float64
	}{
		"session_start":    {"session", 2, 1},
		"artifact_version": {"version", 1, 1},
		"execution":        {"execution", 1, 1},
		"rejection":        {"rejection", 0, 0},
	}
	for name, w := range want {
		entry, ok := byType[name].(map[string]any)
		if !ok || entry["unit"] != w.unit || entry["scope_n"] != w.scope || entry["cohort_n"] != w.cohort {
			t.Fatalf("by_type[%s]=%v want %+v", name, byType[name], w)
		}
	}
	relation, ok := population["relation"].(map[string]any)
	if !ok {
		t.Fatalf("activity population has no relation: %v", population)
	}
	target, ok := relation["target_sessions"].(map[string]any)
	if !ok || target["unit"] != "session" || target["scope_n"] != float64(2) || target["cohort_n"] != float64(1) {
		t.Fatalf("activity target_sessions=%v", relation["target_sessions"])
	}
}
