package serve

import (
	"context"
	"errors"
	"fmt"
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

func TestArtifactSchemaBandsAndWriterMeasures(t *testing.T) {
	s, ts := queryTenant(t)
	at := time.Date(2026, 11, 8, 1, 0, 0, 0, time.UTC)
	// Five distinct contents give exact p25=.25 and p75=.75; another path
	// sharing the low hash must not move either boundary.
	for i, value := range []float64{0, .25, .5, .75, 1} {
		repo := fmt.Sprintf("r%d", i)
		hash := keys.ContentHash([]byte(repo))
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: repo, Harness: "h", RepoID: repo, Path: "docs/plans/p/DESIGN.md", ContentHash: hash, TS: float64(at.Unix())}, fx{"content_hash": hash})
		if err := ts.t.AppendScores(t.Context(), hash, []store.Score{{Check: "quality", Result: value, Scorer: "current"}, {Check: "other", Result: value, Scorer: "other-scorer"}}); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: repo, Harness: "h", RepoID: "duplicate", Path: "docs/plans/p/DESIGN.md", ContentHash: hash, TS: float64(at.Unix())}, fx{"content_hash": hash})
		}
	}
	// A sixth current-scorer observation will replace the .5 removed by the
	// rescore below, keeping the current baseline quartiles exactly .25/.75.
	extraHash := keys.ContentHash([]byte("extra"))
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "extra", RepoID: "extra", Path: "docs/plans/p/DESIGN.md", ContentHash: extraHash, TS: float64(at.Unix())}, fx{"content_hash": extraHash})
	if err := ts.t.AppendScores(t.Context(), extraHash, []store.Score{{Check: "quality", Result: .5, Scorer: "current"}}); err != nil {
		t.Fatal(err)
	}
	// The original score on r2 must not survive the latest scorer selection.
	hash := keys.ContentHash([]byte("r2"))
	if err := ts.t.AppendScores(t.Context(), hash, []store.Score{{Check: "quality", Result: .5, Scorer: "new"}}); err != nil {
		t.Fatal(err)
	}
	hash = keys.ContentHash([]byte("unscored"))
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "unscored", RepoID: "unscored", Path: "docs/plans/p/DESIGN.md", ContentHash: hash, TS: float64(at.Unix())}, fx{"content_hash": hash})
	// Unrecognised artifact kinds have no comparative baseline, even if scored.
	hash = keys.ContentHash([]byte("unknown-kind"))
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "unknown", RepoID: "unknown", Path: "README.md", ContentHash: hash, TS: float64(at.Unix())}, fx{"content_hash": hash})
	if err := ts.t.AppendScores(t.Context(), hash, []store.Score{{Check: "quality", Result: .5, Scorer: "current"}}); err != nil {
		t.Fatal(err)
	}
	// r0: no calls; r1: all unpriced; r2: partial; r3: priced calls outside
	// the board window. Usage facts have no repo, and remain joined by session.
	cost := 2.0
	usage := func(id string, delta time.Duration, reported *float64) {
		qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: id, Harness: "h", NormEvent: "usage", Model: "unpriced-model", TokIn: 10, TokOut: 20, TokCacheRead: 30, TokCacheWrite: 40, TokReasoning: 50, CostReported: reported, TS: float64(at.Add(delta).Unix())}, fx{"tag": fmt.Sprintf("%s-%v-%v", id, delta, reported)})
	}
	usage("r1", 0, nil)
	usage("r2", 0, &cost)
	usage("r2", time.Minute, nil)
	usage("r3", -2*time.Hour, &cost)
	base := "/v1/analytics/entities?grain=artifact&check=quality&from=" + url.QueryEscape(at.Add(-time.Hour).Format(time.RFC3339)) + "&to=" + url.QueryEscape(at.Add(time.Hour).Format(time.RFC3339))
	out := aok(t, s, base+"&fields=score:quality,writing_session_cost_usd,writing_session_model_calls")
	rows := map[string]map[string]any{}
	for _, row := range rowsOf(out, "rows") {
		rows[row["id"].(map[string]any)["repo_id"].(string)] = row
	}
	for repo, band := range map[string]string{"r0": "low", "r1": "mid", "r2": "mid", "r3": "mid", "r4": "high", "unscored": "unscored", "unknown": "baseline_unavailable"} {
		if rows[repo]["l"].(map[string]any)["band:quality"] != band {
			t.Errorf("%s band=%v, want %s", repo, rows[repo], band)
		}
	}
	if rows["r2"]["m"].(map[string]any)["score_scorer:other"] != "other-scorer" {
		t.Errorf("per-check scorer lost: %v", rows["r2"])
	}
	if rows["r2"]["l"].(map[string]any)["scorer"] != "new" {
		t.Errorf("latest scorer: %v", rows["r2"])
	}
	for repo, want := range map[string]any{"r0": float64(0), "r1": nil, "r2": cost, "r3": float64(0)} {
		m := rows[repo]["m"].(map[string]any)
		if m["writing_session_cost_usd"] != want {
			t.Errorf("%s cost=%v want %v", repo, m, want)
		}
	}
	partial := rows["r2"]
	m := partial["m"].(map[string]any)
	for field, want := range map[string]float64{"model_calls": 2, "tokens_in": 20, "tokens_out": 40, "tokens_cache_read": 60, "tokens_cache_write": 80, "tokens_reasoning": 100, "hook_events": 2} {
		if m["writing_session_"+field] != want {
			t.Errorf("writer %s=%v want %v", field, m, want)
		}
	}
	if partial["flags"].(map[string]any)["writing_session_cost_lower_bound"] != true {
		t.Errorf("partial flags=%v", partial)
	}
	if rows["r1"]["flags"].(map[string]any)["null_reasons"].(map[string]any)["writing_session_cost_usd"] != "all_unpriced" {
		t.Errorf("unpriced null reason=%v", rows["r1"])
	}
	coverage := out["populations"].(map[string]any)["writing_session_cost_usd"].(map[string]any)
	if coverage["lower_bound_n"] != float64(1) || coverage["unpriced_n"] != float64(2) || coverage["missing_by_reason"].(map[string]any)["all_unpriced"] != float64(1) {
		t.Errorf("cost coverage=%v", coverage)
	}
	scatter := aok(t, s, base+"&mode=scatter&fields=writing_session_cost_usd,versions")
	if scatter["population"].(map[string]any)["missing_by_reason"].(map[string]any)["all_unpriced"] != float64(1) {
		t.Errorf("scatter pricing=%v", scatter)
	}
	aggregate := aok(t, s, base+"&mode=aggregate&stat=percentiles&field=writing_session_cost_usd")
	if aggregate["eligible_n"] != float64(len(rows)-1) || aggregate["lower_bound_n"] != float64(1) || aggregate["cost_lower_bound"] != true {
		t.Errorf("aggregate pricing=%v", aggregate)
	}
	schema := aok(t, s, "/v1/analytics/schema")
	features := schema["features"].(map[string]any)
	if features["entities_artifact"] != true || features["artifact_content"] != true {
		t.Errorf("artifact features=%v", features)
	}
	for _, name := range []string{"entities_plan", "entities_execution", "cohort", "activity", "actions", "reviews"} {
		if _, ok := features[name]; ok {
			t.Errorf("unserved feature %s", name)
		}
	}
	grain := schema["grains"].(map[string]any)["artifact"].(map[string]any)
	if grain["bucket_grouping"] != false {
		t.Errorf("artifact buckets advertised: %v", grain)
	}
}

