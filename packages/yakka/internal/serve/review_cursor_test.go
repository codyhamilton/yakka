package serve

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

type reviewPageResponse struct {
	Reviews    []map[string]any `json:"reviews"`
	NextCursor *string          `json:"next_cursor"`
	Complete   bool             `json:"complete"`
}

func reviewTestRow(hash, conv string, ts float64, tags []string) store.FactRow {
	obj := map[string]any{
		"repo_id": "r", "plan": "p", "kind": "phase", "status": "ok",
		"effective_effort": "high", "profile": "shadow", "manifest_hash": "mh",
		"conversation_id": conv, "ts": ts, "payload": "evidence",
	}
	if tags != nil {
		obj["tags"] = tags
	}
	raw, _ := json.Marshal(obj)
	return store.FactRow{RowHash: hash, Type: "review_run", ConversationID: conv, RepoID: "r", TS: ts, Raw: raw}
}

func seedReviewRows(t *testing.T, s *Server, tenant string, rows []store.FactRow) {
	t.Helper()
	ts, err := s.tenant(tenant)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ts.t.AppendReviewRuns(context.Background(), rows); err != nil {
		t.Fatal(err)
	}
}

func reviewPage(t *testing.T, s *Server, u, key string) reviewPageResponse {
	t.Helper()
	code, body := do(t, s.Handler(), "GET", u, key, "")
	if code != 200 {
		t.Fatalf("GET %s = %d %s", u, code, body)
	}
	var resp reviewPageResponse
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return resp
}

func reviewConvs(resp reviewPageResponse) []string {
	out := make([]string, len(resp.Reviews))
	for i, item := range resp.Reviews {
		out[i], _ = item["conversation_id"].(string)
	}
	return out
}

func TestReviewRESTCursorWalkIsFixedAndComplete(t *testing.T) {
	s, _ := newServer(t, true)
	var rowsA []store.FactRow
	for i := 0; i < 1001; i++ {
		rowsA = append(rowsA, reviewTestRow(fmt.Sprintf("a-%04d", i), fmt.Sprintf("a-conv-%04d", i), 100, nil))
	}
	seedReviewRows(t, s, "a", rowsA)
	var rowsB []store.FactRow
	for i := 0; i < 20; i++ {
		rowsB = append(rowsB, reviewTestRow(fmt.Sprintf("b-%04d", i), fmt.Sprintf("b-conv-%04d", i), 100, nil))
	}
	seedReviewRows(t, s, "b", rowsB)

	limits := []int{37, 150, 500, 10, 91, 333}
	seen := map[string]int{}
	var order []string
	cursor := ""
	appended := false
	for page := 0; ; page++ {
		if page > 30 {
			t.Fatal("walk did not terminate")
		}
		u := fmt.Sprintf("/v1/reviews?limit=%d", limits[page%len(limits)])
		if cursor != "" {
			u += "&cursor=" + url.QueryEscape(cursor)
		}
		resp := reviewPage(t, s, u, "ka")
		for _, conv := range reviewConvs(resp) {
			if strings.HasPrefix(conv, "b-conv-") {
				t.Fatalf("tenant b row %s leaked into tenant a walk", conv)
			}
			if strings.HasPrefix(conv, "late-") {
				t.Fatalf("late row %s entered the fixed walk", conv)
			}
			seen[conv]++
			if seen[conv] > 1 {
				t.Fatalf("row %s returned twice", conv)
			}
			order = append(order, conv)
		}
		if resp.Complete {
			if resp.NextCursor != nil {
				t.Fatalf("exhausted page returned cursor %q", *resp.NextCursor)
			}
			break
		}
		if resp.NextCursor == nil {
			t.Fatal("nonterminal page returned no cursor")
		}
		cursor = *resp.NextCursor
		if !appended {
			seedReviewRows(t, s, "a", []store.FactRow{
				reviewTestRow("late-1", "late-conv-1", 50, nil),
				reviewTestRow("late-2", "late-conv-2", 1, nil),
			})
			appended = true
		}
	}
	if len(seen) != 1001 {
		t.Fatalf("walk returned %d rows, want 1001", len(seen))
	}
	for i := 0; i < 1001; i++ {
		want := fmt.Sprintf("a-conv-%04d", 1000-i)
		if order[i] != want {
			t.Fatalf("order[%d] = %s, want %s", i, order[i], want)
		}
	}
}

