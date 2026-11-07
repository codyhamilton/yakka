package serve

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func queryTenant(t *testing.T) (*Server, *tenantState) {
	t.Helper()
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", "ka"}}}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	ts, err := s.tenant("a")
	if err != nil {
		t.Fatal(err)
	}
	return s, ts
}

// qadd appends one fact with round-trippable raw JSON, as an uncompacted ledger holds.
func qadd(t *testing.T, ts *tenantState, f store.FactRow, payload fx) {
	t.Helper()
	if payload == nil {
		payload = fx{}
	}
	payload["type"], payload["conversation_id"], payload["harness"] = f.Type, f.ConversationID, f.Harness
	payload["repo_id"], payload["event"], payload["ts"] = f.RepoID, f.Event, f.TS
	if f.Path != "" {
		payload["path"] = f.Path
	}
	if f.Source != "" {
		payload["source"] = f.Source
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	rh, err := keys.RowHash(raw)
	if err != nil {
		t.Fatal(err)
	}
	f.RowHash, f.Raw = rh, raw
	if _, err := ts.t.Append(context.Background(), []store.FactRow{f}); err != nil {
		t.Fatal(err)
	}
}

func queryFixture(t *testing.T) (*Server, *tenantState) {
	t.Helper()
	s, ts := queryTenant(t)
	now := time.Now().UTC()
	recent := float64(now.Add(-time.Hour).Unix())
	hook := func(conv, harness, repo, event, tool string, at float64) {
		qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: conv, Harness: harness, RepoID: repo,
			Event: event, NormEvent: "tool_use", Tool: tool, TS: at}, nil)
	}
	hook("c1", "claude", "r1", "PreToolUse", "Read", recent)
	hook("c2", "claude", "r1", "PreToolUse", "Bash", recent)
	hook("c3", "cursor", "r2", "Stop", "", recent)
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "cold", Harness: "claude", RepoID: "r1",
		Event: "commit", TS: float64(now.AddDate(0, 0, -40).Unix())}, nil)
	// A sub-day fact for the tz bucket boundary (23:30 UTC, outside the default window).
	hook("ctz", "claude", "r1", "PreToolUse", "Read", float64(time.Date(2026, 3, 10, 23, 30, 0, 0, time.UTC).Unix()))
	return s, ts
}

func TestAnalyticsSchema(t *testing.T) {
	s, _ := queryFixture(t)
	m := aok(t, s, "/v1/analytics/schema")
	if got := strs(m["buckets"]); !equalStrs(got, []string{"none", "hour", "day", "week", "month"}) {
		t.Errorf("buckets = %v", got)
	}
	budgets := m["budgets"].(map[string]any)
	if budgets["deadline_s"] != analyticsDeadline.Seconds() || budgets["max_cells"] != float64(20000) ||
		budgets["heavy_read_concurrency"] != float64(analyticsHeavyConcurrency) {
		t.Errorf("budget metadata: %v", budgets)
	}
	features := m["features"].(map[string]any)
	for _, name := range []string{"bucket_auto", "entities_session", "entities_time", "exclude", "scores_by_lens"} {
		if features[name] != true {
			t.Errorf("missing Phase 4 feature %s: %v", name, features)
		}
	}
	for _, name := range []string{"entities_artifact", "entities_plan", "entities_execution", "artifact_content", "activity", "cohort", "actions", "reviews"} {
		if _, ok := features[name]; ok {
			t.Errorf("later phase feature advertised: %s", name)
		}
	}
	if _, ok := m["grains"].(map[string]any)["session"]; !ok {
		t.Error("session grain missing")
	}
	if _, ok := m["grains"].(map[string]any)["time"]; !ok {
		t.Error("time grain missing")
	}
	sessionSchema := m["grains"].(map[string]any)["session"].(map[string]any)
	if !equalStrs(strs(sessionSchema["modes"]), []string{"list", "scatter", "aggregate"}) || !equalStrs(strs(sessionSchema["aggregate_stats"]), []string{"count", "sum", "percentiles", "histogram"}) {
		t.Errorf("session aggregate capability missing: %v", sessionSchema)
	}
	coverage := m["coverage"].(map[string]any)
	if _, ok := coverage["pending"]; !ok {
		t.Errorf("pending coverage missing: %v", coverage)
	}
	if kinds, ok := coverage["scored_content_by_kind"].(map[string]any); !ok || kinds["design"] == nil || kinds["brief"] == nil || kinds["report"] == nil {
		t.Errorf("per-kind score coverage missing: %v", coverage)
	}
	if _, ok := coverage["revisions"]; !ok {
		t.Errorf("revision coverage missing: %v", coverage)
	}
	// The design's measure × dimension matrix, verbatim; every measure also takes hour_of_day, weekday.
	design := []struct {
		name, unit string
		dims       []string
	}{
		{"hook_events", "count", []string{"harness", "repo_id", "norm_event", "event", "tool", "tool_kind", "conversation_id"}},
		{"conversations", "count", []string{"harness", "repo_id", "model"}},
		{"artifact_versions", "count", []string{"harness", "repo_id", "kind", "plan", "source", "conversation_id"}},
		{"distinct_content", "count", []string{"harness", "repo_id", "kind", "plan", "source", "conversation_id"}},
		{"commits", "count", []string{"harness", "repo_id", "conversation_id"}},
		{"rejections", "count", []string{"stage"}},
		{"model_calls", "count", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"tokens_in", "tokens", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"tokens_out", "tokens", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"tokens_cache_read", "tokens", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"tokens_cache_write", "tokens", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"tokens_reasoning", "tokens", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"cost_usd", "usd", []string{"harness", "repo_id", "model", "conversation_id"}},
		{"unpriced_calls", "count", []string{"harness", "repo_id", "model", "conversation_id"}},
	}
	got := rowsOf(m, "measures")
	if len(got) != len(design) {
		t.Fatalf("measures = %d, want %d", len(got), len(design))
	}
	for i, d := range design {
		if got[i]["name"] != d.name || got[i]["unit"] != d.unit {
			t.Errorf("measure %d = %v %v, want %s %s", i, got[i]["name"], got[i]["unit"], d.name, d.unit)
		}
		want := append(append([]string{}, d.dims...), "hour_of_day", "weekday")
		if g := strs(got[i]["dims"]); !equalStrs(g, want) {
			t.Errorf("%s dims = %v, want %v", d.name, g, want)
		}
	}
}

