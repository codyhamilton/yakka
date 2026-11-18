package serve

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
)

func mcpActionReaders() []MCPReader {
	optional := false
	return []MCPReader{
		{Reader: "cwd", Version: 1, Required: &optional},
		{Reader: "resolved_path", Version: 1, Params: map[string]any{"path_arg": "path", "bases": []any{"cwd"}}},
		{Reader: "file", Version: 1, Params: map[string]any{"of": "resolved_path"}},
		{Reader: "git", Version: 1, Params: map[string]any{"of": "resolved_path"}},
		{Reader: "queue", Version: 2, Params: map[string]any{"of": "git", "path": "resolved_path"}},
		{Reader: "drain", Version: 1},
	}
}

func mcpActionTool(handler func(context.Context, string, *tenantState, map[string]any, LocalContext) (any, error)) MCPTool {
	return MCPTool{
		Name:               "action_fixture",
		DeclarationVersion: 2,
		Context:            mcpActionReaders(),
		LocalActions:       []MCPLocalAction{{Action: mcpEnqueueAction, Version: 1, PathFrom: mcpEnqueuePathFrom}},
		Handler:            handler,
	}
}

func mcpActionLocal(rev, call string) map[string]any {
	return map[string]any{
		"_v": 2, "_rev": rev, "_call": call,
		"cwd":           map[string]any{"path": "/repo"},
		"resolved_path": map[string]any{"path": "/repo/docs/plans/01-x/DESIGN.md", "base": "cwd"},
		"file":          map[string]any{"exists": true, "is_file": true, "size": 10, "mtime": 1, "content_hash": "abc", "withheld": nil, "read_error": nil},
		"git":           map[string]any{"repo_id": "r", "rel_path": "docs/plans/01-x/DESIGN.md", "error": nil},
		"queue": map[string]any{"pending": []any{}, "rejected": []any{}, "coverage": map[string]any{
			"complete": true, "pending_covering": 0, "rejected_covering": 0, "oldest_covering_age_s": nil,
		}},
		"drain": map[string]any{"running": false},
	}
}

func mcpActionHeaders() map[string]string {
	return map[string]string{"Yakka-Context": "2", "Yakka-Local-Actions": "enqueue_file_snapshot/1"}
}

func mcpActionEffect(actionID string) map[string]any {
	return map[string]any{"action": mcpEnqueueAction, "v": 1, "action_id": actionID, "ok": true, "outcome": "enqueued", "error": nil}
}

// The registry accepts only design 8's one action shape and its required readers.
func TestMCPLocalActionRegistration(t *testing.T) {
	s, _ := newServer(t, true)
	valid := mcpActionTool(mcpNoop)
	mcpRegister(t, s, valid)
	tool := s.mcpTool("action_fixture")
	decl := tool.declaration
	if decl["v"] != float64(2) || len(decl["local_actions"].([]any)) != 1 {
		t.Fatalf("declaration: %#v", decl)
	}
	action := decl["local_actions"].([]any)[0].(map[string]any)
	if action["action"] != mcpEnqueueAction || action["v"] != float64(1) || action["path_from"] != mcpEnqueuePathFrom {
		t.Fatalf("action: %#v", action)
	}
	rev := decl["rev"]
	without := mcpActionTool(mcpNoop)
	without.Name = "no_action"
	without.LocalActions = nil
	mcpRegister(t, s, without)
	if s.mcpTool("no_action").declaration["rev"] == rev {
		t.Fatal("local_actions did not change rev")
	}

	bad := func(name string, mutate func(*MCPTool)) {
		tc := mcpActionTool(mcpNoop)
		tc.Name = "bad"
		mutate(&tc)
		if err := s.RegisterMCPTool(tc); err == nil {
			t.Fatalf("%s: accepted invalid action declaration %+v", name, tc.LocalActions)
		}
	}
	bad("action", func(t *MCPTool) { t.LocalActions[0].Action = "other" })
	bad("version", func(t *MCPTool) { t.LocalActions[0].Version = 2 })
	bad("binding", func(t *MCPTool) { t.LocalActions[0].PathFrom = "path" })
	bad("duplicate", func(t *MCPTool) { t.LocalActions = append(t.LocalActions, t.LocalActions[0]) })
	bad("v1", func(t *MCPTool) { t.DeclarationVersion = 1 })
	bad("queue v1", func(t *MCPTool) {
		for i, r := range t.Context {
			if r.Reader == "queue" {
				t.Context[i].Version = 1
			}
		}
	})
	bad("optional drain", func(t *MCPTool) {
		for i, r := range t.Context {
			if r.Reader == "drain" {
				optional := false
				t.Context[i].Required = &optional
			}
		}
	})
	bad("missing drain", func(t *MCPTool) {
		t.Context = t.Context[:len(t.Context)-1]
	})
	bad("missing queue", func(t *MCPTool) {
		t.Context = t.Context[:4]
	})
}