func TestArtifactWriterLensesAfterLifetimeSelection(t *testing.T) {
	s, ts := queryTenant(t)
	at := time.Date(2026, 11, 8, 1, 0, 0, 0, time.UTC)
	hash := keys.ContentHash([]byte("stable"))
	path := "docs/plans/p/DESIGN.md"
	// The in-window re-save was emitted by another session/harness. Lifetime
	// version provenance still belongs to writer, whose harness mode is derived
	// from all its facts and whose model is only present on usage rows.
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "writer", Harness: "transient", RepoID: "r", Path: path, ContentHash: hash, TS: float64(at.Add(-2 * time.Hour).Unix())}, fx{"content_hash": hash})
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "resaver", Harness: "resaver", RepoID: "r", Path: path, ContentHash: hash, TS: float64(at.Unix())}, fx{"content_hash": hash})
	for i := 0; i < 2; i++ {
		qadd(t, ts, store.FactRow{Type: "hook_event", ConversationID: "writer", Harness: "dominant", NormEvent: "usage", Model: "writer-model", TS: float64(at.Add(time.Duration(i) * time.Minute).Unix())}, fx{"n": i})
	}
	base := "/v1/analytics/entities?grain=artifact&from=" + url.QueryEscape(at.Add(-time.Hour).Format(time.RFC3339)) + "&to=" + url.QueryEscape(at.Add(time.Hour).Format(time.RFC3339))
	for _, filter := range []string{"&harness=dominant", "&model=writer-model", "&exclude=harness:resaver", "&exclude=model:other"} {
		out := aok(t, s, base+filter)
		rows := rowsOf(out, "rows")
		if len(rows) != 1 || rows[0]["l"].(map[string]any)["writing_session"] != "writer" || rows[0]["m"].(map[string]any)["versions"] != float64(1) {
			t.Fatalf("%s rows=%v", filter, out)
		}
	}
	for _, filter := range []string{"&harness=resaver", "&model=other", "&exclude=harness:dominant", "&exclude=model:writer-model"} {
		if out := aok(t, s, base+filter); len(rowsOf(out, "rows")) != 0 {
			t.Fatalf("%s rows=%v", filter, out)
		}
	}
}

