package serve

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func mcpRequest(t *testing.T, h http.Handler, key, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("POST", "http://127.0.0.1/v1/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}
func mcpDecode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var v map[string]any
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &v) != nil {
		t.Fatalf("reply: %d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "application/json" || strings.Contains(rec.Body.String(), "\n") {
		t.Fatalf("wire response: %v %q", rec.Header(), rec.Body.String())
	}
	return v
}
func mcpRegister(t *testing.T, s *Server, tool MCPTool) {
	t.Helper()
	if err := s.RegisterMCPTool(tool); err != nil {
		t.Fatal(err)
	}
}
func mcpNoop(context.Context, string, *tenantState, map[string]any, LocalContext) (any, error) {
	return map[string]any{}, nil
}
func mcpCallBody(name string, args any) string {
	b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": "call-id", "method": "tools/call", "params": map[string]any{"name": name, "arguments": args}})
	return string(b)
}

// Clauses 1–4: use real persisted remote credentials, tenant stores and the full handler.
func TestMCPRemoteTenantScopeMatrix(t *testing.T) {
	gh := mockGitHub(t, 91, "mcp-owner", []mockEmail{{Email: "mcp@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	type principal struct{ tenant, read, write, hash string }
	var principals []principal
	for _, name := range []string{"alpha", "beta"} {
		tid := remoteCreateTenant(t, h, origin, sess, name)
		_, ro := remoteIssueToken(t, h, origin, sess, tid, TokenScopeRead, "1d")
		_, rw := remoteIssueToken(t, h, origin, sess, tid, TokenScopeReadWrite, "1d")
		if code, body := do(t, h, "POST", "/v1/ingest", rw, artBody(name)); code != 200 {
			t.Fatalf("seed %d %s", code, body)
		}
		principals = append(principals, principal{tid, ro, rw, keys.ContentHash([]byte(name))})
	}
	var calls atomic.Int32
	read := MCPTool{Name: "read-fact", Description: "Read tenant fact.", Instruction: "Read the tenant fact.", Annotations: map[string]any{"readOnlyHint": true, "idempotentHint": true}, Handler: func(ctx context.Context, tenant string, ts *tenantState, args map[string]any, local LocalContext) (any, error) {
		calls.Add(1)
		if _, exists := args["_local"]; exists {
			t.Error("_local leaked into arguments")
		}
		if _, failure := local.Get("tenant"); failure == nil || failure.Code != "undeclared_reader" {
			t.Error("undeclared reader visible")
		}
		a, err := ts.t.Artifact(ctx, "r", "docs/plans/01-x/DESIGN.md")
		if err != nil {
			return nil, err
		}
		if a == nil {
			t.Error("tenant fact missing")
			return nil, nil
		}
		return map[string]any{"tenant": tenant, "hash": a.Latest.ContentHash}, nil
	}}
	mcpRegister(t, s, read)
	mcpRegister(t, s, MCPTool{Name: "write-fact", Scope: TokenScopeReadWrite, Instruction: "Write a tenant fact.", Handler: mcpNoop})
	mcpRegister(t, s, MCPTool{Name: "future", DeclarationVersion: 2, Handler: mcpNoop})
	// Identical claims, including a forged tenant, must resolve only through the credential.
	body := mcpCallBody("read-fact", map[string]any{"tenant": principals[0].tenant, "scope": "read_write", "_local": map[string]any{"tenant": principals[0].tenant, "cwd": map[string]any{"path": "/private/path"}}})
	for _, p := range principals {
		for _, token := range []string{p.read, p.write} {
			v := mcpDecode(t, mcpRequest(t, h, token, body, nil))["result"].(map[string]any)
			if v["tenant"] != p.tenant || v["hash"] != p.hash {
				t.Fatalf("tenant leak: %v", v)
			}
			init := mcpDecode(t, mcpRequest(t, h, token, `{"id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`, nil))["result"].(map[string]any)
			want := "You are connected to yakka. Read the tenant fact."
			if token == p.write {
				want += " Write a tenant fact."
			}
			if init["instructions"] != want {
				t.Fatalf("instructions: %v", init)
			}
			list := mcpDecode(t, mcpRequest(t, h, token, `{"id":1,"method":"tools/list"}`, nil))["result"].(map[string]any)["tools"].([]any)
			wantCount := 1
			if token == p.write {
				wantCount = 2
			}
			if len(list) != wantCount {
				t.Fatalf("scope/version list: %v", list)
			}
			tool := list[0].(map[string]any)
			for _, key := range []string{"name", "description", "inputSchema", "annotations", "_meta"} {
				if tool[key] == nil {
					t.Fatalf("missing tool field %s", key)
				}
			}
			decl := tool["_meta"].(map[string]any)["yakka/tool"].(map[string]any)
			for _, key := range []string{"v", "rev", "scope", "timeout_s", "context"} {
				if decl[key] == nil {
					t.Fatalf("missing declaration field %s", key)
				}
			}
			rev := decl["rev"].(string)
			delete(decl, "rev")
			raw, _ := json.Marshal(decl)
			sum := sha256.Sum256(raw)
			if rev != hex.EncodeToString(sum[:])[:16] {
				t.Fatal("noncanonical revision")
			}
			withV2 := mcpDecode(t, mcpRequest(t, h, token, `{"id":1,"method":"tools/list"}`, map[string]string{"Yakka-Context": "2"}))["result"].(map[string]any)["tools"].([]any)
			if len(withV2) != wantCount+1 {
				t.Fatal("v2 not negotiated")
			}
		}
		denied := mcpDecode(t, mcpRequest(t, h, p.read, mcpCallBody("write-fact", map[string]any{}), nil))["error"].(map[string]any)
		if denied["code"] != float64(-32003) || denied["data"].(map[string]any)["code"] != "insufficient_scope" {
			t.Fatalf("scope error: %v", denied)
		}
		if code, b := do(t, h, "POST", "/v1/mcp?tenant=other", p.write, body); code != 401 || !strings.Contains(b, `"error":"unauthorized"`) {
			t.Fatalf("mismatch: %d %s", code, b)
		}
	}
	if calls.Load() != 4 {
		t.Fatalf("handler calls %d", calls.Load())
	}
	for _, key := range []string{"", "invalid"} {
		rec := mcpRequest(t, h, key, body, nil)
		if rec.Code != 401 || !strings.Contains(rec.Body.String(), `"error":`) {
			t.Fatalf("auth: %d %s", rec.Code, rec.Body.String())
		}
	}
	if code, _, _ := doWithCookies(t, h, "POST", "/v1/mcp?tenant="+principals[0].tenant, "", body, sess); code != 401 {
		t.Fatalf("cookie accepted: %d", code)
	}
	if rec := mcpRequest(t, h, principals[0].read, body, map[string]string{"Origin": origin}); rec.Code != 403 {
		t.Fatalf("origin %d", rec.Code)
	}
}

func TestMCPProtocolAndLocalMode(t *testing.T) {
	s := New(Config{Data: t.TempDir()}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
	mcpRegister(t, s, MCPTool{Name: "write", Scope: TokenScopeReadWrite, Handler: func(_ context.Context, tenant string, _ *tenantState, _ map[string]any, _ LocalContext) (any, error) {
		return map[string]any{"tenant": tenant}, nil
	}})
	h := s.Handler()
	for _, version := range []string{"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "future", ""} {
		body := `{"id":"x","method":"initialize","params":{"protocolVersion":"` + version + `"}}`
		v := mcpDecode(t, mcpRequest(t, h, "", body, nil))["result"].(map[string]any)
		want := version
		if want == "future" || want == "" {
			want = "2025-11-25"
		}
		if v["protocolVersion"] != want || v["serverInfo"].(map[string]any)["name"] != "yakka" || v["capabilities"].(map[string]any)["tools"].(map[string]any)["listChanged"] != false {
			t.Fatalf("initialize: %v", v)
		}
	}
	for _, tc := range []struct {
		body string
		code int
	}{
		{`broken`, -32700}, {"{\"id\":\"\xff\"}", -32700}, {`[]`, -32600}, {`null`, -32600}, {`1`, -32600}, {`{"id":5}`, -32600}, {`{}`, -32600}, {`{"id":5,"method":"unrecognized"}`, -32601},
	} {
		v := mcpDecode(t, mcpRequest(t, h, "", tc.body, nil))
		if v["error"].(map[string]any)["code"] != float64(tc.code) {
			t.Fatalf("%q: %v", tc.body, v)
		}
		if tc.code == -32700 && v["id"] != nil {
			t.Fatal("parse error id")
		}
	}
	for _, method := range []string{"ping", "notifications/initialized", "unknown", "tools/call"} {
		rec := mcpRequest(t, h, "", `{"method":"`+method+`"}`, nil)
		if rec.Code != 202 || rec.Body.Len() != 0 {
			t.Fatalf("notification: %d %s", rec.Code, rec.Body.String())
		}
	}
	ping := mcpDecode(t, mcpRequest(t, h, "", `{"id":null,"method":"ping"}`, nil))
	if ping["id"] != nil || len(ping["result"].(map[string]any)) != 0 {
		t.Fatal(ping)
	}
	for _, method := range []string{"GET", "PUT", "DELETE", "OPTIONS"} {
		req := httptest.NewRequest(method, "http://127.0.0.1/v1/mcp", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 405 || rec.Header().Get("Allow") != "POST" {
			t.Fatalf("method %s: %d", method, rec.Code)
		}
	}
	result := mcpDecode(t, mcpRequest(t, h, "", mcpCallBody("write", map[string]any{}), nil))["result"].(map[string]any)
	if result["tenant"] != LocalTenant {
		t.Fatalf("local tenant: %v", result)
	}
	if rec := mcpRequest(t, h, "", `{"id":1,"method":"ping"}`, map[string]string{"Origin": "http://localhost"}); rec.Code != 403 {
		t.Fatalf("local origin: %d", rec.Code)
	}
}

func TestMCPContextGateAndRevisions(t *testing.T) {
	s, _ := newServer(t, true)
	h := s.Handler()
	var calls int
	tool := MCPTool{Name: "context", Context: []MCPReader{{Reader: "cwd", Version: 1}}, Validate: func(args map[string]any) string {
		if args["invalid"] == true {
			return "invalid argument"
		}
		return ""
	}, Handler: func(_ context.Context, _ string, _ *tenantState, args map[string]any, local LocalContext) (any, error) {
		calls++
		value, failure := local.Get("cwd")
		if failure != nil {
			t.Fatal(failure)
		}
		if _, ok := args["_local"]; ok {
			t.Fatal("_local not stripped")
		}
		return value, nil
	}}
	mcpRegister(t, s, tool)
	rev := s.mcpTool("context").declaration["rev"].(string)
	for _, tc := range []struct {
		args any
		want string
	}{
		{[]any{}, "arguments must be an object"}, {nil, "arguments must be an object"}, {"text", "arguments must be an object"},
		{map[string]any{"invalid": true, "_local": map[string]any{"cwd": map[string]any{"_failed": map[string]any{"code": "io_error"}}}}, "invalid argument"},
		{map[string]any{}, "cwd (missing)"}, {map[string]any{"_local": map[string]any{"undeclared": map[string]any{}}}, "cwd (missing)"},
		{map[string]any{"_local": map[string]any{"cwd": nil}}, "cwd (invalid_context)"},
		{map[string]any{"_local": map[string]any{"cwd": map[string]any{"_failed": map[string]any{"code": "io_error"}}}}, "cwd (io_error)"},
		{map[string]any{"invalid": true, "_local": map[string]any{"_rev": "stale"}}, `"code":-32010`},
		{map[string]any{"_local": map[string]any{"_rev": ""}}, `"code":-32010`},
	} {
		rec := mcpRequest(t, h, "ka", mcpCallBody("context", tc.args), nil)
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), tc.want) {
			t.Fatalf("%v: %d %s", tc.args, rec.Code, rec.Body.String())
		}
	}
	if calls != 0 {
		t.Fatal("gate invoked handler")
	}
	for _, includeRev := range []bool{false, true} {
		local := map[string]any{"cwd": map[string]any{"path": "a_failed_path", "exists": false}}
		if includeRev {
			local["_rev"] = rev
		}
		v := mcpDecode(t, mcpRequest(t, h, "ka", mcpCallBody("context", map[string]any{"_local": local}), nil))
		if v["error"] != nil || v["result"].(map[string]any)["path"] != "a_failed_path" {
			t.Fatal(v)
		}
	}
	optional := false
	mcpRegister(t, s, MCPTool{Name: "optional", Context: []MCPReader{{Reader: "cwd", Version: 1, Required: &optional}}, Handler: func(_ context.Context, _ string, _ *tenantState, _ map[string]any, local LocalContext) (any, error) {
		_, failure := local.Get("cwd")
		return map[string]any{"failure": failure.Code}, nil
	}})
	v := mcpDecode(t, mcpRequest(t, h, "ka", mcpCallBody("optional", map[string]any{}), nil))["result"].(map[string]any)
	if v["failure"] != "missing" {
		t.Fatal(v)
	}
	for i, change := range []func(*MCPTool){func(t *MCPTool) { t.TimeoutS = 21 }, func(t *MCPTool) { t.Scope = TokenScopeReadWrite }, func(t *MCPTool) { t.DeclarationVersion = 2 }, func(t *MCPTool) { t.Context = []MCPReader{{Reader: "drain", Version: 1}} }} {
		copy := tool
		copy.Name = string(rune('a' + i))
		change(&copy)
		mcpRegister(t, s, copy)
		if s.mcpTool(copy.Name).declaration["rev"] == rev {
			t.Fatal("unchanged revision")
		}
	}
}

// Add a conformance-only capability through the same table loading seam.
func mcpBulkFixture(t *testing.T) {
	t.Helper()
	original := mcpReaderTable
	var fixture map[string]any
	if err := json.Unmarshal(original, &fixture); err != nil {
		t.Fatal(err)
	}
	fixture["readers"] = append(fixture["readers"].([]any), map[string]any{"name": "bulk_test", "versions": []int{1}, "bulk": true, "params": map[string]any{}})
	mcpReaderTable, _ = json.Marshal(fixture)
	t.Cleanup(func() { mcpReaderTable = original })
}
func TestMCPRegistrationAndBudgets(t *testing.T) {
	mcpBulkFixture(t)
	s, _ := newServer(t, true)
	for _, tc := range []MCPTool{
		{Name: "reader", Context: []MCPReader{{Reader: "no_such", Version: 1}}},
		{Name: "version", Context: []MCPReader{{Reader: "cwd", Version: 2}}},
		{Name: "dependency", Context: []MCPReader{{Reader: "file", Version: 1}, {Reader: "resolved_path", Version: 1}}},
		{Name: "effect", LocalActions: []string{"enqueue"}}, {Name: "timeout", TimeoutS: 301},
		{Name: "budget", Context: []MCPReader{{Reader: "bulk_test", Version: 1, Bulk: true, Params: map[string]any{"budget_bytes": mcpMaxBody}}}},
		{Name: "fraction", Context: []MCPReader{{Reader: "bulk_test", Version: 1, Bulk: true, Params: map[string]any{"budget_bytes": 1.5}}}},
		{Name: "param", Context: []MCPReader{{Reader: "cwd", Version: 1, Params: map[string]any{"command": "cat"}}}},
	} {
		tc.Handler = mcpNoop
		if err := s.RegisterMCPTool(tc); err == nil {
			t.Fatalf("accepted invalid %s", tc.Name)
		}
	}
	var calls int
	handler := func(context.Context, string, *tenantState, map[string]any, LocalContext) (any, error) {
		calls++
		return map[string]any{}, nil
	}
	mcpRegister(t, s, MCPTool{Name: "small", Handler: handler})
	mcpRegister(t, s, MCPTool{Name: "bulk", Context: []MCPReader{{Reader: "bulk_test", Version: 1, Bulk: true, Params: map[string]any{"budget_bytes": 512 << 10}}}, Handler: handler})
	sized := func(name string, n int) string {
		body := mcpCallBody(name, map[string]any{"padding": "", "_local": map[string]any{"bulk_test": map[string]any{"complete": false}}})
		return strings.Replace(body, `"padding":""`, `"padding":"`+strings.Repeat("x", n-len(body))+`"`, 1)
	}
	for _, tc := range []struct {
		name      string
		n, status int
	}{{"small", mcpDefaultBody, 200}, {"small", mcpDefaultBody + 1, 413}, {"bulk", mcpDefaultBody + 1, 200}, {"bulk", (64 + 512) << 10, 200}, {"bulk", ((64 + 512) << 10) + 1, 413}, {"bulk", mcpMaxBody + 1, 413}} {
		rec := mcpRequest(t, s.Handler(), "ka", sized(tc.name, tc.n), nil)
		if rec.Code != tc.status {
			t.Fatalf("%s size %d: %d %s", tc.name, tc.n, rec.Code, rec.Body.String())
		}
	}
	if calls != 3 {
		t.Fatalf("oversize handler calls: %d", calls)
	}
	for _, method := range []string{"ping", "initialize", "tools/list", "unknown"} {
		body := `{"id":1,"method":"` + method + `","padding":"` + strings.Repeat("x", mcpDefaultBody) + `"}`
		if rec := mcpRequest(t, s.Handler(), "ka", body, nil); rec.Code != 413 {
			t.Fatalf("method cap %s: %d", method, rec.Code)
		}
	}
	body := &mcpReadSpy{}
	req := httptest.NewRequest("POST", "/v1/mcp", body)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != 401 || body.read {
		t.Fatalf("unauthenticated body read: %d %v", rec.Code, body.read)
	}
}

func TestMCPChangeReaderTypedDeclaration(t *testing.T) {
	s, _ := newServer(t, true)
	params := map[string]any{
		"exclusion_policy_version": "review-exclusions-v1",
		"change_max_file_bytes":    262144,
		"change_max_total_bytes":   2097152,
		"change_max_files":         200,
		"context_lines":            20,
		"docs_never_noise":         true,
		"change_exclude":           []any{"vendor/**", "**/*.map", "package-lock.json"},
		"excluded_files":           []any{"*.png", "*.min.js"},
		"excluded_directories":     []any{"vendor/", "dist/"},
		"lockfiles":                []any{"package-lock.json", "go.sum"},
		"truncation_order":         []any{"code", "tests", "config", "docs"},
		"budget_bytes":             2097152,
	}
	optional := false
	tool := MCPTool{Name: "change", Context: []MCPReader{{Reader: "change", Version: 1, Required: &optional, Bulk: true, Params: params}}, Handler: mcpNoop}
	if err := s.RegisterMCPTool(tool); err != nil {
		t.Fatalf("legal change declaration rejected: %v", err)
	}
	if got, want := s.mcpTool("change").bodyCap, (64<<10)+2097152; got != want {
		t.Fatalf("body cap = %d, want %d", got, want)
	}

	mutations := []struct {
		name  string
		key   string
		value any
	}{
		{"wrong boolean type", "docs_never_noise", "true"},
		{"wrong numeric type", "context_lines", "20"},
		{"fractional numeric", "change_max_files", 2.5},
		{"wrong array type", "change_exclude", "vendor/**"},
		{"wrong array item", "excluded_files", []any{"*.png", 4}},
		{"unknown field", "command", "git"},
		{"unsafe path", "change_exclude", []any{"https://example.com/**"}},
		{"unsafe traversal", "excluded_directories", []any{"../outside/"}},
		{"invalid range", "context_lines", 101},
		{"invalid enum value", "truncation_order", []any{"code", "docs", "tests", "config"}},
		{"oversized budget", "budget_bytes", 2097153},
	}
	for i, tc := range mutations {
		bad := map[string]any{}
		for key, value := range params {
			bad[key] = value
		}
		bad[tc.key] = tc.value
		candidate := MCPTool{Name: fmt.Sprintf("bad-%d", i), Handler: mcpNoop, Context: []MCPReader{{Reader: "change", Version: 1, Required: &optional, Bulk: true, Params: bad}}}
		if err := s.RegisterMCPTool(candidate); err == nil {
			t.Errorf("accepted %s", tc.name)
		}
	}
	for i, key := range []string{"change_max_file_bytes", "change_exclude", "budget_bytes"} {
		missing := map[string]any{}
		for k, value := range params {
			missing[k] = value
		}
		delete(missing, key)
		candidate := MCPTool{Name: fmt.Sprintf("missing-%d", i), Handler: mcpNoop, Context: []MCPReader{{Reader: "change", Version: 1, Required: &optional, Bulk: true, Params: missing}}}
		if err := s.RegisterMCPTool(candidate); err == nil {
			t.Errorf("accepted declaration missing %s", key)
		}
	}

	// The typed extension leaves the pre-existing string, enum, dependency and
	// bulk declarations on their original validation path.
	mcpRegister(t, s, MCPTool{Name: "existing", Handler: mcpNoop, Context: []MCPReader{
		{Reader: "resolved_path", Version: 1, Params: map[string]any{"path_arg": "path", "bases": []any{"cwd"}}},
		{Reader: "file", Version: 1, Params: map[string]any{"of": "resolved_path"}},
	}})
}

type mcpReadSpy struct{ read bool }

func (s *mcpReadSpy) Read(p []byte) (int, error) { s.read = true; return 0, io.EOF }

func TestMCPTimeoutDisconnectAndLogs(t *testing.T) {
	s, _ := newServer(t, true)
	cancelled := make(chan struct{}, 2)
	started := make(chan struct{}, 2)
	mcpRegister(t, s, MCPTool{Name: "wait", TimeoutS: 1, Handler: func(ctx context.Context, _ string, _ *tenantState, _ map[string]any, _ LocalContext) (any, error) {
		started <- struct{}{}
		<-ctx.Done()
		cancelled <- struct{}{}
		return nil, ctx.Err()
	}})
	rec := mcpRequest(t, s.Handler(), "ka", mcpCallBody("wait", map[string]any{}), nil)
	if !strings.Contains(rec.Body.String(), "timeout after 1 s") {
		t.Fatal(rec.Body.String())
	}
	<-started
	<-cancelled
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "POST", srv.URL+"/v1/mcp", strings.NewReader(mcpCallBody("wait", map[string]any{})))
	req.Header.Set("Authorization", "Bearer ka")
	done := make(chan struct{})
	go func() {
		defer close(done)
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			resp.Body.Close()
		}
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("handler did not start")
	}
	// A blocked call must not delay an unrelated stateless ping.
	if rec := mcpRequest(t, s.Handler(), "ka", `{"id":1,"method":"ping"}`, nil); rec.Code != 200 {
		t.Fatal(rec.Code)
	}
	cancel()
	select {
	case <-cancelled:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("disconnect did not cancel handler")
	}
	<-done
	// Wait until all concurrent logging has finished before capturing the global logger.
	srv.Close()
	var logs bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	defer slog.SetDefault(old)
	mcpRegister(t, s, MCPTool{Name: "logged", Handler: mcpNoop})
	rec = mcpRequest(t, s.Handler(), "ka", mcpCallBody("logged", map[string]any{"argument": "private-argument", "_local": map[string]any{"cwd": map[string]any{"path": "/private/path"}, "token": "private-token"}}), nil)
	if rec.Code != 200 {
		t.Fatal(rec.Code)
	}
	var entry map[string]any
	if err := json.Unmarshal(logs.Bytes(), &entry); err != nil {
		t.Fatal(err)
	}
	if entry["method"] != "tools/call" || entry["tool"] != "logged" || entry["tenant"] != "a" || entry["status"] != float64(200) || entry["duration_ms"] == nil {
		t.Fatal(entry)
	}
	for _, secret := range []string{"private-argument", "/private/path", "private-token", "_local", "arguments", `"ka"`} {
		if strings.Contains(logs.String(), secret) {
			t.Fatalf("log leak %s: %s", secret, logs.String())
		}
	}
}

func TestMCPDeclarationOwnershipAndConfiguredCeilings(t *testing.T) {
	t.Setenv("YAKKA_MCP_MAX_BODY", "524288")
	t.Setenv("YAKKA_MCP_MAX_CALL", "40")
	s, _ := newServer(t, true)
	params := map[string]any{"path_arg": "path", "bases": []string{"cwd"}}
	schema := map[string]any{"type": "object"}
	annotations := map[string]any{"readOnlyHint": true}
	tool := MCPTool{Name: "declared", Context: []MCPReader{{Reader: "resolved_path", Version: 1, Params: params}}, InputSchema: schema, Annotations: annotations, Handler: mcpNoop}
	mcpRegister(t, s, tool)
	rev := s.mcpTool("declared").declaration["rev"]
	tool.Name = "same"
	tool.Context = []MCPReader{{Reader: "resolved_path", Version: 1, Params: map[string]any{"bases": []string{"cwd"}, "path_arg": "path"}}}
	mcpRegister(t, s, tool)
	if s.mcpTool("same").declaration["rev"] != rev {
		t.Fatal("param key order changed revision")
	}
	params["path_arg"] = "other"
	schema["type"] = "array"
	annotations["readOnlyHint"] = false
	registered := s.mcpTool("declared")
	if registered.Context[0].Params["path_arg"] != "path" || registered.InputSchema["type"] != "object" || registered.Annotations["readOnlyHint"] != true {
		t.Fatal("caller mutated declaration")
	}
	tool.Name = "changed"
	tool.Context = []MCPReader{{Reader: "resolved_path", Version: 1, Params: params}}
	mcpRegister(t, s, tool)
	if s.mcpTool("changed").declaration["rev"] == rev {
		t.Fatal("params did not change revision")
	}
	if err := s.RegisterMCPTool(MCPTool{Name: "over-time", TimeoutS: 41, Handler: mcpNoop}); err == nil {
		t.Fatal("configured timeout ceiling ignored")
	}
	mcpBulkFixture(t)
	if err := s.RegisterMCPTool(MCPTool{Name: "over-body", Handler: mcpNoop, Context: []MCPReader{{Reader: "bulk_test", Version: 1, Bulk: true, Params: map[string]any{"budget_bytes": 524288}}}}); err == nil {
		t.Fatal("configured body ceiling ignored")
	}
	// The foundation dependency order follows the declared reader references.
	mcpRegister(t, s, MCPTool{Name: "foundation", Handler: mcpNoop, Context: []MCPReader{
		{Reader: "resolved_path", Version: 1, Params: map[string]any{"path_arg": "path", "bases": []string{"cwd"}}},
		{Reader: "file", Version: 1, Params: map[string]any{"of": "resolved_path"}},
		{Reader: "git", Version: 1, Params: map[string]any{"of": "resolved_path"}},
		{Reader: "queue", Version: 1, Params: map[string]any{"of": "git", "path": "resolved_path"}},
	}})
	rec := mcpRequest(t, s.Handler(), "ka", mcpCallBody("declared", map[string]any{"_local": map[string]any{"_v": 2, "resolved_path": map[string]any{"path": "untrusted"}}}), nil)
	if !strings.Contains(rec.Body.String(), "unsupported_declaration") {
		t.Fatal(rec.Body.String())
	}
	// Registry construction never registers a product tool implicitly.
	empty, _ := newServer(t, true)
	if len(empty.mcpTools.tools) != 0 {
		t.Fatal("product tool registered")
	}
}
