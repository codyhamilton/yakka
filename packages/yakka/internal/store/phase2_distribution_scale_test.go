package store

import (
	"context"
	"fmt"
	"math"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/keys"
)

func phase2DistUsage(t *testing.T, tn *Tenant, conv, harness, model string, tokOut int64, n int) {
	t.Helper()
	if _, err := tn.Append(context.Background(), []FactRow{
		ufact(n, harness, model, conv, fmt.Sprintf(`{"conversation":%q,"n":%d}`, conv, n), aFrom, 0, tokOut, 0, 0, 0, nil),
	}); err != nil {
		t.Fatal(err)
	}
}

func phase2DistFact(t *testing.T, tn *Tenant, conv, typ, harness, repo, path, hash string) {
	t.Helper()
	raw := []byte(fmt.Sprintf(`{"conversation":%q,"type":%q,"repo":%q,"path":%q,"hash":%q}`, conv, typ, repo, path, hash))
	if _, err := tn.Append(context.Background(), []FactRow{{
		RowHash: keys.ContentHash(raw), Type: typ, ConversationID: conv, Harness: harness,
		Event: typ, TS: float64(aFrom.Unix()), RepoID: repo, Path: path, ContentHash: hash, Raw: raw,
	}}); err != nil {
		t.Fatal(err)
	}
}

// phase2DistFixture builds three in-window usage conversations whose lifetime provenance is
// known: c1 has a single lifetime repo, c2 has two (multi) and c4 has none.
func phase2DistFixture(t *testing.T) *Tenant {
	t.Helper()
	tn := openT(t, Options{})
	phase2DistUsage(t, tn, "c1", "opencode", "model-a", 10, 901)
	phase2DistUsage(t, tn, "c1", "opencode", "model-a", 20, 902)
	phase2DistUsage(t, tn, "c2", "claude", "model-b", 30, 903)
	phase2DistUsage(t, tn, "c4", "opencode", "model-c", 5, 904)
	// Lifetime provenance outside the window: one artifact for c1 would not be enough on its
	// own, so add a second lifetime repo row for c2 only.
	phase2DistFact(t, tn, "c1", "artifact_version", "opencode", "r1", "a.md", hx("a1"))
	phase2DistFact(t, tn, "c1", "artifact_version", "opencode", "r1", "b.md", hx("a2"))
	phase2DistFact(t, tn, "c2", "commit", "cursor", "r2", "", "")
	phase2DistFact(t, tn, "c2", "commit", "cursor", "r3", "", "")
	return tn
}

func TestDistributionConversationProvenanceOracle(t *testing.T) {
	ctx := context.Background()
	tn := phase2DistFixture(t)
	f := distFilter()
	type want struct {
		n        int
		unpriced int
		min, max float64
	}
	cases := []struct {
		name string
		dim  string
		top  int
		rows map[string]want
	}{
		// Conversation n counts priced samples per group, which for a non-cost measure is the
		// kept-call count; the provenance change must not alter that existing n semantics.
		{name: "no-dim", dim: "", top: 10, rows: map[string]want{"all": {4, 0, 5, 30}}},
		{name: "model", dim: "model", top: 10, rows: map[string]want{
			"model-a": {2, 0, 0, 0}, "model-b": {1, 0, 30, 30}, "model-c": {1, 0, 5, 5},
		}},
		{name: "harness", dim: "harness", top: 10, rows: map[string]want{
			"cursor": {1, 0, 30, 30}, "opencode": {3, 0, 5, 5},
		}},
		{name: "session-model", dim: "session_model", top: 10, rows: map[string]want{
			"model-a": {2, 0, 0, 0}, "model-b": {1, 0, 30, 30}, "model-c": {1, 0, 5, 5},
		}},
		{name: "session-repo", dim: "session_repo", top: 10, rows: map[string]want{
			"r1": {2, 0, 0, 0}, "(multi)": {1, 0, 30, 30}, "(none)": {1, 0, 5, 5},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, err := tn.Distribution(ctx, f, DistributionParams{Measure: "tokens_out", Grain: "conversation", Dim: tc.dim, Top: tc.top})
			if err != nil {
				t.Fatal(err)
			}
			if len(res.Rows) != len(tc.rows) {
				t.Fatalf("rows=%d want %d: %#v", len(res.Rows), len(tc.rows), res.Rows)
			}
			for _, row := range res.Rows {
				w, ok := tc.rows[row.K]
				if !ok {
					t.Fatalf("unexpected group %q: %#v", row.K, res.Rows)
				}
				if row.N != w.n || row.Unpriced != w.unpriced {
					t.Fatalf("%s n/unpriced=%d/%d want %d/%d", row.K, row.N, row.Unpriced, w.n, w.unpriced)
				}
				if math.Abs(row.Min-w.min) > 1e-9 || math.Abs(row.Max-w.max) > 1e-9 {
					t.Fatalf("%s min/max=%v/%v want %v/%v", row.K, row.Min, row.Max, w.min, w.max)
				}
				if len(row.Bins) != len(distributionBinDefs("tokens_out")) {
					t.Fatalf("%s bins=%d want the fixed token bins", row.K, len(row.Bins))
				}
			}
		})
	}
}

