package serve

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/scorer"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

type statelessGolden struct {
	Instructions string           `json:"instructions"`
	Tools        []map[string]any `json:"tools"`
	Calls        []struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
		Text      string         `json:"text"`
		IsError   bool           `json:"isError"`
	} `json:"calls"`
}

func statelessServer(t *testing.T) *Server {
	t.Helper()
	checksDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(checksDir, "criteria.json"), []byte(`{"design":{"jev":{"clarity":{"q":"Is it clear?","levels":["no","partly","yes"]},"debt":{"q":"Is there debt?","levels":["low","high"],"invert":true}}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	checks, err := scorer.LoadChecks(checksDir)
	if err != nil {
		t.Fatal(err)
	}
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", "ka"}, {"b", "kb"}}}, Options{DisableWorker: true, Checks: &checks})
	if err := s.RegisterStatelessMCPTools(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestMCPStatelessCorpus(t *testing.T) {
	var golden statelessGolden
	raw, err := os.ReadFile("testdata/mcp-golden/stateless-tools.json")
	if err != nil {
		t.Fatalf("read golden corpus: %v", err)
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatalf("decode golden corpus: %v", err)
	}
	s := statelessServer(t)
	h := s.Handler()
	list := mcpDecode(t, mcpRequest(t, h, "ka", `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`, nil))["result"].(map[string]any)["tools"].([]any)
	if len(list) != len(golden.Tools) {
		t.Fatalf("listed tools: %d want %d", len(list), len(golden.Tools))
	}
	for i, want := range golden.Tools {
		got := list[i].(map[string]any)
		for _, field := range []string{"name", "description", "inputSchema", "annotations"} {
			if !reflect.DeepEqual(got[field], want[field]) {
				t.Errorf("tool %s %s differs\ngot:  %#v\nwant: %#v", want["name"], field, got[field], want[field])
			}
		}
		decl := got["_meta"].(map[string]any)["yakka/tool"].(map[string]any)
		if readers, ok := decl["context"].([]any); !ok || len(readers) != 0 {
			t.Errorf("%s has local context declaration: %#v", want["name"], decl["context"])
		}
	}
	init := mcpDecode(t, mcpRequest(t, h, "ka", `{"jsonrpc":"2.0","id":2,"method":"initialize","params":{}}`, nil))["result"].(map[string]any)
	if !strings.Contains(init["instructions"].(string), golden.Instructions) {
		t.Fatalf("initialize instructions %q omit %q", init["instructions"], golden.Instructions)
	}
	code, checksBody := do(t, h, "GET", "/v1/checks?kind=design", "ka", "")
	if code != 200 {
		t.Fatalf("REST checks: %d %s", code, checksBody)
	}
	var restChecks struct {
		Checks []struct {
			Name   string   `json:"name"`
			Q      string   `json:"q"`
			Levels []string `json:"levels"`
			Invert bool     `json:"invert"`
		} `json:"checks"`
	}
	if err := json.Unmarshal([]byte(checksBody), &restChecks); err != nil {
		t.Fatal(err)
	}
	var checkLines []string
	for _, check := range restChecks.Checks {
		line := fmt.Sprintf("%s [levels %s]", check.Name, strings.Join(check.Levels, "/"))
		if check.Invert {
			line += " [inverted]"
		}
		checkLines = append(checkLines, line+": "+check.Q)
	}
	if len(golden.Calls) == 0 || strings.Join(checkLines, "\n") != golden.Calls[0].Text {
		t.Fatalf("MCP list_checks formatting differs from REST response formatting: %q", strings.Join(checkLines, "\n"))
	}

	for _, tc := range golden.Calls {
		if tc.Name == "search_artifacts" && tc.Text != "no matches" && !tc.IsError {
			continue // The populated search row is exercised against real tenant stores below.
		}
		args := map[string]any{}
		for k, v := range tc.Arguments {
			args[k] = v
		}
		args["_local"] = map[string]any{"forged": map[string]any{"secret": "ignored"}}
		body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": "tool", "method": "tools/call", "params": map[string]any{"name": tc.Name, "arguments": args}})
		result := mcpDecode(t, mcpRequest(t, h, "ka", string(body), nil))["result"].(map[string]any)
		content := result["content"].([]any)[0].(map[string]any)
		if content["text"] != tc.Text || result["isError"] != tc.IsError {
			t.Errorf("%s(%#v) = (%q,%v), want (%q,%v)", tc.Name, tc.Arguments, content["text"], result["isError"], tc.Text, tc.IsError)
		}
	}
}

func TestMCPStatelessSearchTenantAndRESTParity(t *testing.T) {
	s := statelessServer(t)
	const alpha = "alpha needle only in tenant a"
	const beta = "beta needle only in tenant b"
	put := func(key, path, content string) {
		t.Helper()
		body := artBodyAt(path, content)
		if code, response := do(t, s.Handler(), "POST", "/v1/ingest", key, body); code != 200 {
			t.Fatalf("ingest: %d %s", code, response)
		}
		id := "a"
		if key == "kb" {
			id = "b"
		}
		ts, err := s.tenant(id)
		if err != nil {
			t.Fatal(err)
		}
		if err := ts.t.Promote(context.Background(), keys.ContentHash([]byte(content)), store.Screen{Verdict: "pass", Scorer: "fixture"}); err != nil {
			t.Fatal(err)
		}
	}
	put("ka", "docs/plans/y/DESIGN.md", alpha)
	put("kb", "docs/plans/y/DESIGN.md", beta)

	call := func(key, query string, local any) string {
		t.Helper()
		args := map[string]any{"query": query}
		if local != nil {
			args["_local"] = local
		}
		body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": map[string]any{"name": "search_artifacts", "arguments": args}})
		result := mcpDecode(t, mcpRequest(t, s.Handler(), key, string(body), nil))["result"].(map[string]any)
		return result["content"].([]any)[0].(map[string]any)["text"].(string)
	}
	if got := call("kb", "alpha", nil); got != "no matches" {
		t.Fatalf("tenant b saw tenant a search hit: %s", got)
	}
	got := call("ka", "alpha", map[string]any{"forged": "ignored"})
	if !strings.Contains(got, "design r:docs/plans/y/DESIGN.md") || !strings.Contains(got, "[alpha]") {
		t.Fatalf("tenant a search: %s", got)
	}

	code, restBody := do(t, s.Handler(), "GET", "/v1/search?q="+url.QueryEscape("alpha"), "ka", "")
	if code != 200 {
		t.Fatalf("REST search: %d %s", code, restBody)
	}
	var rest struct {
		Hits []struct {
			RepoID  string  `json:"repo_id"`
			Path    string  `json:"path"`
			Kind    string  `json:"kind"`
			Rank    float64 `json:"rank"`
			Snippet string  `json:"snippet"`
		} `json:"hits"`
	}
	if err := json.Unmarshal([]byte(restBody), &rest); err != nil || len(rest.Hits) != 1 {
		t.Fatalf("REST search body: %v %s", err, restBody)
	}
	hit := rest.Hits[0]
	want := fmt.Sprintf("%s %s:%s (rank %v)\n%s", hit.Kind, hit.RepoID, hit.Path, hit.Rank, hit.Snippet)
	if got != want {
		t.Fatalf("MCP formatting differs from REST response formatting\nMCP: %q\nREST: %q", got, want)
	}
}
