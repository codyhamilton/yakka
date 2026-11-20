# Brief: phase2-04 — Request-scoped usage source for multi-dimension treemaps

Consumer: the execute worker for phase2-04; the Phase 2 verifier reads the two-dimension cost-treemap evidence.
Owned paths: `packages/yakka/internal/store/usage.go`, `packages/yakka/internal/store/query.go`, `packages/yakka/internal/store/phase2_usage_scale_test.go` (new), `packages/yakka/internal/serve/analytics_query_multidim_test.go` (new). Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase2-04-multidim-treemap.md` (rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase2-01 for the retained-scale table. Runs alongside: phase2-01, phase2-02, phase2-05.
Budget: read about 7 files, change about 220 lines, 30 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md:177` — Phase 2 outcome; `:97-98` — shared scoped work, independent top-N/`(other)` and the performance contract; `:89-100` — the domain.
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md:42` — D12; `:68,70` — Cost treemap and Tools observations.
3. `docs/design/09-analytics-workspace-contracts.md:74` — time-grain measures and session lenses; `:78` — aggregate route and `(other)`/top-N behavior; `:25` — work bounded by aggregation.
4. `packages/yakka/internal/store/usage.go:72-93` — `usageRowsWhere` dedupe/identity; `:148-216` — `usageQueryImpl` and the embedded source; `:218-290` — kept rows and fold helpers.
5. `packages/yakka/internal/store/query.go:255-337` — `Query`/`queryMeasure`; `:397-429` — `rankSQL`; `:480-600` — `finalUTC`/`finalLocal` folding and `(other)`.
6. Existing tests: `packages/yakka/internal/store/query_test.go` and `packages/yakka/internal/store/usage_test.go` (grep for `other`, `top`, `dims`, `dedupe`); `packages/yakka/internal/serve/analytics_query_test.go` (grep for `top=100`, `other`, two-dim requests).
7. `packages/yakka/internal/serve/analytics_retained_bench_test.go` and `testdata/retained-request-shapes.json` from phase2-01.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make the two-dimension cost treemap complete at retained-history scale by evaluating the deduplicated/priced usage source once per request and reusing it for each independent dimension rank and the final aggregate, without changing top-N or `(other)` semantics.

## Contract

- `DESIGN.md:97`: "Multi-dimension usage and artifact bands must share scoped work rather than rebuild the population per combination or per artifact."
- `EVIDENCE.md:42`: "Reuse a request-scoped deduplicated/priced source and grouped totals, preserving independent top-N folding and `(other)` semantics."
- Performance acceptance, verbatim: "Retain the existing p95 ≤500 ms target over at least 20 warm requests per affected request shape, measured alone and with a four-request board load; no timeout in either run. Record cold/migration latency separately. The one-second deadline is not increased as the acceptance mechanism."
- `09-analytics-workspace-contracts.md:25`: "no handler retains all scanned rows … in Go memory"; SQL grouping is the intended shape.

## Changes

- **Request-scoped source** (`usage.go`/`query.go`): for usage measures, evaluate `usageRowsWhere`'s deduplicated `kept` source once per `/query` request and reuse it for every dimension's rank query and for the final grouped/bucketed query. A two-dimension request must not run the dedupe/pricing source three times.
  - Preferred shape: materialize `kept` once on the request's connection (temporary table or equivalent) and use that materialized source for each independent `rankDim` pass and the final rows. If you choose a single-statement formulation instead, it must still produce independent per-dimension top-N and the same final folding.
  - Keep dedupe identity exactly: `(conversation_id, mid)` for Claude `$.backfill.ref`, largest `tok_out`, `row_hash` tie; calls without a mid are each their own call.
  - Keep pricing at read via the existing `wf_usage_cost`/`wf_usage_priced` functions; do not persist priced values.
  - Preserve independent top-N per dimension (not an intersection), ordering `value desc, key asc`, `(other)` folding for keys outside a dimension's own top-N, `top` default/max, query row cap and truncation.
  - Keep non-usage measures on their existing rollup/source path, and do not change bucketing, timezone handling, filters or response shapes.
- **No new wire surface**: no new measures, dimensions, buckets or parameters; `/query` validation stays as it is.

### Keep untouched

- Independent top-N and `(other)` semantics; dedupe identity; pricing; null/unpriced handling.
- Time-bucket and timezone behavior; cell/series budgets; one-second deadline.
- Rollup tables/migrations (this unit does not own `store.go`).
- Production parity, deployment and the Plan 28 trial.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after. Retained-scale harness data lives under the worktree's ignored `.scratch/`, never `/tmp`; ordinary unit fixtures may use `t.TempDir()`. Use `GOTOOLCHAIN=auto` and `GOMEMLIMIT=8GiB`.

- New `TestUsageQueryMultiDimMatchesSinglePassOracle` (store) → passes after; it compares a two-dimension usage query's groups and `(other)` row with an independent single-pass reference over the same deduplicated calls. If a pre-change behavioural failure is not available, state that the pre-change failing acceptance is the retained-scale timeout below.
- New `TestAnalyticsCostTreemapRetainedShape` (serve) → asserts the two-dimension cost treemap returns 200, `dim` order preserved, top-N keys per dimension, `(other)` present when expected, and totals equal the oracle.
- Retained scale (phase2-01): `YAKKA_RETAINED_PROFILE=1 YAKKA_RETAINED_RUNS=20 go test ./internal/serve -run '^TestAnalyticsRetainedWorkload$' -count=1 -timeout 30m` filtered to `query/cost_usd/dims=harness+model/bucket=none/all`. Report before/after: before the fix the retained diagnostic reports 503/timeout; after, p95 ≤500 ms alone and under the four-request load, zero 503.
- One-dimension sanity: the retained one-dim cost rank (32 groups in the diagnostic) still returns the same rows and `(other)` total.
- Regressions: `… go test ./internal/store -run 'TestUsage|TestQuery' -count=1` and `… go test ./internal/serve -run 'TestAnalyticsQuery' -count=1` → pass.
- `gofmt -l` clean on changed files; `go vet ./internal/store ./internal/serve` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
