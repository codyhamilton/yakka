package serve

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/scorer"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func actionBatch(kind, phase string) string {
	b, _ := json.Marshal(map[string]any{"facts": []any{map[string]any{"id": "q#1", "type": "session_action", "conversation_id": "C", "harness": "codex", "ts": 10, "source": "env", "action": map[string]string{"kind": kind, "subject_type": "plan", "subject_id": "CodyHamilton/Yakka:plan/22-X", "phase": phase}}}})
	return string(b)
}
func TestActionAPIAndProjectionAcrossScoringModes(t *testing.T) {
	modes := []struct {
		name string
		step ScreenFunc
	}{{"disabled", nil}, {"enabled", func(ctx context.Context, tn *store.Tenant, hash string) error { return nil }}, {"unreachable", func(ctx context.Context, tn *store.Tenant, hash string) error {
		return fmt.Errorf("fake scorer: %w", scorer.ErrUnreachable)
	}}}
	for _, mode := range modes {
		t.Run(mode.name, func(t *testing.T) {
			s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"tenant", "key"}}}, Options{PollInterval: 5 * time.Millisecond, ScreenBackoff: time.Second, ActionPollInterval: 5 * time.Millisecond, ScreenStep: mode.step})
			defer s.Close()
			h := s.Handler()
			code, body := do(t, h, http.MethodPost, "/v1/ingest", "key", actionBatch(" Build ", "1"))
			if code != 200 || !strings.Contains(body, `"accepted"`) {
				t.Fatalf("ingest %d %s", code, body)
			}
			code, body = do(t, h, http.MethodPost, "/v1/ingest", "key", actionBatch(" Build ", "1"))
			if code != 200 || !strings.Contains(body, `"duplicate"`) {
				t.Fatalf("duplicate %d %s", code, body)
			}
			deadline := time.Now().Add(2 * time.Second)
			for {
				code, body = do(t, h, http.MethodGet, "/v1/actions?conversation_id=C", "key", "")
				if code == 200 && strings.Contains(body, `"pending":0`) {
					break
				}
				if time.Now().After(deadline) {
					t.Fatalf("projection did not finish: %d %s", code, body)
				}
				time.Sleep(5 * time.Millisecond)
			}
			if !strings.Contains(body, `"status":"accepted"`) || !strings.Contains(body, `"subject_id":"codyhamilton/yakka:plan/22-x"`) {
				t.Fatalf("projected row: %s", body)
			}
			if code, _ = do(t, h, http.MethodGet, "/v1/actions?conversation_id=C", "wrong", ""); code != 401 {
				t.Fatalf("tenant scope leak: %d", code)
			}
		})
	}
}
func TestActionValuesAreRejectedOnlyByProjection(t *testing.T) {
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"tenant", "key"}}}, Options{PollInterval: 5 * time.Millisecond, ActionPollInterval: 5 * time.Millisecond})
	defer s.Close()
	h := s.Handler()
	code, body := do(t, h, http.MethodPost, "/v1/ingest", "key", actionBatch("bogus", "two"))
	if code != 200 || !strings.Contains(body, `"accepted"`) {
		t.Fatalf("value validation leaked to ingest: %d %s", code, body)
	}
	deadline := time.Now().Add(time.Second)
	for {
		code, body = do(t, h, http.MethodGet, "/v1/actions?conversation_id=C", "key", "")
		if code == 200 && strings.Contains(body, `"pending":0`) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("projection: %d %s", code, body)
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !strings.Contains(body, `"status":"rejected"`) || !strings.Contains(body, "unknown_kind") || !strings.Contains(body, "bad_phase") {
		ts, _ := s.tenant("tenant")
		p, _ := ts.t.PendingActionProjections(context.Background(), 10)
		all, _, _ := ts.t.ActionRows(context.Background(), "", "", "", "", "", nil, 10)
		status, _ := ts.t.ActionStatus(context.Background())
		fc, _ := ts.t.FactCount(context.Background())
		t.Fatalf("rejection not projected: %s pending=%#v all=%#v status=%#v facts=%d", body, p, all, status, fc)
	}
}

func TestFailedActionProjectionDoesNotBlockScreening(t *testing.T) {
	var screened int
	screenStep := func(ctx context.Context, tn *store.Tenant, hash string) error {
		screened++
		return tn.Promote(ctx, hash, store.Screen{Verdict: "unscreened"})
	}
	s := New(Config{Data: t.TempDir(), Keys: []KeyPair{{"tenant", "key"}}}, Options{PollInterval: 5 * time.Millisecond, ScreenBackoff: 5 * time.Millisecond, ActionPollInterval: 5 * time.Millisecond, ScreenStep: screenStep, ActionProject: func(context.Context, *store.Tenant, string) error {
		return fmt.Errorf("injected local projection failure")
	}})
	defer s.Close()
	content := "safe fixture\n"
	body := fmt.Sprintf(`{"facts":[{"id":"a#1","type":"session_action","conversation_id":"C","harness":"codex","ts":10,"source":"env","action":{"kind":"build","subject_type":"plan","subject_id":"owner/repo:plan/a"}},{"id":"a#2","type":"artifact_version","conversation_id":"C","harness":"codex","event":"write","ts":11,"repo_id":"repo","path":"docs/plans/a/DESIGN.md","content":%q,"content_hash":%q,"source":"worktree"}]}`, content, keys.ContentHash([]byte(content)))
	if code, reply := do(t, s.Handler(), http.MethodPost, "/v1/ingest", "key", body); code != 200 || !strings.Contains(reply, `"accepted"`) {
		t.Fatalf("ingest %d %s", code, reply)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		ts, err := s.tenant("tenant")
		if err == nil {
			st, _ := ts.t.ActionStatus(context.Background())
			if st["failed"] == 1 && screened > 0 && ts.t.HasBlob(keys.ContentHash([]byte(content))) {
				return
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("screening stalled after projection failure: screened=%d", screened)
}
