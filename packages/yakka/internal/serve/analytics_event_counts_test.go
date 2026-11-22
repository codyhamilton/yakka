package serve

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func countTriplet(t *testing.T, m fx, key string) (int64, int64, int64) {
	t.Helper()
	x, ok := m[key].(map[string]any)
	if !ok {
		t.Fatalf("%s is not an object: %v", key, m[key])
	}
	events, ok1 := x["events"].(float64)
	rejections, ok2 := x["rejections"].(float64)
	rows, ok3 := x["rows"].(float64)
	if !ok1 || !ok2 || !ok3 {
		t.Fatalf("%s is not a count triplet: %v", key, x)
	}
	return int64(events), int64(rejections), int64(rows)
}

func eventCountsURL(from, to time.Time, extra url.Values) string {
	q := url.Values{"tenant": {"a"}, "from": {from.Format(time.RFC3339)}, "to": {to.Format(time.RFC3339)}}
	for k, v := range extra {
		q[k] = v
	}
	return "/v1/analytics/event-counts?" + q.Encode()
}

func TestEventCountsHandler(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC()
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "c1", Harness: "cursor", Event: "PreToolUse",
		TS: float64(now.Add(-time.Minute).Unix()), RepoID: "repoA"}, nil)
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "c2", Harness: "claude", Event: "artifact",
		TS: float64(now.Add(-2 * time.Minute).Unix()), RepoID: "repoA", Path: "docs/plans/p1/briefs/b.md"}, nil)
	for _, r := range []store.Rejection{
		{Stage: "precheck", FactType: "artifact_version", ConversationID: "c1", Path: "docs/plans/p1/briefs/b.md"},
		{Stage: "screen", FactType: "artifact_version", ConversationID: "c2", Path: "docs/plans/p1/reports/r.md"},
	} {
		if err := ts.t.AppendRejection(context.Background(), r); err != nil {
			t.Fatal(err)
		}
	}
	from, to := now.Add(-time.Hour), now.Add(time.Hour)

	m := aok(t, s, eventCountsURL(from, to, nil))
	if m["unit"] != "retained_record" {
		t.Fatalf("unit = %v", m["unit"])
	}
	if ev, rej, rows := countTriplet(t, m, "matched"); ev != 2 || rej != 2 || rows != 4 {
		t.Fatalf("matched = %d/%d/%d, want 2/2/4", ev, rej, rows)
	}
	if ev, rej, rows := countTriplet(t, m, "tenant_total"); ev != 2 || rej != 2 || rows != 4 {
		t.Fatalf("tenant_total = %d/%d/%d, want 2/2/4", ev, rej, rows)
	}
	checked, err := time.Parse(time.RFC3339, m["checked_at"].(string))
	if err != nil || checked.Location() != time.UTC || time.Since(checked) > 10*time.Second {
		t.Fatalf("checked_at = %v (%v)", m["checked_at"], err)
	}

	// A conversation-scoped read returns only that conversation's facts and rejections, while the
	// tenant total keeps all retained history.
	m = aok(t, s, eventCountsURL(from, to, url.Values{"conversation_id": {"c1"}}))
	if ev, rej, rows := countTriplet(t, m, "matched"); ev != 1 || rej != 1 || rows != 2 {
		t.Fatalf("conversation matched = %d/%d/%d, want 1/1/2", ev, rej, rows)
	}
	if ev, rej, rows := countTriplet(t, m, "tenant_total"); ev != 2 || rej != 2 || rows != 4 {
		t.Fatalf("conversation tenant_total = %d/%d/%d, want 2/2/4", ev, rej, rows)
	}

	// all=1 clears the window but keeps the tenant.
	m = aok(t, s, "/v1/analytics/event-counts?tenant=a&all=1")
	matchedEvents, _, _ := countTriplet(t, m, "matched")
	totalEvents, _, _ := countTriplet(t, m, "tenant_total")
	if matchedEvents != totalEvents || matchedEvents != 2 {
		t.Fatalf("all=1 matched events %d, tenant events %d, want 2", matchedEvents, totalEvents)
	}

	code, body := aget(t, s, eventCountsURL(from, to, url.Values{"bogus": {"x"}}))
	if code != 400 || body["code"] != "unsupported_filter" || body["reason"] != "bogus" {
		t.Fatalf("unknown key: %d %v", code, body)
	}
	code, body = aget(t, s, eventCountsURL(from, to, url.Values{"exclude": {"bogus:x"}}))
	if code != 400 || body["code"] != "unsupported_filter" || body["reason"] != "bogus" {
		t.Fatalf("unknown exclude: %d %v", code, body)
	}
	// A schema-published dimension the retained-record predicate cannot apply is
	// still a client error, not an unfiltered count or a read failure.
	code, body = aget(t, s, eventCountsURL(from, to, url.Values{"exclude": {"id:x"}}))
	if code != 400 || body["code"] != "unsupported_filter" || body["reason"] != "id" {
		t.Fatalf("unapplied exclude: %d %v", code, body)
	}
	code, body = aget(t, s, eventCountsURL(from, to, url.Values{"exclude": {"session_model:opus"}}))
	if code != 400 || body["code"] != "unsupported_filter" || body["reason"] != "session_model" {
		t.Fatalf("session_model exclude: %d %v", code, body)
	}
	explore := "/v1/analytics/explore?" + url.Values{
		"tenant": {"a"}, "from": {from.Format(time.RFC3339)}, "to": {to.Format(time.RFC3339)},
		"exclude": {"session_model:opus"},
	}.Encode()
	code, body = aget(t, s, explore)
	if code != 400 || body["code"] != "unsupported_filter" || body["reason"] != "session_model" {
		t.Fatalf("explore unapplied exclude: %d %v", code, body)
	}
	if cache := recHeader(t, s, eventCountsURL(from, to, nil)); cache != "private, no-store" {
		t.Fatalf("cache-control = %q", cache)
	}
}

func recHeader(t *testing.T, s *Server, path string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer ka")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("header probe %s: %d %s", path, rec.Code, rec.Body.String())
	}
	return rec.Header().Get("Cache-Control")
}

func TestEventCountsBusy(t *testing.T) {
	s, ts := queryTenant(t)
	for i := 0; i < analyticsHeavyConcurrency; i++ {
		ts.analyticsSlots <- struct{}{}
	}
	defer func() {
		for i := 0; i < analyticsHeavyConcurrency; i++ {
			<-ts.analyticsSlots
		}
	}()
	now := time.Now().UTC()
	code, body := aget(t, s, eventCountsURL(now.Add(-time.Hour), now.Add(time.Hour), nil))
	if code != 503 || body["code"] != "busy" {
		t.Fatalf("busy: %d %v", code, body)
	}
}

func TestEventCountsSchemaFlags(t *testing.T) {
	s, _ := queryTenant(t)
	m := aok(t, s, "/v1/analytics/schema?tenant=a")
	features, ok := m["features"].(map[string]any)
	if !ok {
		t.Fatalf("features = %v", m["features"])
	}
	if features["event_counts"] != true || features["record_filters"] != true {
		t.Fatalf("features lack event_counts/record_filters: %v", features)
	}
}

func TestEventCountsForeignTenant(t *testing.T) {
	gh := mockGitHub(t, 42, "foreign", []mockEmail{{Email: "foreign@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	code, body, _ := doWithCookies(t, h, "GET", "/v1/analytics/event-counts?tenant=else", origin, "", sess)
	if code != 403 || body == "" || body != "{\"error\":\"no such tenant\"}\n" {
		t.Fatalf("foreign tenant: %d %q", code, body)
	}
}
