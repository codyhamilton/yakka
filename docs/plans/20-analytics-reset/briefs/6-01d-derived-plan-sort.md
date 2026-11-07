# Brief: 6-01d — Derived plan measure sorting

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/serve/analytics_entities.go`, `packages/yakka/internal/serve/analytics_query.go` (plan sort schema declaration only), `packages/yakka/internal/store/plan_entities.go`, focused plan entity tests under `packages/yakka/internal/{serve,store}/`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-01d-derived-plan-sort.md` and include it in the commit.
Depends on: 6-01c; Phases 1–5.
Runs alongside: Nothing; this changes the existing plan list sort and keyset implementation.
Budget: 6 files to read, about 300 lines to change, 12 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` — section 17.3 plan measures and full-identity sort tie rules.
2. `docs/plans/20-analytics-reset/reports/6-01c-plan-execution-paging-schema.md` — remaining unsupported sort fields.
3. The current plan list sort parser and keyset SQL.

## Goal

Support deterministic keyset sorting by every plan measure declared in CONTRACTS.md 17.3.

## Contract

Implement sort for `artifacts:<kind>`, `design_score:<check>`, `associated_cost_usd`, `unpriced_calls`, and `complete_share` using the same filter window and eligibility rules as the row values. Preserve stable tie-breaking by `(repo_id, plan)` and first-page cursor snapshot protection. Unsupported dimensions or malformed sort expressions remain named validation errors. No contract changes or new joins are authorized.

## Changes

- Add safe schema-validated dynamic field parsing for kind/check names; do not interpolate arbitrary user SQL.
- Ensure the next-page predicate and order use the same computed measure, direction, null ordering and full identity tie-break as page one.
- Add fixture tests for ascending/descending order, equal values, nullable scores and continuation without gaps or duplicates.

## Keep untouched

Preserve all other plan/execution/session/artifact behavior, `/schema`, legacy routes and Plan 21/22/23 design-only status.

## Done evidence

Identify or write a failing check before changing code and record output before and after.

- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'AnalyticsPlan' -count=1` passes for all declared plan sort measures and keyset continuations.
- Full bounded store/serve suite and `git diff --check` pass.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include before/after check output, deviations and any contract contradiction.
