package serve

import (
	"encoding/base64"
	"encoding/json"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestAnalyticsActivityMergesAndPagesEqualTimeRows(t *testing.T) {
	s, ts := queryTenant(t)
	at := float64(time.Now().UTC().Unix())
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "session-1", Harness: "h", Event: "commit", TS: at}, nil)
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "session-1", Harness: "h", Event: "artifact", TS: at, RepoID: "r", Path: "docs/plans/p/briefs/a.md"}, nil)
	path := "/v1/analytics/activity?from=2026-11-08T00:00:00Z&to=2026-11-09T00:00:00Z&limit=1"
	seen := map[string]bool{}
	for pages := 0; pages < 5; pages++ {
		code, body := aget(t, s, path)
		if code != 200 {
			t.Fatalf("activity status=%d body=%v", code, body)
		}
		rows := rowsOf(body, "rows")
		if len(rows) != 1 {
			t.Fatalf("page %d rows=%v", pages, rows)
		}
		row := rows[0]
		id := row["type"].(string) + "/" + row["identity"].(string)
		if seen[id] {
			t.Fatalf("duplicate activity row %s", id)
		}
		seen[id] = true
		next, ok := body["next"].(string)
		if !ok {
			break
		}
		path = "/v1/analytics/activity?from=2026-11-08T00:00:00Z&to=2026-11-09T00:00:00Z&limit=1&cursor=" + next
	}
	if len(seen) != 3 {
		t.Fatalf("paged observations=%v want session start, artifact version and brief execution", seen)
	}
}

func TestAnalyticsActivityProbeCountsLateArrivalWithoutRows(t *testing.T) {
	s, ts := queryTenant(t)
	at := float64(time.Now().UTC().Unix())
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "before", Harness: "h", Event: "commit", TS: at}, nil)
	probe := func(after string) map[string]any {
		path := "/v1/analytics/activity?mode=probe&from=2026-11-08T00:00:00Z&to=2026-11-09T00:00:00Z"
		if after != "" {
			path += "&after=" + url.QueryEscape(after)
		}
		code, body := aget(t, s, path)
		if code != 200 {
			t.Fatalf("probe status=%d body=%v", code, body)
		}
		return body
	}
	first := probe("")
	mark := first["watermark"].(string)
	qadd(t, ts, store.FactRow{Type: "commit", ConversationID: "late", Harness: "h", Event: "commit", TS: at - 1}, nil)
	second := probe(mark)
	counts := second["counts"].(map[string]any)
	if counts["session_start"] != 1.0 || second["rows"] != nil {
		t.Fatalf("late probe=%v", second)
	}
	if _, err := base64.RawURLEncoding.DecodeString(mark); err != nil {
		t.Fatalf("watermark is not opaque token: %v", err)
	}
	var _ = json.Valid
	var _ = strings.Builder{}
}
