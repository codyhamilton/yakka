# Plan 20 implementation

Tool: Codex execute skill
Run ID: feat/20-analytics-reset phase 3 execution
Start time: 2026-11-08 09:10 Australia/Brisbane (2026-11-07 23:10 UTC)

Previous run: feat/20-analytics-reset phase 1 execution, started 2026-11-08 04:48 Australia/Brisbane (2026-11-07 18:48 UTC).

## Phase 1 — Reset and shell

Refinement commit: `d570de6` (`docs: refine Plan 20 Phase 1 briefs`). It records three units and their dependencies in `DESIGN.md` and adds the three dispatchable briefs. The fixture and shell units are independent; release/serving depends on both. The first-design coarse check found the phase surfaces, contracts, observable outcomes and dependency order in place. `artifact_feedback` on each brief returned `delivered` / awaiting screen, with no rejection. No product work has landed yet.

### `1-02-framework-free-shell.md`

- Outcome: committed as `505360a`; replaced SvelteKit with the static shell, URL codec, schema-driven transport, scheduler, theme bootstrap and vendored uPlot; added the test-only harness and package README.
- Surfaces: `packages/yakka-analytics/`.
- Verification: Node suite 13/13; `python3 tools/release/test_layout.py` 7/7; system Chrome confirmed deep-route shell rendering, fixture-summary probe, unknown-route fallback and verbatim legacy `range too wide` without retry. No animation/timing assertions.
- Deviations and carried items: Playwright-core is unavailable, so its Chromium acceptance remains outstanding. The worker left `wrangler.toml` unchanged per the brief although DESIGN/CONTRACTS specify `./web`; the release/serving unit must resolve this. Release embedding and headers remain unverified.
- `artifact_feedback`: delivered, screen pass (`jev-1.13.0`).
- gate: provide Playwright-core in the phase test environment and run the Chromium shell harness.

### `1-01-fixture-ledger.md`

- Outcome: committed as `2b4d2c3a7a0c3690982e7131d9fae7fbe2744ee2`; added the non-shipping deterministic ledger generator and manifest covering the populations, relations, chronology and resource boundaries in the brief.
- Surfaces: `packages/yakka/internal/analyticsfixture/`.
- Verification: `GOMEMLIMIT=8GiB go test ./internal/analyticsfixture -count=1 -v` passed; generated-ledger assertions cover exact manifest counts, timestamp bounds, shared bodies, scorer-specific scores, session repo cardinalities, three execution shapes, rejection stages and the unpriced tail. Candidate comparison selected batch append: same 5,015-event oracle, 196 ms versus 11.855 s for single-row append.
- Deviations and carried items: none. The 32,767-hash fixture takes about 187 seconds to generate and verify; later tests should construct it once per setup and reuse it.
- `artifact_feedback`: delivered, screen pass (`jev-1.13.0`).

### `1-03-release-and-serving.md`

- Outcome: committed as `aacab5eb85827459043a7a2a13f92837fbec251e`; release embeds the framework-free `web/` tree without Node/npm, restores the placeholder on success/failure, and serves generic cache/security policy with ETag revalidation. Pages output is `./web`.
- Surfaces: `tools/release/`, `packages/yakka/internal/serve/site.go`, `packages/yakka/internal/serve/site_test.go`, `packages/yakka-analytics/wrangler.toml`, `.dockerignore`, `docs/design/07-analytics-site.md`, `docs/design/system-architecture.md`, and `docs/plans/20-analytics-reset/CONTRACTS.md`.
- Verification: release suite 11/11 with an isolated PATH lacking Node/npm; `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestSite' -count=1` passed; Node shell suite 13/13; layout checks 7/7; `git diff --check` passed. Builds embed the app/uPlot but exclude `_headers`; placeholder restoration is checked for success and failure.
- Deviations and carried items: the brief's `./build` instruction conflicted with the signed design/contract; `./web` was applied. `GOTOOLCHAIN=auto` is needed for the release build because the installed local Go version is older than the module's declared version. The full-server OAuth API handler shadows the UI callback path in local mode; route integration remains for Phase 2, as stated in the updated contract.
- `artifact_feedback`: delivered, screen pass (`jev-1.13.0`).
- gate: verify the external Pages automation accepts `./web` as its output directory.

### Phase 1 verification and closure

