package serve

import (
	"context"
	"errors"
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

func TestArtifactPopulationGroupingPredicatesAndCoverage(t *testing.T) {
	s, ts := queryTenant(t)
	at := time.Now().UTC().Truncate(time.Second)
	for i, repo := range []string{"a", "b", "c"} {
		hash := keys.ContentHash([]byte(repo))
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: repo, Harness: "h", RepoID: repo, Path: "docs/plans/p/DESIGN.md", ContentHash: hash, TS: float64(at.Unix())}, fx{"content_hash": hash, "source": "worktree"})
		if i < 2 {
			if err := ts.t.AppendScores(t.Context(), hash, []store.Score{{Check: "quality", Result: float64(i+1) / 4, Scorer: "v1"}}); err != nil {
				t.Fatal(err)
			}
		}
	}
	base := "/v1/analytics/entities?grain=artifact&all=1"
	code, budget := aget(t, s, base+"&mode=aggregate&stat=count&dim=repo_id&max_cells=2")
	if code != 400 || budget["code"] != "too_many_cells" {
		t.Fatalf("budget=%d %v", code, budget)
	}
	grouped := aok(t, s, base+"&mode=aggregate&stat=count&dim=repo_id&dim=kind")
	if len(rowsOf(grouped, "groups")) != 3 {
		t.Fatalf("groups=%v", grouped)
	}
	filtered := aok(t, s, base+"&where="+url.QueryEscape("score:quality:0.4..1"))
	if len(rowsOf(filtered, "rows")) != 1 {
		t.Fatalf("where=%v", filtered)
	}
	pred := `{"or":[{"is_null":{"measure":"score:quality"}},{"range":{"measure":"score:quality","lo":0.4,"hi":1}}]}`
	filtered = aok(t, s, base+"&predicate="+url.QueryEscape(pred)+"&exclude=repo_id:c")
	if len(rowsOf(filtered, "rows")) != 1 {
		t.Fatalf("predicate/exclusion=%v", filtered)
	}
	list := aok(t, s, base+"&limit=1&fields=score:quality,content_bytes")
	populations := list["populations"].(map[string]any)
	score := populations["score:quality"].(map[string]any)
	if score["scope_n"] != float64(3) || score["eligible_n"] != float64(2) || score["missing_by_reason"].(map[string]any)["unscored"] != float64(1) {
		t.Fatalf("score coverage=%v", score)
	}
	content := populations["content_bytes"].(map[string]any)
	if content["missing_by_reason"].(map[string]any)["content_unavailable"] != float64(3) {
		t.Fatalf("content coverage=%v", content)
	}
}

func TestArtifactPredicateGrammarAndBudgets(t *testing.T) {
	row := artifactPopulationRow{measures: map[string]any{"versions": float64(2), "score:quality": nil}, lenses: map[string]any{"repo_id": "repo"}}
	for _, raw := range []string{
		`{"and":[{"in":{"lens":"repo_id","values":["repo"]}},{"not":{"range":{"measure":"versions","lo":3,"hi":null}}}]}`,
		`{"or":[{"range":{"measure":"score:quality","lo":0,"hi":1}},{"is_null":{"measure":"score:quality"}}]}`,
	} {
		leaves := 0
		p, err := parseArtifactPredicate([]byte(raw), 1, &leaves)
		if err != nil || !p(row) {
			t.Fatalf("predicate %s: %v", raw, err)
		}
	}
	for _, raw := range []string{`{"range":{"measure":"unknown","lo":0,"hi":1}}`, `{"in":{"lens":"unknown","values":["x"]}}`, `{"and":[],"or":[]}`, `{"is_null":{"measure":"versions","extra":1}}`, `{"range":{"measure":"versions","lo":5,"hi":1}}`} {
		leaves := 0
		if _, err := parseArtifactPredicate([]byte(raw), 1, &leaves); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	nested := `{"is_null":{"measure":"versions"}}`
	for i := 0; i < 8; i++ {
		nested = `{"not":` + nested + `}`
	}
	leaves := 0
	if _, err := parseArtifactPredicate([]byte(nested), 1, &leaves); err == nil {
		t.Fatal("accepted over-depth predicate")
	}
}

func TestArtifactCursorBindsPredicateAndPagesNullScores(t *testing.T) {
	s, ts := queryTenant(t)
	at := time.Now().UTC()
	for i, repo := range []string{"a", "b", "c"} {
		hash := keys.ContentHash([]byte(repo))
		qadd(t, ts, store.FactRow{Type: "artifact_version", RepoID: repo, Path: "docs/plans/p/DESIGN.md", ContentHash: hash, TS: float64(at.Unix())}, fx{"content_hash": hash})
		if i == 0 {
			if err := ts.t.AppendScores(t.Context(), hash, []store.Score{{Check: "quality", Result: .5, Scorer: "v1"}}); err != nil {
				t.Fatal(err)
			}
		}
	}
	base := "/v1/analytics/entities?grain=artifact&all=1&limit=1&sort=score:quality:desc"
	next := ""
	seen := map[string]bool{}
	for i := 0; i < 3; i++ {
		path := base
		if next != "" {
			path += "&cursor=" + url.QueryEscape(next)
		}
		out := aok(t, s, path)
		rows := rowsOf(out, "rows")
		if len(rows) != 1 {
			t.Fatalf("page=%v", out)
		}
		repo := rows[0]["id"].(map[string]any)["repo_id"].(string)
		if seen[repo] {
			t.Fatalf("duplicate %s", repo)
		}
		seen[repo] = true
		next, _ = out["next"].(string)
	}
	if next != "" || len(seen) != 3 {
		t.Fatalf("paging seen=%v next=%q", seen, next)
	}
}

func TestArtifactPopulationCancellation(t *testing.T) {
	_, ts := queryTenant(t)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err := artifactPopulation(ctx, ts.t, store.AnalyticsFilter{From: time.Unix(0, 0), To: time.Now()})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled scan: %v", err)
	}
}