func TestMCPLocalActionAdvertisement(t *testing.T) {
	s, _ := newServer(t, true)
	mcpRegister(t, s, MCPTool{Name: "plain", Handler: mcpNoop})
	init := mcpDecode(t, mcpRequest(t, s.Handler(), "ka", `{"id":1,"method":"initialize","params":{}}`, nil))["result"].(map[string]any)
	got := init["_meta"].(map[string]any)["yakka/local-actions"]
	b, _ := json.Marshal(got)
	if string(b) != `{"actions":[{"action":"enqueue_file_snapshot","v":1}],"v":1}` {
		t.Fatalf("advertisement: %s", b)
	}
	mcpRegister(t, s, mcpActionTool(mcpNoop))
	list1 := mcpDecode(t, mcpRequest(t, s.Handler(), "ka", `{"id":2,"method":"tools/list"}`, nil))["result"].(map[string]any)["tools"].([]any)
	list2 := mcpDecode(t, mcpRequest(t, s.Handler(), "ka", `{"id":2,"method":"tools/list"}`, map[string]string{"Yakka-Context": "2"}))["result"].(map[string]any)["tools"].([]any)
	if len(list1) != 1 || len(list2) != 2 {
		t.Fatalf("declaration negotiation: %d %d", len(list1), len(list2))
	}
}

func TestMCPLocalActionDirectiveAndContinuation(t *testing.T) {
	s, _ := newServer(t, true)
	var directives, continuations atomic.Int32
	handler := func(_ context.Context, _ string, _ *tenantState, _ map[string]any, local LocalContext) (any, error) {
		if effects, ok := local.Effects(); ok {
			continuations.Add(1)
			return map[string]any{"result": "final", "call": local.Call(), "effects": effects}, nil
		}
		if _, ok := local.Action(); ok {
			directives.Add(1)
			return MCPLocalActionRequest{Action: mcpEnqueueAction, Version: 1}, nil
		}
		return map[string]any{"result": "v1"}, nil
	}
	mcpRegister(t, s, mcpActionTool(handler))
	rev := s.mcpTool("action_fixture").declaration["rev"].(string)
	h := s.Handler()
	body := func(local map[string]any) string {
		return mcpCallBody("action_fixture", map[string]any{"path": "spoofed/other.md", "_local": local})
	}

	reply := mcpDecode(t, mcpRequest(t, h, "ka", body(mcpActionLocal(rev, "call-1")), mcpActionHeaders()))
	errData := reply["error"].(map[string]any)
	if errData["code"] != float64(-32011) {
		t.Fatalf("directive: %v", reply)
	}
	data := errData["data"].(map[string]any)
	if data["code"] != "local_action_required" || data["v"] != float64(1) || data["call"] != "call-1" ||
		data["rev"] != rev || data["action"] != mcpEnqueueAction || data["action_v"] != float64(1) ||
		data["path"] != "/repo/docs/plans/01-x/DESIGN.md" || data["action_id"] == "" {
		t.Fatalf("directive data: %#v", data)
	}
	if directives.Load() != 1 || continuations.Load() != 0 {
		t.Fatalf("directive calls: %d %d", directives.Load(), continuations.Load())
	}

	local := mcpActionLocal(rev, "call-1")
	local["effects"] = []any{mcpActionEffect(data["action_id"].(string))}
	final := mcpDecode(t, mcpRequest(t, h, "ka", body(local), mcpActionHeaders()))["result"].(map[string]any)
	if final["result"] != "final" || final["call"] != "call-1" {
		t.Fatalf("continuation: %v", final)
	}
	if effects := final["effects"].([]any); len(effects) != 1 || effects[0].(map[string]any)["outcome"] != "enqueued" {
		t.Fatalf("effects: %#v", effects)
	}
	if directives.Load() != 1 || continuations.Load() != 1 {
		t.Fatalf("continuation calls: %d %d", directives.Load(), continuations.Load())
	}

}

