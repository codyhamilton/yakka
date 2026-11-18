package serve

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
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

	"github.com/codyhamilton/yakka/packages/yakka/internal/review"
)

const (
	mcpDefaultBody    = 256 << 10
	mcpMaxBody        = 8 << 20
	mcpDefaultTimeout = 20
	reviewMCPTimeoutS = int((review.AttemptTimeout + review.AttemptTimeoutHeadroom) / time.Second)
	mcpMaxTimeout     = reviewMCPTimeoutS
)

// The only local action the v2 declaration may name. It is a fixed shape, not
// a general local-effect mechanism.
const (
	mcpEnqueueAction        = "enqueue_file_snapshot"
	mcpEnqueueActionVersion = 1
	mcpEnqueuePathFrom      = "resolved_path"
)

// The shipped capability table is embedded so registration is independent of cwd.
//
//go:embed testdata/mcp-readers.json
var mcpReaderTable []byte

type mcpReaderSpec struct {
	Name           string                  `json:"name"`
	Versions       []int                   `json:"versions"`
	Depends        []string                `json:"depends_on"`
	Params         map[string][]string     `json:"params"`
	TypedParams    map[string]mcpParamSpec `json:"typed_params,omitempty"`
	Bulk           bool                    `json:"bulk"`
	RequiredParams []string                `json:"required_params"`
}

// mcpParamSpec describes only the fixed scalar and string-array policy values
// supported by the closed reader table. It is not a general schema language.
type mcpParamSpec struct {
	Type   string   `json:"type"`
	Min    int64    `json:"min,omitempty"`
	Max    int64    `json:"max,omitempty"`
	Values []string `json:"values,omitempty"`
	Exact  []string `json:"exact,omitempty"`
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
	LocalActions       []MCPLocalAction
	DeclarationVersion int
	declaration        map[string]any
	bodyCap            int
}

// MCPLocalAction is the declaration of one bounded local effect. The only
// shape registration accepts is enqueue_file_snapshot v1 from resolved_path.
type MCPLocalAction struct {
	Action   string `json:"action"`
	Version  int    `json:"v"`
	PathFrom string `json:"path_from"`
}

// MCPLocalActionRequest is returned by a handler to ask the registry to send
// the one bound -32011 directive for this call. The registry derives the path,
// revision, call token and action id; a handler cannot choose them.
type MCPLocalActionRequest struct {
	Action  string
	Version int
}

// MCPEffect is one shim-supplied result fact from the single continuation.
type MCPEffect struct {
	Action   string  `json:"action"`
	Version  int     `json:"v"`
	ActionID string  `json:"action_id"`
	OK       bool    `json:"ok"`
	Outcome  string  `json:"outcome"`
	Error    *string `json:"error"`
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
	values      map[string]json.RawMessage
	declared    map[string]bool
	action      *MCPLocalAction
	actionBound bool
	call        string
	version     int
	effects     []MCPEffect
	hasEffects  bool
	invalidCall bool
}

// Action reports the one declaration-bound action this call may request, or
// false when the shim did not negotiate it or this is already a continuation.
func (l LocalContext) Action() (MCPLocalAction, bool) {
	if !l.actionBound || l.action == nil {
		return MCPLocalAction{}, false
	}
	return *l.action, true
}

// Effects returns the result facts supplied on the single continuation.
func (l LocalContext) Effects() ([]MCPEffect, bool) { return l.effects, l.hasEffects }

// Call returns the shim-generated call token bound to this request, if any.
func (l LocalContext) Call() string { return l.call }