func TestAnalyticsSessionTimeEntitiesAndExclusions(t *testing.T) {
	s, ts := queryTenant(t)
	win := "from=2026-11-08T00:00:00Z&to=2026-11-08T23:59:59Z"
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "session-a", Harness: "alpha", RepoID: "repo-a", Event: "commit", TS: float64(time.Date(2026, 11, 8, 2, 0, 0, 0, time.UTC).Unix())}, nil)
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "session-a", Harness: "beta", RepoID: "repo-b", Path: "docs/plans/x/DESIGN.md", ContentHash: keys.ContentHash([]byte("x")), TS: float64(time.Date(2026, 11, 7, 2, 0, 0, 0, time.UTC).Unix())}, nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "session-a", Harness: "alpha", NormEvent: "usage", Model: "", TokIn: 3, TS: float64(time.Date(2026, 11, 8, 3, 0, 0, 0, time.UTC).Unix())}, nil)
	reportedCost := 0.1
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "session-a", Harness: "alpha", NormEvent: "usage", Model: "", TokIn: 4, CostReported: &reportedCost, TS: float64(time.Date(2026, 11, 8, 3, 30, 0, 0, time.UTC).Unix())}, nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "session-b", Harness: "", Event: "tool", NormEvent: "tool_use", TS: float64(time.Date(2026, 11, 8, 4, 0, 0, 0, time.UTC).Unix())}, nil)
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "session-c", Harness: "gamma", RepoID: "repo-c", Event: "commit", TS: float64(time.Date(2026, 11, 8, 5, 0, 0, 0, time.UTC).Unix())}, nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "session-d", NormEvent: "usage", Model: "unpriced-model", TokIn: 7, TS: float64(time.Date(2026, 11, 8, 6, 0, 0, 0, time.UTC).Unix())}, nil)
	schema := aok(t, s, "/v1/analytics/schema")
	coverage := schema["coverage"].(map[string]any)
	byKind := coverage["scored_content_by_kind"].(map[string]any)
	if coverage["pending"] != 0.0 || byKind["design"].(map[string]any)["total"] != 1.0 || byKind["design"].(map[string]any)["scored"] != 0.0 {
		t.Fatalf("schema coverage populations=%v", coverage)
	}
	revisions := coverage["revisions"].(map[string]any)
	if revisions["pricing"] != nil || revisions["catalogue"] != nil || revisions["tool_kind"] != nil || coverage["revision_gaps"] == nil {
		t.Fatalf("unknown revisions should remain explicitly unavailable: %v", coverage)
	}
	page := aok(t, s, "/v1/analytics/entities?grain=session&"+win)
	rows := rowsOf(page, "rows")
	if len(rows) != 4 {
		t.Fatalf("session rows=%v", rows)
	}
	var found map[string]any
	var noCalls, singleRepo map[string]any
	var allUnpriced map[string]any
	for _, r := range rows {
		if r["id"] == "session-a" {
			found = r
		} else if r["id"] == "session-b" {
			noCalls = r
		} else if r["id"] == "session-c" {
			singleRepo = r
		} else if r["id"] == "session-d" {
			allUnpriced = r
		}
	}
	if found == nil {
		t.Fatalf("session-a absent: %v", rows)
	}
	l := found["l"].(map[string]any)
	if l["session_repo"] != "(multi)" || l["session_model"] != "unknown" || l["harness"] != "alpha" {
		t.Fatalf("lenses=%v", l)
	}
	allWindow := aok(t, s, "/v1/analytics/entities?grain=session&all=1")
	var allWindowLenses map[string]any
	for _, row := range rowsOf(allWindow, "rows") {
		if row["id"] == "session-a" {
			allWindowLenses = row["l"].(map[string]any)
		}
	}
	if allWindowLenses == nil || !reflect.DeepEqual(l, allWindowLenses) {
		t.Fatalf("lifetime provenance changed across windows: narrow=%v all=%v", l, allWindowLenses)
	}
	if found["flags"].(map[string]any)["cost_lower_bound"] != true {
		t.Fatalf("cost flags=%v", found["flags"])
	}
	if found["m"].(map[string]any)["cost_usd"] != 0.1 || found["flags"].(map[string]any)["cost_lower_bound"] != true {
		t.Fatalf("partially priced session should have lower-bound cost: row=%v", found)
	}
	if allUnpriced == nil || allUnpriced["m"].(map[string]any)["cost_usd"] != nil {
		t.Fatalf("all-unpriced session should have null cost: %v", allUnpriced)
	}
	if noCalls["m"].(map[string]any)["cost_usd"] != 0.0 || singleRepo["m"].(map[string]any)["cost_usd"] != 0.0 || singleRepo["l"].(map[string]any)["session_repo"] != "repo-c" {
		t.Fatalf("no-call and single-repo rules not explicit: noCalls=%v singleRepo=%v", noCalls, singleRepo)
	}
	filteredSessions := aok(t, s, "/v1/analytics/entities?grain=session&where=commits:1..1&"+win)
	if len(rowsOf(filteredSessions, "rows")) != 2 || filteredSessions["population"].(map[string]any)["scope_n"] != 2.0 {
		t.Fatalf("numeric predicate did not select exact session population: %v", filteredSessions)
	}
	aggregate := aok(t, s, "/v1/analytics/entities?grain=session&mode=aggregate&stat=sum&field=commits&where=commits:1..1&"+win)
	if aggregate["value"] != 2.0 || aggregate["population"].(map[string]any)["eligible_n"] != 2.0 {
		t.Fatalf("session aggregate mismatch: %v", aggregate)
	}
	countAggregate := aok(t, s, "/v1/analytics/entities?grain=session&mode=aggregate&stat=count&"+win)
	if countAggregate["value"] != 4.0 {
		t.Fatalf("session count aggregate=%v", countAggregate)
	}
	percentiles := aok(t, s, "/v1/analytics/entities?grain=session&mode=aggregate&stat=percentiles&field=commits&"+win)
	if percentiles["p25"] != 0.0 || percentiles["p50"] != 0.0 || percentiles["p75"] != 1.0 {
		t.Fatalf("session percentiles=%v", percentiles)
	}
	histogram := aok(t, s, "/v1/analytics/entities?grain=session&mode=aggregate&stat=histogram&field=commits&"+win)
	if len(rowsOf(histogram, "bins")) != 2 || histogram["population"].(map[string]any)["eligible_n"] != 4.0 {
		t.Fatalf("session histogram=%v", histogram)
	}
	costAggregate := aok(t, s, "/v1/analytics/entities?grain=session&mode=aggregate&stat=sum&field=cost_usd&"+win)
	if costAggregate["population"].(map[string]any)["eligible_n"] != 3.0 || costAggregate["cost_lower_bound"] != true || costAggregate["population"].(map[string]any)["missing_by_reason"].(map[string]any)["unpriced_cost"] != 1.0 {
		t.Fatalf("session cost eligibility=%v", costAggregate)
	}
	if code, body := aget(t, s, "/v1/analytics/entities?grain=session&where=unknown:0..1&"+win); code != 400 || !strings.Contains(body["error"].(string), "unsupported session predicate") {
		t.Fatalf("unsupported predicate status=%d body=%v", code, body)
	}
	if code, body := aget(t, s, "/v1/analytics/entities?grain=session&where=commits:bad..1&"+win); code != 400 || !strings.Contains(body["error"].(string), "finite numbers") {
		t.Fatalf("malformed predicate status=%d body=%v", code, body)
	}
	if code, body := aget(t, s, "/v1/analytics/entities?grain=session&mode=aggregate&stat=bogus&field=commits&"+win); code != 400 || !strings.Contains(body["error"].(string), "unsupported session aggregate stat") {
		t.Fatalf("unsupported aggregate status=%d body=%v", code, body)
	}
	timeRows := aok(t, s, "/v1/analytics/entities?grain=time&field=commits&field=hook_events&bucket=day&"+win)
	if timeRows["grain"] != "time" || len(rowsOf(timeRows, "rows")) != 1 {
		t.Fatalf("time grid=%v", timeRows)
	}
	for _, r := range rowsOf(timeRows, "rows") {
		m := r["m"].(map[string]any)
		if m["commits"] != 2.0 || m["hook_events"] != 4.0 {
			t.Fatalf("time measures=%v", m)
		}
	}
	filtered := aok(t, s, "/v1/analytics/query?measure=commits&bucket=none&"+win+"&exclude=repo_id:repo-a")
	filteredRows := rowsOf(filtered, "rows")
	if len(filteredRows) != 1 || filteredRows[0]["v"] != 1.0 {
		t.Fatalf("exclude not applied: %v", filtered)
	}
	code, body := aget(t, s, "/v1/analytics/entities?grain=activity&"+win)
	if code != 400 || body["error"] != "grain must be session or time" {
		t.Fatalf("later grain status=%d body=%v", code, body)
	}
}

