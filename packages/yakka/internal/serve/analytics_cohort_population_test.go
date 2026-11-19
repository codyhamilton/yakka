package serve

import (
	"context"
	"fmt"
	"net/url"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// cohortOpParam encodes a session cohort over [from,to] matching sessions with commits.
func cohortOpParam(from, to time.Time, op string) string {
	if op == "" {
		op = "include"
	}
	raw := fmt.Sprintf(`{"v":1,"grain":"session","scope":{"from":%q,"to":%q,"tz":"UTC","include":[],"exclude":[]},"predicate":{"range":{"measure":"commits","lo":1,"hi":1000000}},"op":%q}`,
		from.Format(time.RFC3339), to.Format(time.RFC3339), op)
	return "cohort=" + url.QueryEscape(raw)
}

func cohortRelationFixture(t *testing.T) (*Server, *tenantState, string, time.Time, time.Time) {
	t.Helper()
	s, ts := queryTenant(t)
	now := time.Now().UTC()
	from, to := now.Add(-time.Hour), now.Add(time.Hour)
	at := float64(now.Add(-10 * time.Minute).Unix())
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "c-in", Harness: "h", RepoID: "r", Event: "e", NormEvent: "tool_use", Tool: "Read", TS: at}, nil)
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "c-in", Harness: "h", RepoID: "r", TS: at}, nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "c-out", Harness: "h", RepoID: "r", Event: "e", NormEvent: "tool_use", Tool: "Read", TS: at}, nil)
	for _, conv := range []string{"c-in", "", "ghost"} {
		if err := ts.t.AppendRejection(context.Background(), store.Rejection{Stage: "screen", ConversationID: conv, Pattern: "p", Reason: "r"}); err != nil {
			t.Fatal(err)
		}
	}
	win := "from=" + url.QueryEscape(from.Format(time.RFC3339)) + "&to=" + url.QueryEscape(to.Format(time.RFC3339))
	return s, ts, win, from, to
}

func populationOf(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	p, ok := body["population"].(map[string]any)
	if !ok {
		t.Fatalf("missing population in %v", body)
	}
	return p
}

func relationOf(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	rel, ok := populationOf(t, body)["relation"].(map[string]any)
	if !ok || rel == nil {
		t.Fatalf("missing population.relation in %v", body)
	}
	return rel
}

func TestCohortRelationOnAcceptingRoutes(t *testing.T) {
	s, _, win, from, to := cohortRelationFixture(t)
	cohort := cohortOpParam(from, to, "include")
	join := func(path string) string {
		sep := "?"
		for _, c := range path {
			if c == '?' {
				sep = "&"
			}
		}
		return path + sep + win + "&" + cohort
	}
	for _, path := range []string{
		"/v1/analytics/query?measure=conversations&bucket=none",
		"/v1/analytics/distribution?measure=cost_usd",
		"/v1/analytics/summary",
		"/v1/analytics/series?metric=commits&bucket=day",
		"/v1/analytics/conversations",
		"/v1/analytics/executions",
		"/v1/analytics/scores?kind=design",
		"/v1/analytics/score-series?kind=design&bucket=day",
		"/v1/analytics/explore",
		"/v1/analytics/entities?grain=session",
		"/v1/analytics/entities?grain=artifact",
		"/v1/analytics/entities?grain=plan",
		"/v1/analytics/entities?grain=execution",
	} {
		rel := relationOf(t, aok(t, s, join(path)))
		for _, key := range []string{"source_grain", "target_grain", "mapping", "op", "resolved_n", "resolved_unit", "associations"} {
			if _, ok := rel[key]; !ok {
				t.Errorf("%s relation missing %q: %v", path, key, rel)
			}
		}
		if rel["source_grain"] != "session" || rel["target_grain"] != "session" || rel["resolved_unit"] != "session" || rel["op"] != "include" {
			t.Errorf("%s relation fields=%v", path, rel)
		}
		if rel["resolved_n"].(float64) != 1 {
			t.Errorf("%s resolved_n=%v, want 1", path, rel["resolved_n"])
		}
		if _, ok := rel["associations"].([]any); !ok {
			t.Errorf("%s associations is not an array: %T", path, rel["associations"])
		}
	}
}