// DeclarationVersion returns the carrier declaration version the shim sent.
func (l LocalContext) DeclarationVersion() int { return l.version }

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
	if t.TimeoutS < 1 || t.TimeoutS > s.mcpTools.maxCall {
		return fmt.Errorf("invalid MCP declaration")
	}
	if t.DeclarationVersion == 0 {
		t.DeclarationVersion = 1
	}
	if t.DeclarationVersion < 1 {
		return fmt.Errorf("invalid MCP declaration version")
	}
	if len(t.LocalActions) != 0 {
		// local_actions is a v2 extension with exactly one allowed shape.
		if t.DeclarationVersion != 2 || len(t.LocalActions) != 1 {
			return fmt.Errorf("invalid MCP local action declaration")
		}
		if !validMCPLocalAction(t.LocalActions[0]) {
			return fmt.Errorf("invalid MCP local action declaration")
		}
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
				if typed, ok := spec.TypedParams[key]; ok {
					if err := validateMCPReaderParam(value, typed); err != nil {
						return fmt.Errorf("invalid MCP reader param %q: %w", key, err)
					}
				}
				budget += n
				continue
			}
			allowed, ok := spec.Params[key]
			if typed, typedOK := spec.TypedParams[key]; typedOK {
				if err := validateMCPReaderParam(value, typed); err != nil {
					return fmt.Errorf("invalid MCP reader param %q: %w", key, err)
				}
				continue
			}
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
	if len(t.LocalActions) != 0 {
		// The action only targets the call's already-resolved file. Each of
		// these readers must be present, required and at the declared version.
		required := map[string]int{"resolved_path": 1, "file": 1, "git": 1, "queue": 2, "drain": 1}
		for _, r := range t.Context {
			if version, ok := required[r.Reader]; ok {
				if r.Version != version || !r.required() {
					return fmt.Errorf("MCP local action requires reader %q v%d", r.Reader, version)
				}
				delete(required, r.Reader)
			}
		}
		if len(required) != 0 {
			return fmt.Errorf("MCP local action is missing a required reader")
		}
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
	if len(t.LocalActions) != 0 {
		decl["local_actions"] = t.LocalActions
	}
	raw, err := json.Marshal(decl)
	if err != nil {
		return fmt.Errorf("invalid MCP declaration: %w", err)
	}
	_ = json.Unmarshal(raw, &decl)
	raw, _ = json.Marshal(decl)
	sum := sha256.Sum256(raw)
	decl["rev"] = hex.EncodeToString(sum[:])[:16]
	t.declaration = decl
	// Own immutable copies of caller-provided local action declarations.
	raw, _ = json.Marshal(t.LocalActions)
	t.LocalActions = nil
	_ = json.Unmarshal(raw, &t.LocalActions)
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

func validMCPLocalAction(a MCPLocalAction) bool {
	return a.Action == mcpEnqueueAction && a.Version == mcpEnqueueActionVersion && a.PathFrom == mcpEnqueuePathFrom
}

func validateMCPReaderParam(value any, spec mcpParamSpec) error {
	switch spec.Type {
	case "integer":
		var n int64
		switch v := value.(type) {
		case int:
			n = int64(v)
		case int64:
			n = v
		case float64:
			if v != float64(int64(v)) {
				return fmt.Errorf("must be an integer")
			}
			n = int64(v)
		default:
			return fmt.Errorf("must be an integer")
		}
		if n < spec.Min || n > spec.Max {
			return fmt.Errorf("integer outside allowed range")
		}
		return nil
	case "boolean":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("must be a boolean")
		}
		return nil
	case "string":
		v, ok := value.(string)
		if !ok || !mcpAllowedString(v, spec.Values) {
			return fmt.Errorf("must be an allowed string")
		}
		return nil
	case "string_array":
		var values []any
		switch v := value.(type) {
		case []any:
			values = v
		case []string:
			for _, item := range v {
				values = append(values, item)
			}
		default:
			return fmt.Errorf("must be an array of strings")
		}
		if len(values) == 0 {
			return fmt.Errorf("must not be empty")
		}
		if len(spec.Exact) > 0 {
			if len(values) != len(spec.Exact) {
				return fmt.Errorf("must match the fixed policy order")
			}
			for i, item := range values {
				v, ok := item.(string)
				if !ok || v != spec.Exact[i] {
					return fmt.Errorf("must match the fixed policy order")
				}
			}
		}
		for _, item := range values {
			v, ok := item.(string)
			if !ok || !mcpAllowedString(v, spec.Values) {
				return fmt.Errorf("contains an unsafe or disallowed string")
			}
		}
		return nil
	default:
		return fmt.Errorf("unsupported typed policy")
	}
}

func mcpAllowedString(value string, values []string) bool {
	if value == "" || strings.TrimSpace(value) != value {
		return false
	}
	for _, allowed := range values {
		if value == allowed {
			return true
		}
	}
	// Exclusion patterns are deliberately path-like: no absolute paths,
	// traversal, URLs, backslashes, whitespace or control characters.
	if len(values) == 0 {
		if strings.HasPrefix(value, "/") || strings.Contains(value, "..") || strings.Contains(value, "://") || strings.Contains(value, `\\`) {
			return false
		}
		for _, c := range value {
			if !(c == '/' || c == '*' || c == '.' || c == '-' || c == '_' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9') {
				return false
			}
		}
		return true
	}
	return false
}