func TestAnalyticsSessionScatterDeterministicSampleHasWholePopulationMarginals(t *testing.T) {
	s, ts := queryTenant(t)
	const population = 5005
	now := float64(time.Now().UTC().Unix())
	facts := make([]store.FactRow, 0, population)
	for i := 0; i < population; i++ {
		conv := fmt.Sprintf("scatter-%05d", i)
		raw, err := json.Marshal(map[string]any{"type": "commit", "conversation_id": conv, "harness": "h", "repo_id": "r", "event": "commit", "ts": now})
		if err != nil {
			t.Fatal(err)
		}
		rh, err := keys.RowHash(raw)
		if err != nil {
			t.Fatal(err)
		}
		facts = append(facts, store.FactRow{Type: "commit", ConversationID: conv, Harness: "h", RepoID: "r", Event: "commit", TS: now, RowHash: rh, Raw: raw})
	}
	if _, err := ts.t.Append(context.Background(), facts); err != nil {
		t.Fatal(err)
	}
	url := "/v1/analytics/entities?grain=session&mode=scatter&field=tokens_in&field=tokens_out&field=cost_usd&all=1"
	first := aok(t, s, url)
	second := aok(t, s, url)
	rows := rowsOf(first, "rows")
	if first["sampled"] != true || first["population_n"] != float64(population) || first["returned_n"] != float64(5000) || len(rows) != 5000 {
		t.Fatalf("scatter sample metadata: sampled=%v population=%v returned=%v rows=%d", first["sampled"], first["population_n"], first["returned_n"], len(rows))
	}
	if !reflect.DeepEqual(rows, rowsOf(second, "rows")) {
		t.Fatal("identical scatter requests returned different deterministic samples")
	}
	marginals := first["marginals"].(map[string]any)
	for _, field := range []string{"tokens_in", "tokens_out", "cost_usd"} {
		bins, ok := marginals[field].([]any)
		if !ok {
			t.Fatalf("marginal %s has unexpected shape: %T", field, marginals[field])
		}
		total := 0.0
		for _, raw := range bins {
			total += raw.(map[string]any)["n"].(float64)
		}
		if total != population {
			t.Errorf("marginal %s counts sampled rows, got total %v want whole population %d", field, total, population)
		}
	}
	coverage := first["population"].(map[string]any)
	eligible := coverage["eligible_n"].(map[string]any)
	missing := coverage["missing_by_reason"].(map[string]any)
	if eligible["cost_usd"] != float64(population) || missing["unpriced_cost"] != float64(0) {
		t.Fatalf("no-call zero costs must remain eligible: eligible=%v missing=%v", eligible, missing)
	}
}

