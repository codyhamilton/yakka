# Plan 20 implementation

Tool: Codex execute skill
Run ID: feat/20-analytics-reset phase 1 execution
Start time: 2026-11-08 04:48 Australia/Brisbane (2026-11-07 18:48 UTC)

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
