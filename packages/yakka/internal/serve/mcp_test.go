package serve

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMCPTransportAndConformanceRegistry(t *testing.T) {
	s, _ := newServer(t, true)
	if err := s.RegisterMCPTool(MCPTool{Name: "echo", Description: "echo", InputSchema: map[string]any{"type": "object"}, Scope: TokenScopeRead, Instruction: "Use echo.", Handler: func(_ context.Context, tenant string, _ *tenantState, args map[string]any, _ LocalContext) (any, error) {
		return map[string]any{"tenant": tenant, "args": args}, nil
	}}); err != nil {
		t.Fatal(err)
	}
	if err := s.RegisterMCPTool(MCPTool{Name: "write", Scope: TokenScopeReadWrite, Instruction: "Use write.", Handler: func(context.Context, string, *tenantState, map[string]any, LocalContext) (any, error) {
		return map[string]any{}, nil
	}}); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	call := func(method, body, key string) (int, string, http.Header) {
		req := httptest.NewRequest(method, "/v1/mcp", strings.NewReader(body))
		if key != "" {
			req.Header.Set("Authorization", "Bearer "+key)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code, rec.Body.String(), rec.Header()
	}
	code, body, _ := call(http.MethodPost, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}`, "ka")
	if code != 200 || !strings.Contains(body, `"protocolVersion":"2025-03-26"`) || !strings.Contains(body, "Use echo.") || !strings.Contains(body, "Use write.") {
		t.Fatalf("initialize: %d %s", code, body)
	}
	code, body, _ = call(http.MethodPost, `{"jsonrpc":"2.0","id":2,"method":"unknown"}`, "ka")
	if code != 200 || !strings.Contains(body, `"code":-32601`) {
		t.Fatalf("unknown: %d %s", code, body)
	}
	code, body, _ = call(http.MethodPost, `bad`, "ka")
	if code != 200 || !strings.Contains(body, `"code":-32700`) || !strings.Contains(body, `"id":null`) {
		t.Fatalf("parse: %d %s", code, body)
	}
	code, _, _ = call(http.MethodGet, "", "ka")
	if code != 405 {
		t.Fatalf("GET status: %d", code)
	}
	code, body, _ = call(http.MethodPost, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"_local":{"secret":"x"},"value":1}}}`, "ka")
	var reply map[string]any
	if err := json.Unmarshal([]byte(body), &reply); err != nil {
		t.Fatal(err)
	}
	result := reply["result"].(map[string]any)
	if result["tenant"] != "a" || strings.Contains(body, "secret") {
		t.Fatalf("call: %s", body)
	}
	if scopeAllows(TokenScopeRead, TokenScopeReadWrite) || !scopeAllows(TokenScopeReadWrite, TokenScopeReadWrite) || !scopeAllows(TokenScopeRead, TokenScopeRead) || scopeAllows("", TokenScopeRead) || scopeAllows("other", TokenScopeReadWrite) {
		t.Fatal("MCP scope filtering is incorrect")
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":5,"method":"ping"}`))
	req.Header.Set("Origin", "http://localhost")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatalf("origin: %d", rec.Code)
	}
	code, _, _ = call(http.MethodPost, `{"jsonrpc":"2.0","method":"ping"}`, "ka")
	if code != 202 {
		t.Fatalf("notification: %d", code)
	}
}

func TestMCPRegistrationValidation(t *testing.T) {
	s, _ := newServer(t, true)
	handler := func(context.Context, string, *tenantState, map[string]any, LocalContext) (any, error) {
		return nil, nil
	}
	if err := s.RegisterMCPTool(MCPTool{Name: "x", Handler: handler}); err != nil {
		t.Fatal(err)
	}
	if err := s.RegisterMCPTool(MCPTool{Name: "x", Handler: handler}); err == nil {
		t.Fatal("duplicate accepted")
	}
	if err := s.RegisterMCPTool(MCPTool{Name: "bad", Handler: handler, Context: []MCPReader{{Reader: "missing", Version: 1}}}); err == nil {
		t.Fatal("unknown reader accepted")
	}
	if err := s.RegisterMCPTool(MCPTool{Name: "dependent", Handler: handler, Context: []MCPReader{{Reader: "file", Version: 1}}}); err == nil {
		t.Fatal("reader without dependency accepted")
	}
	if err := s.RegisterMCPTool(MCPTool{Name: "slow", Handler: handler, TimeoutS: 301}); err == nil {
		t.Fatal("timeout above cap accepted")
	}
	if err := s.RegisterMCPTool(MCPTool{Name: "effect", Handler: handler, LocalActions: []string{"write"}}); err == nil {
		t.Fatal("local action accepted")
	}
}

type mcpErrReader struct{}

func (mcpErrReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

func TestMCPShortReadIsNotTooLarge(t *testing.T) {
	s, _ := newServer(t, true)
	req := httptest.NewRequest(http.MethodPost, "/v1/mcp", mcpErrReader{})
	req.Header.Set("Authorization", "Bearer ka")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != 400 || strings.Contains(rec.Body.String(), "too large") {
		t.Fatalf("short read: %d %s", rec.Code, rec.Body.String())
	}
}
