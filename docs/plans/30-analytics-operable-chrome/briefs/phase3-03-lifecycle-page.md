# Brief: phase3-03 — Tenant lifecycle page density, tenant link and return path

Consumer: a product build worker for Plan 30 phase 3, API-origin lifecycle page.
Owned paths: `packages/yakka/internal/serve/lifecycle_profile.html`; `packages/yakka/internal/serve/lifecycle_profile.go` only if required to serve the existing template consistently; new test-only `packages/yakka/internal/serve/lifecycle_profile_phase3_test.go`. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase3-03-lifecycle-page.md` listing A6, S-lifecycle, C1, C10 and V1–V5 with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: nothing.
Runs alongside: `phase3-01-account-console` (disjoint paths). No other unit runs in wave 1.
Budget: about 9 files read, about 420 lines changed, 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 818–833 — **S-lifecycle** region map, exact widths, deep link, left-anchored dialog, style constraint and acceptance sentence.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 900–913 — **A6**, including the exact request fields, same-origin rules, 204-only success, generation/cache invalidation, pending/incomplete/recovery notices, no automatic retry and the “Return to analytics with surviving tenant” obligation.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 99–111 and 131 — **V1–V5, C1, C10**; line 131's exception that account/lifecycle screens have no time/repo/kind controls.
4. `packages/yakka/internal/serve/lifecycle_profile.html` lines 1–182 — the whole page: current self-contained CSS, list markup, state machine, destructive-fetch placement and exact copy.
5. `packages/yakka/internal/serve/lifecycle_profile.go` lines 1–28 — embed, headers, CSP and no-cache; change only if serving the styled template requires it.
6. `packages/yakka/internal/serve/serve.go` lines 595–610 and 690–700 — route registration and lifecycle subtree guard.
7. `packages/yakka/internal/serve/lifecycle_profile_test.go` lines 10–138 — every string, script-shape, CSP and no-credential assertion that must stay green.
8. `packages/yakka/internal/serve/lifecycle_http_test.go` lines 80–120 and 160–210 — the same-origin, session, owner, typed-confirmation and 204 contracts the page exercises; do not change them.
9. `packages/yakka-analytics/web/css/charts.css` lines 8–20 and 80–95 — the real light/dark token values to copy inline; `web/css/app.css` lines 24–60 — 46/32/32px shell row density.
10. `docs/plans/30-analytics-operable-chrome/mockups/lifecycle.png` and `mockups/src/lifecycle.html` — visual order/density reference only.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Restyle the existing same-origin owner lifecycle page to the dense Plan 30 shell, add the C1 tenant selector/deep link and a return-to-analytics link, while preserving every lifecycle security and recovery contract unchanged.

## Contract

Settled by DESIGN.md:

- **S-lifecycle order:** V1 identity row (brand, tenant field, Theme), analytics nav row, account nav row, heading `Tenant lifecycle`, account context/exact identity, full-width owned-tenant table, then the confirmation dialog. No analytics filter bar, chart, time/repo/kind control or fake analytics result.
- **Table:** columns `Tenant name` 240px, `Immutable ID` 260px, `Lifecycle state` 180px, `Generation` 100px, `Actions` (remaining width); `/me` order; 30px single-line rows with the full value available as a title; left alignment; tabular numerals. Buttons exactly `Reset tenant` and `Delete tenant` for active tenants. Preserve the legacy-unsupported and cleanup-in-progress notices.
- **C1 tenant field:** native select in the identity row, options from owned `/me` tenants in `/me` order labelled `{name} · {id}`, pending/cleaning tenants disabled and labelled with lifecycle state. A `?tenant={id}` deep link selects and highlights that owned row; changing the select updates `?tenant=` with `replaceState` and highlights the matching row. Do not rely on Pages `localStorage` or the analytics `yakka-analytics-tenant` reminder. Do not auto-select a fallback after a reset/delete.
- **C10 Theme:** a `Theme` button in the identity row toggling `data-theme` between light/dark and persisting the existing `yakka-analytics-theme` key on the API origin; default from that stored value, else `prefers-color-scheme`. All values come from inline copies of the real `--yk-*` light/dark tokens; no remote stylesheet, script, font or image, and no broad CSP change.
- **V1/V2:** 46px identity row, 32px analytics nav, 32px account nav, 32px heading band, 13px/1.35 body, 19px `h1`, 14px `h2`, 12px gutters, full viewport width, 28px minimum controls, 30px table rows, no max-width wrapper, no centred card, no shadows, no gradients/pills/animations.
- **V5 nav:** analytics row `Start, Pulse, Trends, Cost, Quality, Tools, Workflow, Compare, Scatter, Plans, Sessions, Ledger, Operations`; account row `Tokens, Tenants, Membership, Settings, Device approval`, in order. On this API-origin page the links navigate to the Pages origin (`https://yakka.build`), because the page is served at `api.yakka.build`; they must be ordinary anchors, not reads. `Brand` → Pages Start. Use the existing Pages origin already used by the page's profile link; do not invent a configurable cross-origin API.
- **A6 controls:** the typed-ID confirmation remains a native `<dialog>` opened by `showModal()`, but styled left-anchored with a 12px inset and width `min(600px, calc(100vw - 24px))`, not centred. Keep the human-owner sentence, the exact reset/delete effect text, blank typed-ID default, Confirm disabled until the exact immutable ID, and Cancel closing without a request. Keep reset `POST /v1/tenants/{id}/reset` and delete `DELETE /v1/tenants/{id}`, JSON `{confirm_tenant_id:id}`, `credentials:'include'`, `Content-Type: application/json`, `X-Yakka-UI: tenant-lifecycle`, no Authorization header, no bearer, no retry/loop/timer, 204-only success, lifecycle generation invalidation and same-origin BroadcastChannel/storage notices.
- **Return path:** keep a visible `Return to analytics` link. Its href is `${PAGES_ORIGIN}/?tenant={selected}` while a tenant is selected; after a successful reset keep that tenant (identity survives), after a successful delete clear the deleted selection and use the first surviving owned active tenant, or `/` if none. After the operation keep the existing explicit-selection notice and never auto-select a fallback.
- **A6/invariant:** never write an Authorization header, never use `Bearer`, never issue a lifecycle request on load, and never retry a destructive write automatically.

