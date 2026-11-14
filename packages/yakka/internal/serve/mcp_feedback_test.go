package serve

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

type feedbackGolden struct {
	Tools []map[string]any `json:"tools"`
	Calls []struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
		Local     map[string]any `json:"local"`
		Text      string         `json:"text"`
		IsError   bool           `json:"isError"`
	} `json:"calls"`
}

func feedbackServer(t *testing.T) *Server {
	t.Helper()
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", "ka"}, {"b", "kb"}}}, Options{DisableWorker: true})
	if err := s.RegisterStatelessMCPTools(); err != nil {
		t.Fatal(err)
	}
	if err := s.RegisterFeedbackMCPTool(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestMCPArtifactFeedbackCorpus(t *testing.T) {
	var golden feedbackGolden
	raw, err := os.ReadFile("testdata/mcp-golden/artifact-feedback.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	s := feedbackServer(t)
	h := s.Handler()
	list := mcpDecode(t, mcpRequest(t, h, "ka", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`, nil))["result"].(map[string]any)["tools"].([]any)
	var gotTool map[string]any
	for _, item := range list {
		tool := item.(map[string]any)
		if tool["name"] == "artifact_feedback" {
			gotTool = tool
		}
	}
	if gotTool == nil {
		t.Fatal("artifact_feedback is not registered")
	}
	for _, want := range golden.Tools {
		for _, field := range []string{"name", "description", "inputSchema", "annotations"} {
			if !reflect.DeepEqual(gotTool[field], want[field]) {
				t.Errorf("artifact_feedback %s differs\ngot: %#v\nwant: %#v", field, gotTool[field], want[field])
			}
		}
	}
	meta := gotTool["_meta"].(map[string]any)["yakka/tool"].(map[string]any)
	if meta["scope"] != TokenScopeRead {
		t.Fatalf("feedback scope: %#v", meta["scope"])
	}
	readers := meta["context"].([]any)
	wantReaders := []string{"cwd", "project_dir", "resolved_path", "file", "git", "queue", "drain"}
	if len(readers) != len(wantReaders) {
		t.Fatalf("feedback readers: %#v", readers)
	}
	for i, name := range wantReaders {
		if readers[i].(map[string]any)["reader"] != name {
			t.Fatalf("reader %d: %#v", i, readers[i])
		}
	}
	params := readers[2].(map[string]any)["params"].(map[string]any)
	if params["path_arg"] != "path" || !reflect.DeepEqual(params["bases"], []any{"project_dir"}) || readers[0].(map[string]any)["required"] != false || readers[1].(map[string]any)["required"] != false {
		t.Fatalf("feedback reader declaration: %#v", readers)
	}
	init := mcpDecode(t, mcpRequest(t, h, "ka", `{"jsonrpc":"2.0","id":2,"method":"initialize","params":{}}`, nil))["result"].(map[string]any)
	if init["instructions"] != "You are connected to yakka. "+statelessMCPInstruction+" "+feedbackMCPInstruction {
		t.Fatalf("feedback duplicated or changed the base instruction: %v", init["instructions"])
	}
	for _, tc := range golden.Calls {
		args := map[string]any{}
		for key, value := range tc.Arguments {
			args[key] = value
		}
		if tc.Local != nil {
			decl := gotTool["_meta"].(map[string]any)["yakka/tool"].(map[string]any)
			local := map[string]any{"_v": 1, "_rev": decl["rev"]}
			for key, value := range tc.Local {
				local[key] = value
			}
			args["_local"] = local
		}
		result := mcpDecode(t, mcpRequest(t, h, "ka", mcpCallBody(tc.Name, args), nil))["result"].(map[string]any)
		text := result["content"].([]any)[0].(map[string]any)["text"]
		if text != tc.Text || result["isError"] != tc.IsError {
			t.Errorf("feedback(%#v) = (%q,%v), want (%q,%v)", tc.Arguments, text, result["isError"], tc.Text, tc.IsError)
		}
	}
	badArgs := mcpDecode(t, mcpRequest(t, h, "ka", `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"artifact_feedback","arguments":[]}}`, nil))["result"].(map[string]any)
	if badArgs["isError"] != true || badArgs["content"].([]any)[0].(map[string]any)["text"] != "arguments must be an object" {
		t.Fatalf("non-object arguments: %#v", badArgs)
	}
}

func TestMCPArtifactFeedbackReaderFailuresAndTenantBoundary(t *testing.T) {
	s := feedbackServer(t)
	h := s.Handler()
	list := mcpDecode(t, mcpRequest(t, h, "ka", `{"id":1,"method":"tools/list"}`, nil))["result"].(map[string]any)["tools"].([]any)
	tool := list[2].(map[string]any)
	if tool["name"] != "artifact_feedback" {
		t.Fatalf("tool order: %#v", list)
	}
	decl := tool["_meta"].(map[string]any)["yakka/tool"].(map[string]any)
	base := map[string]any{
		"_v": 1, "_rev": decl["rev"],
		"resolved_path": map[string]any{"path": "/work/docs/plans/x/DESIGN.md"},
		"file":          map[string]any{"exists": true, "is_file": true, "mtime": 1700000000, "content_hash": keys.ContentHash([]byte("content"))},
		"git":           map[string]any{"repo_id": "r", "rel_path": "docs/plans/x/DESIGN.md"},
		"queue":         map[string]any{"pending": []any{}, "rejected": []any{}},
		"drain":         map[string]any{"running": false},
	}
	args := func(local map[string]any) string {
		return mcpCallBody("artifact_feedback", map[string]any{"path": "docs/plans/x/DESIGN.md", "_local": local})
	}
	missing := map[string]any{}
	for k, v := range base {
		missing[k] = v
	}
	delete(missing, "queue")
	result := mcpDecode(t, mcpRequest(t, h, "ka", args(missing), nil))["result"].(map[string]any)
	if result["isError"] != true || !strings.Contains(result["content"].([]any)[0].(map[string]any)["text"].(string), "queue (missing)") {
		t.Fatalf("missing reader became a state: %#v", result)
	}
	for _, check := range []struct {
		reader, code string
		remove       bool
	}{{reader: "queue", code: "io_error"}, {reader: "git", code: "io_error"}, {reader: "file", remove: true}} {
		bad := map[string]any{}
		for k, v := range base {
			bad[k] = v
		}
		if check.remove {
			delete(bad, check.reader)
		} else {
			bad[check.reader] = map[string]any{"_failed": map[string]any{"code": check.code}}
		}
		result = mcpDecode(t, mcpRequest(t, h, "ka", args(bad), nil))["result"].(map[string]any)
		want := check.reader + " (" + check.code + ")"
		if check.remove {
			want = check.reader + " (missing)"
		}
		if result["isError"] != true || !strings.Contains(result["content"].([]any)[0].(map[string]any)["text"].(string), want) {
			t.Fatalf("reader %s failure became a state: %#v", check.reader, result)
		}
	}

	content := "tenant a artifact"
	if code, body := do(t, h, "POST", "/v1/ingest", "ka", artBodyAt("docs/plans/x/DESIGN.md", content)); code != 200 {
		t.Fatalf("ingest seed: %d %s", code, body)
	}
	base["file"] = map[string]any{"exists": true, "is_file": true, "mtime": 1700000000, "content_hash": keys.ContentHash([]byte(content))}
	for _, principal := range []struct{ key, want string }{{"ka", "delivered"}, {"kb", "not delivered"}} {
		before, err := s.tenant(map[string]string{"ka": "a", "kb": "b"}[principal.key])
		if err != nil {
			t.Fatal(err)
		}
		beforeArtifact, err := before.t.Artifact(context.Background(), "r", "docs/plans/x/DESIGN.md")
		if err != nil {
			t.Fatal(err)
		}
		got := mcpDecode(t, mcpRequest(t, h, principal.key, args(base), nil))["result"].(map[string]any)
		text := got["content"].([]any)[0].(map[string]any)["text"].(string)
		if !strings.HasPrefix(text, "state: "+principal.want) {
			t.Fatalf("%s received wrong tenant state: %s", principal.key, text)
		}
		afterArtifact, err := before.t.Artifact(context.Background(), "r", "docs/plans/x/DESIGN.md")
		if err != nil || !reflect.DeepEqual(beforeArtifact, afterArtifact) {
			t.Fatalf("feedback wrote to tenant store: before=%#v after=%#v err=%v", beforeArtifact, afterArtifact, err)
		}
	}
}

func TestMCPArtifactFeedbackRelativePathNeedsProjectDir(t *testing.T) {
	s := feedbackServer(t)
	h := s.Handler()
	list := mcpDecode(t, mcpRequest(t, h, "ka", `{"id":1,"method":"tools/list"}`, nil))["result"].(map[string]any)["tools"].([]any)
	decl := list[2].(map[string]any)["_meta"].(map[string]any)["yakka/tool"].(map[string]any)
	run := func(extra map[string]any) string {
		local := map[string]any{
			"_v": 1, "_rev": decl["rev"],
			"resolved_path": map[string]any{"path": nil, "base": nil},
			"file":          map[string]any{"skipped": "no_input"},
			"git":           map[string]any{"skipped": "no_input"},
			"queue":         map[string]any{"pending": []any{}, "rejected": []any{}},
			"drain":         map[string]any{"running": false},
		}
		for k, v := range extra {
			local[k] = v
		}
		body := mcpCallBody("artifact_feedback", map[string]any{"path": "docs/plans/x/DESIGN.md", "_local": local})
		result := mcpDecode(t, mcpRequest(t, h, "ka", body, nil))["result"].(map[string]any)
		if result["isError"] != true {
			t.Fatalf("relative path without a project directory became a state: %#v", result)
		}
		return result["content"].([]any)[0].(map[string]any)["text"].(string)
	}
	cwd := map[string]any{"path": "/work"}
	for _, tc := range []struct {
		name  string
		extra map[string]any
		want  []string
		not   []string
	}{
		{"no project dir, cwd named", map[string]any{"cwd": cwd, "project_dir": map[string]any{"path": nil}}, []string{"no project directory was supplied", "the shim ran in /work, which is not the project"}, nil},
		{"no project dir, cwd not injected", map[string]any{"project_dir": map[string]any{"path": nil}}, []string{"no project directory was supplied"}, []string{"shim ran in"}},
		{"project dir absent, cwd named", map[string]any{"cwd": cwd}, []string{"no project directory was supplied", "shim ran in /work"}, nil},
		{"project dir unreadable, cwd named", map[string]any{"cwd": cwd, "project_dir": map[string]any{"_failed": map[string]any{"code": "io_error"}}}, []string{"could not be read (io_error)", "shim ran in /work"}, []string{"no project directory was supplied"}},
	} {
		text := run(tc.extra)
		if !strings.HasPrefix(text, "path is relative and cannot be resolved: docs/plans/x/DESIGN.md;") || !strings.HasSuffix(text, "pass the absolute path of the file") {
			t.Fatalf("%s: wrong frame: %q", tc.name, text)
		}
		for _, want := range tc.want {
			if !strings.Contains(text, want) {
				t.Fatalf("%s: missing %q in %q", tc.name, want, text)
			}
		}
		for _, not := range tc.not {
			if strings.Contains(text, not) {
				t.Fatalf("%s: unexpected %q in %q", tc.name, not, text)
			}
		}
	}
}

func TestMCPArtifactFeedbackDeliveredFormattingAndLogPrivacy(t *testing.T) {
	s := feedbackServer(t)
	h := s.Handler()
	const path = "docs/plans/x/DESIGN.md"
	seed := func(path, content string, scores ...store.Score) {
		t.Helper()
		if code, body := do(t, h, "POST", "/v1/ingest", "ka", artBodyAt(path, content)); code != 200 {
			t.Fatalf("ingest %s: %d %s", path, code, body)
		}
		ts, err := s.tenant("a")
		if err != nil {
			t.Fatal(err)
		}
		hash := keys.ContentHash([]byte(content))
		if err := ts.t.Promote(context.Background(), hash, store.Screen{Verdict: "pass", Scorer: "jev-1"}); err != nil {
			t.Fatal(err)
		}
		if len(scores) > 0 {
			if err := ts.t.AppendScores(context.Background(), hash, scores); err != nil {
				t.Fatal(err)
			}
		}
	}
	seed(path, "current", store.Score{Check: "clarity", Result: .25}, store.Score{Check: "few", Result: .1}, store.Score{Check: "new", Result: .2})
	for i, score := range []float64{.5, .7, .9, 1} {
		seed(fmt.Sprintf("docs/plans/base-%d/DESIGN.md", i), fmt.Sprintf("baseline-%d", i), store.Score{Check: "clarity", Result: score})
	}
	seed("docs/plans/few-a/DESIGN.md", "few-a", store.Score{Check: "few", Result: .2})
	seed("docs/plans/few-b/DESIGN.md", "few-b", store.Score{Check: "few", Result: .3})
	list := mcpDecode(t, mcpRequest(t, h, "ka", `{"id":1,"method":"tools/list"}`, nil))["result"].(map[string]any)["tools"].([]any)
	decl := list[2].(map[string]any)["_meta"].(map[string]any)["yakka/tool"].(map[string]any)
	local := map[string]any{
		"_v": 1, "_rev": decl["rev"],
		"resolved_path": map[string]any{"path": "/work/" + path},
		"file":          map[string]any{"exists": true, "is_file": true, "mtime": 1700000000, "content_hash": keys.ContentHash([]byte("current"))},
		"git":           map[string]any{"repo_id": "r", "rel_path": path},
		"queue":         map[string]any{"pending": []any{}, "rejected": []any{}}, "drain": map[string]any{"running": false},
	}
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	result := mcpDecode(t, mcpRequest(t, h, "ka", mcpCallBody("artifact_feedback", map[string]any{"path": path, "_local": local}), nil))["result"].(map[string]any)
	got := result["content"].([]any)[0].(map[string]any)["text"].(string)
	for _, line := range []string{
		"state: delivered", "screen: pass by jev-1", "clarity 0.25 (baseline p25 0.50, median 0.70, n 5) BELOW p25",
		"few 0.10 (baseline n=3, too few to flag)", "new 0.20 (baseline n=1, too few to flag)", "versions: 1",
	} {
		if !strings.Contains(got, line) {
			t.Errorf("feedback missing %q:\n%s", line, got)
		}
	}
	for _, private := range []string{"/work/" + path, keys.ContentHash([]byte("current"))} {
		if strings.Contains(logs.String(), private) {
			t.Errorf("local path or hash leaked to server logs: %s", logs.String())
		}
	}

	// The stale text uses the actual store timestamp and short hash, while the
	// injected current file hash remains a client fact.
	seed(path, "previous")
	ts, _ := s.tenant("a")
	previousArtifact, err := ts.t.Artifact(context.Background(), "r", path)
	if err != nil {
		t.Fatal(err)
	}
	local["file"] = map[string]any{"exists": true, "is_file": true, "mtime": 1700000000, "content_hash": keys.ContentHash([]byte("current"))}
	result = mcpDecode(t, mcpRequest(t, h, "ka", mcpCallBody("artifact_feedback", map[string]any{"path": path, "_local": local}), nil))["result"].(map[string]any)
	got = result["content"].([]any)[0].(map[string]any)["text"].(string)
	short := previousArtifact.Latest.ContentHash[:12]
	want := fmt.Sprintf("state: stale\npath: %s\nrepo: r\ncontent_hash: %s\n\ncurrent content not yet delivered (service has %s from %s); normally a write still in the batch window", path, keys.ContentHash([]byte("current")), short, previousArtifact.Latest.ReceivedAt.UTC().Format("2006-01-02T15:04:05Z"))
	if got != want {
		t.Fatalf("stale feedback:\ngot:  %q\nwant: %q", got, want)
	}
	callState := func(content string) string {
		t.Helper()
		local["file"] = map[string]any{"exists": true, "is_file": true, "mtime": 1700000000, "content_hash": keys.ContentHash([]byte(content))}
		result := mcpDecode(t, mcpRequest(t, h, "ka", mcpCallBody("artifact_feedback", map[string]any{"path": path, "_local": local}), nil))["result"].(map[string]any)
		return result["content"].([]any)[0].(map[string]any)["text"].(string)
	}
	seed(path, "unscreened")
	if err := ts.t.Promote(context.Background(), keys.ContentHash([]byte("unscreened")), store.Screen{Verdict: "unscreened", Scorer: "none"}); err != nil {
		t.Fatal(err)
	}
	if got := callState("unscreened"); !strings.Contains(got, "screen: unscreened (no scorer on the service)") {
		t.Fatalf("unscreened feedback: %s", got)
	}
	for _, test := range []struct{ content, verdict, want string }{{"other-verdict", "warn", "screen: warn"}} {
		seed(path, test.content)
		if err := ts.t.Promote(context.Background(), keys.ContentHash([]byte(test.content)), store.Screen{Verdict: test.verdict, Scorer: "other"}); err != nil {
			t.Fatal(err)
		}
		if got := callState(test.content); !strings.Contains(got, test.want) {
			t.Fatalf("screen verdict feedback: %s", got)
		}
	}
	for _, test := range []struct{ content, rejection, want string }{{"awaiting", "", "screen: awaiting screen"}, {"flagged", "too vague", "screen: flagged: too vague"}} {
		if code, body := do(t, h, "POST", "/v1/ingest", "ka", artBodyAt(path, test.content)); code != 200 {
			t.Fatalf("ingest %s: %d %s", test.content, code, body)
		}
		if test.rejection != "" {
			if err := ts.t.AppendRejection(context.Background(), store.Rejection{Stage: "screen", FactType: "artifact_version", Path: path, ContentHash: keys.ContentHash([]byte(test.content)), Reason: test.rejection}); err != nil {
				t.Fatal(err)
			}
		}
		if got := callState(test.content); !strings.Contains(got, test.want) {
			t.Fatalf("screen/rejection feedback: %s", got)
		}
	}
}

func TestMCPArtifactFeedbackRunningDrainWaitsWithoutStartingOne(t *testing.T) {
	s := feedbackServer(t)
	h := s.Handler()
	toolList := mcpDecode(t, mcpRequest(t, h, "ka", `{"id":1,"method":"tools/list"}`, nil))["result"].(map[string]any)["tools"].([]any)
	decl := toolList[2].(map[string]any)["_meta"].(map[string]any)["yakka/tool"].(map[string]any)
	local := map[string]any{
		"_v": 1, "_rev": decl["rev"],
		"resolved_path": map[string]any{"path": "/work/docs/plans/x/DESIGN.md"},
		"file":          map[string]any{"exists": true, "is_file": true, "mtime": 1700000000, "content_hash": keys.ContentHash([]byte("queued"))},
		"git":           map[string]any{"repo_id": "r", "rel_path": "docs/plans/x/DESIGN.md"},
		"queue":         map[string]any{"pending": []any{map[string]any{"age_s": float64(2), "mtime": float64(1700000000)}}, "rejected": []any{}},
		"drain":         map[string]any{"running": true},
	}
	started := time.Now()
	result := mcpDecode(t, mcpRequest(t, h, "ka", mcpCallBody("artifact_feedback", map[string]any{"path": "docs/plans/x/DESIGN.md", "_local": local}), nil))["result"].(map[string]any)
	if elapsed := time.Since(started); elapsed < 1400*time.Millisecond {
		t.Fatalf("running drain did not get its bounded wait: %s", elapsed)
	}
	text := result["content"].([]any)[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "state: queued") || !strings.Contains(text, "oldest 4s, draining") {
		t.Fatalf("running drain result: %s", text)
	}
}

func TestMCPArtifactFeedbackRunningDrainSeesDelivery(t *testing.T) {
	s := feedbackServer(t)
	h := s.Handler()
	toolList := mcpDecode(t, mcpRequest(t, h, "ka", `{"id":1,"method":"tools/list"}`, nil))["result"].(map[string]any)["tools"].([]any)
	decl := toolList[2].(map[string]any)["_meta"].(map[string]any)["yakka/tool"].(map[string]any)
	content := []byte("queued content")
	hash := keys.ContentHash(content)
	local := map[string]any{
		"_v": 1, "_rev": decl["rev"],
		"resolved_path": map[string]any{"path": "/work/docs/plans/x/DESIGN.md"},
		"file":          map[string]any{"exists": true, "is_file": true, "mtime": 1700000000, "content_hash": hash},
		"git":           map[string]any{"repo_id": "r", "rel_path": "docs/plans/x/DESIGN.md"},
		"queue":         map[string]any{"pending": []any{map[string]any{"age_s": float64(2), "mtime": float64(1700000000)}}, "rejected": []any{}},
		"drain":         map[string]any{"running": true},
	}
	ts, err := s.tenant("a")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		time.Sleep(200 * time.Millisecond)
		raw := []byte(`{"type":"artifact_version"}`)
		_, _ = ts.t.Append(context.Background(), []store.FactRow{{RowHash: keys.ContentHash(raw), Type: "artifact_version", ConversationID: "c", RepoID: "r", Path: "docs/plans/x/DESIGN.md", ContentHash: hash, Raw: raw}})
	}()
	started := time.Now()
	result := mcpDecode(t, mcpRequest(t, h, "ka", mcpCallBody("artifact_feedback", map[string]any{"path": "docs/plans/x/DESIGN.md", "_local": local}), nil))["result"].(map[string]any)
	if elapsed := time.Since(started); elapsed < 150*time.Millisecond || elapsed >= 1400*time.Millisecond {
		t.Fatalf("delivery observation was not bounded by the running-drain wait: %s", elapsed)
	}
	text := result["content"].([]any)[0].(map[string]any)["text"].(string)
	if !strings.Contains(text, "state: delivered") || !strings.Contains(text, "versions: 1") {
		t.Fatalf("running drain delivery: %s", text)
	}
}
