# Brief: 6-07 — Schema-driven cohort proof

Consumer: the Phase 6 server worker.
Owned paths: focused test files under `packages/yakka/internal/serve/` and `packages/yakka/internal/store/`, `packages/yakka/internal/serve/analytics_query.go` (the `features.cohort` flag only), and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-07-cohort-proof-enumeration.md` and include it in the commit.
Depends on: 6-06.
Runs alongside: Nothing; closes the phase outcome.
Budget: 8 files to read, about 300 lines to change (mostly tests), 16 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.3.1 — Offer implies resolve; Valid/empty/invalid/unsupported; Invariants proved by fixtures.
2. `docs/plans/20-analytics-reset/DESIGN.md` Phase 6 outcome.
3. `packages/yakka/internal/serve/analytics_query.go` and the fixture helpers in the serve tests.

## Goal

Prove, from the published schema rather than a hand-written list, that every pair `/schema` offers for every grain resolves or is named `undefined`, and advertise `features.cohort` only after that proof and the route rule hold.

## Contract

- A schema-driven enumeration (read `/schema.grains` and `/schema.features`, not a literal list) builds a minimal valid cohort for every published `predicate` measure/lens on every grain, on the fixture, and asserts the resolver answers it (or, for a pair listed in `undefined`, returns 400 `unsupported_join` with a reason). It also asserts every accepting route in 17.3.1 resolves and every refusing route returns `route_not_supported`.
- Invariants: (1) association identity on every response; (2) distinct sessions from rejections equal the distinct existing sessions of associated rows; (3) on a session target `cohort_n(include) + cohort_n(exclude) = scope_n`; (4) a frozen scope reproduces `/entities?grain=g`'s population with the same filters, on a two-harness / `(mixed)`-model fixture; (5) `scope.exclude` and `op=exclude` differ on a fixture where they differ.
- `features.cohort` is advertised only when the enumeration passes on the fixture.

## Changes

- Write the enumeration and invariant tests. If a test exposes a genuine gap in 6-02..6-06, make the smallest correct fix inside those units' owned paths and record it; a gap that needs a new grain, join, route or contract change is a contradiction — stop and report it.
- Flip `features.cohort` to true only after the enumeration test passes.

### Keep untouched

Do not weaken an assertion to make it pass. Do not add a hand-maintained allow-list of pairs. Do not add a new route, grain or join.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- With `features.cohort` still absent, the enumeration test either passes (all pairs resolve) or fails naming the pair; after the fixes it passes and `features.cohort` is true.
- The five invariants pass on fixtures.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` → passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, check output before and after, any gap fixed in an earlier unit, deviations, and any contradiction. Never resolve a contradiction silently.
