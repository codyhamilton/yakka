# Brief: phase3-04 — Phase 3 proof and three-phase union regression

Consumer: a proof/test build worker for Plan 30 phase 3, final wave.
Owned paths: new `packages/yakka-analytics/tests/operable-chrome/phase3-harness.mjs`; new `packages/yakka-analytics/tests/operable-chrome/phase3-acceptance.test.mjs`; the Phase 3 report below. You may make a minimal corrective edit inside the Phase 3 product paths owned by `phase3-01`, `phase3-02` or `phase3-03` only if an executed proof exposes a defect, and you must name that edit and its owning unit in the report. Touch no other product or test file.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: write `docs/plans/30-analytics-operable-chrome/reports/phase3-04-proof-harness.md` with every ID in the Phase 3 outcome, pass/fail and exact evidence, the union-regression results from separate processes, and the deployment/legacy-capability record. Include it in the commit.
Depends on: `phase3-01-account-console`, `phase3-02-account-routes`, `phase3-03-lifecycle-page`.
Runs alongside: nothing (final wave).
Budget: about 18 files read, about 750 lines added, 75 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit what passes, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 1057–1062 — the exact Phase 3 outcome and proof list.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 784–898 — **S-profile, S-settings, S-lifecycle, S-login, S-callback, S-device, S-notfound**, each full region map and acceptance sentence.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 900–913 — **A1–A6** and the account-request authority; line 95 — **F7**.
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 99–160 — **V1–V5, C1, C10, T1–T5**; the account/lifecycle exception at line 131.
5. `docs/plans/30-analytics-operable-chrome/IMPLEMENTATION.md` — the Phase 1/Phase 2 verification records and the final Carried/verification lines (Phase 2 leaves no unplaced Carried item).
6. `packages/yakka-analytics/tests/plan30/harness.mjs` lines 1–360 — `startPlan30Harness`, real-Go fixture, `installSession`, `attach`, `waitIdle`, `close`, diagnostics.
7. `packages/yakka-analytics/tests/operable-chrome/harness.mjs` lines 1–95 — route helpers, screenshot/PNG helpers and the mockups path convention to reuse or wrap.
8. `packages/yakka-analytics/tests/plan30/phase1-acceptance.test.mjs` lines 1–130 and `tests/operable-chrome/phase2-acceptance.test.mjs` lines 1–230 — the per-ID `group`/failure-collection idiom, request capture, screenshot capture and diagnostics policy.
9. `packages/yakka-analytics/tests/charts-time/browser.mjs` — `loadBrowserEnvironment`, `launchBrowser`, `SKIP_REASON`; use these, do not invent a launcher.
10. `packages/yakka-analytics/tests/identity/browser.test.mjs` lines 15–158 — the contract-faithful two-origin account stub and cookie pattern; this suite owns the account writes by DESIGN, not the real lifecycle engine.
11. `packages/yakka/internal/serve/lifecycle_profile_test.go` lines 10–138 and `lifecycle_http_test.go` lines 80–120 — the lifecycle security strings and no-auto-retry contract the real Go suite keeps proving.
12. `docs/plans/30-analytics-operable-chrome/mockups/{profile,settings,lifecycle,login,callback,device,notfound}.png` and matching `mockups/src/*.html` — visual references only.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

One reproducible Chromium proof at 1440×900 covers every Phase 3 ID, using a contract-faithful stub for account writes and the real Go template/server for the lifecycle page; a separate-process union regression covers Phase 1, Phase 2 and Phase 3, and the report records honest deployment/legacy-capability evidence.

## Contract

Settled by DESIGN.md and this phase outcome:

- **No production fixture mode and no fake analytics behaviour.** Account writes are stubbed only because A6 and each S-screen acceptance sentence explicitly require contract-faithful stubbed failed writes; every stub request/response shape must match A1–A6 and the existing API field names. The lifecycle page is the real template served by the Plan 30 Go harness; its destructive calls are stubbed to 204/failed responses in the browser only (A6 explicitly allows this), and the existing Go lifecycle tests are run unchanged.
- **A1–A6:** exact `GET /v1/me` identity/tenant fields and order; two owned tenants plus a pending tenant for the disabled C1 state; owned-membership columns/`Owner`; `Use tenant`; A2 exact create payload, validation, 409, refresh/select/focus, no double submit; A3 exact create-token payload, one-time plaintext, copy/dismiss, tenant switch/navigation clears it, no secret persistence; A4 client-side exact-tenant filtering, columns/order, revoked/expired derivation, no secret column; A5 inline confirmation, cancel no write, exact revoke request, failed write not labelled revoked, click-only retry, no auto-retry; A6 link label/href to the configured API origin `/profile/lifecycle?tenant={id}` same tab, typed confirmation, human-owner/effect copy, cancel no write, 204 reset/delete behaviour (stubbed), generation/recovery notices, no Authorization/bearer, surviving-tenant return link.
- **F7:** tenant B selection shows only B tokens; membership still lists A and B (and a pending owned tenant if the stub carries one) with `Owner`; no invite/member/role controls.
- **S screens:** `/profile`, `/settings`, `/login`, `/oauth/callback`, `/device`, `/missing`, and the API-origin lifecycle page render the exact heading/order/copy/controls in their sections. `/oauth/callback` is captured in its failure state (exact sentence and `Try sign in again`); the success path must still navigate to the safe return.
- **C1/C10/V1–V5:** the header tenant select is always visible with `{name} · {id}` labels and pending disabled; no time/repo/kind controls on account screens; Theme toggles each route; 46/32/32/32px rows, full width, 12px gutters, 30px left-aligned table rows, real `--yk-*` tokens, no white surfaces, no decorative chips/centred cards/gradients, nav order and `aria-current` unchanged.
- **Security and honesty:** 401/403/failure writes leave no optimistic success and no fake row; sanitized errors only; no plaintext token in localStorage/sessionStorage/URL/DOM after dismissal/navigation, no token in logs/list responses; the not-found route performs no `/v1/analytics/` read; the lifecycle page never constructs Authorization/Bearer and never auto-retries a destructive call.
- **Deployment:** do not deploy or assert production totals. The report must record either authenticated API/Pages deployment evidence (only if a legitimate owner session is supplied) or the explicit legacy-capability state: no authenticated production read was performed, event-counts/record_filters remain capability-gated, and `tests/plan30/legacy-counts.test.mjs` proves the truthful legacy text. Signed-in production checks and real lifecycle writes remain gates.

Settled by the code: the Plan 30 harness serves `web/` with the declared CSP and proxies `/v1/` to the real Go server; `/profile/lifecycle` is served by the Go server at `harness.upstreamOrigin`, not by the static Pages server. Account routes need `me` but must not call analytics reads. Use Playwright route interception only for the account API in the account context and for the lifecycle destructive calls in the lifecycle context.

## Changes

- `phase3-harness.mjs` (new): wrap `startPlan30Harness`; provide (a) a stateful contract-faithful account stub for `/v1/me`, `/v1/tokens`, `/v1/tenants`, token revoke and `/logout`, with success/401/403/409/failure modes, request capture and a gate to hold a request so a second click is testable without sleeps; (b) a screenshot helper writing 1440×900 light/dark PNGs under `.scratch/plan30-chrome/phase3-screens/`; (c) a lifecycle context helper that opens `${harness.upstreamOrigin}/profile/lifecycle?tenant=...` and stubs only `/v1/me`, reset and delete; (d) PNG size/mockup path helpers. Do not change `plan30/harness.mjs` or `phase2` harness.
- `phase3-acceptance.test.mjs` (new): one top-level test, `group(id, fn)` per ID, collect failures, skip with `SKIP_REASON` when Chromium is unavailable. Cover:
  - A1–A6, F7 and the seven S screens with exact assertions named in the contract.
  - Account stub request assertions (method/path/body/credentials) and no accidental `/v1/analytics/` reads on account/not-found routes.
  - Stubbed 401/403/500/failed revoke/409/failed create behaviour, no optimistic success, no double submit (gated request + two clicks), no plaintext persistence.
  - Lifecycle real page: table/DOM/copy/widths/30px rows, C1 deep link highlight, left-anchored dialog geometry (`left≈12`, `width≈600` at 1440), typed-ID enablement, cancel no request, stubbed 204 reset/delete, `/me` re-read, surviving-tenant `Return to analytics`, ambiguous failure shows `completion unknown` and leaves exactly one destructive request, no Authorization/Bearer.
  - C1/C10/V1–V5 on every Phase 3 screen; both themes; nav and `aria-current`; no forbidden account controls.
  - Screenshot `/profile`, `/settings`, `/login`, `/oauth/callback` failure, `/device`, `/missing`, lifecycle — light and dark, 1440×900 — into `.scratch/plan30-chrome/phase3-screens/`; compare each with its mockup and write `comparisons.json`.
