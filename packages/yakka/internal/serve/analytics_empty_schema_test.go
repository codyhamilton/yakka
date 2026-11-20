package serve

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAnalyticsSchemaEmptyTenant(t *testing.T) {
	s, _ := queryTenant(t)
	code, body := do(t, s.Handler(), "GET", "/v1/analytics/schema", "ka", "")
	if code != 200 {
		t.Fatalf("empty schema: %d %s", code, body)
	}
	if strings.Contains(body, "read failed") {
		t.Fatalf("empty schema reported read failed: %s", body)
	}
	var m fx
	if err := json.Unmarshal([]byte(body), &m); err != nil {
		t.Fatalf("empty schema not JSON: %s", body)
	}
	coverage, ok := m["coverage"].(map[string]any)
	if !ok {
		t.Fatalf("coverage missing: %v", m)
	}
	facts, ok := coverage["facts"].(map[string]any)
	if !ok || len(facts) != 0 {
		t.Fatalf("coverage.facts = %#v, want empty object", coverage["facts"])
	}
	sessions, ok := coverage["sessions"].(map[string]any)
	if !ok || sessions["total"] != 0.0 || sessions["with_session_repo"] != 0.0 || sessions["without_session_repo"] != 0.0 {
		t.Fatalf("coverage.sessions = %#v, want zero counts", coverage["sessions"])
	}
	units, ok := coverage["units"].(map[string]any)
	if !ok || units["ts"] != "unix_seconds" || units["received_at"] != "unix_nanoseconds" {
		t.Fatalf("coverage.units = %#v", coverage["units"])
	}
}
