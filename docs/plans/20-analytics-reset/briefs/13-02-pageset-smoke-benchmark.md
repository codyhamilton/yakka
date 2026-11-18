# Brief: 13-02 — Server pageset smoke and p95 alignment

Consumer: the Phase 13 acceptance worker and server-maintenance owner.
Owned paths: `packages/yakka/internal/serve/analytics_pageset_test.go`, `packages/yakka/internal/serve/testdata/browser-request-shapes.json`, `docs/plans/20-analytics-reset/reports/13-02-pageset-smoke-benchmark.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/13-02-pageset-smoke-benchmark.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 13-01 browser release matrix and request-shape record.
Runs alongside: 13-03 identity and route proof; 13-04 release docs and checks.
Budget: 7 files to read, about 350 lines to change, 10 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 13 outcome and the unchanged p95 statement in Architectural Implications.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 12 (500 ms p95); 17.1 (all-history and budgets); 17.7 (deterministic fixture); Phase 13-referenced section 7 route semantics if needed.
3. `packages/yakka/internal/serve/testdata/browser-request-shapes.json` — exact 13-01 record.
4. `packages/yakka/internal/serve/analytics_pageset_test.go` — current smoke, profiler, data format and stale generated request sets.
5. `packages/yakka/internal/serve/analytics_bench_test.go` — current fixture source, benchmark threshold and gate.
6. `packages/yakka/internal/analyticsfixture/{fixture.go,manifest.json}` — committed deterministic data, not a tenant source.

## Goal

Make the ungated server smoke and environment-gated page profiler consume the deterministic browser-recorded request shapes, including all-history, and keep p95 measured against the existing 500 ms contract. The test data must describe current workspace requests, not the deleted Overview/Usage pages.

## Contract

DESIGN.md Phase 13: “Browser-recorded request shapes including all-history are covered by server smoke/benchmark tests under the existing p95 contract.”

CONTRACTS.md 12: “The bound is **p95 under 500 ms per case**”; “Phase 13 replaces these sets with the request shapes recorded from the shipped boards, so the smoke and profiling tests cover what ships.”

CONTRACTS.md 17.1: “Every windowed analytics route accepts `all=1`.”

Settled: retain an ungated smoke over the committed small fixture and the current profiling gate; the profile must use only a temporary copy of deterministic committed fixture data. Do not change routes, server contracts, p95 threshold, fixture populations or performance policy. The test must prove the recorded request set is non-empty and every recorded request returns 200; benchmark outputs must identify the exact case count and enforce p95 <=500 ms.
Environment note: the worker sandbox blocks writes outside the worktree, so `TMPDIR` is the gitignored in-worktree `.scratch/p13` (never `/tmp`); remove it before the closing commit.

## Changes

Replace the Overview/Usage constants and 399-day assumptions with a strict parser for 13-01's committed record and exact request paths. Preserve the current max-four concurrency in smoke/profile, response status checks, useful test logs, and EXPLAIN output for slow requests where it remains applicable. Keep output deterministic except measured timing fields. Add a clear gate invocation for the profiler that selects the committed fixture via the existing fixture generator/helper; do not point `YAKKA_BENCH_DIR` at any user/live tenant. If an invocation cannot be expressed without a new product contract or changing the p95 rule, stop and name the design gap rather than weakening the benchmark.

Set `TMPDIR` to an in-worktree scratch directory for Go's temp copies; memory cap `GOMEMLIMIT=8GiB`, `GOMAXPROCS=3`, `-p=3`. No `/tmp`, live server, production ledger, secret, deploy or tenant action.

### Keep untouched

Keep server routes/contracts, benchmark threshold, analytics fixture generator and all other benchmark files unchanged. Do not “fix” a failing shape by dropping it, changing its parameters or clipping the all-history window. The record is captured against the deterministic first-party stub, whose advertised capability set is a superset of the Go server's; a recorded shape that the Go server explicitly refuses (HTTP 400 naming an unsupported dimension, field, mode, check or scorer) is the documented capability-degradation path and is accepted as such. Any 5xx, unexpected 4xx, or refusal message that does not name an unsupported capability still fails the smoke.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `mkdir -p .scratch/p13` → scratch directory exists outside `/tmp`.
- `TMPDIR=.scratch/p13 GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run '^TestAnalyticsPageSetSmoke$' -count=1` → 1/1 test passes; it parses every committed record entry, asserts the record's pinned request count, and every request returns HTTP 200 or a documented capability refusal (HTTP 400 naming an unsupported dimension, field, mode, check or scorer). It asserts the exact 200/refusal split (currently 60 served, 15 documented refusals over the committed 75-request record) and fails on any 5xx or unnamed refusal.
- `TMPDIR=.scratch/p13 GOMAXPROCS=3 GOMEMLIMIT=8GiB YAKKA_PAGESET_PROFILE=fixture go test -p=3 ./internal/serve -run '^TestAnalyticsPageSet$' -count=1 -v` → 1/1 profiler passes on the committed fixture; exact case count equals the record count, the documented refusals are excluded from timing, and every served case's p95 is <=500 ms. Keep this environment gate opt-in and document it in the test comment. If the current test seam needs another gate name, document the chosen name in the report and the exact command.
- `git diff --check` → clean.
- Data audit → committed JSON is request metadata only and includes a canonical `all=1`; the fixture is test-only, generated from the committed analyticsfixture package, and all temporary copies are removed.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, check output before/after, exact request/case count and 200/refusal split, max p95 over served cases, deviations, contract contradictions, carried items, and any `gate:` line.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
