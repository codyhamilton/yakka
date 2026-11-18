package serve

import (
	"context"
	"strings"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

const feedbackActionPath = "docs/plans/x/DESIGN.md"

var feedbackActionHash = keys.ContentHash([]byte("feedback action content"))

func feedbackActionRev(t *testing.T, s *Server) string {
	t.Helper()
	list := mcpDecode(t, mcpRequest(t, s.Handler(), "ka", `{"id":1,"method":"tools/list"}`, map[string]string{"Yakka-Context": "2"}))["result"].(map[string]any)["tools"].([]any)
	for _, item := range list {
		tool := item.(map[string]any)
		if tool["name"] == "artifact_feedback" {
			return tool["_meta"].(map[string]any)["yakka/tool"].(map[string]any)["rev"].(string)
		}
	}
	t.Fatal("artifact_feedback is not registered")
	return ""
}

func feedbackActionHeaders() map[string]string {
	return map[string]string{"Yakka-Context": "2", "Yakka-Local-Actions": "enqueue_file_snapshot/1"}
}

func feedbackActionLocal(rev, call string) map[string]any {
	return map[string]any{
		"_v": 2, "_rev": rev, "_call": call,
		"resolved_path": map[string]any{"path": "/work/" + feedbackActionPath, "base": nil},
		"file":          map[string]any{"exists": true, "is_file": true, "size": 4, "mtime": 1700000000, "content_hash": feedbackActionHash, "withheld": nil},
		"git":           map[string]any{"repo_id": "r", "rel_path": feedbackActionPath, "error": nil},
		"queue":         map[string]any{"pending": []any{}, "rejected": []any{}, "coverage": map[string]any{"complete": true, "pending_covering": float64(0), "rejected_covering": float64(0), "oldest_covering_age_s": nil}},
		"drain":         map[string]any{"running": false},
	}
}

func feedbackActionEffect(outcome, code string) map[string]any {
	effect := map[string]any{"action": mcpEnqueueAction, "v": 1, "action_id": "action-1", "ok": true, "outcome": outcome, "error": nil}
	if outcome == "failed" || outcome == "unknown" {
		effect["ok"] = false
		effect["error"] = code
	}
	return effect
}

func feedbackActionCall(t *testing.T, s *Server, local map[string]any, headers map[string]string) map[string]any {
	t.Helper()
	return mcpDecode(t, mcpRequest(t, s.Handler(), "ka", mcpCallBody("artifact_feedback", map[string]any{"path": feedbackActionPath, "_local": local}), headers))
}

func feedbackActionText(t *testing.T, reply map[string]any) string {
	t.Helper()
	result, ok := reply["result"].(map[string]any)
	if !ok {
		t.Fatalf("no tool result: %#v", reply)
	}
	return result["content"].([]any)[0].(map[string]any)["text"].(string)
}

func TestMCPArtifactFeedbackLocalActionDirective(t *testing.T) {
	s := feedbackServer(t)
	rev := feedbackActionRev(t, s)
	ts, err := s.tenant("a")
	if err != nil {
		t.Fatal(err)
	}
	reply := feedbackActionCall(t, s, feedbackActionLocal(rev, "call-1"), feedbackActionHeaders())
	errData, ok := reply["error"].(map[string]any)
	if !ok || errData["code"] != float64(-32011) {
		t.Fatalf("directive: %#v", reply)
	}
	data := errData["data"].(map[string]any)
	if data["code"] != "local_action_required" || data["v"] != float64(1) || data["call"] != "call-1" || data["rev"] != rev ||
		data["action"] != mcpEnqueueAction || data["action_v"] != float64(1) || data["path"] != "/work/"+feedbackActionPath || data["action_id"] == "" {
		t.Fatalf("directive data: %#v", data)
	}
	artifact, err := ts.t.Artifact(context.Background(), "r", feedbackActionPath)
	if err != nil || artifact != nil {
		t.Fatalf("directive wrote to the store: %#v %v", artifact, err)
	}
}

func TestMCPArtifactFeedbackLocalActionContinuation(t *testing.T) {
	t.Run("refreshed covering coverage", func(t *testing.T) {
		s := feedbackServer(t)
		local := feedbackActionLocal(feedbackActionRev(t, s), "call-1")
		local["file"] = map[string]any{"exists": true, "is_file": true, "size": 4, "mtime": 1700000000, "content_hash": "abc", "withheld": nil}
		local["queue"] = map[string]any{
			"pending":  []any{map[string]any{"age_s": float64(2), "mtime": float64(1700000000)}},
			"rejected": []any{},
			"coverage": map[string]any{"complete": true, "pending_covering": float64(1), "rejected_covering": float64(0), "oldest_covering_age_s": float64(2)},
		}
		local["effects"] = []any{feedbackActionEffect("enqueued", "")}
		if text := feedbackActionText(t, feedbackActionCall(t, s, local, feedbackActionHeaders())); !strings.HasPrefix(text, "state: queued") {
			t.Fatalf("refreshed covering coverage: %s", text)
		}
	})

	t.Run("refreshed matching hash", func(t *testing.T) {
		s := feedbackServer(t)
		rev := feedbackActionRev(t, s)
		if code, body := do(t, s.Handler(), "POST", "/v1/ingest", "ka", artBodyAt(feedbackActionPath, "feedback action content")); code != 200 {
			t.Fatalf("ingest: %d %s", code, body)
		}
		local := feedbackActionLocal(rev, "call-1")
		local["effects"] = []any{feedbackActionEffect("enqueued", "")}
		if text := feedbackActionText(t, feedbackActionCall(t, s, local, feedbackActionHeaders())); !strings.HasPrefix(text, "state: delivered") {
			t.Fatalf("refreshed matching hash: %s", text)
		}
	})

	t.Run("acknowledged but unconfirmed", func(t *testing.T) {
		s := feedbackServer(t)
		local := feedbackActionLocal(feedbackActionRev(t, s), "call-2")
		local["effects"] = []any{feedbackActionEffect("enqueued", "")}
		text := feedbackActionText(t, feedbackActionCall(t, s, local, feedbackActionHeaders()))
		if !strings.HasPrefix(text, "state: not delivered") || !strings.Contains(text, "the enqueue was acknowledged but delivery is unconfirmed") {
			t.Fatalf("enqueue acknowledged but unconfirmed: %s", text)
		}
	})

	for _, tc := range []struct {
		name, outcome, code, want string
	}{
		{"capture_off", "failed", "capture_off", "capture is off (YAKKA_HOOKLOG=off)"},
		{"effect_unknown", "unknown", "effect_unknown", "the local enqueue outcome is unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := feedbackServer(t)
			local := feedbackActionLocal(feedbackActionRev(t, s), "call-3")
			local["effects"] = []any{feedbackActionEffect(tc.outcome, tc.code)}
			text := feedbackActionText(t, feedbackActionCall(t, s, local, feedbackActionHeaders()))
			if !strings.HasPrefix(text, "state: not delivered") || !strings.Contains(text, tc.want) {
				t.Fatalf("%s: %s", tc.name, text)
			}
			if strings.Contains(text, "state: queued") || strings.Contains(text, "state: delivered") {
				t.Fatalf("%s claimed delivery: %s", tc.name, text)
			}
		})
	}
}

