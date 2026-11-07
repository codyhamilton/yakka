status: done with concerns

## What changed

- Removed the SvelteKit source, route tree, build configs, package manifests, and build scripts from `packages/yakka-analytics/`.
- Added a framework-free static shell with route fallback/not-found rendering, URL state codec, capability-schema request, credential-aware transport, request deduplication/abort/four-request limit, first-paint external theme bootstrap, CSP-compatible headers, and the pinned uPlot 1.6.32 files with the contract SHA-256 evidence.
- Added Node checks and a test-only HTTP harness. Its fixture-summary endpoint receives the deterministic `Summary` shape from the 1-01 fixture generator; legacy `/schema` absence and `range too wide` responses stay in the test harness, not the product tree.
- Replaced README build/test/release fields with the no-build package instructions. `wrangler.toml` is unchanged.

## Checks before and after

Before: the target `web/` and shell tests did not exist in HEAD. `git ls-tree -r --name-only HEAD packages/yakka-analytics` showed `package.json`, Svelte `src/` routes and library files, plus Vite/Svelte configs. The old README required `npm run build`; the old `params.ts` contained the 399-day clamp. There was no target shell/scheduler/legacy/fixture-summary check to run.

After:

- `node --test packages/yakka-analytics/tests/*.test.mjs packages/yakka-analytics/tests/e2e/*.test.mjs` — 13 passed, 0 failed. Covers route/not-found and idle marker, URL round-trip including repeated/unknown keys and uncapped windows, request dedupe/abort/four-request cap, legacy error/retry behavior, fixture-summary test endpoint, no-build/secret scan, and uPlot integrity.
- `python3 tools/release/test_layout.py` — 7 passed.
- System Chrome headless against the test harness — deep route `/plans/repo/plan` rendered `Details` with `data-idle="true"`; `/__test/fixture-summary-probe` rendered the 1-01 manifest and counts; `/__test/legacy-limit-probe` rendered `range too wide|retry=`. An unknown path rendered `Not found` in the shell. No animation or timing assertions were used.
- `git diff -- packages/yakka-analytics/wrangler.toml` — empty.

## Departures, issues, and unfinished work

- The contract calls for Playwright-core Chromium coverage, but Playwright-core is not installed in this worktree. The shell was smoke-checked in system Chrome and the functional checks ran in Node. No Playwright package was added because the package contract removes package manifests and build dependencies. The Playwright-specific run remains outstanding.
- The framework-free shell leaves later-phase views as shell destinations; no analytics pages, identity flows, new routes, or chart interactions were added.
- `wrangler.toml` remains at `./build` as required by this brief. DESIGN.md Phase 1 / CONTRACTS.md 17.6 instead target `./web` and include `wrangler.toml` in Phase 1. This scope conflict is left for the release/serving unit; it was not resolved silently.
- Release embedding/cache/security behavior is not verified by this unit; the release/serving unit owns those paths.

gate: provide Playwright-core in the phase test environment and run its Chromium shell harness before treating the Playwright-specific browser acceptance as verified.