func TestAnalyticsSessionMeasuresReconcileWithLegacyQuery(t *testing.T) {
	s, _ := queryFixture(t)
	entity := aok(t, s, "/v1/analytics/entities?grain=session&all=1")
	rows := rowsOf(entity, "rows")
	measures := []string{"hook_events", "artifact_versions", "distinct_content", "commits"}
	for _, measure := range measures {
		var sum float64
		for _, row := range rows {
			v := row["m"].(map[string]any)[measure]
			if v == nil { // legacy totals only include priced calls; null sessions are not eligible.
				continue
			}
			sum += v.(float64)
		}
		legacy := aok(t, s, "/v1/analytics/query?measure="+measure+"&bucket=none&all=1")
		legacyRows := rowsOf(legacy, "rows")
		var want float64
		if len(legacyRows) > 0 {
			want = legacyRows[0]["v"].(float64)
		}
		if sum != want {
			t.Errorf("session %s sum=%v does not reconcile with legacy /query=%v", measure, sum, want)
		}
	}
	legacyConversations := aok(t, s, "/v1/analytics/query?measure=conversations&bucket=none&all=1")
	gotConversations := legacyConversations
	legacyRows := rowsOf(gotConversations, "rows")
	if len(legacyRows) != 1 || entity["population"].(map[string]any)["scope_n"] != legacyRows[0]["v"] {
		t.Fatalf("session population=%v does not reconcile with legacy conversations=%v", entity["population"], legacyRows)
	}
}

