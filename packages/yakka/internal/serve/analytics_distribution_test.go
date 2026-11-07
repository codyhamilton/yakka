package serve

import (
	"testing"
	"time"
)

func distWindow(t *testing.T, s *Server) string {
	m := aok(t, s, "/v1/analytics/summary")
	from := m["from"].(string)
	to := m["to"].(string)
	return "from=" + from + "&to=" + to
}

func TestDistributionErrors(t *testing.T) {
	s, _ := queryFixture(t)
	win := distWindow(t, s)
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

func TestDistributionAcceptsWideRange(t *testing.T) {
	s, _ := queryFixture(t)
	from := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	to := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	m := aok(t, s, "/v1/analytics/distribution?measure=cost_usd&from="+from+"&to="+to)
	if m["measure"] != "cost_usd" {
		t.Fatalf("wide-range response: %v", m)
	}
}
