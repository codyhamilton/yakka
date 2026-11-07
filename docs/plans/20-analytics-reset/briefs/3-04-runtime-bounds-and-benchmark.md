# Brief: 3-04 — Runtime bounds and benchmark

Consumer: Plan 20 Phase 3 server worker.
Owned paths: `packages/yakka/internal/serve/{analytics.go,analytics_query.go,analytics_score_series.go,serve.go,analytics_test.go,analytics_query_test.go,analytics_bench_test.go,analytics_runtime_test.go}`, `packages/yakka/internal/store/{analytics.go,analytics_test.go}`, plus any new focused test file under `packages/yakka/internal/serve/` or `store/`. The handler and store paths are included to integrate the already-designed `/explore` cursor/watermark, auto-resolution, deadline and route-wide coverage contracts; they add no new route, grain, join or capability. Touch nothing else.
Commits: Include the implementation and report in a plain-summary unit commit; phase owner closes the phase record separately.
Report: before committing, write `docs/plans/20-analytics-reset/reports/3-04-runtime-bounds-and-benchmark.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the phase commit.
Depends on: 3-01 Range resolution and budget responses; 3-02 Bounded aggregate storage reads; 3-03 Paged reads and honest coverage.
Runs alongside: nothing.
Budget: 8 files to read, about 500 lines to change, 12 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 3 outcome and p95 contract.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — sections 12 and 17.1.
3. `packages/yakka/internal/serve/analytics.go` and `analytics_bench_test.go` — existing handler and benchmark.
4. SQLite driver context/cancellation documentation or source as needed; do not infer driver behavior from HTTP cancellation alone.

## Goal

Prove and enforce request deadlines, cancellation, heavy-read concurrency and the unchanged p95 bound for the Phase 3 range domain.

## Contract

`CONTRACTS.md` 17.1 is binding: `/schema` publishes measured `deadline_s`; deadline returns 503 `query_timeout` with retry hints and no partial body; cancellation stops the statement and releases the reader; per-tenant heavy-read concurrency returns 503 `busy` and `Retry-After` beyond its bound. Phase 3 explicitly requires these properties and adds all-time/`auto` to the existing p95 benchmark.

## Changes

Compare driver-native interruption with any supported cancellation mechanism and prove which actually interrupts an executing statement and releases the reader. Compare a bounded semaphore strategy against any existing pool-level bound for heavy reads; choose using deterministic tests for cancellation, deadline and competing requests. Set the default deadline from measured fixture latency against the Phase 3 benchmark domain, not by guessing. Add all-time and `auto` benchmark cases while preserving the existing p95 target and four-request client assumption; do not weaken the target to make a candidate pass.

### Keep untouched

Do not read a production ledger, credentials or secrets, or contact/deploy to a live system. A real-corpus benchmark requires `YAKKA_BENCH_DIR`; record it as a gate if unavailable. Do not change the worktree/branch or run `fly`/`wrangler`.

## Done evidence

Identify or write failing checks before changing code. Report outputs before and after.

- Deterministic cancellation test shows the underlying read stops and releases its reader; deadline and concurrency tests assert exact status/code/retry behavior and no partial response.
- Benchmark includes all-time and `auto` and meets the existing p95 contract on the fixture.
- If real-ledger benchmark data is absent, report `gate: run the analytics benchmark with owner-provided YAKKA_BENCH_DIR`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include candidate comparison, checks before/after, deviations and contradictions.
