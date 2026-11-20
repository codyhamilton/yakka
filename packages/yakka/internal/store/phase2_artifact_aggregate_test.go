package store

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

// TestArtifactGroupedCountMatchesSelectedPopulation checks the grouped band count against an
// independent file population, an independent SQL kind grouping and a Go re-classification built
// from the latest version, the latest per-check score and the all-time content baseline.
func TestArtifactGroupedCountMatchesSelectedPopulation(t *testing.T) {
	tn := openT(t, Options{})
	defer tn.Close()
	ctx := context.Background()
	base := time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC)
	add := func(conv, repo, path, body string) string {
		raw, _ := json.Marshal(map[string]any{"type": "artifact_version", "conversation_id": conv, "repo_id": repo, "path": path, "content": body})
		hash := keys.ContentHash([]byte(body))
		rh, _ := keys.RowHash(raw)
		if _, err := tn.Append(ctx, []FactRow{{RowHash: rh, Raw: raw, Type: "artifact_version", ConversationID: conv, RepoID: repo, Path: path, ContentHash: hash, TS: float64(base.Unix())}}); err != nil {
			t.Fatal(err)
		}
		return hash
	}
	score := func(hash string, value float64, scorer string) {
		if err := tn.AppendScores(ctx, hash, []Score{{Check: "q", Result: value, Scorer: scorer}}); err != nil {
			t.Fatal(err)
		}
	}
	design := "docs/plans/p/DESIGN.md"
	add("r0", "r0", design, "old")
	// The newest version of the same path wins, even though the older hash is scored.
	score(add("r0", "r0", design, "s0"), 0, "current")
	for i, v := range []float64{.25, .5, .75, 1} {
		score(add("", "r"+string(rune('1'+i)), design, "s"+string(rune('1'+i))), v, "current")
	}
	add("dup", "dup", design, "s0")
	add("u", "unscored", design, "s5")
	score(add("alt", "alt", design, "s7"), .5, "alt")
	score(add("unknown", "unknown", "README.md", "u0"), .5, "current")
	score(add("brief", "brief", "docs/plans/p/briefs/b.md", "b0"), .5, "current")

	f := AnalyticsFilter{From: base.Add(-time.Hour), To: base.Add(time.Hour)}
	count, err := tn.ArtifactEntityCount(ctx, f, nil)
	if err != nil {
		t.Fatal(err)
	}
	baselines := map[string]map[string][]float64{}
	for _, kind := range kindOrderStore {
		rows, err := tn.LatestContentScores(ctx, kind)
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			if baselines[kind] == nil {
				baselines[kind] = map[string][]float64{}
			}
			baselines[kind][row.Scorer] = append(baselines[kind][row.Scorer], row.Score)
		}
		for _, values := range baselines[kind] {
			sort.Float64s(values)
		}
	}
	thresholds := map[string]map[string][2]float64{}
	for kind, scorers := range baselines {
		thresholds[kind] = map[string][2]float64{}
		for scorer, values := range scorers {
			thresholds[kind][scorer] = [2]float64{interpolatedPercentile(values, .25), interpolatedPercentile(values, .75)}
		}
	}
	bandGroups, cardinality, total, err := tn.ArtifactGroupedCount(ctx, f, "q", []string{"band:q", "kind"}, "", thresholds)
	if err != nil {
		t.Fatal(err)
	}
	if total != count {
		t.Fatalf("grouped total=%d selected-file population=%d", total, count)
	}
	sum := 0
	seen := map[string]int{}
	for _, g := range bandGroups {
		sum += g.N
		seen[g.Values[0]+"\x00"+g.Values[1]] = g.N
	}
	if sum != total {
		t.Fatalf("group counts sum=%d total=%d", sum, total)
	}
	if len(cardinality) != 2 {
		t.Fatalf("cardinality=%v", cardinality)
	}

	// The Go oracle re-classifies the same files from the established per-file reads.
	oracle := map[string]int{}
	page, more, err := tn.ArtifactEntitiesPage(ctx, f, nil, "last_ts", true, nil, 1000)
	if err != nil || more {
		t.Fatalf("entities page more=%v err=%v", more, err)
	}
	for _, entity := range page {
		kind := keys.Kind(entity.Path)
		band := "unscored"
		scores, err := tn.ArtifactVersionScores(ctx, entity.Hash)
		if err != nil {
			t.Fatal(err)
		}
		if s, ok := scores["q"]; ok {
			baseline := baselines[kind][s["scorer"].(string)]
			if len(baseline) == 0 {
				band = "baseline_unavailable"
			} else {
				value := s["score"].(float64)
				switch {
				case value < interpolatedPercentile(baseline, .25):
					band = "low"
				case value > interpolatedPercentile(baseline, .75):
					band = "high"
				default:
					band = "mid"
				}
			}
		}
		oracle[band+"\x00"+kind]++
	}
	if len(oracle) != len(seen) {
		t.Fatalf("grouped=%v oracle=%v", seen, oracle)
	}
	for key, n := range oracle {
		if seen[key] != n {
			t.Errorf("group %q=%d oracle=%d", key, seen[key], n)
		}
	}

	// An independent SQL grouping of the selected files backs the kind lens.
	kindGroups, _, kindTotal, err := tn.ArtifactGroupedCount(ctx, f, "", []string{"kind"}, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if kindTotal != count {
		t.Fatalf("kind total=%d population=%d", kindTotal, count)
	}
	rows, err := tn.rdb.QueryContext(ctx, `SELECT wf_kind(path),COUNT(*) FROM (
		SELECT repo_id,path FROM facts WHERE type='artifact_version' AND ts>=? AND ts<=? GROUP BY repo_id,path
	) GROUP BY 1`, seconds(f.From), seconds(f.To))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	sqlKinds := map[string]int{}
	for rows.Next() {
		var kind string
		var n int
		if err := rows.Scan(&kind, &n); err != nil {
			t.Fatal(err)
		}
		sqlKinds[kind] = n
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(kindGroups) != len(sqlKinds) {
		t.Fatalf("kind groups=%v sql=%v", kindGroups, sqlKinds)
	}
	for _, g := range kindGroups {
		if sqlKinds[g.Values[0]] != g.N {
			t.Errorf("kind %q=%d sql=%d", g.Values[0], g.N, sqlKinds[g.Values[0]])
		}
	}
}

var kindOrderStore = []string{"design", "brief", "report"}

// interpolatedPercentile mirrors the server's linear interpolation between closest ranks.
func interpolatedPercentile(sorted []float64, q float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	pos := float64(len(sorted)-1) * q
	lo := int(math.Floor(pos))
	hi := int(math.Ceil(pos))
	return sorted[lo] + (sorted[hi]-sorted[lo])*(pos-float64(lo))
}
