# Brief: 13-03 — Pages-faithful account and route proof

Consumer: the Phase 13 acceptance worker and identity-flow owner.
Owned paths: `packages/yakka-analytics/tests/identity/`, `packages/yakka/internal/serve/site_test.go`, `docs/plans/20-analytics-reset/reports/13-03-identity-and-routes.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/13-03-identity-and-routes.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: Nothing.
Runs alongside: 13-01 browser matrix; 13-02 pageset smoke; 13-04 release docs and checks.
Budget: 9 files to read, about 450 lines to change, 12 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 13; Phase 2 outcome; Identity UI and Serving/release/Pages domains.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 2.1–2.3; 3.5–3.7; 5–6; 10.1–10.2; 17.6–17.7.
3. `docs/plans/20-analytics-reset/IMPLEMENTATION.md` — Phase 1 `1-03` outcome/gate and Phase 2 outcome, verification and carried browser gate.
4. `packages/yakka/internal/serve/{serve.go,site.go,site_test.go}` — registration condition and current real mux test. Read the selected ranges around `Server.Handler`, `/oauth/*`, site fallback and `TestOAuthCallbackRouteIsShellLocallyAndJSONRemotely`.
5. `packages/yakka-analytics/tests/identity/contracts.test.mjs`, `web/js/identity/`, `web/js/core/`, `web/contract/` — settled account behavior and current pure-only tests.
6. `packages/yakka-analytics/tests/{workspace,plans-artifacts}/browser.mjs` and the stub harnesses — current Playwright loader and topology conventions.

## Goal

Prove account flows against the Pages-faithful identity rig and prove full-mux local/remote route ownership. The known Phase 1 report's callback concern is not presumed current: current code registers `/oauth/login` and `/oauth/callback` only when `cfg.Remote()`, `site_test.go` already asserts local callback shell and remote callback JSON, and local catch-all serves `/device`, `/login`, `/profile`, and `/settings`. Fix serving/mux code only if this unit demonstrates an actual remaining gap named by Phase 13.

## Contract

DESIGN.md Phase 13: “Account flows pass the Pages-faithful rig; embedded local `/device` and `/oauth/callback` serve the shell while remote `/oauth/callback` retains the API JSON route.”

CONTRACTS.md 10.1: “On an embedded remote serve `/oauth/callback` is the API's JSON callback, not a UI page”; local non-file routes return `index.html`. CONTRACTS.md 10.2: “Pages serves unknown paths as `/` when there is no `404.html`”. CONTRACTS.md 17.7 requires a Pages-faithful host-mapped identity rig and no fixed sleeps.

Settled: do not alter OAuth/device request contracts or production route policy. Existing focused Go route test passed during refinement (`GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestSiteBuiltMode|TestOAuthCallbackRouteIsShellLocallyAndJSONRemotely' -count=1`: pass). The account rig must remain local/stubbed and use the existing Chromium 1243 cache and Playwright-core.

## Changes

Extend the identity browser tests to cover signed-out deep-link return, callback success/denial/error, device code preservation and approval/deny, profile tenant/token operations, Settings bearer/base behavior and sign-out. Use a contract-faithful stub with Pages/API host mapping and a throwaway test certificate per 17.7; no live GitHub, API, tenant or credential.

Strengthen full-mux route evidence in `site_test.go` for local `/device`, `/oauth/callback`, `/login`, `/profile`, `/settings` (shell HTML), and remote `/oauth/callback` (JSON API response). The existing current route behavior is already correct; do not modify serve.go unless a failing test proves a Phase 13 route gap. Include the observed callback proof in the report either way.

Use `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules`, `PUBLIC_CANVAS_TEST_MODE=true`, `NODE_OPTIONS=--max-old-space-size=8192`, `--test-concurrency=1`, `TMPDIR` in-worktree, and Go memory cap 8G. Wait on explicit DOM state/URL/requests, never fixed sleeps or animation.

### Keep untouched

Keep `serve.go` and all OAuth/device product contracts untouched unless a test demonstrates a route gap. Do not modify identity production modules, Pages config, external automation, secrets, `fly.toml`, live tenants or stale `tests/e2e/*.spec.ts` and `tests/hosted/*.ts`.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `TMPDIR=/home/codyh/.cache/plan20p13 NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test --test-concurrency=1 packages/yakka-analytics/tests/identity/*.test.mjs` → existing contracts tests remain 6/6 or higher; new browser account-flow test has a fixed reported subtest count and no skips.
- `TMPDIR=/home/codyh/.cache/plan20p13 GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestSiteBuiltMode|TestOAuthCallbackRouteIsShellLocallyAndJSONRemotely' -count=1` → 2/2 named tests pass; assertions cover local shell paths `/device`, `/oauth/callback`, `/login`, `/profile`, `/settings` and remote callback JSON.
- Browser evidence → Pages/API host-mapped rig; account operations and signed-out return settle; max 4 requests in flight; zero unexpected console/page/CSP errors; no live service or credential accessed.
- `git diff --check` → clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, before/after test output, account-flow subtest counts, callback/device route results, any actual mux fix or explicit no-gap finding, deviations, contradictions, carried items, and any `gate:` line.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
