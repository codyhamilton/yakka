package serve

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// parityFixture seeds retained design scores and no active check catalogue. The
// two versions sit in different months so the score-series cell budget is real.
func parityFixture(t *testing.T) (*Server, *tenantState) {
	t.Helper()
	s, ts := queryTenant(t)
	ctx := context.Background()
	for i, month := range []time.Month{time.September, time.October} {
		body := []byte(fmt.Sprintf("retained parity body %d", i))
		hash := keys.ContentHash(body)
		if err := ts.t.WritePending(hash, body); err != nil {
			t.Fatal(err)
		}
		at := time.Date(2026, month, 8, 2, 0, 0, 0, time.UTC)
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: fmt.Sprintf("parity-session-%d", i),
			Harness: "harness-a", RepoID: "repo-a", Path: "docs/plans/parity/DESIGN.md", ContentHash: hash,
			TS: float64(at.Unix())}, nil)
		if err := ts.t.Promote(ctx, hash, store.Screen{Verdict: "pass", Scorer: "legacy-scorer"},
			store.Score{Check: "legacy-check", Result: 0.6 + float64(i)*0.1, Scorer: "legacy-scorer"}); err != nil {
			t.Fatal(err)
		}
		if err := ts.t.AppendScores(ctx, hash, []store.Score{{Check: "quality", Result: 0.7, Scorer: "legacy-scorer"}}); err != nil {
			t.Fatal(err)
		}
	}
	return s, ts
}

func artifactChecksByKind(t *testing.T, s *Server) map[string]any {
	t.Helper()
	schema := aok(t, s, "/v1/analytics/schema")
	grain := schema["grains"].(map[string]any)["artifact"].(map[string]any)
	return grain["checks_by_kind"].(map[string]any)
}

func TestAnalyticsRetainedChecks(t *testing.T) {
	s, _ := parityFixture(t)
	design := strs(artifactChecksByKind(t, s)["design"])
	if !containsValue(design, "legacy-check") {
		t.Fatalf("retained design check missing from /schema: %v", design)
	}

	scores := aok(t, s, "/v1/analytics/scores?kind=design&all=1")
	names := []string{}
	for _, c := range rowsOf(scores, "checks") {
		names = append(names, c["name"].(string))
	}
	if !containsValue(names, "legacy-check") {
		t.Fatalf("retained design check missing from /scores: %v", names)
	}

	selected := aok(t, s, "/v1/analytics/scores?kind=design&check=legacy-check&all=1")
	if got := rowsOf(selected, "checks"); len(got) != 1 || got[0]["name"] != "legacy-check" {
		t.Fatalf("selected retained check: %v", selected)
	}

	series := aok(t, s, "/v1/analytics/score-series?kind=design&bucket=month&check=legacy-check&all=1")
	checks := rowsOf(series, "checks")
	if len(checks) != 1 || checks[0]["name"] != "legacy-check" {
		t.Fatalf("selected retained score-series: %v", series)
	}
	if pts := checks[0]["points"].([]any); len(pts) != 2 {
		t.Fatalf("retained score-series months: %v", checks[0])
	}
}

func TestAnalyticsCapabilityParity(t *testing.T) {
	s, _ := parityFixture(t)
	schemaNames := map[string]bool{}
	for _, name := range strs(artifactChecksByKind(t, s)["design"]) {
		schemaNames[name] = true
	}
	scores := aok(t, s, "/v1/analytics/scores?kind=design&all=1")
	scoreNames := map[string]bool{}
	for _, c := range rowsOf(scores, "checks") {
		scoreNames[c["name"].(string)] = true
	}
	if len(schemaNames) == 0 || len(scoreNames) != len(schemaNames) {
		t.Fatalf("discovery and /scores disagree: schema=%v scores=%v", schemaNames, scoreNames)
	}
	for name := range schemaNames {
		if !scoreNames[name] {
			t.Fatalf("check %q discovered but not scored: schema=%v scores=%v", name, schemaNames, scoreNames)
		}
		if _, body := aget(t, s, "/v1/analytics/scores?kind=design&check="+name+"&all=1"); body == nil {
			t.Fatalf("selected-check validation refused %q", name)
		}
	}
	if code, body := aget(t, s, "/v1/analytics/scores?kind=design&check=absent-check&all=1"); code != 400 || body["error"] != "unknown check absent-check" {
		t.Fatalf("unknown check accepted: %d %v", code, body)
	}
}

func TestScoreSeriesRouteCapability(t *testing.T) {
	s, _ := parityFixture(t)
	schema := aok(t, s, "/v1/analytics/schema")
	resolutions := schema["resolutions"].(map[string]any)
	routes, ok := resolutions["routes"].(map[string]any)
	if !ok {
		t.Fatalf("route resolutions missing: %v", resolutions)
	}
	route, ok := routes["score-series"].(map[string]any)
	if !ok || len(route) != 2 || route["auto"] != false ||
		!equalStrs(strs(route["buckets"]), []string{"day", "week", "month"}) {
		t.Fatalf("score-series route capability: %v", routes["score-series"])
	}
	// The route entry is authoritative even though the legacy global flags still
	// advertise auto for the routes that support it.
	if resolutions["auto"] != true {
		t.Fatalf("legacy global resolutions changed: %v", resolutions)
	}

	for _, bucket := range []string{"auto", "hour"} {
		code, body := aget(t, s, "/v1/analytics/score-series?kind=design&bucket="+bucket+"&all=1")
		if code != 400 || body["code"] != "unsupported_resolution" {
			t.Fatalf("%s bucket refusal: %d %v", bucket, code, body)
		}
		if !equalStrs(strs(body["supported_buckets"]), []string{"day", "week", "month"}) {
			t.Fatalf("%s supported_buckets: %v", bucket, body)
		}
	}

	code, body := aget(t, s, "/v1/analytics/score-series?kind=design&bucket=month&all=1&max_cells=1")
	if code != 400 || body["code"] != "too_many_cells" || body["max_cells"] != float64(1) {
		t.Fatalf("cell budget refusal: %d %v", code, body)
	}
	if body["suggested_bucket"] == nil && body["suggested_action"] != "reduce_splits_checks_or_choose_window" {
		t.Fatalf("cell budget refusal has no suggestion: %v", body)
	}
}

func TestSessionScatterCommits(t *testing.T) {
	s, ts := queryTenant(t)
	at := float64(time.Date(2026, 11, 8, 2, 0, 0, 0, time.UTC).Unix())
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "scatter-session", Harness: "h", RepoID: "r", Event: "commit", TS: at}, nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "scatter-session", Harness: "h", Event: "usage",
		NormEvent: "usage", Model: "unpriced-model", TokIn: 5, TS: at + 1}, nil)

	schema := aok(t, s, "/v1/analytics/schema")
	session := schema["grains"].(map[string]any)["session"].(map[string]any)
	fields := strs(session["scatter_fields"])
	for _, field := range []string{"commits", "unpriced_calls"} {
		if !containsValue(fields, field) {
			t.Fatalf("scatter field %s not published: %v", field, fields)
		}
	}

	page := aok(t, s, "/v1/analytics/entities?grain=session&mode=scatter&fields=cost_usd,commits,unpriced_calls&all=1")
	rows := rowsOf(page, "rows")
	if len(rows) != 1 {
		t.Fatalf("scatter rows: %v", page)
	}
	measures := rows[0]["m"].(map[string]any)
	if measures["commits"] != float64(1) || measures["unpriced_calls"] != float64(1) {
		t.Fatalf("scatter commits/unpriced values: %v", measures)
	}
}