func equalStrs(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestAnalyticsQuery(t *testing.T) {
	s, ts := queryFixture(t)
	A := "/v1/analytics/query?"
	rows := func(u string) []fx { return rowsOf(aok(t, s, A+u), "rows") }

	t.Run("dims", func(t *testing.T) {
		zero := rows("measure=hook_events&bucket=none")
		if len(zero) != 1 || len(strs(zero[0]["k"])) != 0 || zero[0]["v"] != 3.0 {
			t.Fatalf("0 dims: %v", zero)
		}
		one := rows("measure=hook_events&dim=harness&bucket=none")
		if len(one) != 2 {
			t.Fatalf("1 dim: %v", one)
		}
		two := rows("measure=hook_events&dim=harness&dim=tool&bucket=none")
		if len(two) != 3 {
			t.Fatalf("2 dims: %v", two)
		}
		for _, r := range two {
			if len(strs(r["k"])) != 2 {
				t.Errorf("2 dims key: %v", r["k"])
			}
		}
	})

	t.Run("errors", func(t *testing.T) {
		aerr(t, s, A, 400, "measure required")
		aerr(t, s, A+"measure=nope", 400, "unknown measure nope")
		aerr(t, s, A+"measure=hook_events&dim=harness&dim=tool&dim=repo_id", 400, "at most two dim")
		aerr(t, s, A+"measure=conversations&dim=tool", 400, "unsupported dimension tool for conversations")
		aerr(t, s, A+"measure=hook_events&tz=Not%2FAZone", 400, "invalid tz")
		aerr(t, s, A+"measure=model_calls&dim=tool", 400, "unsupported dimension tool for model_calls")
	})

	t.Run("ignored_filters", func(t *testing.T) {
		m := aok(t, s, A+"measure=hook_events&dim=harness&kind=design&bucket=none")
		if g := strs(m["ignored_filters"]); !equalStrs(g, []string{"kind"}) {
			t.Fatalf("ignored_filters = %v", g)
		}
	})

	t.Run("top", func(t *testing.T) {
		m := aok(t, s, A+"measure=hook_events&dim=tool&top=1&bucket=none")
		found := false
		for _, r := range rowsOf(m, "rows") {
			if k := strs(r["k"]); len(k) == 1 && k[0] == "__other__" {
				found = true
			}
		}
		if !found {
			t.Fatalf("top=1 rows: %v", m["rows"])
		}
	})

	t.Run("all", func(t *testing.T) {
		if got := rows("measure=commits&dim=repo_id&bucket=none"); len(got) != 0 {
			t.Fatalf("default window: %v", got)
		}
		got := rows("measure=commits&dim=repo_id&all=1&bucket=none")
		if len(got) != 1 || got[0]["v"] != 1.0 {
			t.Fatalf("all=1: %v", got)
		}
	})

	t.Run("tz", func(t *testing.T) {
		m := aok(t, s, A+"measure=hook_events&dim=harness&bucket=day&tz=Australia%2FSydney"+
			"&from=2026-03-10T00:00:00Z&to=2026-03-12T00:00:00Z")
		rs := rowsOf(m, "rows")
		if len(rs) != 1 {
			t.Fatalf("tz rows: %v", rs)
		}
		ts, _ := rs[0]["t"].(string)
		if !strings.Contains(ts, "2026-03-11") || !(strings.Contains(ts, "+11:00") || strings.Contains(ts, "+10:00")) {
			t.Fatalf("tz bucket t = %q", ts)
		}
	})

	t.Run("cap", func(t *testing.T) {
		from := time.Now().UTC().AddDate(0, 0, -31).Format(time.RFC3339)
		to := time.Now().UTC().Format(time.RFC3339)
		if code, body := aget(t, s, A+"measure=hook_events&dim=harness&bucket=hour&from="+from+"&to="+to); code != 200 {
			t.Fatalf("31-day hourly request: status=%d body=%v", code, body)
		}
		aok(t, s, A+"measure=hook_events&dim=harness&bucket=day&from="+from+"&to="+to)
	})

	t.Run("auto_and_explicit_cell_budget", func(t *testing.T) {
		qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "mid", Harness: "claude", RepoID: "r1", Event: "PreToolUse", Tool: "Read", NormEvent: "tool_use",
			TS: float64(time.Date(2026, 3, 11, 12, 0, 0, 0, time.UTC).Unix())}, nil)
		from, to := "2020-01-01T00:00:00Z", "2030-01-01T00:00:00Z"
		m := aok(t, s, A+"measure=hook_events&dim=harness&bucket=auto&from="+from+"&to="+to)
		if m["bucket"] != "day" || m["requested_bucket"] != "auto" || m["coarsened"] != true {
			t.Fatalf("auto resolution metadata: %v", m)
		}
		multi := aok(t, s, A+"measure=hook_events&dim=harness&dim=tool&bucket=auto&max_cells=100&from=1700-01-01T00:00:00Z&to=2200-01-01T00:00:00Z")
		if multi["bucket"] != "year:10" || multi["bucket_step"] != float64(10) || len(rowsOf(multi, "rows")) == 0 {
			t.Fatalf("multi-century, two-dimension fixture: %v", multi)
		}
		win := multi["window"].(map[string]any)["requested"].(map[string]any)
		if win["from"] != "1700-01-01T00:00:00Z" || win["to"] != "2200-01-01T00:00:00Z" {
			t.Fatalf("auto clipped requested dates: %v", win)
		}
		code, body := aget(t, s, A+"measure=hook_events&dim=harness&bucket=day&max_cells=1&from="+from+"&to="+to)
		if code != 400 || body["code"] != "too_many_series" || body["suggested_top"] == nil || body["max_cells"] != float64(1) {
			t.Fatalf("explicit over-budget request: status=%d body=%v", code, body)
		}
		code, body = aget(t, s, A+"measure=hook_events&bucket=day&max_cells=1&from=2026-03-10T00:00:00Z&to=2026-03-11T23:59:59Z")
		if code != 400 || body["code"] != "too_many_cells" || body["suggested_bucket"] != "week" {
			t.Fatalf("explicit cell overflow: status=%d body=%v", code, body)
		}
	})
}