func TestMCPArtifactFeedbackLocalActionNoDirectiveWhenEvidenceExists(t *testing.T) {
	t.Run("delivered", func(t *testing.T) {
		s := feedbackServer(t)
		if code, body := do(t, s.Handler(), "POST", "/v1/ingest", "ka", artBodyAt(feedbackActionPath, "feedback action content")); code != 200 {
			t.Fatalf("ingest: %d %s", code, body)
		}
		local := feedbackActionLocal(feedbackActionRev(t, s), "call-1")
		if text := feedbackActionText(t, feedbackActionCall(t, s, local, feedbackActionHeaders())); !strings.HasPrefix(text, "state: delivered") {
			t.Fatalf("delivered with action bound: %s", text)
		}
	})
	t.Run("covering pending", func(t *testing.T) {
		s := feedbackServer(t)
		local := feedbackActionLocal(feedbackActionRev(t, s), "call-2")
		local["file"] = map[string]any{"exists": true, "is_file": true, "size": 4, "mtime": 1700000000, "content_hash": "abc", "withheld": nil}
		local["queue"] = map[string]any{
			"pending":  []any{map[string]any{"age_s": float64(2), "mtime": float64(1700000000)}},
			"rejected": []any{},
			"coverage": map[string]any{"complete": true, "pending_covering": float64(1), "rejected_covering": float64(0), "oldest_covering_age_s": float64(2)},
		}
		if text := feedbackActionText(t, feedbackActionCall(t, s, local, feedbackActionHeaders())); !strings.HasPrefix(text, "state: queued") {
			t.Fatalf("covering pending with action bound: %s", text)
		}
	})
	t.Run("covering rejected", func(t *testing.T) {
		s := feedbackServer(t)
		local := feedbackActionLocal(feedbackActionRev(t, s), "call-3")
		local["file"] = map[string]any{"exists": true, "is_file": true, "size": 4, "mtime": 1700000000, "content_hash": "abc", "withheld": nil}
		local["queue"] = map[string]any{
			"pending":  []any{},
			"rejected": []any{map[string]any{"reason": "secret: aws_access_key at line 3", "mtime": float64(1700000000)}},
			"coverage": map[string]any{"complete": true, "pending_covering": float64(0), "rejected_covering": float64(1), "oldest_covering_age_s": nil},
		}
		if text := feedbackActionText(t, feedbackActionCall(t, s, local, feedbackActionHeaders())); !strings.HasPrefix(text, "state: rejected") {
			t.Fatalf("covering rejected with action bound: %s", text)
		}
	})
}