- The report: a table with every Phase 3 ID (`A1–A6, F7, S-profile, S-settings, S-lifecycle, S-login, S-callback, S-device, S-notfound, C1, C10, V1–V5`) and pass/fail/evidence, the union-regression command outputs, the screenshot list and comparisons, any minimal correction and owner, and the deployment/legacy-capability line.
- **Union regression, separate processes:** run Phase 1 acceptance, Phase 2 acceptance and Phase 3 acceptance in three separate `node --test` invocations; run the focused JS suites (`tests/workspace/acceptance.test.mjs`, `tests/static-shell.test.mjs`, `tests/identity/contracts.test.mjs`, `tests/identity/browser.test.mjs`, `tests/plan30/legacy-counts.test.mjs`) and the Go lifecycle/serve/store suites. Record any pre-existing failure outside Phase 3 (for example the known `tests/trends-quality/cost.test.mjs` distribution expectation) as pre-existing, not a Phase 3 pass or a new regression.
- If an executed Phase 3 assertion fails, diagnose and fix it in the owning Phase 3 product path, rerun, and record the fix; do not weaken a check, change an existing test, or touch Phase 1/2 analytics behaviour to make a Phase 3 ID pass.

### Keep untouched

Every product file outside the Phase 3 account/lifecycle surfaces named by `phase3-01/02/03`; all Phase 1/2 chart/filter/panel/explorer code and tests; the lifecycle engine/handlers/gates and existing Go tests; `plan30/harness.mjs`; the mockups; `DESIGN.md`; deployment configuration. No request interception for analytics reads, no production fixture mode, no tenant reset/delete against a real server.

## Done evidence

- `cd packages/yakka-analytics && PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test --test-reporter=spec tests/operable-chrome/phase3-acceptance.test.mjs` → runs and reports every Phase 3 ID pass/fail with evidence; all Phase 3 IDs pass or each failure is exact and owned.
- `cd packages/yakka-analytics && PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/plan30/phase1-acceptance.test.mjs tests/plan30/legacy-counts.test.mjs` → passes (separate process).
- `cd packages/yakka-analytics && PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/operable-chrome/phase2-acceptance.test.mjs` → passes (separate process).
- `cd packages/yakka-analytics && PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/workspace/acceptance.test.mjs tests/static-shell.test.mjs tests/identity/contracts.test.mjs tests/identity/browser.test.mjs` → passes.
- `cd packages/yakka && go test ./internal/serve ./internal/store -count=1` → lifecycle security, engine, conformance and serve/store suites pass unchanged.
- Observable: screenshots exist for all seven screens in both themes at 1440×900; comparisons name each mockup; the report records the deployment/legacy-capability state and the two gates.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192`), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` in this repo (Vitest `--maxWorkers=3` only if ever used), no animation/timing tests, no fixed sleeps (use URL/request/status predicates and the hold gate), no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches, no analytics request interception. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then the per-ID summary (counts pass/fail with owned failures named), the check outputs, screenshot paths, deviations, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
