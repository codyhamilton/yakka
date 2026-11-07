# Brief: 6-01 — Plan and execution entities

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/serve/analytics_entities.go`, `packages/yakka/internal/store/`, focused entity tests under `packages/yakka/internal/{serve,store}/`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-01-plan-execution-entities.md` and include it in the commit.
Depends on: Phases 1–5.
Runs alongside: Nothing; the remaining Phase 6 units share the entity route, store, or schema surfaces.
Budget: 12 files to read, about 700 lines to change, 18 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` — section 17.3 entity identities, plan/execution measures, `/entities`, `/entity`, typed populations, shared filters, deadlines and non-goals.
2. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 6 outcome and Phase 5 closure/Carried.
3. `packages/yakka/internal/serve/analytics_entities.go` and existing execution store/query code — actual Phase 4–5 implementation.

## Goal

Implement plan and execution rows and plan detail collections under the identities, measures and paging contract in CONTRACTS.md 17.3. Preserve plan association cost as overlapping session cost, with shared-session and missing-pricing coverage.

## Contract

Use the exact identities, sort orders, row shape, typed population semantics, measure/lens tables and independently paged detail collections in CONTRACTS.md 17.3. Plan associated sessions are many-to-many and their cost is non-additive across plans. Execution shape is process completion, not success. Entity membership follows in-window facts while selected artifact/session attribution is lifetime-derived as specified. No new route, grain, join, dependency or contract is authorized.

## Changes

- Add `plan` and `execution` to the existing `/v1/analytics/entities` and `/entity` contract paths, including only the listed measures, lenses and collection orders.
- Reuse existing fact tables and identity rules; do not add stored tables or infer phases, reviews, outcomes, authorship or missing associations.
- Keep each plan collection independently cursor-paged with population totals and the existing receive watermark/revision/deadline/cancellation behavior.
- Do not publish a feature capability until its implementation and tests are complete. Do not add cohort behavior in this unit.

### Keep untouched

Preserve all existing session, time and artifact behavior and legacy `/executions` response semantics. Preserve the design-only status of Plans 21/22/23; detect capabilities only through `/schema` and never synthesize their data.

## Done evidence

Identify or write a failing check before changing code. Report its output before and after.

- Focused `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Entity|Execution|Plan)' -count=1` → passes with fixture plan/execution identity, sorting, cursor continuation, collection totals, process shapes, shared-session overlap and null/lower-bound pricing assertions.
- Fixture assertions cover all detail collections and ensure ties use the contract's full identity; no page silently drops rows.
- Existing analytics schema/route tests → legacy defaults remain stable; Plan 21/22/23 feature flags remain absent.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include before/after check output, deviations and any contract contradiction.
