# Brief: 3-02 — Bounded aggregate storage reads

Consumer: Plan 20 Phase 3 server worker.
Owned paths: `packages/yakka/internal/store/usage.go`, `packages/yakka/internal/store/query.go`, `packages/yakka/internal/store/distribution.go`, `packages/yakka/internal/store/score_series.go`, their corresponding `*_test.go` files, `packages/yakka/internal/store/rollup.go` and `rollup_test.go`. Touch nothing else.
Commits: Leave changes in the working tree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/3-02-bounded-aggregation.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the phase commit.
Depends on: 3-01 Range resolution and budget responses.
Runs alongside: nothing.
Budget: 10 files to read, about 700 lines to change, 14 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 3 outcome and approach.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — sections 7, 12 and 17.1.
3. `packages/yakka/internal/store/{usage,query,distribution,score_series,rollup}.go` — current aggregate paths.

## Goal

Make aggregate memory independent of scanned-row count while retaining exact contracted values and enabling all-history reads.

## Contract

`CONTRACTS.md` 17.1 is binding: usage, summaries, score percentiles/series and distributions aggregate in SQL or rollups; no handler retains all scanned rows, hashes, scores or values in Go memory; exact rank/percentile may spill bounded database work to disk under deadline; `ScoreSeries` uses joins rather than per-hash binds. Phase 3 specifically proves usage/distribution/score reads have row-independent Go heap, including over 32,766 scored hashes.

## Changes

Compare SQL aggregation, day-grain rollup and a hybrid against the same fixture oracle, row-independent Go-heap criterion, exactness requirements and existing p95 contract. Implement the selected candidate within the owned store paths. Record why the alternatives fail or cost more; do not claim approximation as exact. Reuse the Phase 1 multi-year fixture generator and construct the 32,767-hash population once per setup. Do not add storage tiers or retention behavior.

### Keep untouched

Preserve legacy eligibility, money/null semantics, ordering and response values. Do not modify server routing or introduce entity grains/joins from Phase 4+.

## Done evidence

Identify or write failing checks before changing code. Report outputs before and after.

- Store tests compare candidate output to fixture oracle for all-time usage, distribution and score results.
- A heap-allocation check is stable as scanned row count grows, and 32,767 distinct hashes succeed.
- Focused tests pass under `GOMAXPROCS=3 GOMEMLIMIT=8GiB`; no memory cap is raised.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include candidate comparison, checks before/after, deviations and contradictions.
