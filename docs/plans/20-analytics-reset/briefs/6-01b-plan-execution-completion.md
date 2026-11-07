# Brief: 6-01b — Plan and execution contract completion

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/serve/analytics_entities.go`, `packages/yakka/internal/store/`, focused plan/execution tests under `packages/yakka/internal/{serve,store}/`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-01b-plan-execution-completion.md` and include it in the commit.
Depends on: 6-01; Phases 1–5.
Runs alongside: Nothing; all work is on the existing plan/execution entity and schema surfaces.
Budget: 10 files to read, about 500 lines to change, 16 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` — section 17.3 plan/execution measure tables, entity sort and detail collection paging rules.
2. `docs/plans/20-analytics-reset/reports/6-01-plan-execution-entities.md` — exact first-unit gaps.
3. `packages/yakka/internal/serve/analytics_entities.go` and `packages/yakka/internal/store/plan_entities.go` — current implementation.

## Goal

Close the reported Phase 6 plan/execution contract gaps without changing the signed contract or existing route set.

## Contract

Follow CONTRACTS.md 17.3 verbatim. Add plan artifact counts by kind and latest design-version scores per check; execution brief/report scores and all schema-listed lenses; complete supported plan sort fields. Pin list/detail pagination to the existing fact receive watermark and derivation revision rules. Preserve independently paged detail collections and deterministic full-identity tie-breaking. No new route, grain, join, dependency, or capability beyond the signed plan/execution entities is authorized.

## Changes

- Complete row measures, lenses, and sort options identified in the report.
- Ensure cursors cannot silently cross a first-page receive watermark or derivation revision change; use existing shared cursor behavior where available.
- Add focused fixture coverage for plan execution detail ordering, event cursor ties, and stale continuation behavior.
- Keep Plan 21/22/23 capabilities absent unless an implemented feature is actually returned by `/schema`.

## Keep untouched

Preserve existing no-cohort semantics, legacy `/executions`, and existing session/time/artifact behavior. Do not implement cohorts or alter CONTRACTS.md.

## Done evidence

Identify or write a failing check before changing code and record its output before and after.

- Focused `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Plan|Execution|Entity)' -count=1` passes with fixture assertions for every added field, supported sort, paging order and stale cursor behavior.
- The full bounded store/serve suite passes and `/schema` advertises only implemented Phase 6 plan/execution capabilities.
- `git diff --check` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include before/after check output, deviations and any contract contradiction.
