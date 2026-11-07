package serve

import (
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	mcpDefaultBody    = 256 << 10
	mcpMaxBody        = 8 << 20
	mcpDefaultTimeout = 20
	mcpMaxTimeout     = 300
)

// The shipped capability table is embedded so registration is independent of cwd.
//
//go:embed testdata/mcp-readers.json
var mcpReaderTable []byte

type mcpReaderSpec struct {
	Name           string              `json:"name"`
	Versions       []int               `json:"versions"`
	Depends        []string            `json:"depends_on"`
	Params         map[string][]string `json:"params"`
	Bulk           bool                `json:"bulk"`
	RequiredParams []string            `json:"required_params"`
}

// MCPTool is registered during server construction, before serving requests.
// The handler must honor ctx cancellation. All local values are untrusted claims;
// tenantState is the only source of tenant identity and storage access.
type MCPTool struct {
	Name               string
	Description        string
	InputSchema        map[string]any
	Annotations        map[string]any
	Scope              string
	TimeoutS           int
	Instruction        string
	Context            []MCPReader
	Validate           func(map[string]any) string
	Handler            func(context.Context, string, *tenantState, map[string]any, LocalContext) (any, error)
	LocalActions       []string
	DeclarationVersion int
	declaration        map[string]any
	bodyCap            int
}

type MCPReader struct {
	Reader   string         `json:"reader"`
	Version  int            `json:"v"`
	Required *bool          `json:"required,omitempty"` // nil defaults to true
	Params   map[string]any `json:"params,omitempty"`
	Bulk     bool           `json:"bulk,omitempty"`
}

func (r MCPReader) required() bool { return r.Required == nil || *r.Required }

type mcpRegistry struct {
	tools            []MCPTool
	maxBody, maxCall int
}

func newMCPRegistry() mcpRegistry {
	limit := func(name string, fallback, minimum int) int {
		value := os.Getenv(name)
		if value == "" {
			return fallback
		}
		n, err := strconv.Atoi(value)
		if err != nil || n < minimum || n > fallback {
			panic("serve: invalid " + name)
		}
		return n
	}
	return mcpRegistry{maxBody: limit("YAKKA_MCP_MAX_BODY", mcpMaxBody, mcpDefaultBody), maxCall: limit("YAKKA_MCP_MAX_CALL", mcpMaxTimeout, mcpDefaultTimeout)}
}

// LocalFailure is a reader failure, never an empty successful fact.
type LocalFailure struct{ Reader, Code string }

func (f *LocalFailure) Error() string {
	return "local context unavailable: " + f.Reader + " (" + f.Code + ")"
}

type LocalContext struct {
	values   map[string]json.RawMessage
	declared map[string]bool
}

func (l LocalContext) Get(name string) (map[string]any, *LocalFailure) {
	fail := func(code string) (map[string]any, *LocalFailure) { return nil, &LocalFailure{name, code} }
	if !l.declared[name] {
		return fail("undeclared_reader")
	}
	raw, ok := l.values[name]
	if !ok {
		return fail("missing")
	}
	var value map[string]any
	if json.Unmarshal(raw, &value) != nil || value == nil {
		return fail("invalid_context")
	}
	if v, exists := value["_failed"]; exists {
		f, _ := v.(map[string]any)
		code, _ := f["code"].(string)
		switch code {
		case "unsupported_reader", "unsupported_reader_version", "unsupported_declaration", "bad_params", "bad_input", "dependency_failed", "timeout", "io_error", "over_budget", "secret_in_context", "internal":
		default:
			code = "invalid_context"
		}
		return fail(code)
	}
	return value, nil
}

