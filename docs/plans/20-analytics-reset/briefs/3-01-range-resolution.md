# Brief: 3-01 — Range resolution and budget responses

Consumer: Plan 20 Phase 3 server worker.
Owned paths: `packages/yakka/internal/serve/analytics.go`, `packages/yakka/internal/serve/analytics_query.go`, `packages/yakka/internal/serve/analytics_test.go`, `packages/yakka/internal/serve/analytics_query_test.go`, `docs/plans/20-analytics-reset/CONTRACTS.md`, `docs/design/03-remote-service.md`. Touch nothing else.
Commits: Leave changes in the working tree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/3-01-range-resolution.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the phase commit.
Depends on: nothing.
Runs alongside: nothing.
Budget: 8 files to read, about 500 lines to change, 12 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 3 outcome and approach.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — sections 7 and 12, especially 17.1.
3. `packages/yakka/internal/serve/analytics.go` and `analytics_query.go` — current filter, route and cell-cap behavior.

## Goal

Make route window and series resolution semantics satisfy the fixed Phase 3 outcome: no width-only refusal, preserved requested dates, `auto` selection/coarsening and explicit budget errors.

## Contract

`CONTRACTS.md` 17.1 is binding: no window cap; accepted nanosecond interval is inclusive; `all=1` uses route coverage; `auto` chooses the finest fitting calendar resolution through year and multi-year steps; explicit over-budget requests return `too_many_cells` with suggestions or `too_many_series`, without slicing. Existing omission defaults remain unchanged. Phase 3 requires representative all-history, ten-year, pre-epoch, exact-boundary and multi-century/two-dimension evidence.

## Changes

Compare at least two viable ways to determine fit and effective bucket (route-specific calculation versus a shared cell planner), using the fixed output/cell semantics and fixture evidence. Choose and record the candidate that meets the contract; do not add routes, measures, grains or limits. Keep legacy response fields/defaults and add only contracted metadata and machine-readable errors. Candidate choice cannot weaken the 20,000-cell budget.

### Keep untouched

Do not alter identity routes, entity/session joins, or the client. Do not reinterpret RFC3339 bounds or widen the representable interval.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- Focused Go tests demonstrate all-history and ten-year range acceptance, `auto` year-step choice without date clipping, explicit overflow suggestions and exact time boundaries.
- Multi-century/two-dimension fixture case fits or returns the contracted bounded error; no newest-bucket truncation.
- `git diff --check` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include candidate comparison, checks before/after, deviations and contradictions.