func TestAnalyticsQueryPartial(t *testing.T) {
	s, ts := queryTenant(t)
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "c", Harness: "claude", RepoID: "r1", Event: "commit",
		TS: float64(time.Now().UTC().Add(-time.Hour).Unix())}, nil)
	u := "/v1/analytics/query?measure=commits&bucket=none"

	// A tenant opened on an empty ledger seeds compaction=complete; mark it uncompacted, then compact.
	if err := ts.t.SetMeta(context.Background(), "compaction", "required"); err != nil {
		t.Fatal(err)
	}
	routes := []string{u, "/v1/analytics/facets", "/v1/analytics/summary", "/v1/analytics/series?metric=hook_events&bucket=day",
		"/v1/analytics/scores?kind=design", "/v1/analytics/executions", "/v1/analytics/conversations", "/v1/analytics/explore",
		"/v1/analytics/distribution?measure=cost_usd", "/v1/analytics/score-series?kind=design&bucket=day", "/v1/analytics/conversation?id=c"}
	for _, route := range routes {
		code, m := aget(t, s, route)
		if code != 200 || m["partial"] != true || !reflect.DeepEqual(strs(m["partial_reasons"]), []string{"compaction_incomplete"}) {
			t.Fatalf("uncompacted route %s: %d %v", route, code, m)
		}
	}
	if err := ts.t.SetMeta(context.Background(), "compaction", "complete"); err != nil {
		t.Fatal(err)
	}
	code, m := aget(t, s, u)
	if code != 200 {
		t.Fatalf("compacted: %d %v", code, m)
	}
	if _, ok := m["partial"]; ok {
		t.Fatalf("partial present after compaction: %v", m)
	}
}

