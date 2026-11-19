package serve

import (
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func distWindow(t *testing.T, s *Server) string {
	m := aok(t, s, "/v1/analytics/summary")
	from := m["from"].(string)
	to := m["to"].(string)
	return "from=" + from + "&to=" + to
}

func TestDistributionErrors(t *testing.T) {
	s, _ := queryFixture(t)
	win := "from=2026-11-08T00:00:00Z&to=2026-11-09T00:00:00Z"
	aerr(t, s, "/v1/analytics/distribution?"+win, 400, "measure required")
	aerr(t, s, "/v1/analytics/distribution?measure=nope&"+win, 400, "unknown measure nope")
	aerr(t, s, "/v1/analytics/distribution?measure=cost_usd&grain=hour&"+win, 400, "unknown grain hour")
	aerr(t, s, "/v1/analytics/distribution?measure=cost_usd&dim=repo_id&"+win, 400, "unsupported dimension repo_id for cost_usd")
}

func TestDistributionShape(t *testing.T) {
	s, _ := queryFixture(t)
	win := distWindow(t, s)
	m := aok(t, s, "/v1/analytics/distribution?measure=tokens_in&grain=call&"+win)
	if m["measure"] != "tokens_in" || m["grain"] != "call" {
		t.Fatalf("meta: %v", m)
	}
	if _, ok := m["rows"].([]any); !ok {
		t.Fatalf("rows missing or wrong type: %v", m["rows"])
	}
}

func TestDistributionSessionLenses(t *testing.T) {
	s, ts := queryTenant(t)
	win := "from=2026-11-08T00:00:00Z&to=2026-11-09T00:00:00Z"
	for i, item := range []struct{ id, harness, repo, model string }{{"a", "alpha", "repo-a", "model-a"}, {"b", "beta", "repo-b", "model-b"}} {
		at := float64(time.Date(2026, 11, 8, 2+i, 0, 0, 0, time.UTC).Unix())
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: item.id, Harness: item.harness, RepoID: item.repo, Path: "docs/plans/p/DESIGN.md", ContentHash: keys.ContentHash([]byte(item.id)), TS: at}, nil)
		qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: item.id, Harness: item.harness, NormEvent: "usage", Model: item.model, TokIn: 10, CostReported: func() *float64 { v := .1; return &v }(), TS: at}, nil)
	}
	for _, dim := range []string{"harness", "session_model", "session_repo"} {
		m := aok(t, s, "/v1/analytics/distribution?measure=cost_usd&grain=conversation&dim="+dim+"&"+win)
		rows, ok := m["rows"].([]any)
		if !ok || len(rows) == 0 || m["dim"] != dim {
			t.Fatalf("dim %s response: %v", dim, m)
		}
		seen := map[string]bool{}
		for _, raw := range rows {
			row := raw.(map[string]any)
			key := row["k"].(string)
			if seen[key] || row["n"] == nil || row["unpriced"] == nil {
				t.Fatalf("dim %s row coverage: %v", dim, rows)
			}
			seen[key] = true
		}
	}
}

func TestDistributionAcceptsWideRange(t *testing.T) {
	s, _ := queryFixture(t)
	from := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	to := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	m := aok(t, s, "/v1/analytics/distribution?measure=cost_usd&from="+from+"&to="+to)
	if m["measure"] != "cost_usd" {
		t.Fatalf("wide-range response: %v", m)
	}
}
