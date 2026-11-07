# Brief: 4-02 — Close Phase 4 session outcome gaps

Consumer: Plan 20 Phase 4 follow-up worker.
Owned paths: `packages/yakka/internal/serve/analytics_entities.go`, `analytics_query.go` and focused serving tests; `packages/yakka/internal/store/session_entities.go`, focused store tests and existing coverage query code; `docs/design/03-remote-service.md`; this plan's report/runner records as assigned. Do not change `CONTRACTS.md` or add routes/grains/joins/dependencies.
Commits: Commit implementation and any focused tests in a plain-summary unit commit. The phase owner will close Phase 4 separately with the required trailer.
Report: Add a short remediation report at `docs/plans/20-analytics-reset/reports/4-02-session-outcome-remediation.md` before committing; state exact tests and any remaining gap.
Depends on: Unit 4-01 commit `b9c9ca0` and its report.
Runs alongside: nothing.

## Required reading

1. `docs/plans/20-analytics-reset/DESIGN.md`, Phase 4 outcome.
2. `docs/plans/20-analytics-reset/CONTRACTS.md`, 17.2–17.3 (schema, session/time measures/modes, entities request, typed coverage).
3. `docs/plans/20-analytics-reset/reports/4-01-capability-schema-and-session-grain.md`.
4. The current `analytics_entities.go`, `analytics_query.go` and `store/session_entities.go` implementation.

## Goal

Close only the Phase 4 omissions reported by unit 4-01:

1. Implement bounded numeric entity filtering for session rows (`where=<measure>:<lo>..<hi>` and/or equivalent numeric predicate exactly as already specified in 17.3). Null is not a match; validate measure names, bounds and budgets; return matching population totals. Do not introduce cohort semantics, arbitrary expressions, cross-grain predicates or a new grammar.
2. Implement the contract's schema-listed session `mode=aggregate` operations and their typed population/eligibility metadata with bounded SQL reads. Keep supported stats/fields/dimensions limited to signed session measures and lenses; do not silently truncate groups or scan unbounded rows into Go memory.
3. Complete the `/schema` coverage fields already listed in 17.2 using available tenant data: pending, per-kind scored/total distinct content, and pricing/catalogue/tool-kind revisions. If a named field is not represented locally, report the exact data gap rather than inventing a value or schema contract.

Preserve existing fields/defaults and truthful Phase 1–4 capabilities. Keep the Phase 5/6 capability set absent. Use the fixture and focused tests to prove filters, aggregates, coverage populations and errors. Any work that needs a contract change or a new grain/join/route/dependency is a stop-and-report item.

## Constraints

Stay in `/home/codyh/workspace/yakka-build/20` on `feat/20-analytics-reset`. Never push, merge, touch master/other branches/worktrees, production data, credentials or secrets. Never deploy or run `fly`/`wrangler`. Drizzle/DB migrations remain local-only. 8 GiB memory cap; if Vitest is used, max 3 workers; Playwright requires `PUBLIC_CANVAS_TEST_MODE=true`; no animation/timing tests.

## Done evidence

- Numeric `where` filters include/exclude exact fixture sessions and update typed totals; malformed and unsupported filters return documented errors.
- Each schema-advertised session aggregate mode returns fixture-matching values, whole-population totals and typed missing/null coverage under budget; unsupported modes are named errors.
- Schema coverage emits the existing contract's pending, per-kind scored/total, and revision fields with fixture assertions; no later-phase features appear.
- Run relevant store/serve tests under the memory/worker cap and record exact command/results.

Report status `done` or `done with concerns`, with each resolved/unresolved item plainly identified. Do not claim Phase 4 complete if an outcome gap remains.
