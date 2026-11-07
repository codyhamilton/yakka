package store

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func appendAction(t *testing.T, tn *Tenant, id, conv, source, kind, subject, phase string, ts float64) string {
	t.Helper()
	fact := map[string]any{"type": "session_action", "conversation_id": conv, "harness": "codex", "ts": ts, "source": source, "evidence": id, "action": map[string]string{"kind": kind, "subject_type": "plan", "subject_id": subject, "phase": phase}}
	raw, _ := json.Marshal(fact)
	hash, err := keys.RowHash(raw)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tn.Append(context.Background(), []FactRow{{RowHash: hash, Type: "session_action", ConversationID: conv, Harness: "codex", TS: ts, Raw: raw}}); err != nil {
		t.Fatal(err)
	}
	return hash
}
func TestActionProjectionValidationSegmentsAndPrecedence(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	bad := appendAction(t, tn, "bad", "c", "env", "bogus", "owner/repo:plan/a", "two", 3)
	back := appendAction(t, tn, "back", "c", "backfill", "build", "owner/repo:plan/a", "", 4)
	first := appendAction(t, tn, "first", "live", "env", "design", "owner/repo:plan/a", "1", 20)
	second := appendAction(t, tn, "second", "live", "mcp", "build", "owner/repo:plan/b", "2", 10)
	duplicate := appendAction(t, tn, "duplicate", "live", "mcp", "build", "owner/repo:plan/b", "2", 10)
	review := appendAction(t, tn, "review", "c", "review", "fix", "owner/repo:plan/a", "", 5)
	for _, h := range []string{bad, back, first, second, duplicate, review} {
		if err := tn.ProjectAction(ctx, h); err != nil {
			t.Fatal(err)
		}
	}
	rows, _, err := tn.ActionRows(ctx, "c", "", "", "", "", nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	statuses := map[string]string{}
	for _, x := range rows {
		statuses[x.Hash] = x.Status
	}
	if statuses[bad] != "rejected" || statuses[back] != "accepted" || statuses[review] != "accepted" {
		t.Fatalf("unexpected statuses: %#v", statuses)
	}
	live, _, err := tn.ActionRows(ctx, "live", "", "", "", "", nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	var active, ended int
	for _, x := range live {
		if x.Effective {
			active++
		}
		if x.SegmentEnd != nil {
			ended++
		}
	}
	if active != 2 || ended != 1 {
		t.Fatalf("segments: effective=%d ended=%d rows=%#v", active, ended, live)
	}
	var effectiveReview bool
	for _, x := range rows {
		if x.Hash == review {
			effectiveReview = x.Effective
		}
	}
	if !effectiveReview {
		t.Fatal("review did not override backfill")
	}
}
func TestActionProjectionPendingRetriesStopAtThree(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	hash := appendAction(t, tn, "x", "c", "env", "build", "owner/repo:plan/a", "", 1)
	for i := 0; i < 3; i++ {
		if err := tn.FailActionProjection(ctx, hash, context.DeadlineExceeded); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := tn.PendingActionProjections(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("terminal failure still pending: %#v", rows)
	}
	s, err := tn.ActionStatus(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if s["failed"] != 1 {
		t.Fatalf("status: %#v", s)
	}
}

func TestSessionActionsDoNotChangeLegacyAnalytics(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	if _, err := tn.Append(ctx, []FactRow{row(100, "hook_event")}); err != nil {
		t.Fatal(err)
	}
	f := AnalyticsFilter{From: time.Unix(0, 0), To: time.Unix(7200, 0)}
	summaryBefore, err := tn.Summary(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	facetsBefore, err := tn.Facets(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	queryBefore, err := tn.Query(ctx, f, QueryParams{Measure: "conversations", Bucket: "hour"})
	if err != nil {
		t.Fatal(err)
	}
	raw := []byte(`{"type":"session_action","conversation_id":"action-only","harness":"codex","event":"ignored","ts":200,"source":"env","action":{"kind":"build"}}`)
	hash, err := keys.RowHash(raw)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tn.Append(ctx, []FactRow{{RowHash: hash, Type: "session_action", ConversationID: "action-only", Harness: "codex", Event: "ignored", TS: 200, Source: "env", Raw: raw}}); err != nil {
		t.Fatal(err)
	}
	summaryAfter, err := tn.Summary(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	facetsAfter, err := tn.Facets(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	queryAfter, err := tn.Query(ctx, f, QueryParams{Measure: "conversations", Bucket: "hour"})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(summaryBefore, summaryAfter) {
		t.Fatalf("summary changed: before=%#v after=%#v", summaryBefore, summaryAfter)
	}
	if !reflect.DeepEqual(facetsBefore, facetsAfter) {
		t.Fatalf("facets changed: before=%#v after=%#v", facetsBefore, facetsAfter)
	}
	if !reflect.DeepEqual(queryBefore, queryAfter) {
		t.Fatalf("conversation query changed: before=%#v after=%#v", queryBefore, queryAfter)
	}
}

func TestActionStatusCountsReasonsAndConversationCoverage(t *testing.T) {
	ctx := context.Background()
	tn := openT(t, Options{})
	now := float64(time.Now().Unix())
	accepted := appendAction(t, tn, "accepted", "tagged", "env", "build", "owner/repo:plan/a", "", now)
	rejected := appendAction(t, tn, "rejected", "rejected", "env", "bogus", "owner/repo:plan/a", "", now)
	for _, h := range []string{accepted, rejected} {
		if err := tn.ProjectAction(ctx, h); err != nil {
			t.Fatal(err)
		}
	}
	s, err := tn.ActionStatus(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if s["tagged"] != 1 || s["untagged"] != 1 || s["rejected:unknown_kind"] != 1 {
		t.Fatalf("action counts: %#v", s)
	}
}