func TestMCPLocalActionGates(t *testing.T) {
	s, _ := newServer(t, true)
	handler := func(_ context.Context, _ string, _ *tenantState, _ map[string]any, local LocalContext) (any, error) {
		if _, ok := local.Action(); ok {
			return MCPLocalActionRequest{Action: mcpEnqueueAction, Version: 1}, nil
		}
		return map[string]any{"result": "v1"}, nil
	}
	tool := mcpActionTool(handler)
	tool.Validate = func(args map[string]any) string {
		if args["invalid"] == true {
			return "invalid argument"
		}
		return ""
	}
	mcpRegister(t, s, tool)
	rev := s.mcpTool("action_fixture").declaration["rev"].(string)
	h := s.Handler()
	call := func(local map[string]any, headers map[string]string, extra map[string]any) map[string]any {
		args := map[string]any{"_local": local}
		for k, v := range extra {
			args[k] = v
		}
		return mcpDecode(t, mcpRequest(t, h, "ka", mcpCallBody("action_fixture", args), headers))
	}

	// Authentication and scope are unchanged, and no directive precedes the gates.
	if rec := mcpRequest(t, h, "", mcpCallBody("action_fixture", map[string]any{}), mcpActionHeaders()); rec.Code != 401 {
		t.Fatalf("unauthenticated action: %d", rec.Code)
	}
	if got := call(mcpActionLocal(rev, "c"), mcpActionHeaders(), map[string]any{"invalid": true})["result"].(map[string]any); got["isError"] != true {
		t.Fatalf("validation gate: %v", got)
	}
	missing := mcpActionLocal(rev, "c")
	delete(missing, "drain")
	if got := call(missing, mcpActionHeaders(), nil)["result"].(map[string]any); got["isError"] != true || !strings.Contains(got["content"].([]any)[0].(map[string]any)["text"].(string), "drain") {
		t.Fatalf("required-reader gate: %v", got)
	}
	stale := mcpActionLocal("stale", "c")
	if got := call(stale, mcpActionHeaders(), nil)["error"].(map[string]any); got["code"] != float64(-32010) {
		t.Fatalf("revision gate: %v", got)
	}

	// Old shims, absent headers and mismatched carrier versions get the v1 branch.
	for name, tc := range map[string]struct {
		local   map[string]any
		headers map[string]string
	}{
		"absent action header":  {mcpActionLocal(rev, "c"), map[string]string{"Yakka-Context": "2"}},
		"absent context header": {mcpActionLocal(rev, "c"), map[string]string{"Yakka-Local-Actions": "enqueue_file_snapshot/1"}},
		"wrong action version":  {mcpActionLocal(rev, "c"), map[string]string{"Yakka-Context": "2", "Yakka-Local-Actions": "enqueue_file_snapshot/2"}},
		"absent call token":     {func() map[string]any { l := mcpActionLocal(rev, "c"); delete(l, "_call"); return l }(), mcpActionHeaders()},
	} {
		got := call(tc.local, tc.headers, nil)
		if got["error"] != nil || got["result"].(map[string]any)["result"] != "v1" {
			t.Fatalf("%s: %v", name, got)
		}
	}

	// A carrier version the declaration cannot interpret is a failed read, not a directive.
	mismatched := mcpActionLocal(rev, "c")
	mismatched["_v"] = 1
	if got := call(mismatched, mcpActionHeaders(), nil); got["error"] != nil || got["result"].(map[string]any)["isError"] != true {
		t.Fatalf("carrier mismatch: %v", got)
	}

	// A malformed or unsupported action version is never executed.
	for i, effects := range []any{
		[]any{},
		[]any{map[string]any{"action": "other", "v": 1, "action_id": "a", "ok": true, "outcome": "enqueued", "error": nil}},
		[]any{map[string]any{"action": mcpEnqueueAction, "v": 2, "action_id": "a", "ok": true, "outcome": "enqueued", "error": nil}},
		[]any{map[string]any{"action": mcpEnqueueAction, "v": 1, "action_id": "", "ok": true, "outcome": "enqueued", "error": nil}},
		[]any{map[string]any{"action": mcpEnqueueAction, "v": 1, "action_id": "a", "ok": true, "outcome": "failed", "error": nil}},
		[]any{map[string]any{"action": mcpEnqueueAction, "v": 1, "action_id": "a", "ok": true, "outcome": "enqueued", "error": "queue_rejected"}},
	} {
		local := mcpActionLocal(rev, "c")
		local["effects"] = effects
		got := call(local, mcpActionHeaders(), nil)
		if got["error"] != nil || got["result"].(map[string]any)["isError"] != true {
			t.Fatalf("malformed effects %d accepted: %v", i, got)
		}
	}
}

