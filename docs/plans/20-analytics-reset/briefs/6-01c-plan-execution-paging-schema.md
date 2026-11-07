# Brief: 6-01c — Plan and execution paging and schema closure

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/serve/analytics_entities.go`, `packages/yakka/internal/store/`, focused plan/execution tests and schema tests under `packages/yakka/internal/{serve,store}/`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-01c-plan-execution-paging-schema.md` and include it in the commit.
Depends on: 6-01b; Phases 1–5.
Runs alongside: Nothing; these are the remaining plan/execution route and schema seams.
Budget: 8 files to read, about 400 lines to change, 14 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` — section 17.1 pagination and 17.3 plan/execution sort, collection and schema rules.
2. `docs/plans/20-analytics-reset/reports/6-01-plan-execution-entities.md` and `6-01b-plan-execution-completion.md` — exact remaining concerns.
3. The current plan/execution entity handlers, cursor code and schema tests.

## Goal

Close the remaining plan/execution sort, cursor safety, schema, and detail paging evidence gaps reported by units 6-01 and 6-01b.

## Contract

Follow CONTRACTS.md 17.1 and 17.3 verbatim: supported plan measures sort with full-identity tie-breaks; list and detail cursors bind to the first-page receive watermark and derivation revision, and stale continuation returns the named error; detail collections retain their independent deterministic orders and population totals; `/schema` accurately describes implemented measures/lenses and publishes only complete feature flags. No new route, grain, join, dependency, or contract is authorized.

## Changes

- Complete plan sort fields supported by the plan measure table, with deterministic ties and keyset continuation.
- Apply existing first-page receive watermark/revision cursor behavior to plan/execution lists and plan detail collections.
- Update the schema's plan/execution measure and lens declarations to match implemented rows.
- Add fixture assertions for execution detail order, event ties, and cursor invalidation after receive-watermark/revision changes.

## Keep untouched

Preserve existing session/time/artifact behavior, legacy `/executions`, and Plan 21/22/23 design-only capability status. Do not implement cohorts or change CONTRACTS.md.

## Done evidence

Identify or write a failing check before changing code and record its output before and after.

- Focused `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Plan|Execution|Entity|Schema)' -count=1` passes with sort, stable continuation, tie, stale-cursor, and schema assertions.
- Full bounded store/serve suite and `git diff --check` pass.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include before/after check output, deviations and any contract contradiction.
