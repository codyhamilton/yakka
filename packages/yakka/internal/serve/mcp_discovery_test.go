package serve

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestMCPAnonymousDiscoveryRemote(t *testing.T) {
	var calls atomic.Int32
	readTool := MCPTool{Name: "probe-read", Handler: func(context.Context, string, *tenantState, map[string]any, LocalContext) (any, error) {
		calls.Add(1)
		return map[string]any{}, nil
	}}
	gh := mockGitHub(t, 92, "mcp-owner2", []mockEmail{{Email: "m2@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	_ = s.RegisterStatelessMCPTools()
	_ = s.RegisterFeedbackMCPTool()
	_ = s.RegisterListReviewsMCPTool()
	mcpRegister(t, s, readTool)
	mcpRegister(t, s, MCPTool{Name: "probe-write", Scope: TokenScopeReadWrite, Handler: func(context.Context, string, *tenantState, map[string]any, LocalContext) (any, error) {
		calls.Add(1)
		return map[string]any{}, nil
	}})
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tid := remoteCreateTenant(t, h, origin, sess, "beta")
	_, readKey := remoteIssueToken(t, h, origin, sess, tid, TokenScopeRead, "1d")
	_, writeKey := remoteIssueToken(t, h, origin, sess, tid, TokenScopeReadWrite, "1d")

	initBody := `{"id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}`
	listBody := `{"id":2,"method":"tools/list"}`
	if rec := mcpRequest(t, h, "", `{"method":"ping"}`, nil); rec.Code != 202 {
		t.Fatalf("notification: %d", rec.Code)
	}
	anonInit := mcpDecode(t, mcpRequest(t, h, "", initBody, nil))["result"].(map[string]any)
	readInit := mcpDecode(t, mcpRequest(t, h, readKey, initBody, nil))["result"].(map[string]any)
	if anonInit["instructions"] != readInit["instructions"] {
		t.Fatalf("instructions differ: anon=%q read=%q", anonInit["instructions"], readInit["instructions"])
	}
	anonList := mcpDecode(t, mcpRequest(t, h, "", listBody, map[string]string{"Yakka-Context": "2"}))["result"].(map[string]any)["tools"].([]any)
	readList := mcpDecode(t, mcpRequest(t, h, readKey, listBody, map[string]string{"Yakka-Context": "2"}))["result"].(map[string]any)["tools"].([]any)
	if len(anonList) == 0 {
		t.Fatal("anonymous tool list empty")
	}
	if len(anonList) != len(readList) {
		t.Fatalf("list len anon=%d read=%d", len(anonList), len(readList))
	}
	names := map[string]bool{}
	for _, item := range anonList {
		n := item.(map[string]any)["name"].(string)
		names[n] = true
	}
	for _, want := range []string{"list_checks", "search_artifacts", "artifact_feedback", "list_reviews"} {
		if !names[want] {
			t.Fatalf("missing %s in anonymous list", want)
		}
	}
	if names["review_change"] {
		t.Fatal("review_change must not appear anonymously")
	}
	writeList := mcpDecode(t, mcpRequest(t, h, writeKey, listBody, map[string]string{"Yakka-Context": "2"}))["result"].(map[string]any)["tools"].([]any)
	if len(writeList) <= len(readList) {
		t.Fatal("read_write list should include more tools than read")
	}

	callBody := mcpCallBody("list_checks", map[string]any{"kind": "design"})
	if rec := mcpRequest(t, h, "", callBody, nil); rec.Code != 401 || !strings.Contains(rec.Body.String(), `"error":`) {
		t.Fatalf("anonymous call: %d %s", rec.Code, rec.Body.String())
	}
	if calls.Load() != 0 {
		t.Fatalf("handlers ran: %d", calls.Load())
	}
	if rec := mcpRequest(t, h, "bad-token", initBody, nil); rec.Code != 401 {
		t.Fatalf("bad bearer initialize: %d", rec.Code)
	}
	if rec := mcpRequest(t, h, "", initBody, map[string]string{"Authorization": "Basic dXNlcjpwYXNz"}); rec.Code != 401 {
		t.Fatalf("non-bearer authorization: %d %s", rec.Code, rec.Body.String())
	}
	spy := &mcpReadSpy{}
	req := httptest.NewRequest("POST", "/v1/mcp", spy)
	req.Header.Set("Authorization", "Bearer not-valid")
	h.ServeHTTP(httptest.NewRecorder(), req)
	if spy.read {
		t.Fatal("bad bearer read body")
	}
	if rec := mcpRequest(t, h, "", initBody, map[string]string{"Origin": "https://evil.example"}); rec.Code != 403 {
		t.Fatalf("origin: %d", rec.Code)
	}
	if code, b := do(t, h, "POST", "/v1/ingest", "", artBody("x")); code != 401 {
		t.Fatalf("ingest anonymous: %d %s", code, b)
	}
	// Rate limit: inject a low cap via the limiter's clock and counter.
	s.mcpDiscovery.hits = map[string][]time.Time{}
	s.mcpDiscovery.now = func() time.Time { return fixedTime }
	const ip = "203.0.113.9"
	for i := 0; i < mcpDiscoveryRatePerMinute; i++ {
		s.mcpDiscovery.hits[ip] = append(s.mcpDiscovery.hits[ip], fixedTime)
	}
	req = httptest.NewRequest("POST", "/v1/mcp", strings.NewReader(initBody))
	req.RemoteAddr = ip + ":1234"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 429 || strings.Contains(rec.Body.String(), "jsonrpc") {
		t.Fatalf("rate limit: %d %s", rec.Code, rec.Body.String())
	}
	if rec := mcpRequest(t, h, readKey, initBody, nil); rec.Code != 200 {
		t.Fatalf("bearer after rate cap: %d", rec.Code)
	}
	big := `{"id":1,"method":"initialize","padding":"` + strings.Repeat("x", mcpDefaultBody) + `"}`
	if rec := mcpRequest(t, h, "", big, nil); rec.Code != 413 {
		t.Fatalf("oversize anonymous: %d", rec.Code)
	}
	_ = writeKey // exercised above in writeList check
}

var fixedTime = mustParseTime("2026-01-02T15:04:05Z")

func mustParseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestMCPDiscoveryLimitsAdmit(t *testing.T) {
	l := newMCPDiscoveryLimits()
	base := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	l.now = func() time.Time { return base }
	for i := 0; i < mcpDiscoveryRatePerMinute; i++ {
		if err := l.admit("203.0.113.1"); err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
	}
	if err := l.admit("203.0.113.1"); !errors.Is(err, errMCPDiscoveryRateLimited) {
		t.Fatalf("want rate_limited, got %v", err)
	}
	if err := l.admit("203.0.113.2"); err != nil {
		t.Fatal(err)
	}
}

func TestMCPAnonymousDiscoveryKeyedNonRemote(t *testing.T) {
	s, _ := newServer(t, true)
	_ = s.RegisterStatelessMCPTools()
	h := s.Handler()
	initBody := `{"id":1,"method":"initialize"}`
	rec := mcpRequest(t, h, "", initBody, nil)
	if rec.Code != 200 {
		t.Fatalf("keyed anonymous init: %d %s", rec.Code, rec.Body.String())
	}
	call := mcpCallBody("list_checks", map[string]any{"kind": "design"})
	if rec := mcpRequest(t, h, "", call, nil); rec.Code != 401 {
		t.Fatalf("keyed anonymous call: %d", rec.Code)
	}
}

func TestMCPAnonymousLocalModeUnchanged(t *testing.T) {
	s := New(Config{Data: t.TempDir()}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	mcpRegister(t, s, MCPTool{Name: "write", Scope: TokenScopeReadWrite, Handler: func(_ context.Context, tenant string, _ *tenantState, _ map[string]any, _ LocalContext) (any, error) {
		return map[string]any{"tenant": tenant}, nil
	}})
	h := s.Handler()
	v := mcpDecode(t, mcpRequest(t, h, "", mcpCallBody("write", map[string]any{}), nil))["result"].(map[string]any)
	if v["tenant"] != LocalTenant {
		t.Fatalf("local call: %v", v)
	}
}
