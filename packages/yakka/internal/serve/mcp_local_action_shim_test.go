package serve

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
)

// Exercise the real product MCP server with the real Python shim: one bound
// directive, one continuation carrying the effect facts, and no replay.
func TestMCPLocalActionRealShimRoundTrip(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not available")
	}
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	root, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	clientDir := filepath.Join(root, "plugins", "yakka", "client")
	if _, err := os.Stat(filepath.Join(clientDir, "yakka.py")); err != nil {
		t.Skipf("shim not found: %v", err)
	}
	repo := t.TempDir()
	path := filepath.Join(repo, "docs", "plans", "01-x", "DESIGN.md")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("reviewed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"-C", repo, "init", "-q"},
		{"-C", repo, "-c", "user.name=t", "-c", "user.email=t@x", "add", "."},
		{"-C", repo, "-c", "user.name=t", "-c", "user.email=t@x", "commit", "-qm", "fixture"},
	} {
		if out, err := exec.Command("git", args...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	queue := filepath.Join(repo, "queue")
	if err := os.MkdirAll(queue, 0o700); err != nil {
		t.Fatal(err)
	}

	const key = "unit-test-action-key"
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"a", key}}}, Options{DisableWorker: true})
	t.Cleanup(func() { s.Close() })
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
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()

	script := `
import io, json, os, sys, threading
import yakka
relay = yakka._McpRelay(yakka.McpOptions(QueueDir=os.environ["YAKKA_QUEUE"], Version="test"))
request = {"jsonrpc":"2.0","id":"bridge","method":"tools/call","params":{"name":"action_fixture","arguments":{"path":os.environ["YAKKA_PATH"]}}}
relay.writer = io.BytesIO()
relay._dispatch(json.dumps(request, separators=(",", ":")).encode(), request, "bridge", "tools/call", True, threading.Event())
sys.stdout.buffer.write(relay.writer.getvalue())
`
	cmd := exec.Command(python, "-c", script)
	cmd.Dir = clientDir
	cmd.Env = append(os.Environ(),
		"YAKKA_ENDPOINT="+srv.URL,
		"YAKKA_KEY="+key,
		"YAKKA_CLIENT_CONFIG="+filepath.Join(repo, "missing.toml"),
		"YAKKA_QUEUE="+queue,
		"YAKKA_HOOKLOG=off",
		"YAKKA_PATH="+path,
		"PYTHONPATH="+clientDir,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("shim: %v\n%s", err, out)
	}
	var reply map[string]any
	if err := json.Unmarshal(out, &reply); err != nil {
		t.Fatalf("shim reply: %v\n%s", err, out)
	}
	if reply["error"] != nil {
		t.Fatalf("shim error: %v", reply)
	}
	result, _ := reply["result"].(map[string]any)
	if result["result"] != "final" || result["call"] == "" {
		t.Fatalf("final reply: %v", result)
	}
	effects, _ := result["effects"].([]any)
	if len(effects) != 1 {
		t.Fatalf("effects: %v", result)
	}
	effect, _ := effects[0].(map[string]any)
	if effect["action"] != mcpEnqueueAction || effect["action_id"] == "" || effect["outcome"] != "failed" || effect["error"] != "capture_off" {
		t.Fatalf("effect: %v", effect)
	}
	if directives.Load() != 1 || continuations.Load() != 1 {
		t.Fatalf("rounds: directives=%d continuations=%d", directives.Load(), continuations.Load())
	}
}
