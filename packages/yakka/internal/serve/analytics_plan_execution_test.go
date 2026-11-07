package serve

import (
	"net/url"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func TestAnalyticsPlanEntitiesExposeScopedIdentityAndDetails(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC().Truncate(time.Second)
	add := func(conv, path string, at time.Time, extra fx) {
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: conv, Harness: "h", RepoID: "repo", Path: path, ContentHash: keys.ContentHash([]byte(path + conv)), TS: float64(at.Unix())}, extra)
	}
	add("shared", "docs/plans/p/DESIGN.md", now.Add(-time.Minute), nil)
	add("shared", "docs/plans/q/DESIGN.md", now.Add(-30*time.Second), nil)
	add("outside", "docs/plans/p/reports/b.md", now.Add(-24*time.Hour), nil)
	qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "shared", Harness: "missing-price-provider", NormEvent: "usage", Event: "usage", TS: float64(now.Add(-time.Second).Unix()), TokIn: 50}, nil)
	base := "/v1/analytics/entities?grain=plan&from=" + url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339)) + "&to=" + url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339))
	page := aok(t, s, base+"&limit=1")
	rows := rowsOf(page, "rows")
	if len(rows) != 1 || rows[0]["id"].(map[string]any)["repo_id"] != "repo" {
		t.Fatalf("plan page=%v", page)
	}
	if _, ok := page["next"].(string); !ok {
		t.Fatalf("missing plan cursor: %v", page)
	}
	if rows[0]["m"].(map[string]any)["shared_sessions"] != float64(1) {
		t.Fatalf("shared-session overlap missing: %v", rows[0])
	}
	if _, ok := rows[0]["m"].(map[string]any)["artifacts_by_kind"]; !ok {
		t.Fatalf("plan artifact-kind counts missing: %v", rows[0])
	}
	if _, ok := rows[0]["l"].(map[string]any)["harness"]; !ok {
		t.Fatalf("plan harness lens missing: %v", rows[0])
	}
	if rows[0]["m"].(map[string]any)["unpriced_calls"] != float64(1) || rows[0]["m"].(map[string]any)["associated_cost_usd"] != nil || rows[0]["flags"].(map[string]any)["associated_cost_lower_bound"] != true {
		t.Fatalf("missing-pricing semantics=%v", rows[0])
	}
	detail := aok(t, s, "/v1/analytics/entity?grain=plan&repo_id=repo&plan=p&collection=sessions&limit=1&from="+url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339))+"&to="+url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339)))
	if detail["collection"] != "sessions" || len(rowsOf(detail, "rows")) != 1 {
		t.Fatalf("plan detail=%v", detail)
	}
	if detail["population"].(map[string]any)["scope_n"] != float64(1) {
		t.Fatalf("plan session population=%v", detail)
	}
}

func TestAnalyticsExecutionEntitiesUseProcessShapeAndIdentityTie(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC().Truncate(time.Second)
	for _, p := range []string{"a.md", "b.md"} {
		hash := keys.ContentHash([]byte(p))
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "same", Harness: "h", RepoID: "repo", Path: "docs/plans/p/briefs/" + p, ContentHash: hash, TS: float64(now.Unix())}, fx{"content_hash": hash})
	}
	base := "/v1/analytics/entities?grain=execution&from=" + url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339)) + "&to=" + url.QueryEscape(now.Add(time.Hour).Format(time.RFC3339))
	first := aok(t, s, base+"&limit=1")
	rows := rowsOf(first, "rows")
	if len(rows) != 1 || rows[0]["l"].(map[string]any)["shape"] != "started" {
		t.Fatalf("execution rows=%v", first)
	}
	if _, ok := rows[0]["l"].(map[string]any)["session_model"]; !ok {
		t.Fatalf("execution session-model lens missing: %v", rows[0])
	}
	next := first["next"].(string)
	second := aok(t, s, base+"&limit=1&cursor="+url.QueryEscape(next))
	if len(rowsOf(second, "rows")) != 1 {
		t.Fatalf("execution cursor=%v", second)
	}
}