func TestDistributionConversationOmittedCountsOracle(t *testing.T) {
	ctx := context.Background()
	tn := phase2DistFixture(t)
	// r1 (n=2) survives first; the equal-n=1 groups then order by key, so "(multi)"
	// survives top=2 and "(none)" is omitted.
	res, err := tn.Distribution(ctx, distFilter(), DistributionParams{Measure: "tokens_out", Grain: "conversation", Dim: "session_repo", Top: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Rows) != 2 || !res.Truncated || res.GroupN != 3 {
		t.Fatalf("rows=%d truncated=%v group_n=%d", len(res.Rows), res.Truncated, res.GroupN)
	}
	if res.Rows[0].K != "r1" || res.Rows[1].K != "(multi)" {
		t.Fatalf("order=%q,%q", res.Rows[0].K, res.Rows[1].K)
	}
	if res.OmittedGroups != 1 || res.OmittedN != 1 || res.OmittedUnpriced != 0 {
		t.Fatalf("omitted groups/n/unpriced=%d/%d/%d want 1/1/0", res.OmittedGroups, res.OmittedN, res.OmittedUnpriced)
	}
}

func TestSessionScatterMarginalsMatchGroupedHistogram(t *testing.T) {
	ctx := context.Background()
	tn := phase2DistFixture(t)
	f := distFilter()
	fields := []string{"cost_usd", "commits", "unpriced_calls", "tokens_out"}
	got, err := tn.SessionScatterMarginals(ctx, f, fields)
	if err != nil {
		t.Fatal(err)
	}
	cte, args := sessionAggregateCTE(f)
	rows, err := tn.rdb.QueryContext(ctx, cte+` SELECT model_calls,unpriced_calls,commits,cost_usd,tokens_out FROM filtered`, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	want := map[string][]DistributionBin{}
	for _, field := range fields {
		want[field] = distributionBinDefs(field)
	}
	population := 0
	for rows.Next() {
		var modelCalls, unpriced, commits, cost, tokOut float64
		if err := rows.Scan(&modelCalls, &unpriced, &commits, &cost, &tokOut); err != nil {
			t.Fatal(err)
		}
		population++
		values := map[string]struct {
			v  float64
			ok bool
		}{
			"cost_usd":       {cost, modelCalls == 0 || modelCalls > unpriced},
			"commits":        {commits, true},
			"unpriced_calls": {unpriced, true},
			"tokens_out":     {tokOut, true},
		}
		for _, field := range fields {
			x := values[field]
			if !x.ok {
				continue
			}
			bins := want[field]
			bins[binIndex(field, x.v)].N++
			want[field] = bins
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if population == 0 {
		t.Fatal("empty session population")
	}
	for _, field := range fields {
		if len(got[field]) != len(want[field]) {
			t.Fatalf("%s bins=%d want %d", field, len(got[field]), len(want[field]))
		}
		for i := range want[field] {
			if got[field][i].N != want[field][i].N || got[field][i].Lo != want[field][i].Lo {
				t.Fatalf("%s bin %d=%+v want %+v", field, i, got[field][i], want[field][i])
			}
			g, w := got[field][i].Hi, want[field][i].Hi
			if (g == nil) != (w == nil) || (g != nil && *g != *w) {
				t.Fatalf("%s bin %d hi=%v want %v", field, i, g, w)
			}
		}
	}
	for _, field := range []string{"commits", "unpriced_calls", "tokens_out"} {
		total := 0
		for _, b := range got[field] {
			total += b.N
		}
		if total != population {
			t.Fatalf("%s total=%d want whole population %d", field, total, population)
		}
	}
}
