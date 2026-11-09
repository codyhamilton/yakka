package serve

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/review"
)

func TestReviewMCPRegistrationContract(t *testing.T) {
	s, _ := newServer(t, true)
	if err := s.RegisterReviewMCPTool(); err != nil {
		t.Fatal(err)
	}
	tool := s.mcpTool("review_change")
	if tool == nil {
		t.Fatal("review_change is not registered")
	}
	if tool.Scope != TokenScopeReadWrite || tool.TimeoutS != 150 || len(tool.LocalActions) != 0 || len(tool.Context) != 4 {
		t.Fatalf("registration scope=%q timeout=%d local_actions=%v context=%v", tool.Scope, tool.TimeoutS, tool.LocalActions, tool.Context)
	}
	want := []string{"project_dir", "cwd", "git", "change"}
	for i, name := range want {
		if tool.Context[i].Reader != name || tool.Context[i].required() {
			t.Fatalf("context[%d]=%+v", i, tool.Context[i])
		}
	}
	if !tool.Context[3].Bulk || fmt.Sprint(tool.Context[3].Params["budget_bytes"]) != "2.097152e+06" {
		t.Fatalf("change declaration=%+v", tool.Context[3])
	}
	if err := validateReviewMCPArgs(map[string]any{"mode": "range", "base": "a", "head": "b", "build_models": []any{map[string]any{"id": "unknown"}}}); err != "" {
		t.Fatal(err)
	}
	if idempotent, ok := tool.Annotations["idempotentHint"].(bool); ok && idempotent {
		t.Fatal("review_change must not promise unconditional idempotency")
	}
	properties, _ := tool.InputSchema["properties"].(map[string]any)
	for _, key := range []string{"effort", "tags", "store"} {
		if properties[key] == nil {
			t.Fatalf("review schema missing %s", key)
		}
	}
	if err := validateReviewMCPArgs(map[string]any{"mode": "uncommitted", "build_models": []any{map[string]any{"id": "unknown"}}, "effort": "max", "tags": []any{"run:1"}, "store": false}); err != "" {
		t.Fatalf("valid call controls rejected: %s", err)
	}
	for _, args := range []map[string]any{
		{"mode": "range", "build_models": []any{map[string]any{"id": "unknown"}}},
		{"mode": "uncommitted", "build_models": []any{map[string]any{"id": "unknown"}}, "surprise": true},
		{"mode": "uncommitted", "build_models": []any{map[string]any{"id": "unknown"}}, "include_untracked": "yes"},
		{"mode": "uncommitted", "build_models": []any{map[string]any{"id": "unknown"}}, "effort": "min"},
		{"mode": "uncommitted", "build_models": []any{map[string]any{"id": "unknown"}}, "tags": "run"},
		{"mode": "uncommitted", "build_models": []any{map[string]any{"id": "unknown"}}, "tags": []any{"ok", 5}},
		{"mode": "uncommitted", "build_models": []any{map[string]any{"id": "unknown"}}, "tags": make([]any, 17)},
		{"mode": "uncommitted", "build_models": []any{map[string]any{"id": "unknown"}}, "store": "yes"},
	} {
		if err := validateReviewMCPArgs(args); err == "" {
			t.Fatalf("invalid args accepted: %#v", args)
		}
	}
}

func TestReviewMCPMissingReaderIsCaptureUnsupportedWithoutRecord(t *testing.T) {
	s, _ := newServer(t, true)
	defer s.Close()
	ts, err := s.tenant("a")
	if err != nil {
		t.Fatal(err)
	}
	ctx := LocalContext{declared: map[string]bool{"change": true}, values: map[string]json.RawMessage{}}
	_, err = s.mcpReviewChange(context.Background(), "a", ts, map[string]any{"mode": "uncommitted", "build_models": []any{map[string]any{"id": "unknown"}}}, ctx)
	if err == nil || err.Error() != "capture_unsupported" {
		t.Fatalf("error=%v", err)
	}
}

func TestReviewMCPReadScopeAndLocalSpoofStripping(t *testing.T) {
	s, _ := newServer(t, true)
	if err := s.RegisterReviewMCPTool(); err != nil {
		t.Fatal(err)
	}
	result := s.mcpCall(context.Background(), "a", TokenScopeRead, "review_change", nil)
	b, _ := json.Marshal(result)
	if !strings.Contains(string(b), "insufficient_scope") {
		t.Fatalf("read scope was not refused: %s", b)
	}
}

