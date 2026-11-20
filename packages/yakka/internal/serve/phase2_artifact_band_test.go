package serve

import (
	"fmt"
	"net/url"
	"testing"
	"time"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

// TestAnalyticsArtifactBandAggregateGroupedCounts proves the grouped count path derives the same
// bands as the per-file population path: latest version selection, per-scorer content baselines,
// unscored versus baseline_unavailable, strict p25/p75 bounds and a total that equals the
// selected-file population.
func TestAnalyticsArtifactBandAggregateGroupedCounts(t *testing.T) {
	s, ts := queryTenant(t)
	at := time.Now().UTC().Truncate(time.Second)
	design := "docs/plans/p/DESIGN.md"
	add := func(repo, path, body string, score *float64, scorer string) {
		hash := keys.ContentHash([]byte(body))
		qadd(t, ts, store.FactRow{Type: "artifact_version", ConversationID: repo, Harness: "h", RepoID: repo, Path: path, ContentHash: hash, TS: float64(at.Unix())}, fx{"content_hash": hash, "source": "worktree"})
		if score != nil {
			if err := ts.t.AppendScores(t.Context(), hash, []store.Score{{Check: "q", Result: *score, Scorer: scorer}}); err != nil {
				t.Fatal(err)
			}
		}
	}
	value := func(v float64) *float64 { return &v }

	// r0 keeps an older unscored version; the latest version (inserted second) is the scored one.
	add("r0", design, "s0-old", nil, "")
	add("r0", design, "s0", value(0), "current")
	// Five distinct contents at 0, .25, .5, .75, 1 give exact p25=.25 and p75=.75.
	add("r1", design, "s1", value(.25), "current")
	add("r2", design, "s2", value(.5), "current")
	add("r3", design, "s3", value(.75), "current")
	add("r4", design, "s4", value(1), "current")
	// A second path sharing s0's content must not move the distinct-content baseline.
	add("dup", design, "s0", nil, "")
	// A designed hash without a score stays unscored, not baseline_unavailable.
	add("unscored", design, "s5", nil, "")
	// The same check scored by a different scorer uses that scorer's own baseline.
	add("alt", design, "s7", value(.5), "alt")
	// An unrecognised kind has no comparative baseline even with a score.
	add("unknown", "README.md", "u0", value(.5), "current")

	base := "/v1/analytics/entities?grain=artifact&all=1&check=q&mode=aggregate&stat=count"

	out := aok(t, s, base+"&dim="+url.QueryEscape("band:q")+"&dim=kind")
	want := map[string]int{
		"low\x00design":            2, // r0 (0 < .25) and dup (shared content)
		"mid\x00design":            4, // .25, .5, .75 are inclusive boundaries; alt uses its own baseline
		"high\x00design":           1, // 1 > .75
		"unscored\x00design":       1,
		"baseline_unavailable\x00": 1, // README.md has no kind baseline
	}
	got := map[string]int{}
	sum := 0
	for _, group := range rowsOf(out, "groups") {
		l := group["l"].(map[string]any)
		key := fmt.Sprint(l["band:q"]) + "\x00" + fmt.Sprint(l["kind"])
		got[key] = int(group["value"].(float64))
		sum += got[key]
		if group["population"].(map[string]any)["scope_n"] != group["value"] {
			t.Errorf("group population disagrees with count: %v", group)
		}
	}
	if len(got) != len(want) {
		t.Fatalf("groups=%v want %v", got, want)
	}
	for key, n := range want {
		if got[key] != n {
			t.Errorf("group %q=%d want %d (all=%v)", key, got[key], n, got)
		}
	}
	if out["value"] != float64(9) || sum != 9 {
		t.Fatalf("total value=%v sum=%d want 9", out["value"], sum)
	}
	if out["population"].(map[string]any)["scope_n"] != float64(9) || out["population"].(map[string]any)["eligible_n"] != float64(9) {
		t.Fatalf("population=%v", out["population"])
	}

	// The scorer lens reports unscored separately and keeps the two scorers independent.
	scored := aok(t, s, base+"&dim=scorer")
	scorerGroups := map[string]int{}
	for _, group := range rowsOf(scored, "groups") {
		scorerGroups[fmt.Sprint(group["l"].(map[string]any)["scorer"])] = int(group["value"].(float64))
	}
	if scorerGroups["current"] != 7 || scorerGroups["alt"] != 1 || scorerGroups["unscored"] != 1 {
		t.Fatalf("scorer groups=%v", scorerGroups)
	}

	// A scorer filter keeps only that scorer's selected-version scores; unscored files drop out.
	filtered := aok(t, s, base+"&scorer=current&dim="+url.QueryEscape("band:q")+"&dim=kind")
	if filtered["value"] != float64(7) {
		t.Fatalf("scorer-filtered total=%v want 7", filtered["value"])
	}
	for _, group := range rowsOf(filtered, "groups") {
		if fmt.Sprint(group["l"].(map[string]any)["band:q"]) == "unscored" {
			t.Fatalf("scorer filter kept an unscored group: %v", group)
		}
	}
	if one := aok(t, s, base+"&scorer=alt"); one["value"] != float64(1) {
		t.Fatalf("alt scorer total=%v want 1", one["value"])
	}

	// List and scatter stay on the population path and must agree with the grouped aggregate.
	list := aok(t, s, "/v1/analytics/entities?grain=artifact&all=1&check=q&fields=score:q")
	listGroups := artifactBandGroups(t, rowsOf(list, "rows"))
	if fmt.Sprint(listGroups) != fmt.Sprint(want) {
		t.Fatalf("list bands=%v want %v", listGroups, want)
	}
	scatter := aok(t, s, "/v1/analytics/entities?grain=artifact&all=1&check=q&mode=scatter&fields=versions,last_ts")
	scatterGroups := artifactBandGroups(t, rowsOf(scatter, "rows"))
	if fmt.Sprint(scatterGroups) != fmt.Sprint(want) {
		t.Fatalf("scatter bands=%v want %v", scatterGroups, want)
	}
}

func artifactBandGroups(t *testing.T, rows []fx) map[string]int {
	t.Helper()
	out := map[string]int{}
	for _, row := range rows {
		l := row["l"].(map[string]any)
		out[fmt.Sprint(l["band:q"])+"\x00"+fmt.Sprint(l["kind"])]++
	}
	return out
}
