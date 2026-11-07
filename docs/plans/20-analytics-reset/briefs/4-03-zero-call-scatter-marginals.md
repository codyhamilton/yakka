# Brief: 4-03 — Preserve zero-call sessions in scatter marginals

Consumer: Plan 20 Phase 4 focused fixer.
Owned paths: `packages/yakka/internal/serve/analytics_entities.go`, `analytics_query_test.go`, and this report. The failing verification test is currently present as an uncommitted runner change in `analytics_query_test.go`; include it in the fix commit. Touch no other paths.
Commits: Commit the fix, regression test and report together in a plain-summary commit, without a phase trailer.
Depends on: Phase 4 units 4-01 and 4-02.
Runs alongside: nothing.

## Required reading

1. `docs/plans/20-analytics-reset/DESIGN.md`, Phase 4 outcome.
2. `docs/plans/20-analytics-reset/CONTRACTS.md`, 17.2–17.3 (session no-call/null behavior and whole-population scatter marginals).
3. `docs/plans/20-analytics-reset/reports/4-01-capability-schema-and-session-grain.md` and `reports/4-02-session-outcome-remediation.md`.
4. The failing `TestAnalyticsSessionScatterDeterministicSampleHasWholePopulationMarginals` in `analytics_query_test.go` and scatter implementation.

## Goal

Make session scatter marginals count the whole eligible session population when measures have no model-call rows, consistent with session semantics (no-call usage/cost values are zero) and the declared whole-population marginal contract. Preserve null/all-unpriced cost behavior and deterministic sample selection. Do not introduce a route, grain, join, dependency or contract change.

## Baseline evidence

Run from `packages/yakka`:

`GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestAnalyticsSessionScatterDeterministicSampleHasWholePopulationMarginals' -count=1`

Before fix it fails: for `tokens_in` and `tokens_out`, histogram marginal totals are 0 while the fixture population is 5,005. The response marks the sample deterministic with population 5,005 and returned 5,000, but no-call sessions are dropped from empty marginal bins.

## Constraints

Stay in `/home/codyh/workspace/yakka-build/20` on `feat/20-analytics-reset`. No push, merge, other branch/worktree, production data, credentials, secrets, deployment, `fly`, or `wrangler`. 8 GiB memory cap; no animation/timing tests.

## Done evidence

- The regression test passes; repeated requests return identical point rows, and each whole-population marginal sums to all 5,005 eligible sessions.
- Add/retain focused assertions that priced/unpriced cost eligibility remains distinct if the fix touches cost bins.
- Run focused test plus the bounded `./internal/store ./internal/serve` suites with `GOMAXPROCS=3 GOMEMLIMIT=8GiB` and `-p=3`; report exact outcomes.
- Report any remaining behavior that does not meet Phase 4's fixed outcome.