func TestReviewMCPAndRESTShareOrchestrationAndReceipt(t *testing.T) {
	var providerCalls int
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls++
		var payload map[string]any
		if json.NewDecoder(r.Body).Decode(&payload) != nil {
			t.Error("invalid provider request")
		}
		if payload["model"] != "claude-haiku-5-5" || payload["output_config"].(map[string]any)["effort"] != "high" {
			t.Errorf("provider settings=%#v", payload)
		}
		answer, _ := json.Marshal(map[string]any{"outcomes": []any{}, "findings": []any{}, "limitations": []any{}, "coverage": "complete"})
		response, _ := json.Marshal(map[string]any{"model": "claude-haiku-5-5", "content": []any{map[string]any{"type": "text", "text": string(answer)}}, "usage": map[string]any{"input_tokens": 80, "output_tokens": 20}})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(response)
	}))
	defer fake.Close()
	dir := t.TempDir()
	s := New(Config{Data: dir, Keys: []KeyPair{{"a", "ka"}}, ReviewToken: "fixture-only", ReviewModel: "claude-haiku-5-5", ReviewEffort: "", ReviewUSDCap: 2, ReviewRepositories: map[string]bool{"a/repo-a": true}}, Options{DisableWorker: true, ReviewEndpoint: fake.URL, PollInterval: time.Hour})
	defer s.Close()
	h := s.Handler()
	for _, mode := range []string{"uncommitted", "range"} {
		diff := "diff --git a/pkg/a.go b/pkg/a.go\nindex 1111111..2222222 100644\n--- a/pkg/a.go\n+++ b/pkg/a.go\n@@ -1 +1 @@\n-old code\n+new code\n"
		if mode == "range" {
			diff = strings.ReplaceAll(diff, "new code", "range code")
		}
		hash := sha256.Sum256([]byte(diff))
		head := strings.Repeat("b", 40)
		capture := review.Capture{RepoID: "repo-a", Mode: mode, View: "combined", Head: head, Diff: diff, DiffSHA256: hex.EncodeToString(hash[:]), Complete: true}
		args := map[string]any{"mode": mode, "view": "combined", "kind": "adhoc", "build_models": []any{map[string]any{"id": "unknown"}}, "detail": "full", "_local": map[string]any{"change": capture, "spoof": "ignored"}}
		if mode == "range" {
			capture.Base = strings.Repeat("a", 40)
			args["base"] = capture.Base
			args["head"] = head
			args["_local"].(map[string]any)["change"] = capture
		}
		callBody, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": map[string]any{"name": "review_change", "arguments": args}})
		req := httptest.NewRequest(http.MethodPost, "/v1/mcp", strings.NewReader(string(callBody)))
		req.Header.Set("Authorization", "Bearer ka")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 200 || strings.Contains(rec.Body.String(), diff) {
			t.Fatalf("MCP %s status=%d body=%s", mode, rec.Code, rec.Body.String())
		}
		var rpc struct {
			Result review.Receipt `json:"result"`
		}
		if json.Unmarshal(rec.Body.Bytes(), &rpc) != nil || rpc.Result.ID == "" {
			t.Fatalf("MCP result %s", rec.Body.String())
		}
		mcpReceipt := rpc.Result
		restReq := review.Request{Capture: capture, Kind: "adhoc", BuildModels: []review.BuildModel{{ID: "unknown"}}, Detail: "full"}
		restBody, _ := json.Marshal(restReq)
		req = httptest.NewRequest(http.MethodPost, "/v1/reviews", strings.NewReader(string(restBody)))
		req.Header.Set("Authorization", "Bearer ka")
		req.Header.Set("Content-Type", "application/json")
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var restReceipt review.Receipt
		if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &restReceipt) != nil || restReceipt.Reason != mcpReceipt.ID || restReceipt.CaptureID != mcpReceipt.CaptureID || restReceipt.Status != "skipped_duplicate" {
			t.Fatalf("REST parity status=%d body=%s MCP=%+v", rec.Code, rec.Body.String(), mcpReceipt)
		}
		if strings.Contains(rec.Body.String(), diff) || mcpReceipt.Result == nil {
			t.Fatalf("receipt exposed capture/full input: %s", rec.Body.String())
		}
	}
	if providerCalls != 2 {
		t.Fatalf("provider calls=%d want 2", providerCalls)
	}
}
