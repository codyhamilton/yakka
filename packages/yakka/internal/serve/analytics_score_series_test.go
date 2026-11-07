package serve

import (
	"testing"
	"time"
)

func scoreSeriesWindow(t *testing.T, s *Server) string {
	m := aok(t, s, "/v1/analytics/summary")
	return "from=" + m["from"].(string) + "&to=" + m["to"].(string)
}

func TestScoreSeriesErrors(t *testing.T) {
	s, _ := queryFixture(t)
	win := scoreSeriesWindow(t, s)
	aerr(t, s, "/v1/analytics/score-series?"+win, 400, "kind required")
	aerr(t, s, "/v1/analytics/score-series?kind=nope&bucket=day&"+win, 400, "kind must be design, brief or report")
	aerr(t, s, "/v1/analytics/score-series?kind=design&"+win, 400, "bucket required")
	aerr(t, s, "/v1/analytics/score-series?kind=design&bucket=hour&"+win, 400, "bucket must be day, week, or month")
}

func TestScoreSeriesShape(t *testing.T) {
	s, _ := queryFixture(t)
	win := scoreSeriesWindow(t, s)
	m := aok(t, s, "/v1/analytics/score-series?kind=design&bucket=day&"+win)
	if m["kind"] != "design" || m["bucket"] != "day" {
		t.Fatalf("meta: %v", m)
	}
	if _, ok := m["checks"].([]any); !ok {
		t.Fatalf("checks missing or wrong type: %v", m["checks"])
	}
}

func TestScoreSeriesAcceptsWideRange(t *testing.T) {
	s, _ := queryFixture(t)
	from := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	to := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
	m := aok(t, s, "/v1/analytics/score-series?kind=design&bucket=day&from="+from+"&to="+to)
	if m["kind"] != "design" {
		t.Fatalf("wide-range response: %v", m)
	}
}