func TestCohortRelationNullWithoutCohort(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC()
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "c1", Harness: "h", RepoID: "r", TS: float64(now.Unix())}, nil)
	win := "from=" + url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339)) + "&to=" + url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339))
	body := aok(t, s, "/v1/analytics/entities?grain=session&"+win)
	if rel, ok := populationOf(t, body)["relation"]; !ok || rel != nil {
		t.Fatalf("no-cohort relation=%v, want null", populationOf(t, body)["relation"])
	}
}

func TestCohortSessionInvariant(t *testing.T) {
	s, _, win, from, to := cohortRelationFixture(t)
	include := aok(t, s, "/v1/analytics/summary?"+win+"&"+cohortOpParam(from, to, "include"))
	exclude := aok(t, s, "/v1/analytics/summary?"+win+"&"+cohortOpParam(from, to, "exclude"))
	inc, exc := populationOf(t, include), populationOf(t, exclude)
	scope, inN, outN := inc["scope_n"].(float64), inc["cohort_n"].(float64), exc["cohort_n"].(float64)
	if inN+outN != scope {
		t.Fatalf("include cohort_n %v + exclude cohort_n %v != scope_n %v", inN, outN, scope)
	}
	if inN != 1 || outN != 1 || scope != 2 {
		t.Fatalf("counts include=%v exclude=%v scope=%v, want 1/1/2", inN, outN, scope)
	}
}

func TestCohortRejectionAssociations(t *testing.T) {
	s, _, win, from, to := cohortRelationFixture(t)
	for _, tc := range []struct {
		op        string
		treatment string
	}{
		{"include", "dropped"},
		{"exclude", "kept"},
	} {
		body := aok(t, s, "/v1/analytics/summary?"+win+"&"+cohortOpParam(from, to, tc.op))
		list, ok := relationOf(t, body)["associations"].([]any)
		if !ok || len(list) != 1 {
			t.Fatalf("%s associations=%v", tc.op, relationOf(t, body)["associations"])
		}
		a := list[0].(map[string]any)
		total, assoc := a["total_n"].(float64), a["associated_n"].(float64)
		missing := a["missing_by_reason"].(map[string]any)
		noID, orphan := missing["no_conversation_id"].(float64), missing["orphan_conversation_id"].(float64)
		if a["side"] != "target" || a["contributor"] != "rejection" || a["unit"] != "rejection" || a["treatment"] != tc.treatment {
			t.Errorf("%s association=%v", tc.op, a)
		}
		if total != assoc+noID+orphan {
			t.Errorf("%s total_n %v != associated %v + missing %v + orphan %v", tc.op, total, assoc, noID, orphan)
		}
		if assoc != 1 || noID != 1 || orphan != 1 {
			t.Errorf("%s counts associated=%v no_conversation_id=%v orphan=%v, want 1/1/1", tc.op, assoc, noID, orphan)
		}
	}
}

func TestCohortPopulationUnits(t *testing.T) {
	s, _, win, from, to := cohortRelationFixture(t)
	cohort := cohortOpParam(from, to, "include")
	join := func(path string) string {
		sep := "?"
		for _, c := range path {
			if c == '?' {
				sep = "&"
			}
		}
		return path + sep + win + "&" + cohort
	}
	session := []string{
		"/v1/analytics/query?measure=rejections&bucket=none",
		"/v1/analytics/distribution?measure=cost_usd",
		"/v1/analytics/summary",
		"/v1/analytics/series?metric=rejections&bucket=day",
		"/v1/analytics/explore",
	}
	for _, path := range session {
		p := populationOf(t, aok(t, s, join(path)))
		if p["grain"] != "session" || p["unit"] != "conversation_id" {
			t.Errorf("%s population grain/unit=%v/%v", path, p["grain"], p["unit"])
		}
	}
	for _, path := range []string{
		"/v1/analytics/scores?kind=design",
		"/v1/analytics/score-series?kind=design&bucket=day",
	} {
		p := populationOf(t, aok(t, s, join(path)))
		if p["unit"] != "content_hash" {
			t.Errorf("%s population unit=%v, want content_hash", path, p["unit"])
		}
	}
}