- Entry point → action → result: the committed test harness serves `/__test/fixture-summary-probe` from the embedded manifest; shell tests observe the summary, uncapped URL round-trip, legacy limit message without automatic retry, request deduplication/abort/four-request cap, and unknown-route fallback. The built Go site serves direct client routes with the committed app, generic cache/security headers and correct ETags; the release harness confirms no-Node embedding and placeholder restoration.
- Final checks on the integrated branch: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/analyticsfixture -count=1` passed (306.215 s); `GOMAXPROCS=3 python3 -m unittest tools.release.test_release` passed (11); `PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test packages/yakka-analytics/tests/*.test.mjs packages/yakka-analytics/tests/e2e/*.test.mjs` passed (13); `python3 tools/release/test_layout.py` passed (7); `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestSite' -count=1` passed. No animation or timing tests were used.
- Playwright-core is unavailable in this worktree, so the Playwright Chromium harness was not run; system Chrome smoke evidence is recorded in the shell report.

Carried

- Playwright-core browser harness run when available.
- Verify the external Pages automation accepts `./web` as its output directory.
- Phase 2 reconcile the local full-server `/oauth/callback` route collision while preserving the remote API callback.
- Reuse the 32,767-hash fixture once per test setup; its generation and verification take about 187 seconds.

## Phase 2 — Identity flows

Tool: Codex execute skill
Run ID: feat/20-analytics-reset phase 2 execution
Start time: 2026-11-08 05:42 Australia/Brisbane (2026-11-07 19:42 UTC)

Inline refinement: Phase 2 is one unit. The brief `2-01-identity-flows.md` is committed before implementation and covers the session gate, account routes, device login, credential handling and local/remote OAuth callback routing under CONTRACTS.md. The Phase 1 carried callback collision is included in the route seam. `artifact_feedback` pending for the brief.
`artifact_feedback` on the inline brief returned `not delivered`: the service has no version and nothing is queued, even after retrying with an absolute path. Recorded; proceed with local contract verification.

### `2-01-identity-flows.md`

- Outcome: committed in the phase-closing commit; added safe return-path and session-gate contracts, credential-aware account requests, and Login, OAuth callback, Device, Profile and Settings UI flows. Local `/oauth/callback` serves the shell; remote collector mode retains the JSON callback API.
- Surfaces: `packages/yakka-analytics/web/contract/`, `web/js/identity/`, `web/js/app.js`, `packages/yakka/internal/serve/serve.go`, focused tests.
- Deviations: none identified against the brief or CONTRACTS.md. No Plan 21/22/23 capability was invented.
- Unit evidence: report `reports/2-01-identity-flows.md`; `artifact_feedback` on the report and brief both returned delivered / screen pass (`jev-1.13.0`). Worker-reported checks: Node identity/static-shell/scheduler 12 passed; focused Go callback routing passed; syntax checks passed.

### Phase 2 verification and closure

- Entry point → action → result: `GET /oauth/callback?code=x&state=y` through `Server.Handler()` returns the embedded static shell in local mode and the JSON callback handler's unauthorized response in remote mode. Focused browser-contract tests cover safe callback targets, sign-in returns, the session gate, tenant recovery, auth headers and normalized device approval fields. The Chromium UI smoke could not run because `playwright`, `@playwright/test`, `playwright-core` and Vitest are absent, and the installed Chromium Snap wrapper fails to start (`snap-confine` missing `cap_dac_override`).
- Independent checks: `PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test packages/yakka-analytics/tests/identity/contracts.test.mjs packages/yakka-analytics/tests/static-shell.test.mjs packages/yakka-analytics/tests/request-scheduler.test.mjs` passed 12/12; `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestOAuthCallbackRouteIsShellLocallyAndJSONRemotely|TestSiteHandlerDirectCallbackFallback' -count=1` passed. No animation/timing tests or live systems were used.
- `artifact_feedback`: report and brief delivered / screen pass (`jev-1.13.0`).
- gate: provide a working Playwright/Chromium harness and verify the Pages-faithful callback, device approval, profile/token and Settings flows end to end.

Carried

- Playwright browser acceptance for the complete identity flow; runner/browser unavailable in this worktree.
- Verify that external Pages automation accepts `./web` as its output directory (Phase 13).
- Reuse the 32,767-hash fixture once per test setup; its generation and verification take about 187 seconds (Phase 3).

## Phase 3 — Bounded range reads

Refinement commit: `d46453e883a962681e5349286c4d96c3b689b651`; four sequential units. The 32,767-hash fixture reuse was assigned to 3-02. Identity browser acceptance and the external Pages output check were bounced as unrelated to Phase 3. Before closing, runner `artifact_feedback` on all four briefs and reports returned delivered / screen pass (`jev-1.13.0`), with no flagged checks.

### `3-01-range-resolution.md`

- Outcome: committed as `95e8c13`; removed shared width rejection, accepted `all=1` from the signed nanosecond minimum, added explicit time-bound errors, and added `/query` auto-range metadata and cell/series budget errors.
- Surfaces: `packages/yakka/internal/serve/analytics.go`, `analytics_query.go`, their focused tests, `CONTRACTS.md`, and `docs/design/03-remote-service.md`.
- Deviations and carried work: route-side only; year and multi-year grouping/auto retry and pre-slice cell planning remain for 3-02. Full serve tests identify two stale expectations outside this unit's ownership: `TestDistributionRangeTooWide` and `TestScoreSeriesRangeTooWide` still require legacy 400s.
- Verification: focused `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestAnalytics(Query|Schema|Outcome)' -count=1` passed; full serve suite failed only those two stale expectations. `git diff --check` passed. Before/after regression evidence and the candidate comparison are in `reports/3-01-range-resolution.md`.

### `3-02-bounded-aggregation.md`

- Outcome: committed as `f415d72`; usage, distribution and score-series scanned-row aggregation now runs in SQLite, including exact percentile/rank logic and a 32,767-hash score-series join. Internal year and multi-year bucket expressions were added without changing the legacy public bucket list.
- Surfaces: owned aggregate store paths (`usage.go`, `query.go`, `distribution.go`, `score_series.go`, and rollup files/tests).
- Deviations and carried work: no heap-growth measurement was recorded; the SQL shape removes input-row collections but allocation independence still needs direct evidence. Serve integration must connect auto retry to internal year buckets and executable suggestions. The two stale serve assertions remain to update in the serving unit. The 14-turn budget was exceeded.
- Verification: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store -count=1` passed, including 32,767 distinct scored hashes; focused store checks and `git diff --check` passed. Full report and candidate comparison: `reports/3-02-bounded-aggregation.md`.

### `3-03-paged-reads-and-coverage.md`

- Outcome: committed as `b49316f`; `/series` uses the requested IANA timezone for daily and Monday-start weekly buckets, conversation usage events expose pricing, and conversation/distribution/score-series report compaction coverage. The two stale wide-window expectations now accept successful responses.
- Surfaces: owned conversation/distribution/score-series handlers, store conversation/analytics paths and corresponding tests.
- Deviations and carried work at unit landing: `/explore` keyset traversal with receive watermark, explore-event `priced`, and route-wide partial metadata were left for 3-04 because the shared handler was outside this brief's owned paths. Unit 3-04 completed those items; the final 20,005-row traversal proof is recorded in `reports/3-04-runner-note.md`.
- Verification: before, the two stale wide-window tests failed with 400-vs-200. After, `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed; `git diff --check` passed.

### `3-04-runtime-bounds-and-benchmark.md`

- Outcome: committed as `492fc80`; added a one-second measured query deadline, driver cancellation and reader-release behavior, a four-request tenant heavy-read bound, `/explore` keyset traversal with first-page watermarks and `priced`, auto year-step retries, executable overflow suggestions, and route-wide partial reasons. The fixture benchmark now covers all-time and auto.
- Surfaces: `serve/{analytics.go,analytics_query.go,analytics_score_series.go,serve.go}` and focused analytics tests/benchmark; `store/{analytics.go,analytics_test.go}` for keyset page/watermark queries.
- Deviations and carried work: the brief's original path list omitted handler and store paths needed by its fixed outcome; it has been amended to record the clarified implementation ownership. Usage/distribution allocation comparisons were added in the runner follow-up; ScoreSeries has no cross-size allocation comparison. The optional real-corpus benchmark needs owner-provided data.
- Verification: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed; cancellation/deadline and heavy-read concurrency tests passed; fixture benchmark completed 2,647 cases (max observed p95 4.4 ms, all-time/auto max p95 4.1 ms) against the 500 ms target; `git diff --check` passed. Full evidence/candidate comparison is in `reports/3-04-runtime-bounds-and-benchmark.md`.

### Phase 3 verification and closure

- Entry point → action → result: `/v1/analytics/query` accepts all-history and ten-year ranges without changing requested bounds, coarsens the calendar resolution under cell pressure, and returns a documented budget error rather than clipped rows. `/v1/analytics/explore` pages a 20,005-row equal-time fixture in 20,000 + 5 rows with distinct keys and no omissions; route-level tests confirm cursor round-trips. Timezone, pricing and partial-coverage fields match fixtures. Runtime tests observe query deadline interruption, reader reuse, no partial response and tenant concurrency rejection.
- Independent integrated verification: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed after the histogram and 20,005-row cursor follow-ups (store 7.349s; serve 24.905s). Allocation-growth tests passed for usage and distribution at 16× input rows. `git diff --check` passed.

Runner note: the first allocation-growth check found distribution histogram binning scanned every SQLite sample into Go. A follow-up change moved bin counts into SQL and added 16x input-size allocation comparisons for usage and distribution (128 vs. 2,048 rows); both passed. ScoreSeries retains only result buckets and its 32,767-hash regression passes, but a cross-size Go allocation comparison is not recorded. See `reports/3-04-runner-note.md`.

Carried

- Usage and distribution allocation comparisons passed at a 16× scanned-row increase (usage 3,288 → 3,288 bytes; distribution 21,360 → 21,856 bytes). ScoreSeries succeeds with 32,767 distinct hashes and retains only bounded result buckets, but no cross-size allocation comparison was recorded; the peak-retention claim for that path remains based on its streaming SQL-temp-table implementation shape.
- Run the analytics benchmark against an owner-provided real ledger via `YAKKA_BENCH_DIR` for additional corpus evidence.
- Playwright browser acceptance for Phase 2 identity flows remains outstanding (carried from Phase 2; not a Phase 3 blocker).
- Verify the external Pages automation accepts `./web` as its output directory (release readiness).
