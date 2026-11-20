package store

import (
	"context"
	"testing"
)

func TestAnalyticsCoverageEmpty(t *testing.T) {
	tn := openT(t, Options{})
	cov, err := tn.AnalyticsCoverage(context.Background())
	if err != nil {
		t.Fatalf("empty ledger coverage: %v", err)
	}
	facts, ok := cov["facts"].(map[string]any)
	if !ok || len(facts) != 0 {
		t.Fatalf("facts = %#v, want empty object", cov["facts"])
	}
	sessions, ok := cov["sessions"].(map[string]int)
	if !ok {
		t.Fatalf("sessions = %#v, want counts", cov["sessions"])
	}
	if sessions["total"] != 0 || sessions["with_session_repo"] != 0 || sessions["without_session_repo"] != 0 {
		t.Fatalf("sessions = %v, want zero counts", sessions)
	}
	if u, present := cov["usage"]; present && u != nil {
		t.Fatalf("usage = %#v, want null/absent on an empty ledger", u)
	}
	units, ok := cov["units"].(map[string]any)
	if !ok || units["ts"] != "unix_seconds" || units["received_at"] != "unix_nanoseconds" {
		t.Fatalf("units = %#v, want ts=unix_seconds received_at=unix_nanoseconds", cov["units"])
	}
}