func TestMCPLocalActionNeverEmitsASecondDirective(t *testing.T) {
	s, _ := newServer(t, true)
	handler := func(_ context.Context, _ string, _ *tenantState, _ map[string]any, _ LocalContext) (any, error) {
		return MCPLocalActionRequest{Action: mcpEnqueueAction, Version: 1}, nil
	}
	mcpRegister(t, s, mcpActionTool(handler))
	rev := s.mcpTool("action_fixture").declaration["rev"].(string)
	local := mcpActionLocal(rev, "call-1")
	local["effects"] = []any{mcpActionEffect("a")}
	reply := mcpDecode(t, mcpRequest(t, s.Handler(), "ka", mcpCallBody("action_fixture", map[string]any{"_local": local}), mcpActionHeaders()))
	if reply["error"] != nil {
		t.Fatalf("second directive: %v", reply)
	}
	if reply["result"].(map[string]any)["isError"] != true {
		t.Fatalf("second directive accepted: %v", reply)
	}
}

func TestMCPLocalActionEffectOutcomesAreFacts(t *testing.T) {
	s, _ := newServer(t, true)
	var seen []MCPEffect
	handler := func(_ context.Context, _ string, _ *tenantState, _ map[string]any, local LocalContext) (any, error) {
		if effects, ok := local.Effects(); ok {
			seen = effects
			return map[string]any{"outcome": effects[0].Outcome}, nil
		}
		return MCPLocalActionRequest{Action: mcpEnqueueAction, Version: 1}, nil
	}
	mcpRegister(t, s, mcpActionTool(handler))
	rev := s.mcpTool("action_fixture").declaration["rev"].(string)
	for _, effect := range []map[string]any{
		{"action": mcpEnqueueAction, "v": 1, "action_id": "a", "ok": true, "outcome": "covered", "error": nil},
		{"action": mcpEnqueueAction, "v": 1, "action_id": "a", "ok": false, "outcome": "failed", "error": "queue_rejected"},
		{"action": mcpEnqueueAction, "v": 1, "action_id": "a", "ok": false, "outcome": "unknown", "error": "effect_unknown"},
	} {
		local := mcpActionLocal(rev, "c")
		local["effects"] = []any{effect}
		got := mcpDecode(t, mcpRequest(t, s.Handler(), "ka", mcpCallBody("action_fixture", map[string]any{"_local": local}), mcpActionHeaders()))
		if got["result"].(map[string]any)["outcome"] != effect["outcome"] {
			t.Fatalf("effect %v: %v", effect, got)
		}
		if len(seen) != 1 || seen[0].ActionID != "a" {
			t.Fatalf("handler effects: %+v", seen)
		}
	}
}
