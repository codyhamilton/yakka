# Phase 2 unit 04 — request-scoped usage source for multi-dimension treemaps

Status: done with concerns (retained-scale measurement deferred; no commit per orchestrator override). Uncommitted working-tree handoff.

## What changed

- `packages/yakka/internal/store/query.go`
  - Added `rowQueryer` (`QueryContext`) so rank and final reads can run through `*sql.DB` or a pinned `*sql.Conn`.
  - Split `queryMeasure` into a thin wrapper over new `queryMeasureOn(ctx, q, ...)`; threaded `q` through `rankDim`, `rankSQL`, `rankLocalTimeDim`, `finalUTC`, `finalLocal`. Non-usage callers still pass `t.rdb`; SQL text and semantics unchanged.
- `packages/yakka/internal/store/usage.go`
  - `usageQueryImpl` now materializes `kept` once per request on one connection (`CREATE TEMP TABLE IF NOT EXISTS usage_kept …; DELETE; INSERT … SELECT … FROM kept`) and passes `sourceSQL = "usage_kept"` to `queryMeasureOn`.
  - A two-dimension usage request now evaluates the dedupe/pricing source once instead of three times (one per independent dimension rank plus the final aggregate). Dedupe identity, read-time `wf_usage_cost`/`wf_usage_priced` pricing, `top` default/cap, independent per-dimension top-N, `value desc, key asc`, `(other)` folding, row cap/truncation, bucketing/timezone/filters and response shapes are unchanged.
- `packages/yakka/internal/store/phase2_usage_scale_test.go` (new): `TestUsageQueryMultiDimMatchesSinglePassOracle`.
- `packages/yakka/internal/serve/analytics_query_multidim_test.go` (new): `TestAnalyticsCostTreemapRetainedShape`.

No new wire surface; non-usage measures keep their rollup/source path.

## Evidence

Environment for all commands: `GOTOOLCHAIN=auto GOMEMLIMIT=8GiB TMPDIR=<worktree>/.scratch/plan29-p2-tmp`, run from `packages/yakka`.

Before the fix, `HEAD` embedded the source CTE in the measure definition (`git show HEAD:…/usage.go`):

```
205: qdef := measureDef{… sourceSQL: "(" + cte + " SELECT … FROM kept)", sourceArgs: sourceArgs}
210: res, err := t.queryMeasure(ctx, …)
```

`queryMeasure` ran that embedded CTE in each `rankDim` pass and again in the final query, so a two-dim request ran the dedupe/pricing source three times. No pre-change behavioural (row) failure is available: the old path produced the same rows, so the pre-change failing acceptance is the retained-scale timeout below. The retained-scale harness from phase2-01 (`analytics_retained_bench_test.go`, `testdata/retained-request-shapes.json`) is not present in this worktree.

After (new tests):

```
$ go test ./internal/store -run 'TestUsageQueryMultiDimMatchesSinglePassOracle' -count=1 -v
--- PASS: TestUsageQueryMultiDimMatchesSinglePassOracle (0.05s)
    --- PASS: …/model_calls (0.00s)
    --- PASS: …/cost_usd (0.00s)
ok  internal/store  0.054s

$ go test ./internal/serve -run 'TestAnalyticsCostTreemapRetainedShape' -count=1 -v
--- PASS: TestAnalyticsCostTreemapRetainedShape (0.07s)
ok  internal/serve  0.072s
```

Oracle comparison: the store test compares the two-dimension result (top=2) with an independent single-pass reference over `usageKeptRows`: independent per-dimension ranks, then Go folding/`(other)`/grouping, for `model_calls` and `cost_usd`. One-dimension sanity: the same test compares `dim=harness` top=2 against the single-pass oracle. Exact keys/order and values within 1e-9. The serve test asserts 200, `dims == ["harness","model"]`, only each dimension's own top-two keys plus `__other__`, `(other)` present independently in each position, exact folded rows, and total cost 1.60 (oracle sum); it also shows claude's top harness row surviving while its model folds, i.e. no intersection.

Regressions:

```
$ go test ./internal/store -run 'TestUsage|TestQuery' -count=1
ok  internal/store  0.731s
$ go test ./internal/serve -run 'TestAnalyticsQuery' -count=1
ok  internal/serve  0.182s
$ gofmt -l <changed files>        # clean (no output)
$ go vet ./internal/store ./internal/serve   # clean
```

The existing `TestUsageGoHeapDoesNotScaleWithScannedRows` passes: materialization is in SQLite temp storage, not Go heap.

## Deviations from the brief

1. **No commit.** The orchestrator overrode the brief's commit line; changes and this report are left in the working tree.
2. **Retained-scale measurement deferred.** The phase2-01 harness is absent. `gate: retained-scale measurement deferred to orchestrator`. The required `YAKKA_RETAINED_PROFILE=1 YAKKA_RETAINED_RUNS=20` run and the four-request board load were not executed; before/after p95 and 503 counts are therefore not measured here.
3. **Pre-change failing check.** Not reproducible as a row-equality failure (performance-only change); used the brief's stated fallback, the deferred retained-scale timeout.

## Unfinished work

- Orchestrator: run the retained-scale `query/cost_usd/dims=harness+model/bucket=none/all` shape before and after (needs phase2-01 harness), confirming p95 ≤500 ms alone and under four-request load with zero 503; confirm the retained one-dim cost rank (32 groups) rows and `(other)` total are unchanged. The unit-level one-dim sanity above is already green.

## Known problems

- None found in this change. The temp table is per reader connection and bounded to the deduplicated calls in the request window; no handler-side row retention was added in Go.

## Gates

- `gate: retained-scale measurement deferred to orchestrator`
- `gate: unit oracle + serve treemap shape pass`
- `gate: store/serve regressions, gofmt, vet pass`
