package serve

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func TestMCPListReviewsDeclarationAndReadScope(t *testing.T) {
	gh := mockGitHub(t, 91, "list-review-reader", []mockEmail{{Email: "reader@example.com", Verified: true}})
	defer gh.Close()
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	if err := s.RegisterListReviewsMCPTool(); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tenant := remoteCreateTenant(t, h, origin, sess, "review-reader")
	_, readKey := remoteIssueToken(t, h, origin, sess, tenant, TokenScopeRead, "1d")

	var golden struct {
		Tools []map[string]any `json:"tools"`
	}
	raw, err := os.ReadFile("testdata/mcp-golden/list-reviews.json")
	if err != nil || json.Unmarshal(raw, &golden) != nil || len(golden.Tools) != 1 {
		t.Fatalf("read MCP list_reviews golden: %v", err)
	}
	listed := mcpDecode(t, mcpRequest(t, h, readKey, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`, nil))["result"].(map[string]any)["tools"].([]any)
	if len(listed) != 1 {
		t.Fatalf("read token tools: %#v", listed)
	}
	got := listed[0].(map[string]any)
	for _, field := range []string{"name", "description", "inputSchema", "annotations", "_meta"} {
		if !reflect.DeepEqual(got[field], golden.Tools[0][field]) {
			t.Errorf("list_reviews %s differs\ngot: %#v\nwant: %#v", field, got[field], golden.Tools[0][field])
		}
	}
	if got["name"] != "list_reviews" || got["annotations"].(map[string]any)["readOnlyHint"] != true {
		t.Fatalf("read-only declaration: %#v", got)
	}
	meta := got["_meta"].(map[string]any)["yakka/tool"].(map[string]any)
	if meta["scope"] != TokenScopeRead || len(meta["context"].([]any)) != 0 {
		t.Fatalf("list_reviews declaration metadata: %#v", meta)
	}
	registered := s.mcpTool("list_reviews")
	if registered == nil || len(registered.Context) != 0 || len(registered.LocalActions) != 0 {
		t.Fatalf("tool registered with local capabilities: %#v", registered)
	}
	result := mcpCallResult(t, mcpRequest(t, h, readKey, mcpCallBody("list_reviews", map[string]any{}), nil))
	if result["isError"] == true {
		t.Fatalf("read token could not call list_reviews: %#v", result)
	}
	var page reviewPageResponse
	b, _ := json.Marshal(result)
	if err := json.Unmarshal(b, &page); err != nil || !page.Complete || len(page.Reviews) != 0 || page.NextCursor != nil {
		t.Fatalf("empty read result=%s err=%v", b, err)
	}
}

func TestMCPListReviewsMatchesRESTAcrossCompleteWalk(t *testing.T) {
	s, _ := newServer(t, true)
	if err := s.RegisterListReviewsMCPTool(); err != nil {
		t.Fatal(err)
	}
	var rows []store.FactRow
	for i := 0; i < 1101; i++ {
		rows = append(rows, listReviewFixture(fmt.Sprintf("a-%04d", i), fmt.Sprintf("a-conv-%04d", i), 100, []string{"tag:a", "tag:b"}))
	}
	seedReviewRows(t, s, "a", rows)
	seedReviewRows(t, s, "b", []store.FactRow{listReviewFixture("b-1", "b-only", 100, []string{"tag:a", "tag:b"})})

	filters := url.Values{}
	filters.Set("repo_id", "r")
	filters.Set("plan", "p")
	filters.Set("phase", "2")
	filters.Set("kind", "phase")
	filters.Set("status", "ok")
	filters.Set("effort", "high")
	filters.Set("profile", "shadow")
	filters.Set("manifest_hash", "mh")
	filters.Set("since", "50")
	filters.Add("tag", "tag:a")
	filters.Add("tag", "tag:b")
	tags := []any{"tag:a", "tag:b"}
	limits := []int{37, 150, 333, 500}
	type walkState struct {
		detail     string
		restCursor string
		mcpCursor  string
		seen       int
		pages      int
		complete   bool
	}
	walks := []*walkState{{}, {detail: "full"}}
	fetch := func(walk *walkState) {
		t.Helper()
		limit := limits[walk.pages%len(limits)]
		q := cloneValues(filters)
		q.Set("limit", fmt.Sprint(limit))
		args := map[string]any{
			"repo_id": "r", "plan": "p", "phase": 2, "kind": "phase", "status": "ok",
			"effort": "high", "profile": "shadow", "manifest_hash": "mh", "since": 50,
			"tags": tags, "limit": limit,
		}
		if walk.detail == "full" {
			q.Set("detail", "full")
			args["detail"] = "full"
		}
		if walk.restCursor != "" {
			q.Set("cursor", walk.restCursor)
			args["cursor"] = walk.mcpCursor
		}
		rest := reviewPage(t, s, "/v1/reviews?"+q.Encode(), "ka")
		mcpResult := mcpCallResult(t, mcpRequest(t, s.Handler(), "ka", mcpCallBody("list_reviews", args), nil))
		var mcp reviewPageResponse
		b, _ := json.Marshal(mcpResult)
		if err := json.Unmarshal(b, &mcp); err != nil {
			t.Fatalf("decode MCP page %s: %v", b, err)
		}
		if !reflect.DeepEqual(rest, mcp) {
			t.Fatalf("detail=%q page=%d REST/MCP differ\nREST: %#v\nMCP:  %#v", walk.detail, walk.pages, rest, mcp)
		}
		for _, item := range mcp.Reviews {
			_, hasPayload := item["payload"]
			if hasPayload != (walk.detail == "full") {
				t.Fatalf("detail=%q payload presence=%v", walk.detail, hasPayload)
			}
		}
		walk.seen += len(mcp.Reviews)
		walk.pages++
		walk.complete = mcp.Complete
		if mcp.Complete {
			if mcp.NextCursor != nil {
				t.Fatalf("terminal page returned cursor: %#v", mcp.NextCursor)
			}
			return
		}
		if rest.NextCursor == nil || mcp.NextCursor == nil {
			t.Fatalf("detail=%q page=%d nonterminal response omitted cursor", walk.detail, walk.pages-1)
		}
		walk.restCursor, walk.mcpCursor = *rest.NextCursor, *mcp.NextCursor
	}
	// Start both detail modes before inserting backdated rows so each cursor is
	// fixed to the same high-water. Neither walk may see the later appends.
	fetch(walks[0])
	fetch(walks[1])
	seedReviewRows(t, s, "a", []store.FactRow{
		listReviewFixture("late-1", "late-conv-1", 50, []string{"tag:a", "tag:b"}),
		listReviewFixture("late-2", "late-conv-2", 1, []string{"tag:a", "tag:b"}),
	})
	for _, walk := range walks {
		for !walk.complete {
			fetch(walk)
			if walk.pages > 30 {
				t.Fatal("review walk did not terminate")
			}
		}
		if walk.seen != 1101 {
			t.Fatalf("detail=%q walk returned %d rows, want 1101 originals", walk.detail, walk.seen)
		}
	}
}

func TestMCPListReviewsRejectsInvalidAndForeignCursors(t *testing.T) {
	s, _ := newServer(t, true)
	if err := s.RegisterListReviewsMCPTool(); err != nil {
		t.Fatal(err)
	}
	seedReviewRows(t, s, "a", []store.FactRow{
		listReviewFixture("one", "conv-one", 100, nil),
		listReviewFixture("two", "conv-two", 100, nil),
	})
	for name, args := range map[string]map[string]any{
		"too many tags":    {"tags": []any{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q"}},
		"bad charset":      {"tags": []any{"bad tag"}},
		"overlength":       {"tags": []any{strings.Repeat("a", 97)}},
		"malformed cursor": {"cursor": "not-a-cursor"},
	} {
		t.Run(name, func(t *testing.T) {
			result := mcpCallResult(t, mcpRequest(t, s.Handler(), "ka", mcpCallBody("list_reviews", args), nil))
			if result["isError"] != true || len(result["content"].([]any)) == 0 {
				t.Fatalf("invalid arguments accepted: %#v", result)
			}
		})
	}
	first := mcpCallResult(t, mcpRequest(t, s.Handler(), "ka", mcpCallBody("list_reviews", map[string]any{"limit": 1}), nil))
	var page reviewPageResponse
	b, _ := json.Marshal(first)
	if err := json.Unmarshal(b, &page); err != nil || page.NextCursor == nil {
		t.Fatalf("first page=%s err=%v", b, err)
	}
	foreign := mcpCallResult(t, mcpRequest(t, s.Handler(), "kb", mcpCallBody("list_reviews", map[string]any{"limit": 1, "cursor": *page.NextCursor}), nil))
	if foreign["isError"] != true || len(foreign["content"].([]any)) == 0 {
		t.Fatalf("cross-tenant cursor was not rejected: %#v", foreign)
	}
}

func TestMCPListReviewsCursorInvalidAfterReset(t *testing.T) {
	gh := mockGitHub(t, 402, "mcp-cursor-reset", []mockEmail{{Email: "mcp-cursor@example.com", Verified: true}})
	t.Cleanup(gh.Close)
	s := remoteTestConfig(t, t.TempDir(), gh.URL)
	if err := s.RegisterListReviewsMCPTool(); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	origin := "https://collector.example"
	sess := loginRemote(t, h, origin)
	tenant := remoteCreateTenant(t, h, origin, sess, "walk")
	_, key := remoteIssueToken(t, h, origin, sess, tenant, TokenScopeRead, "1d")
	seedReviewRows(t, s, tenant, []store.FactRow{
		listReviewFixture("r1", "conv-1", 100, nil),
		listReviewFixture("r2", "conv-2", 100, nil),
	})

	firstResult := mcpCallResult(t, mcpRequest(t, h, key, mcpCallBody("list_reviews", map[string]any{"limit": 1}), nil))
	var first reviewPageResponse
	b, _ := json.Marshal(firstResult)
	if err := json.Unmarshal(b, &first); err != nil || first.Complete || first.NextCursor == nil {
		t.Fatalf("first MCP page=%s err=%v", b, err)
	}
	stale := *first.NextCursor

	if err := s.ResetTenant(context.Background(), 402, tenant); err != nil {
		t.Fatalf("reset: %v", err)
	}
	_, freshKey := remoteIssueToken(t, h, origin, sess, tenant, TokenScopeRead, "1d")

	staleResult := mcpCallResult(t, mcpRequest(t, h, freshKey, mcpCallBody("list_reviews", map[string]any{"limit": 1, "cursor": stale}), nil))
	if staleResult["isError"] != true || len(staleResult["content"].([]any)) == 0 {
		t.Fatalf("stale MCP cursor after reset accepted: %#v", staleResult)
	}

	freshResult := mcpCallResult(t, mcpRequest(t, h, freshKey, mcpCallBody("list_reviews", map[string]any{"limit": 1}), nil))
	var fresh reviewPageResponse
	fb, _ := json.Marshal(freshResult)
	if err := json.Unmarshal(fb, &fresh); err != nil || !fresh.Complete || fresh.NextCursor != nil || len(fresh.Reviews) != 0 {
		t.Fatalf("fresh MCP walk after reset=%s err=%v", fb, err)
	}
}

func listReviewFixture(hash, conv string, ts float64, tags []string) store.FactRow {
	obj := map[string]any{
		"repo_id": "r", "plan": "p", "phase": 2, "kind": "phase", "status": "ok",
		"effective_effort": "high", "profile": "shadow", "manifest_hash": "mh",
		"conversation_id": conv, "ts": ts, "payload": map[string]any{"evidence": conv},
	}
	if tags != nil {
		obj["tags"] = tags
	}
	raw, _ := json.Marshal(obj)
	return store.FactRow{RowHash: hash, Type: "review_run", ConversationID: conv, RepoID: "r", TS: ts, Raw: raw}
}

func mcpCallResult(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	return mcpDecode(t, rec)["result"].(map[string]any)
}

func cloneValues(values url.Values) url.Values {
	clone := url.Values{}
	for key, vals := range values {
		clone[key] = append([]string(nil), vals...)
	}
	return clone
}