func TestReviewRESTPageSizeDoesNotChangeSelection(t *testing.T) {
	s, _ := newServer(t, true)
	var rows []store.FactRow
	for i := 0; i < 137; i++ {
		rows = append(rows, reviewTestRow(fmt.Sprintf("r-%03d", i), fmt.Sprintf("conv-%03d", i), 100, nil))
	}
	seedReviewRows(t, s, "a", rows)

	walk := func(pageSize int) []string {
		var got []string
		cursor := ""
		for page := 0; ; page++ {
			if page > 200 {
				t.Fatal("walk did not terminate")
			}
			u := fmt.Sprintf("/v1/reviews?limit=%d", pageSize)
			if cursor != "" {
				u += "&cursor=" + url.QueryEscape(cursor)
			}
			resp := reviewPage(t, s, u, "ka")
			got = append(got, reviewConvs(resp)...)
			if resp.Complete {
				return got
			}
			cursor = *resp.NextCursor
		}
	}
	small := walk(13)
	large := walk(97)
	if !reflect.DeepEqual(small, large) {
		t.Fatalf("page size changed selection:\nsmall=%v\nlarge=%v", small, large)
	}

	first := reviewPage(t, s, "/v1/reviews?limit=13", "ka")
	cur := url.QueryEscape(*first.NextCursor)
	p20 := reviewConvs(reviewPage(t, s, "/v1/reviews?limit=20&cursor="+cur, "ka"))
	p80 := reviewConvs(reviewPage(t, s, "/v1/reviews?limit=80&cursor="+cur, "ka"))
	if len(p20) != 20 || len(p80) < 20 || !reflect.DeepEqual(p20, p80[:20]) {
		t.Fatalf("same cursor selected different rows across page sizes: %v vs %v", p20, p80)
	}
}

func TestReviewRESTTagFiltersConjunctive(t *testing.T) {
	s, _ := newServer(t, true)
	seedReviewRows(t, s, "a", []store.FactRow{
		reviewTestRow("t1", "conv-ab", 10, []string{"a", "b"}),
		reviewTestRow("t2", "conv-a", 20, []string{"a"}),
		reviewTestRow("t3", "conv-bc", 30, []string{"b", "c"}),
		reviewTestRow("t4", "conv-untagged", 40, nil),
		reviewTestRow("t5", "conv-empty", 50, []string{}),
	})

	if got := reviewConvs(reviewPage(t, s, "/v1/reviews", "ka")); len(got) != 5 {
		t.Fatalf("empty filter = %v, want all 5 including untagged", got)
	}
	if got := reviewConvs(reviewPage(t, s, "/v1/reviews?tag=a&tag=b", "ka")); len(got) != 1 || got[0] != "conv-ab" {
		t.Fatalf("tags a AND b = %v, want [conv-ab]", got)
	}
	if got := reviewConvs(reviewPage(t, s, "/v1/reviews?tag=a", "ka")); len(got) != 2 || got[0] != "conv-a" || got[1] != "conv-ab" {
		t.Fatalf("tag a = %v, want [conv-a conv-ab] and no untagged row", got)
	}
	for _, bad := range []string{"-bad", "bad tag", strings.Repeat("x", 97)} {
		code, body := do(t, s.Handler(), "GET", "/v1/reviews?tag="+url.QueryEscape(bad), "ka", "")
		if code != 400 {
			t.Fatalf("tag %q = %d %s, want 400", bad, code, body)
		}
	}
}