Settled by the code: `lifecycle_profile.go` already serves the embedded file with `Cache-Control: no-cache`, `frame-ancestors 'none'` and `X-Frame-Options: DENY`; `serve.go` registers the route before the site fallback. The existing tests require the exact human-owner string, reset/delete effect strings, `/v1/tenants/`, `/reset`, `X-Yakka-UI`, `tenant-lifecycle`, `id="typed-id"`, `confirm_tenant_id`, `credentials: 'include'`, `href="/oauth/login"`, `signedOut`, `unauth`, `completion unknown`, `recoveryFailed`, `BroadcastChannel`, `addEventListener("storage"`, `selection-note`, `ambiguousFailure`, no `setTimeout`/`for (;;)`, no forbidden `authorization`/`bearer` substrings, and the `loadMe()`-after-`submitConfirmed` script layout.

## Changes

- Rewrite the page's inline CSS into the dense shell above using copied `--yk-*` token values and the existing markup/script structure. Keep the page self-contained and keep the existing embedded-script event model.
- Replace the tenant `<ul>` with a semantic table (`caption`, `thead`, `th scope="col"`, 30px rows, exact widths), keeping every state branch (active actions, legacy unsupported notice, cleanup-in-progress notice) and the `Reset tenant`/`Delete tenant` labels. Keep `data-tenant-id` on each row so the C1 highlight can be asserted.
- Add the identity row with the existing `Signed in as {login} ({id})` context (hidden when signed out), the C1 tenant select, the Theme button, the `Return to analytics` link, and the two nav rows. Preserve `href="/oauth/login"`, the human-owner sentence, the profile link, the status/recovery/selection-note elements and their ids.
- Add only the minimum script for: reading `?tenant=`, populating/filtering the C1 select from `state.me.tenants`, highlighting the selected row, `replaceState` on select change, Theme persistence, and updating the return link after a successful reset/delete. Do not change `loadMe`, `unauth`, `render`, `openConfirm`, `submitConfirmed`, `ambiguousFailure`, `reportedFailure`, `failureMessage` semantics or the destructive fetch construction. No timers, no loops, no automatic retry, no credential strings.
- Keep `lifecycle_profile.go` unchanged unless the styled template cannot be served consistently; if a change is truly required, keep the same headers, embed, no-cache and CSP.
- Add `lifecycle_profile_phase3_test.go` (test-only) with a real `httptest` GET through `remoteTestConfig`/`placeholderFS` asserting: table headers/widths, `?tenant=` handling strings, C1 select id/option label contract, Theme control, `Return to analytics`, nav order, 30px rule, left-anchored dialog rule, self-contained page (no `http://`/`https://` script/style/link fetch beyond the existing Pages anchors), and that the existing security strings remain. Do not edit or weaken `lifecycle_profile_test.go`, `lifecycle_http_test.go`, `lifecycle_engine_test.go` or `lifecycle_conformance_test.go`.
- Capture a 1440×900 light/dark screenshot of the real template served by the Plan 30 Go harness at `${harness.upstreamOrigin}/profile/lifecycle?tenant=<A>` into `.scratch/plan30-chrome/phase3-u3/` and compare region order, row density, table/dialog placement and colours with `mockups/lifecycle.png` and `mockups/src/lifecycle.html`; the written contract wins. Do not click reset/delete; do not write to production.

### Keep untouched

The lifecycle engine, handlers, origin/session/owner gates, CSP/embed/no-cache headers, `confirm_tenant_id` semantics, 204-only success, recovery/incomplete notices, same-origin invalidation and no-auto-retry logic; all other Go files; the Plan 30 Pages shell and account console; existing lifecycle tests. No new endpoint, no CORS/gate change, no cross-origin lifecycle write, no Pages localStorage assumption.

## Done evidence

Identify or write the failing check before changing code; the new structure assertions must fail against the current `<ul>` page.

- `cd packages/yakka && go test ./internal/serve -run 'Lifecycle' -count=1` → all existing profile/HTTP/engine/conformance tests plus the new phase3 page test pass.
- `cd packages/yakka && go test ./internal/serve ./internal/store -count=1` → no regression outside the lifecycle package.
- Observable: `GET /profile/lifecycle?tenant=<owned-id>` returns the styled page, highlights that row, and leaves every lifecycle request until an explicit Confirm; the typed-ID Confirm stays disabled until the exact id; Cancel sends nothing.
- Observable: a stubbed 204 reset/delete (only in the browser proof, not in this unit's Go tests) leaves the `Return to analytics` href pointing at a surviving tenant and never auto-selects a fallback.
- `git diff --stat` shows only the owned paths and the report.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` for browser work), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` for the JS side and `go test` for Go, no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete against a real server, never the default tenant, no other worktrees or branches. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