func TestMCPArtifactFeedbackLocalActionThreeHundredSecondBound(t *testing.T) {
	s := feedbackServer(t)
	rev := feedbackActionRev(t, s)
	at := func(age float64) map[string]any {
		local := feedbackActionLocal(rev, "call-1")
		local["file"] = map[string]any{"exists": true, "is_file": true, "size": 4, "mtime": 1700000000, "content_hash": "abc", "withheld": nil}
		local["queue"] = map[string]any{
			"pending":  []any{map[string]any{"age_s": age, "mtime": float64(1700000000)}},
			"rejected": []any{},
			"coverage": map[string]any{"complete": true, "pending_covering": float64(1), "rejected_covering": float64(0), "oldest_covering_age_s": age},
		}
		return local
	}
	if text := feedbackActionText(t, feedbackActionCall(t, s, at(300), feedbackActionHeaders())); !strings.HasPrefix(text, "state: queued") {
		t.Fatalf("age 300 should stay queued: %s", text)
	}
	for _, age := range []float64{300.4, 301} {
		text := feedbackActionText(t, feedbackActionCall(t, s, at(age), feedbackActionHeaders()))
		if !strings.HasPrefix(text, "state: not delivered") || !strings.Contains(text, "301s old, over the 300 s bound") || !strings.Contains(text, "run yakka status") {
			t.Fatalf("age %v should not be queued: %s", age, text)
		}
		if strings.Contains(text, "state: queued") {
			t.Fatalf("age %v still queued: %s", age, text)
		}
	}
}

func TestMCPArtifactFeedbackLocalActionDeclarationNegotiation(t *testing.T) {
	s := feedbackServer(t)
	tool := s.mcpTool("artifact_feedback")
	if tool.DeclarationVersion != 2 || len(tool.LocalActions) != 1 {
		t.Fatalf("feedback action declaration: %#v", tool.LocalActions)
	}
	for _, reader := range tool.Context {
		if reader.Reader == "queue" && reader.Version != 2 {
			t.Fatalf("feedback queue reader: %#v", reader)
		}
	}
	list := mcpDecode(t, mcpRequest(t, s.Handler(), "ka", `{"id":1,"method":"tools/list"}`, map[string]string{"Yakka-Context": "1"}))["result"].(map[string]any)["tools"].([]any)
	for _, item := range list {
		if item.(map[string]any)["name"] == "artifact_feedback" {
			t.Fatalf("v1 shim received the v2 tool: %#v", list)
		}
	}
}