func TestReviewRESTCursorRejectsMismatch(t *testing.T) {
	s, _ := newServer(t, true)
	for i := 0; i < 3; i++ {
		seedReviewRows(t, s, "a", []store.FactRow{reviewTestRow(fmt.Sprintf("a%d", i), fmt.Sprintf("a-conv-%d", i), 10, nil)})
		seedReviewRows(t, s, "b", []store.FactRow{reviewTestRow(fmt.Sprintf("b%d", i), fmt.Sprintf("b-conv-%d", i), 10, nil)})
	}
	want400 := func(u, key string) {
		t.Helper()
		code, body := do(t, s.Handler(), "GET", u, key, "")
		if code != 400 {
			t.Fatalf("GET %s = %d %s, want 400", u, code, body)
		}
		for _, leak := range []string{"a-conv-", "b-conv-"} {
			if strings.Contains(body, leak) {
				t.Fatalf("rejected cursor leaked rows: %s", body)
			}
		}
	}

	want400("/v1/reviews?cursor=not-a-cursor", "ka")

	foreign := reviewPage(t, s, "/v1/reviews?limit=1", "kb")
	want400("/v1/reviews?limit=1&cursor="+url.QueryEscape(*foreign.NextCursor), "ka")

	own := reviewPage(t, s, "/v1/reviews?limit=1", "ka")
	want400("/v1/reviews?limit=1&repo_id=other&cursor="+url.QueryEscape(*own.NextCursor), "ka")
	want400("/v1/reviews?limit=1&detail=full&cursor="+url.QueryEscape(*own.NextCursor), "ka")

	unsupported, err := encodeReviewCursor(reviewCursorPayload{
		Version: reviewCursorVersion + 1, Tenant: "a", Route: reviewCursorRoute,
		Filters: reviewCursorFilter{}, HighWater: 3, LastTS: 10, LastID: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	want400("/v1/reviews?limit=1&cursor="+url.QueryEscape(unsupported), "ka")
}

func TestReviewRESTCompletionMetadata(t *testing.T) {
	s, _ := newServer(t, true)
	var rows []store.FactRow
	for i := 0; i < 200; i++ {
		rows = append(rows, reviewTestRow(fmt.Sprintf("e-%03d", i), fmt.Sprintf("e-conv-%03d", i), 100, nil))
	}
	seedReviewRows(t, s, "a", rows)

	first := reviewPage(t, s, "/v1/reviews?limit=100", "ka")
	if first.Complete || first.NextCursor == nil || len(first.Reviews) != 100 {
		t.Fatalf("partial page complete=%v cursor=%v rows=%d", first.Complete, first.NextCursor, len(first.Reviews))
	}
	second := reviewPage(t, s, "/v1/reviews?limit=100&cursor="+url.QueryEscape(*first.NextCursor), "ka")
	if !second.Complete || second.NextCursor != nil || len(second.Reviews) != 100 {
		t.Fatalf("exact-multiple last page complete=%v cursor=%v rows=%d", second.Complete, second.NextCursor, len(second.Reviews))
	}
	exact := reviewPage(t, s, "/v1/reviews?limit=200", "ka")
	if !exact.Complete || exact.NextCursor != nil || len(exact.Reviews) != 200 {
		t.Fatalf("exact-multiple single page complete=%v cursor=%v rows=%d", exact.Complete, exact.NextCursor, len(exact.Reviews))
	}
	empty := reviewPage(t, s, "/v1/reviews", "kb")
	if !empty.Complete || empty.NextCursor != nil || len(empty.Reviews) != 0 {
		t.Fatalf("empty population complete=%v cursor=%v rows=%d", empty.Complete, empty.NextCursor, len(empty.Reviews))
	}
}

func TestReviewRESTCorruptRowFailsPage(t *testing.T) {
	s, _ := newServer(t, true)
	seedReviewRows(t, s, "a", []store.FactRow{
		reviewTestRow("ok", "conv-ok", 100, nil),
		{RowHash: "corrupt", Type: "review_run", ConversationID: "conv-corrupt", RepoID: "r", TS: 100, Raw: []byte("{not json")},
	})
	code, body := do(t, s.Handler(), "GET", "/v1/reviews", "ka", "")
	if code != 500 {
		t.Fatalf("corrupt row page = %d %s, want 500", code, body)
	}
	if strings.Contains(body, "conv-ok") {
		t.Fatalf("corrupt page leaked rows: %s", body)
	}
}
