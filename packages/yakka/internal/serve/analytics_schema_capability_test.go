package serve

import (
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func TestAnalyticsSchemaPublishesFiltersPredicatesAndContent(t *testing.T) {
	s, _ := queryFixture(t)
	m := aok(t, s, "/v1/analytics/schema")
	grains := m["grains"].(map[string]any)
	for _, name := range []string{"session", "artifact", "content", "execution", "plan", "time"} {
		g, ok := grains[name].(map[string]any)
		if !ok {
			t.Fatalf("grain %s missing", name)
		}
		filters := strs(g["filters"])
		if len(filters) == 0 {
			t.Fatalf("%s publishes no filters", name)
		}
		predicate, ok := g["predicate"].(map[string]any)
		if !ok {
			t.Fatalf("%s publishes no predicate", name)
		}
		if _, ok := predicate["measures"]; !ok {
			t.Fatalf("%s predicate has no measures", name)
		}
		if _, ok := predicate["lenses"]; !ok {
			t.Fatalf("%s predicate has no lenses", name)
		}
		if _, ok := predicate["undefined"]; !ok {
			t.Fatalf("%s predicate has no undefined", name)
		}
		predMeasures := strs(predicate["measures"])
		for _, measure := range grainMeasuredNames(g["measures"]) {
			if !containsString(predMeasures, measure) {
				t.Errorf("%s predicate measures %v miss %s", name, predMeasures, measure)
			}
		}
	}
	content := grains["content"].(map[string]any)
	if modes := strs(content["modes"]); !equalStrs(modes, []string{"aggregate"}) {
		t.Errorf("content modes = %v", modes)
	}
	if content["required"] == nil && content["source"] == nil {
		t.Error("content grain does not name its required kind/check")
	}
	predicate := content["predicate"].(map[string]any)
	if lenses := strs(predicate["lenses"]); !containsString(lenses, "band") {
		t.Errorf("content predicate lenses = %v", lenses)
	}
	budgets := m["budgets"].(map[string]any)
	if budgets["scope_elements"] != float64(64) || budgets["scope_values"] != float64(64) {
		t.Errorf("scope budgets = %v", budgets)
	}
	valueBytes, ok := budgets["value_bytes"].(map[string]any)
	if !ok || valueBytes["default"] != float64(256) || valueBytes["id"] != float64(1024) {
		t.Errorf("value_bytes budget = %v", budgets["value_bytes"])
	}
	features := m["features"].(map[string]any)
	if _, ok := features["cohort"]; ok {
		t.Errorf("cohort advertised before proof: %v", features)
	}
}

func grainMeasuredNames(v any) []string {
	out := []string{}
	switch measures := v.(type) {
	case []any:
		for _, raw := range measures {
			switch m := raw.(type) {
			case string:
				out = append(out, m)
			case map[string]any:
				if name, ok := m["name"].(string); ok {
					out = append(out, name)
				}
			}
		}
	}
	return out
}

func containsString(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}

func TestAnalyticsSessionLensFilters(t *testing.T) {
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
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "lens-b", Harness: "beta", NormEvent: "usage", Model: "model-2", TokIn: 10, TS: at(2, 0)}, nil)
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "lens-b", Harness: "beta", RepoID: "repo-2", TS: at(2, 10)}, nil)

	ids := func(url string) []string {
		t.Helper()
		out := []string{}
		for _, row := range rowsOf(aok(t, s, url), "rows") {
			out = append(out, row["id"].(string))
		}
		sort.Strings(out)
		return out
	}
	path := "/v1/analytics/entities?grain=session&" + win
	if got := ids(path + "&harness=beta"); !equalStrs(got, []string{"lens-b"}) {
		t.Errorf("lens harness=beta = %v, want [lens-b]", got)
	}
	if got := ids(path + "&harness=alpha"); !equalStrs(got, []string{"lens-a"}) {
		t.Errorf("lens harness=alpha = %v, want [lens-a]", got)
	}
	if got := ids(path + "&session_model=%28mixed%29"); !equalStrs(got, []string{"lens-a"}) {
		t.Errorf("session_model=(mixed) = %v, want [lens-a]", got)
	}
	if got := ids(path + "&session_model=model-2"); !equalStrs(got, []string{"lens-b"}) {
		t.Errorf("session_model=model-2 = %v, want [lens-b]", got)
	}
	if got := ids(path + "&session_repo=%28multi%29"); !equalStrs(got, []string{"lens-a"}) {
		t.Errorf("session_repo=(multi) = %v, want [lens-a]", got)
	}
	if got := ids(path + "&model=model-1"); len(got) != 0 {
		t.Errorf("model=model-1 should alias the mixed session_model lens, got %v", got)
	}
	if got := ids(path + "&exclude=harness:alpha"); !equalStrs(got, []string{"lens-b"}) {
		t.Errorf("exclude=harness:alpha = %v, want [lens-b]", got)
	}

	legacy := aok(t, s, "/v1/analytics/conversations?harness=beta&"+win)
	legacyIDs := []string{}
	for _, row := range rowsOf(legacy, "rows") {
		legacyIDs = append(legacyIDs, row["conversation_id"].(string))
	}
	sort.Strings(legacyIDs)
	if !equalStrs(legacyIDs, []string{"lens-a", "lens-b"}) {
		t.Errorf("legacy conversations harness stayed fact-level: %v", legacyIDs)
	}
}

func TestAnalyticsTimeIgnoredFilters(t *testing.T) {
	s, _ := queryFixture(t)
	win := "from=2026-03-10T00:00:00Z&to=2026-03-11T00:00:00Z"
	m := aok(t, s, "/v1/analytics/entities?grain=time&field=commits&field=hook_events&bucket=day&model=model-1&"+win)
	if got := strs(m["ignored_filters"]); !containsString(got, "model") {
		t.Fatalf("time ignored_filters = %v, want model", got)
	}
}

func TestAnalyticsExcludeAcceptsPublishedFilterNames(t *testing.T) {
	s, _ := queryFixture(t)
	m := aok(t, s, "/v1/analytics/schema")
	grains := m["grains"].(map[string]any)
	names := map[string]bool{}
	for _, grain := range []string{"session", "artifact", "content", "execution", "plan", "time"} {
		for _, name := range strs(grains[grain].(map[string]any)["filters"]) {
			if strings.HasSuffix(name, ":<check>") {
				name = strings.TrimSuffix(name, ":<check>")
			}
			names[name] = true
		}
	}
	win := "from=2026-03-10T00:00:00Z&to=2026-03-11T00:00:00Z"
	for name := range names {
		code, body := aget(t, s, "/v1/analytics/entities?grain=session&exclude="+name+":sample&"+win)
		if code != 200 {
			t.Errorf("exclude=%s rejected: %d %v", name, code, body)
		}
	}
	if code, body := aget(t, s, "/v1/analytics/entities?grain=session&exclude=bogus:sample&"+win); code != 400 {
		t.Errorf("unpublished exclude dimension accepted: %d %v", code, body)
	}
}
