package ingest

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func secretText() string { return "AKIA" + "IOSFODNN7" + "EXAMPLE" }

func artifact(id, content string) map[string]any {
	return map[string]any{"id": id, "type": "artifact_version", "conversation_id": "c1", "harness": "h", "event": "write",
		"ts": 1.5, "repo_id": "r", "path": "docs/plans/01-x/DESIGN.md", "content": content,
		"content_hash": keys.ContentHash([]byte(content)), "source": "worktree"}
}

func marshal(t *testing.T, ms ...any) []json.RawMessage {
	var out []json.RawMessage
	for _, m := range ms {
		b, err := json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, b)
	}
	return out
}

func open(t *testing.T) *store.Tenant {
	tn, err := store.Open(t.TempDir(), store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tn.Close() })
	return tn
}

func TestIngestBatchAndResend(t *testing.T) {
	tn := open(t)
	hook := map[string]any{"id": "q#0", "type": "hook_event", "conversation_id": "c1", "harness": "h", "event": "Stop", "ts": 1, "payload": map[string]any{"a": "b"}, "extra": 1}
	art := artifact("q#1", "# design\n")
	commit := map[string]any{"id": "q#2", "type": "commit", "conversation_id": "c1", "harness": "h", "event": "commit", "ts": 2,
		"repo_id": "r", "sha": "abc", "paths": []string{"a"}, "renames": []map[string]string{{"from": "a", "to": "b"}}}
	bad := map[string]any{"id": "q#3", "type": "hook_event", "conversation_id": "c1", "harness": "h", "event": "x", "ts": 3,
		"payload": map[string]any{"cmd": "line\nkey " + secretText()}}
	facts := marshal(t, hook, art, commit, bad)
	for round := 0; round < 2; round++ {
		res, err := Ingest(context.Background(), tn, facts)
		if err != nil {
			t.Fatal(err)
		}
		if len(res) != 4 {
			t.Fatalf("results %d", len(res))
		}
		want := Accepted
		if round == 1 {
			want = Duplicate
		}
		for i := 0; i < 3; i++ {
			if res[i].Status != want || res[i].ID != "q#"+string(rune('0'+i)) {
				t.Fatalf("round %d result %d: %+v", round, i, res[i])
			}
		}
		if res[3].Status != Rejected || !strings.HasPrefix(res[3].Reason, "precheck: ") || !strings.Contains(res[3].Reason, "payload.cmd line 2") || strings.Contains(res[3].Reason, secretText()) {
			t.Fatalf("round %d secret result: %+v", round, res[3])
		}
	}
	if pend, _ := tn.PendingHashes(); len(pend) != 1 {
		t.Fatalf("pending %v", pend)
	}
}

func TestSessionActionAcceptsValueErrorsAndPreservesPrecheck(t *testing.T) {
	tn := open(t)
	bad := map[string]any{"id": "q#action", "type": "session_action", "conversation_id": "c1", "harness": "codex", "ts": 1,
		"source": "env", "action": map[string]any{"kind": "bogus", "phase": "two"}}
	res, err := Ingest(context.Background(), tn, marshal(t, bad))
	if err != nil || len(res) != 1 || res[0].Status != Accepted {
		t.Fatalf("invalid action values must be accepted for projection: %#v %v", res, err)
	}
	secret := map[string]any{"id": "q#secret-action", "type": "session_action", "conversation_id": "c1", "harness": "codex", "ts": 2,
		"action": map[string]any{"kind": "build", "subject_id": "key " + secretText()}}
	res, err = Ingest(context.Background(), tn, marshal(t, secret))
	if err != nil || len(res) != 1 || res[0].Status != Rejected || !strings.HasPrefix(res[0].Reason, "precheck:") {
		t.Fatalf("secret scan must still refuse action facts: %#v %v", res, err)
	}
	missingConversation := map[string]any{"id": "q#missing", "type": "session_action", "action": map[string]any{"kind": "build"}}
	res, err = Ingest(context.Background(), tn, marshal(t, missingConversation))
	if err != nil || len(res) != 1 || res[0].Status != Rejected {
		t.Fatalf("conversation_id remains structurally required: %#v %v", res, err)
	}
}

func TestIngestSecretInContent(t *testing.T) {
	tn := open(t)
	res, _ := Ingest(context.Background(), tn, marshal(t, artifact("x#0", "a\nb "+secretText()+"\n")))
	if res[0].Status != Rejected || !strings.HasSuffix(res[0].Reason, "at line 2") || strings.Contains(res[0].Reason, secretText()) {
		t.Fatalf("%+v", res[0])
	}
	if pend, _ := tn.PendingHashes(); len(pend) != 0 {
		t.Fatal("secret content reached pending")
	}
}

func TestIngestInvalid(t *testing.T) {
	tn := open(t)
	good := artifact("g#0", "ok")
	badHash := artifact("g#1", "ok2")
	badHash["content_hash"] = "deadbeef"
	noPath := artifact("g#2", "ok3")
	delete(noPath, "path")
	noConv := artifact("g#3", "ok4")
	noConv["conversation_id"] = ""
	noSha := map[string]any{"id": "g#4", "type": "commit", "conversation_id": "c", "repo_id": "r"}
	noRepo := map[string]any{"id": "g#5", "type": "commit", "conversation_id": "c", "sha": "s"}
	unk := map[string]any{"id": "g#6", "type": "bogus", "conversation_id": "c"}
	facts := marshal(t, good, badHash, noPath, noConv, noSha, noRepo, unk)
	facts = append(facts, json.RawMessage(`"str"`), json.RawMessage(`[1]`))
	res, err := Ingest(context.Background(), tn, facts)
	if err != nil {
		t.Fatal(err)
	}
	if res[0].Status != Accepted {
		t.Fatalf("good: %+v", res[0])
	}
	for i := 1; i < len(res); i++ {
		if res[i].Status != Rejected || !strings.HasPrefix(res[i].Reason, "invalid:") {
			t.Fatalf("%d: %+v", i, res[i])
		}
	}
}

func TestPrecheckPaths(t *testing.T) {
	obj := map[string]any{"payload": map[string]any{"l": []any{"x", "k " + secretText()}}}
	r := Precheck(obj)
	if !strings.Contains(r, "payload.l[1] line 1") {
		t.Fatal(r)
	}
}