func TestArtifactBandPrecisionAndSupportedOperations(t *testing.T) {
	baseline := []float64{.1, .2504, .2504, .8, .9}
	score := func(value float64) map[string]any { return map[string]any{"score": value} }
	for value, want := range map[float64]string{.2503: "low", .2504: "mid", .8: "mid", .8001: "high"} {
		if got := artifactScoreBand(score(value), baseline); got != want {
			t.Errorf("%v: %s, want %s", value, got, want)
		}
	}
	s, ts := queryTenant(t)
	hash := keys.ContentHash([]byte("supported"))
	qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: "s", RepoID: "r", Path: "docs/plans/p/DESIGN.md", ContentHash: hash, TS: float64(time.Now().Unix())}, fx{"content_hash": hash})
	if err := ts.t.AppendScores(t.Context(), hash, []store.Score{{Check: "quality", Result: .5, Scorer: "v1"}}); err != nil {
		t.Fatal(err)
	}
	base := "/v1/analytics/entities?grain=artifact&all=1"
	for _, query := range []string{"&fields=score:invented", "&where=score:invented:0..1", "&sort=score:invented:asc", "&mode=aggregate&stat=sum&field=writing_session_cost_usd", "&mode=aggregate&stat=count&dim=scorer", "&mode=aggregate&stat=count&dim=band:quality", "&bucket=day", "&predicate=" + url.QueryEscape(`{"in":{"lens":"band:invented","values":["low"]}}`), "&predicate=" + url.QueryEscape(`{"in":{"lens":"scorer","values":["v1"]}}`)} {
		if code, out := aget(t, s, base+query); code != 400 {
			t.Errorf("accepted %s: %d %v", query, code, out)
		}
	}
	out := aok(t, s, base+"&check=quality&mode=aggregate&stat=count&dim=scorer&dim=band:quality")
	if len(rowsOf(out, "groups")) != 1 {
		t.Errorf("score groups=%v", out)
	}
	out = aok(t, s, base+"&check=quality&scorer=old")
	if len(rowsOf(out, "rows")) != 0 {
		t.Errorf("revived score=%v", out)
	}
}