func (s *Server) RegisterMCPTool(t MCPTool) error {
	if t.Name == "" || t.Handler == nil {
		return fmt.Errorf("invalid MCP tool")
	}
	for _, old := range s.mcpTools.tools {
		if old.Name == t.Name {
			return fmt.Errorf("duplicate MCP tool %q", t.Name)
		}
	}
	if t.Scope == "" {
		t.Scope = TokenScopeRead
	}
	if t.Scope != TokenScopeRead && t.Scope != TokenScopeReadWrite {
		return fmt.Errorf("invalid MCP scope")
	}
	if t.TimeoutS == 0 {
		t.TimeoutS = mcpDefaultTimeout
	}
	if t.TimeoutS < 1 || t.TimeoutS > s.mcpTools.maxCall || len(t.LocalActions) != 0 {
		return fmt.Errorf("invalid MCP declaration")
	}
	if t.DeclarationVersion == 0 {
		t.DeclarationVersion = 1
	}
	if t.DeclarationVersion < 1 {
		return fmt.Errorf("invalid MCP declaration version")
	}
	var fixture struct {
		Readers []mcpReaderSpec `json:"readers"`
	}
	if err := json.Unmarshal(mcpReaderTable, &fixture); err != nil {
		return fmt.Errorf("invalid MCP reader table: %w", err)
	}
	specs := map[string]mcpReaderSpec{}
	for _, spec := range fixture.Readers {
		specs[spec.Name] = spec
	}
	seen, budget := map[string]bool{}, 0
	for _, r := range t.Context {
		spec, exists := specs[r.Reader]
		if !exists || seen[r.Reader] {
			return fmt.Errorf("unknown or duplicate MCP reader %q", r.Reader)
		}
		supported := false
		for _, v := range spec.Versions {
			supported = supported || v == r.Version
		}
		if !supported {
			return fmt.Errorf("unsupported MCP reader version")
		}
		for _, dep := range spec.Depends {
			if !seen[dep] {
				return fmt.Errorf("MCP reader %q precedes dependency %q", r.Reader, dep)
			}
		}
		if r.Bulk != spec.Bulk {
			return fmt.Errorf("invalid MCP reader bulk capability")
		}
		for _, key := range spec.RequiredParams {
			if _, ok := r.Params[key]; !ok {
				return fmt.Errorf("missing MCP reader param %q", key)
			}
		}
		for key, value := range r.Params {
			if key == "budget_bytes" && r.Bulk {
				b, err := json.Marshal(value)
				var n int
				if err != nil || json.Unmarshal(b, &n) != nil || n < 1 || n > mcpMaxBody {
					return fmt.Errorf("invalid MCP bulk budget")
				}
				budget += n
				continue
			}
			allowed, ok := spec.Params[key]
			if !ok {
				return fmt.Errorf("unknown MCP reader param %q", key)
			}
			values := []any{value}
			if key == "bases" {
				b, _ := json.Marshal(value)
				if json.Unmarshal(b, &values) != nil || len(values) == 0 {
					return fmt.Errorf("invalid MCP reader bases")
				}
			}
			for _, v := range values {
				str, ok := v.(string)
				if !ok || str == "" {
					return fmt.Errorf("invalid MCP reader param")
				}
				valid := false
				for _, a := range allowed {
					valid = valid || str == a
				}
				if key == "path_arg" {
					valid = true
					for _, c := range str {
						if !(c == '_' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9') {
							valid = false
						}
					}
				}
				if !valid {
					return fmt.Errorf("invalid MCP reader param")
				}
				// Reader references must precede their consumer; bases are read independently.
				if (key == "of" || key == "path") && !seen[str] {
					return fmt.Errorf("MCP reader %q precedes dependency %q", r.Reader, str)
				}
			}
		}
		if r.Bulk && r.Params["budget_bytes"] == nil {
			return fmt.Errorf("missing MCP bulk budget")
		}
		seen[r.Reader] = true
	}
	t.bodyCap = max(mcpDefaultBody, (64<<10)+budget)
	if t.bodyCap > s.mcpTools.maxBody {
		return fmt.Errorf("MCP bulk budget exceeds body ceiling")
	}
	if t.Context == nil {
		t.Context = []MCPReader{}
	}
	// Marshal through maps to sort every object key (including reader fields).
	decl := map[string]any{"v": t.DeclarationVersion, "scope": t.Scope, "timeout_s": t.TimeoutS, "context": t.Context}
	raw, err := json.Marshal(decl)
	if err != nil {
		return fmt.Errorf("invalid MCP declaration: %w", err)
	}
	_ = json.Unmarshal(raw, &decl)
	raw, _ = json.Marshal(decl)
	sum := sha256.Sum256(raw)
	decl["rev"] = hex.EncodeToString(sum[:])[:16]
	t.declaration = decl
	// Own immutable copies of caller-provided metadata and reader declarations.
	raw, _ = json.Marshal(t.Context)
	t.Context = nil
	_ = json.Unmarshal(raw, &t.Context)
	if t.InputSchema == nil {
		t.InputSchema = map[string]any{"type": "object"}
	}
	raw, err = json.Marshal(t.InputSchema)
	if err != nil {
		return err
	}
	t.InputSchema = nil
	_ = json.Unmarshal(raw, &t.InputSchema)
	raw, err = json.Marshal(t.Annotations)
	if err != nil {
		return err
	}
	t.Annotations = nil
	_ = json.Unmarshal(raw, &t.Annotations)
	if t.Annotations == nil {
		t.Annotations = map[string]any{}
	}
	if t.Scope == TokenScopeReadWrite {
		t.Annotations["readOnlyHint"] = false
	}
	s.mcpTools.tools = append(s.mcpTools.tools, t)
	return nil
}