type mcpAuthResult struct {
	tenant, scope string
	anonymous     bool
}

func (s *Server) mcpAuth(w http.ResponseWriter, r *http.Request) (mcpAuthResult, bool) {
	if _, present := r.Header["Origin"]; present {
		writeJSON(w, 403, map[string]string{"error": "forbidden"})
		return mcpAuthResult{}, false
	}
	if s.cfg.Local() {
		res := s.authorizeBearer(r)
		return mcpAuthResult{tenant: res.tenant, scope: res.scope}, true
	}
	if r.Header.Get("Authorization") != "" {
		res := s.authorizeBearer(r)
		if res.status != authOK {
			writeJSON(w, 401, map[string]string{"error": res.msg})
			return mcpAuthResult{}, false
		}
		return mcpAuthResult{tenant: res.tenant, scope: res.scope}, true
	}
	if err := s.mcpDiscovery.admit(deviceClientIP(r)); err != nil {
		if errors.Is(err, errMCPDiscoveryRateLimited) {
			writeJSON(w, 429, map[string]string{"error": "rate_limited"})
		}
		return mcpAuthResult{}, false
	}
	return mcpAuthResult{scope: TokenScopeRead, anonymous: true}, true
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
	auth, ok := s.mcpAuth(w, r)
	if !ok {
		return
	}
	tenant, scope := auth.tenant, auth.scope
	bodyCap := s.mcpTools.maxBody
	if auth.anonymous {
		bodyCap = mcpDefaultBody
	}
	if mt := r.Header.Get("Content-Type"); mt != "" {
		media, _, err := mime.ParseMediaType(mt)
		if err != nil || media != "application/json" {
			writeJSON(w, 415, map[string]string{"error": "content type must be application/json"})
			return
		}
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, int64(bodyCap)))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeJSON(w, 413, map[string]string{"error": "request body too large"})
			return
		}
		// A disconnect or short read is not a size rejection.
		writeJSON(w, 400, map[string]string{"error": "request body unreadable"})
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
	if auth.anonymous && requestedMethod == "tools/call" {
		msg := "unauthorized: this service requires a key; run yakka login"
		if s.cfg.Remote() {
			msg = s.remoteUnauthorizedMsg()
		}
		writeJSON(w, 401, map[string]string{"error": msg})
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
		result = s.mcpCall(r.Context(), tenant, scope, name, params, r.Header)
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

// scopeAllows reports whether credential scope have satisfies tool scope need.
// Only the two issued scopes match. An empty or unknown scope matches nothing;
// loopback local mode sets read_write on the bearer result explicitly.
func scopeAllows(have, need string) bool {
	switch have {
	case TokenScopeReadWrite:
		return need == TokenScopeRead || need == TokenScopeReadWrite
	case TokenScopeRead:
		return need == TokenScopeRead
	default:
		return false
	}
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
	result := map[string]any{"protocolVersion": v, "capabilities": map[string]any{"tools": map[string]any{"listChanged": false}}, "serverInfo": map[string]any{"name": "yakka", "version": s.opts.Version}, "instructions": strings.Join(ins, " ")}
	if actions := s.mcpLocalActionCapability(scope); actions != nil {
		result["_meta"] = map[string]any{"yakka/local-actions": actions}
	}
	return result
}

// mcpLocalActionCapability is the server's additive action-capability
// advertisement. The server supports exactly this one bounded action.
func (s *Server) mcpLocalActionCapability(_ string) any {
	return map[string]any{"v": 1, "actions": []any{map[string]any{"action": mcpEnqueueAction, "v": mcpEnqueueActionVersion}}}
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
func (s *Server) mcpCall(parent context.Context, tenant, scope, name string, p map[string]json.RawMessage, headers http.Header) any {
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
	revBound := false
	if raw, present := local.values["_rev"]; present {
		var rev string
		if json.Unmarshal(raw, &rev) != nil || rev != t.declaration["rev"] {
			return map[string]any{"error": map[string]any{"code": -32010, "message": "stale declaration", "data": map[string]string{"code": "stale_declaration"}}}
		}
		revBound = true
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
		if json.Unmarshal(raw, &version) != nil || (version != 1 && version != 2) || version != t.DeclarationVersion {
			for _, reader := range t.Context {
				local.values[reader.Reader] = json.RawMessage(`{"_failed":{"code":"unsupported_declaration"}}`)
			}
		} else {
			local.version = version
		}
	}
	for _, reader := range t.Context {
		if reader.required() {
			if _, failure := local.Get(reader.Reader); failure != nil {
				return mcpToolError(failure.Error())
			}
		}
	}
	if raw, present := local.values["_call"]; present {
		var call string
		if json.Unmarshal(raw, &call) != nil || call == "" || len(call) > 128 {
			local.invalidCall = true
		} else {
			local.call = call
		}
	}
	if raw, present := local.values["effects"]; present {
		effects, err := parseMCPEffects(raw)
		if err != nil || len(t.LocalActions) != 1 || !revBound || local.version != 2 || local.call == "" || local.invalidCall {
			return mcpToolError("bad directive")
		}
		if !mcpEffectMatches(effects[0], t.LocalActions[0]) {
			return mcpToolError("bad directive")
		}
		local.effects, local.hasEffects = effects, true
	}
	if len(t.LocalActions) == 1 && !local.hasEffects && !local.invalidCall && revBound &&
		local.version == 2 && local.call != "" && mcpActionAdvertised(headers, t.LocalActions[0]) {
		action := t.LocalActions[0]
		local.action, local.actionBound = &action, true
	}
	ctx, cancel := context.WithTimeout(parent, time.Duration(t.TimeoutS)*time.Second)
	defer cancel()
	release, uerr := s.beginTenantUse(tenant)
	if uerr != nil {
		if errors.Is(uerr, ErrTenantLifecycleBusy) {
			return mcpToolError("tenant_busy")
		}
		return mcpToolError("tenant unavailable")
	}
	defer release()
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
	var directive MCPLocalActionRequest
	switch r := result.(type) {
	case MCPLocalActionRequest:
		directive = r
	case *MCPLocalActionRequest:
		if r == nil {
			return result
		}
		directive = *r
	default:
		return result
	}
	// A handler cannot turn a continuation or an unnegotiated call into a
	// directive, and a second directive never starts another round.
	if local.hasEffects {
		return mcpToolError("local action already supplied")
	}
	if !local.actionBound || local.action == nil || directive.Action != local.action.Action || directive.Version != local.action.Version {
		return mcpToolError("local action unavailable")
	}
	resolved, failure := local.Get(local.action.PathFrom)
	if failure != nil {
		return mcpToolError(failure.Error())
	}
	path, ok := resolved["path"].(string)
	if !ok || path == "" {
		return mcpToolError("local action has no resolved path")
	}
	actionID, err := newMCPActionID()
	if err != nil {
		return mcpToolError("internal")
	}
	return map[string]any{"error": map[string]any{"code": -32011, "message": "local action required", "data": map[string]any{
		"code": "local_action_required", "v": 1, "call": local.call, "rev": t.declaration["rev"],
		"action_id": actionID, "action": local.action.Action, "action_v": local.action.Version, "path": path,
	}}}
}

func newMCPActionID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func mcpActionAdvertised(headers http.Header, action MCPLocalAction) bool {
	contextVersion, err := strconv.Atoi(headers.Get("Yakka-Context"))
	if err != nil || contextVersion < 2 {
		return false
	}
	want := action.Action + "/" + strconv.Itoa(action.Version)
	for _, part := range strings.Split(headers.Get("Yakka-Local-Actions"), ",") {
		if strings.TrimSpace(part) == want {
			return true
		}
	}
	return false
}

// parseMCPEffects accepts exactly the single continuation carrying one effect.
func parseMCPEffects(raw json.RawMessage) ([]MCPEffect, error) {
	var effects []MCPEffect
	if json.Unmarshal(raw, &effects) != nil || len(effects) != 1 {
		return nil, fmt.Errorf("malformed effects")
	}
	return effects, nil
}

func mcpEffectMatches(effect MCPEffect, action MCPLocalAction) bool {
	if effect.Action != action.Action || effect.Version != action.Version || effect.ActionID == "" || len(effect.ActionID) > 128 {
		return false
	}
	switch effect.Outcome {
	case "enqueued", "covered":
		return effect.OK && effect.Error == nil
	case "failed", "unknown":
		if effect.OK || effect.Error == nil {
			return false
		}
		switch *effect.Error {
		case "capture_off", "spool_dropped", "yakka_bin_set", "unsupported", "path_changed", "queue_unavailable", "queue_rejected", "stale_declaration", "effect_unknown":
			return true
		}
	}
	return false
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