func TestAnalyticsQueryAcceptsWideWindowAndRejectsOutOfNanosecondBounds(t *testing.T) {
	s, ts := queryTenant(t)
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "old", Harness: "claude", RepoID: "r1", Event: "commit",
		TS: float64(time.Date(1900, 1, 1, 0, 0, 0, 0, time.UTC).Unix())}, nil)
	wide := "/v1/analytics/query?measure=commits&bucket=day&from=1900-01-01T00:00:00Z&to=1910-01-01T00:00:00Z"
	if code, body := aget(t, s, wide); code != 200 {
		t.Fatalf("ten-year window: status=%d body=%v", code, body)
	}
	all := aok(t, s, "/v1/analytics/query?measure=commits&bucket=none&all=1")
	if rows := rowsOf(all, "rows"); len(rows) != 1 || rows[0]["v"] != 1.0 {
		t.Fatalf("all history including pre-epoch data: %v", rows)
	}
	for _, bound := range []string{
		"from=1677-09-21T00:12:43.145224191Z&to=1677-09-21T00:12:43.145224192Z",
		"from=2262-04-11T23:47:16.854775807Z&to=2262-04-11T23:47:16.854775808Z",
	} {
		code, body := aget(t, s, "/v1/analytics/query?measure=commits&bucket=none&"+bound)
		if code != 400 || body["code"] != "time_out_of_range" {
			t.Errorf("out-of-range %s: status=%d body=%v", bound, code, body)
		}
	}
	for _, bound := range []string{
		"from=1677-09-21T00:12:43.145224192Z&to=1677-09-21T00:12:43.145224192Z",
		"from=2262-04-11T23:47:16.854775807Z&to=2262-04-11T23:47:16.854775807Z",
	} {
		if code, body := aget(t, s, "/v1/analytics/query?measure=commits&bucket=none&"+bound); code != 200 {
			t.Errorf("inclusive boundary %s: status=%d body=%v", bound, code, body)
		}
	}
}

func TestAnalyticsQueryMonthSuggestionIsExecutable(t *testing.T) {
	s, ts := queryTenant(t)
	for i, month := range []time.Month{time.January, time.February, time.March} {
		at := time.Date(2025, month, 10, 0, 0, 0, 0, time.UTC)
		qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "c", Harness: "h", Event: "PostToolUse", NormEvent: "tool_post",
			TS: float64(at.Unix()) + float64(i)}, nil)
	}
	win := "from=2025-01-01T00:00:00Z&to=2025-03-31T23:59:59Z&max_cells=1"
	code, body := aget(t, s, "/v1/analytics/query?measure=hook_events&bucket=month&"+win)
	if code != 400 || body["code"] != "too_many_cells" || body["suggested_bucket"] != "year" || body["suggested_bucket_step"] != float64(1) {
		t.Fatalf("month overflow suggestion: status=%d body=%v", code, body)
	}
	got := aok(t, s, "/v1/analytics/query?measure=hook_events&bucket=year&"+win)
	if len(rowsOf(got, "rows")) != 1 || got["bucket"] != "year" {
		t.Fatalf("suggestion did not execute: %v", got)
	}
}

func TestAnalyticsFilterToolSummary(t *testing.T) {
	s, _ := queryFixture(t)
	aok(t, s, "/v1/analytics/summary?tool=Read")
}