func (s *Server) mcpAuth(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	if _, present := r.Header["Origin"]; present {
		writeJSON(w, 403, map[string]string{"error": "forbidden"})
		return "", "", false
	}
	res := s.authorizeBearer(r)
	if res.status != authOK {
		writeJSON(w, 401, map[string]string{"error": res.msg})
		return "", "", false
	}
	return res.tenant, res.scope, true
}

type mcpResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *mcpResponseWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (s *Server) mcp(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	logged := &mcpResponseWriter{ResponseWriter: w, status: 200}
	w = logged
	method, toolName, tenant := "", "", ""
	defer func() {
		slog.Info("mcp", "method", method, "tool", toolName, "tenant", tenant, "status", logged.status, "duration_ms", time.Since(started).Milliseconds())
	}()
	var scope string
	var ok bool
	tenant, scope, ok = s.mcpAuth(w, r)
	if !ok {
		return
	}
	if mt := r.Header.Get("Content-Type"); mt != "" {
		media, _, err := mime.ParseMediaType(mt)
		if err != nil || media != "application/json" {
			writeJSON(w, 415, map[string]string{"error": "content type must be application/json"})
			return
		}
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, int64(s.mcpTools.maxBody)))
	if err != nil {
		writeJSON(w, 413, map[string]string{"error": "request body too large"})
		return
	}
	var msg map[string]json.RawMessage
	if !utf8.Valid(body) || !json.Valid(body) {
		s.mcpReply(w, nil, map[string]any{"code": -32700, "message": "Parse error"})
		return
	}
	if json.Unmarshal(body, &msg) != nil || msg == nil {
		s.mcpReply(w, nil, map[string]any{"code": -32600, "message": "Invalid Request"})
		return
	}
	id, hasID := msg["id"]
	var requestedMethod string
	if json.Unmarshal(msg["method"], &requestedMethod) != nil || requestedMethod == "" {
		s.mcpReply(w, id, map[string]any{"code": -32600, "message": "Invalid Request"})
		return
	}
	// Never log caller-controlled unknown names, which may contain credentials or paths.
	switch requestedMethod {
	case "initialize", "ping", "tools/list", "tools/call":
		method = requestedMethod
	default:
		method = "unknown"
	}
	var params map[string]json.RawMessage
	_ = json.Unmarshal(msg["params"], &params)
	var name string
	_ = json.Unmarshal(params["name"], &name)
	limit := mcpDefaultBody
	if requestedMethod == "tools/call" {
		if t := s.mcpTool(name); t != nil {
			limit = t.bodyCap
			toolName = t.Name
		}
	}
	if len(body) > limit {
		writeJSON(w, 413, map[string]string{"error": "request body too large"})
		return
	}
	if !hasID {
		w.WriteHeader(202)
		return
	}
	var result any
	switch requestedMethod {
	case "ping":
		result = map[string]any{}
	case "initialize":
		result = s.mcpInitialize(params, scope)
	case "tools/list":
		result = s.mcpList(scope, r)
	case "tools/call":
		result = s.mcpCall(r.Context(), tenant, scope, name, params)
	default:
		s.mcpReply(w, id, map[string]any{"code": -32601, "message": "Method not found"})
		return
	}
	s.mcpResult(w, id, result)
}
func (s *Server) mcpTool(name string) *MCPTool {
	for i := range s.mcpTools.tools {
		if s.mcpTools.tools[i].Name == name {
			return &s.mcpTools.tools[i]
		}
	}
	return nil
}
func scopeAllows(have, need string) bool {
	return have == TokenScopeReadWrite || need == TokenScopeRead || have == ""
}
func (s *Server) mcpInitialize(p map[string]json.RawMessage, scope string) any {
	var v string
	_ = json.Unmarshal(p["protocolVersion"], &v)
	switch v {
	case "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05":
	default:
		v = "2025-11-25"
	}
	ins := []string{"You are connected to yakka."}
	for _, t := range s.mcpTools.tools {
		if scopeAllows(scope, t.Scope) && t.Instruction != "" {
			ins = append(ins, t.Instruction)
		}
	}
	return map[string]any{"protocolVersion": v, "capabilities": map[string]any{"tools": map[string]any{"listChanged": false}}, "serverInfo": map[string]any{"name": "yakka", "version": s.opts.Version}, "instructions": strings.Join(ins, " ")}
}
func (s *Server) mcpList(scope string, r *http.Request) any {
	version := 1
	if v, err := strconv.Atoi(r.Header.Get("Yakka-Context")); err == nil && v > 0 {
		version = v
	}
	tools := []any{}
	for _, t := range s.mcpTools.tools {
		if !scopeAllows(scope, t.Scope) || t.DeclarationVersion > version {
			continue
		}
		tools = append(tools, map[string]any{"name": t.Name, "description": t.Description, "inputSchema": t.InputSchema, "annotations": t.Annotations, "_meta": map[string]any{"yakka/tool": t.declaration}})
	}
	return map[string]any{"tools": tools}
}
func (s *Server) mcpCall(parent context.Context, tenant, scope, name string, p map[string]json.RawMessage) any {
	t := s.mcpTool(name)
	if t == nil {
		return map[string]any{"error": map[string]any{"code": -32602, "message": "unknown tool"}}
	}
	if !scopeAllows(scope, t.Scope) {
		return map[string]any{"error": map[string]any{"code": -32003, "message": "insufficient_scope", "data": map[string]string{"code": "insufficient_scope", "need": t.Scope}}}
	}
	args := map[string]any{}
	if raw, present := p["arguments"]; present {
		if json.Unmarshal(raw, &args) != nil || args == nil {
			return mcpToolError("arguments must be an object")
		}
	}
	local := LocalContext{values: map[string]json.RawMessage{}, declared: map[string]bool{}}
	if raw, ok := args["_local"]; ok {
		b, _ := json.Marshal(raw)
		_ = json.Unmarshal(b, &local.values)
	}
	delete(args, "_local")
	if raw, present := local.values["_rev"]; present {
		var rev string
		if json.Unmarshal(raw, &rev) != nil || rev != t.declaration["rev"] {
			return map[string]any{"error": map[string]any{"code": -32010, "message": "stale declaration", "data": map[string]string{"code": "stale_declaration"}}}
		}
	}
	if t.Validate != nil {
		if e := t.Validate(args); e != "" {
			return mcpToolError(e)
		}
	}
	for _, reader := range t.Context {
		local.declared[reader.Reader] = true
	}
	// A carrier format the server cannot interpret cannot become successful facts.
	if raw, present := local.values["_v"]; present {
		var version int
		if json.Unmarshal(raw, &version) != nil || version != 1 {
			for _, reader := range t.Context {
				local.values[reader.Reader] = json.RawMessage(`{"_failed":{"code":"unsupported_declaration"}}`)
			}
		}
	}
	for _, reader := range t.Context {
		if reader.required() {
			if _, failure := local.Get(reader.Reader); failure != nil {
				return mcpToolError(failure.Error())
			}
		}
	}
	ctx, cancel := context.WithTimeout(parent, time.Duration(t.TimeoutS)*time.Second)
	defer cancel()
	ts, err := s.tenant(tenant)
	if err != nil {
		return mcpToolError("tenant unavailable")
	}
	result, err := t.Handler(ctx, tenant, ts, args, local)
	if ctx.Err() == context.DeadlineExceeded {
		return mcpToolError(fmt.Sprintf("timeout after %d s", t.TimeoutS))
	}
	if ctx.Err() != nil {
		return mcpToolError("call cancelled")
	}
	if err != nil {
		return mcpToolError(err.Error())
	}
	return result
}
func mcpToolError(msg string) any {
	return map[string]any{"content": []any{map[string]any{"type": "text", "text": msg}}, "isError": true}
}
func (s *Server) mcpResult(w http.ResponseWriter, id json.RawMessage, result any) {
	if m, ok := result.(map[string]any); ok {
		if e, ok := m["error"]; ok {
			s.mcpReply(w, id, e)
			return
		}
	}
	mcpWrite(w, map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
}
func (s *Server) mcpReply(w http.ResponseWriter, id json.RawMessage, e any) {
	if len(id) == 0 {
		id = json.RawMessage("null")
	}
	mcpWrite(w, map[string]any{"jsonrpc": "2.0", "id": id, "error": e})
}
func mcpWrite(w http.ResponseWriter, reply any) {
	// Keep Unicode literal: declaration hashes and wire output use UTF-8 JSON.
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if enc.Encode(reply) != nil {
		writeJSON(w, 500, map[string]string{"error": "invalid tool result"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	_, _ = w.Write(bytes.TrimSuffix(b.Bytes(), []byte{'\n'}))
}
