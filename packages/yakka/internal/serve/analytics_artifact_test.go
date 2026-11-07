package serve

import (
	"net/url"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func TestArtifactEntitiesAndDetailUseCanonicalVersionWriter(t *testing.T) {
	s, ts := queryTenant(t)
	now := time.Now().UTC().Truncate(time.Second)
	hash := keys.ContentHash([]byte("artifact"))
	add := func(id, conv string, at time.Time) {
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: conv, Harness: "h", RepoID: "repo", Path: "docs/plans/p/DESIGN.md", ContentHash: hash, TS: float64(at.Unix())}, fx{"content_hash": hash, "source": "worktree", "sha": "sha"})
	}
	add("first", "writer", now.Add(-time.Hour))
	add("later", "resaver", now.Add(-time.Minute))
	if err := ts.t.WritePending(hash, []byte("artifact")); err != nil {
		t.Fatal(err)
	}
	if err := ts.t.Promote(t.Context(), hash, store.Screen{Verdict: "pass", Scorer: "screen-v1"}); err != nil {
		t.Fatal(err)
	}
	if err := ts.t.AppendScores(t.Context(), hash, []store.Score{{Check: "quality", Result: .75, Scorer: "score-v1"}}); err != nil {
		t.Fatal(err)
	}
	list := aok(t, s, "/v1/analytics/entities?grain=artifact&from="+url.QueryEscape(now.Add(-2*time.Hour).Format(time.RFC3339))+"&to="+url.QueryEscape(now.Format(time.RFC3339)))
	rows := rowsOf(list, "rows")
	if len(rows) != 1 {
		t.Fatalf("artifact list rows=%v", rows)
	}
	agg := aok(t, s, "/v1/analytics/entities?grain=artifact&mode=aggregate&stat=count&from="+url.QueryEscape(now.Add(-2*time.Hour).Format(time.RFC3339))+"&to="+url.QueryEscape(now.Format(time.RFC3339)))
	if agg["value"] != float64(1) {
		t.Fatalf("artifact aggregate=%v", agg)
	}
	scatter := aok(t, s, "/v1/analytics/entities?grain=artifact&mode=scatter&fields=versions,last_ts&from="+url.QueryEscape(now.Add(-2*time.Hour).Format(time.RFC3339))+"&to="+url.QueryEscape(now.Format(time.RFC3339)))
	if len(rowsOf(scatter, "rows")) != 1 || scatter["sampled"] != false {
		t.Fatalf("artifact scatter=%v", scatter)
	}
	detail := aok(t, s, "/v1/analytics/entity?grain=artifact&repo_id=repo&path="+url.QueryEscape("docs/plans/p/DESIGN.md")+"&limit=10")
	versions := rowsOf(detail, "rows")
	if len(versions) != 1 {
		t.Fatalf("version rows=%v", versions)
	}
	if versions[0]["writing_session"] != "writer" || versions[0]["also_seen_sessions"] != float64(1) {
		t.Fatalf("version provenance=%v", versions[0])
	}
	scores := versions[0]["scores"].(map[string]any)
	if scores["quality"].(map[string]any)["scorer"] != "score-v1" {
		t.Fatalf("scores=%v", scores)
	}
}
