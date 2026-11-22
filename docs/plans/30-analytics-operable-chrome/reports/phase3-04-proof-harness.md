# Report: phase3-04 — Phase 3 proof and three-phase union regression

Status: done. Branch `feat/30-analytics-operable-chrome`. Every Phase 3 ID passes;
the union regression passed in separate processes; one minimal corrective edit was
required and is named below.

## What changed

- New `packages/yakka-analytics/tests/operable-chrome/phase3-harness.mjs`: wraps
  `startPlan30Harness` (real Go fixture + Pages static server) and adds
  - a stateful contract-faithful account stub for `/v1/me`, `/v1/tokens` (GET/POST),
    `/v1/tokens/{id}/revoke`, `/v1/tenants` POST, `/v1/device/grant`,
    `/v1/device/authorize`, `/logout` and `/oauth/callback`, with success/401/403/409/500
    modes, request capture (method/path/query/body/headers/credentials) and a hold gate
    that lets a second submit be attempted without sleeps;
  - a lifecycle helper that opens the **real** Go template at
    `${harness.upstreamOrigin}/profile/lifecycle?tenant=...` and stubs only `/v1/me`,
    reset and delete (204 by default, or a network abort for the ambiguous case);
  - 1440×900 light/dark screenshot and mockup PNG/source helpers under
    `.scratch/plan30-chrome/phase3-screens/`.
- New `packages/yakka-analytics/tests/operable-chrome/phase3-acceptance.test.mjs`: one
  Chromium 1440×900 proof, `group(id, fn)` per ID, failure collection, `SKIP_REASON`
  when Chromium is unavailable, no analytics request interception.
- Minimal corrective edit (see below) in `web/js/identity/flows.js`.

## Minimal correction

- **File/owner:** `packages/yakka-analytics/web/js/identity/flows.js` — owned by
  `phase3-02-account-routes`.
- **Defect exposed by the executed proof:** `/oauth/callback` success was treated as a
  failure whenever no API base is configured (same-origin collector). `transport.callback`
  returns a relative `requestUrl` (`/oauth/callback?...`) while `response.url` is always
  absolute, so the existing `response.url !== requestUrl` redirect guard always fired. The
  browser showed `Sign in failed. Please try again.` instead of navigating to the safe
  return.
- **Fix:** compare both URLs in one absolute space (`absoluteUrl(...)`) before the redirect
  guard. Redirect/type checks are otherwise unchanged. No test was weakened and no Phase
  1/2 analytics behaviour changed.

## Per-ID results

The executed run (`tests/operable-chrome/phase3-acceptance.test.mjs`) records all 21 IDs
`pass` in `.scratch/plan30-chrome/phase3-screens/results.json`.

| ID | Result | Evidence from the executed Chromium proof |
|---|---|---|
| A1 | pass | `/v1/me` order rendered; headers `Name, Immutable ID, Your access, Lifecycle state, Generation, Actions`; rows `Alpha/tenant-a/Owner/Active/3`, `Beta/tenant-b/Owner/Active/5`, `Pending/tenant-p/Owner/Pending/1`; widths 240/260/100/160/100; 30±1px rows; lifecycle link path `/profile/lifecycle?tenant=tenant-a`, same tab, label `Reset or delete… (API owner page)`; empty/loading/error (`Could not load tenants.` + `Retry account`), token loading, empty `Create a tenant to issue a token.`, Refresh account re-reads `/v1/me`; 401 and 403 leave zero fake rows and the `Sign in to manage account` boundary. No Invite/Add member/Change role and no analytics controls. |
| A2 | pass | Blank/control names send no request with `Use 1–64 characters with no control characters.`; `Delta` posts exactly `{"name":"Delta"}`, one POST despite a gated second submit, button+input disabled while pending, `/v1/me` refreshed, returned tenant selected in URL/header and its row focused; duplicate `Alpha` shows `You already have a tenant with this name.` and keeps the input; 500 leaves no optimistic row. |
| A3 | pass | Exact `{tenant:"tenant-a",scope:"read",lifetime:"3m",name:"token"}`; blank name omits `name`; one-time `fixture-plaintext-token`, exact notice, Copy token works, Dismiss erases DOM; no secret in localStorage/sessionStorage/URL/DOM; copy failure `Select and copy the token manually.`; tenant switch and navigation clear the plaintext; no tenant disables Create with the exact sentence; 401 shows `Could not create token.` and no plaintext. `GET /v1/tokens` carries no tenant filter. |
| A4 | pass | Headers `Name, Tenant, Scope, Created, Expires, State, Action` (no Secret), widths 220/180/140/160/160/120; rows `token-a1, token-a4, token-a2, token-a3` (created_at DESC, id ASC) with states `Active, Active, Expired, Revoked`; Revoke only on Active; GET has no tenant param; A→B leaves only `beta-active`; token failure keeps `Could not load tokens.` + `Retry tokens` and no rows. |
| A5 | pass | Inline `Revoke alpha-active? Clients using it will lose access.`; Cancel sends nothing; confirm posts one `{}` to `/v1/tokens/token-a1/revoke`, disabled while pending, then `Revoked` on 204; a 500 keeps `Active`, shows `Retry revoke`, issues no automatic retry, keeps the data row at 30±1px, leaks no secret; a click retries to `Revoked` (two POSTs). |
| A6 | pass | Profile link is `${configured API origin}/profile/lifecycle?tenant=tenant-a`, same tab, when a base is configured. Real Go template: dialog opens at left 12px / width 600px, blank typed id, Confirm disabled until the exact id, Cancel sends nothing; reset posts exactly `{"confirm_tenant_id":"t-a"}` to `/v1/tenants/t-a/reset` with `Content-Type: application/json`, `X-Yakka-UI: tenant-lifecycle`, same-origin `Origin`, no `Authorization`; 204 keeps the tenant; 204 delete clears the deleted selection and `Return to analytics` targets the surviving `https://yakka.build/?tenant=t-b`; an aborted reset shows `completion unknown`, keeps owner state and leaves exactly one destructive request (no auto-retry). |
| F7 | pass | Tenant B shows only `beta-active`; membership still lists all three owned tenants with `Owner`; no invite/member/role or time/repo/kind controls. |
| S-profile | pass | `Account, tenants & tokens`; region order identity → `Tenants & membership` → token section; `#membership` resolves inside the `#tenants` section and `#tokens` is its own section; exact h2 copy; no analytics controls. |
| S-settings | pass | `Connection settings` / `Connection`; 480px left control column; base blank default, password never hydrated; Save trims a trailing slash, stores base+key and reloads the same `/settings`; invalid `javascript:` base shows `Enter an absolute http(s) API base URL.` and changes nothing; Clear removes both keys; token inventory unchanged; Sign out failure stays inline (`Sign out failed.`) with no navigation, success posts `{}` to `/logout` and goes to `/login`; no credential in DOM/URL/query. |
| S-lifecycle | pass | Real Go template; identity 46px, both nav rows 32px, title band 32px, main.left=0, title left 12px, `scrollWidth≤1440`; table `Tenant name, Immutable ID, Lifecycle state, Generation, Actions`, widths 240/260/180/100, rows `t-a,t-b,t-p` at 30±1px; body 13px, h1 19px; no analytics filter/chart/time/repo/kind control. |
| S-login | pass | `Sign in`; exact sentence; Continue with GitHub href `oauthLoginPath('/device?user_code=ABCD-EFGH')`; disabled `#tenant-select` reading `Sign in to select a tenant`; escaped error text; no tables/charts/filter bar. |
| S-callback | pass | `Completing sign in`; denial and API-error paths show exactly `Sign in failed. Please try again.` with `Try sign in again` → `/login` (safe `return` only) and no code/state/leaked body; success navigates to the safe return (`/profile` with the canonical tenant). |
| S-device | pass | `Device approval`; code prefill normalized to `ABCD-EFGH`; Continue reads `GET /v1/device/grant?user_code=ABCD-EFGH`; no local tenant select, header tenant `tenant-b`; name blank, scope `Choose access`, lifetime `3m`; approve disabled until a scope is chosen; approve posts exactly `{user_code,tenant,scope,lifetime}` and shows `Device approved.`; Deny posts only `{user_code,action:"deny"}` and shows `Device denied.`; unknown code and rejected approval keep the form with the inline reason; no bearer echoed. |
| S-notfound | pass | `Page not found` + `No page matches this address.`; escaped path (no injected `<b>`); committed `tenant`, `win`, `repo_id` preserved on Open Start/Open Pulse; tenant and Theme visible; zero `/v1/analytics/` reads signed in and signed out; navigation stays reachable. |
| C1 | pass | One 260px `#tenant-select` on every account screen; options `Alpha · tenant-a`, `Beta · tenant-b`, `Pending · tenant-p · pending` (pending disabled); selecting B commits the URL once; login/callback show the disabled `Sign in to select a tenant`; lifecycle deep link `?tenant=t-b` highlights the t-b row and changing the select replaces the URL and moves the highlight. |
| C10 | pass | The real Theme button toggles each of `/profile`, `/settings`, `/login`, callback failure, `/device`, `/missing` and the lifecycle page; both themes render. |
| V1 | pass | On all six account screens (and lifecycle): identity 46px, analytics nav 32px, account nav 32px, heading 32px, `main.left=0`, content left 12px, right ≤1428, `scrollWidth≤1440`. |
| V2 | pass | Body 13px, h1 19px, h2 14px, left-aligned tabular table text, account and lifecycle rows 30±1px, visible controls ≥28px. |
| V3 | pass | Both themes on every screen use real `--yk-bg/surface/surface-alt/text/muted/border` tokens and expose no `rgb(255,255,255)` surface. |
| V4 | pass | No gradients, shadows, animations, removable default scope chip, invitation/member/role controls or hidden tenant selection on any Phase 3 screen. |
| V5 | pass | Analytics nav order `Start…Operations` and account nav order `Tokens, Tenants, Membership, Settings, Device approval` on every screen; brand → Start; Theme follows the tenant field; `/settings` and `/device` set account `aria-current="location"`; lifecycle uses Pages-origin brand/return anchors. |
| diagnostics | pass | No unexpected page error or console error (only the deliberate 401/403/404/409/500/abort responses exercised by the proof). |

## Union regression (separate processes)

All commands used `PUBLIC_CANVAS_TEST_MODE=true`,
`NODE_OPTIONS=--max-old-space-size=8192` and a repo-root
`TMPDIR=/home/codyh/workspace/yakka-build/30/.scratch/t` (no `/tmp`).

| Command | Result |
|---|---|
| `node --test --test-reporter=spec tests/operable-chrome/phase3-acceptance.test.mjs` | 1 test pass; all 21 IDs pass; 34.3s |
| `node --test tests/plan30/phase1-acceptance.test.mjs tests/plan30/legacy-counts.test.mjs` | 21 tests pass (phase 1 18/18 + legacy-counts 3/3); 49.8s |
| `node --test tests/operable-chrome/phase2-acceptance.test.mjs` | 1 test pass (20 subtests); 75.1s |
| `node --test tests/workspace/acceptance.test.mjs tests/static-shell.test.mjs tests/identity/contracts.test.mjs tests/identity/browser.test.mjs` | 32 tests pass; 445.2s |
| `node --test tests/workspace/deep-links.test.mjs` | 1 test pass (the orchestrator's `Page not found` alignment holds) |
| `cd packages/yakka && go test ./internal/serve ./internal/store -count=1` | `ok` serve 283.0s, `ok` store 12.9s |

The first combined Go invocation reported a serve-suite failure, but a rerun of
`./internal/serve` alone (`ok`, 343.4s) and a fresh combined invocation (`ok`) both
passed, and no Phase 3 file is touched by that suite. Recorded as a transient
non-reproduced serve failure, not a Phase 3 regression; no pre-existing JS failure
(such as the known `tests/trends-quality/cost.test.mjs` distribution expectation) was
observed in the commands above.

## Screenshots and mockup comparison

14 PNGs at 1440×900 in `.scratch/plan30-chrome/phase3-screens/`:
`profile`, `settings`, `login`, `callback`, `device`, `notfound`, `lifecycle`, each
`-light.png` and `-dark.png`. `comparisons.json` names each mockup PNG and
`mockups/src/*.html` source.

The written text wins where the mockups differ:

- lifecycle: the mockup shows `Tenant`/`State` and an inline confirmation panel; the
  implemented page uses `Tenant name`/`Immutable ID`/`Lifecycle state`/`Generation`/
  `Actions`, a left-anchored 600px dialog, and Pages-origin links.
- profile: the mockup's membership note is inside the table panel; the product keeps a
  separate full-width identity line and the ownership note, and adds the contract's
  `Refresh account`. Token order follows the written `created_at DESC` rule.
- settings/device: fields are stacked inside the required 480px left column rather than
  inline as drawn in the mockup HTML; copy, order and controls match.
- login/callback/notfound: mockup `Sign in to your Yakka account to continue` heading and
  footer reference styles yield to the written screen contracts and the shared dense shell.

## Deployment and legacy capability

- No deployment was performed and no production totals are asserted.
- No authenticated production read was performed. `event-counts` and `record_filters`
  remain capability-gated; `tests/plan30/legacy-counts.test.mjs` passed in the phase 1
  process and proves the truthful legacy text.
- **Gate 1:** signed-in production API/Pages checks remain a gate (no legitimate owner
  session was supplied). **Gate 2:** real lifecycle reset/delete writes remain a gate; this
  proof stubs only those destructive calls and runs the existing Go lifecycle tests
  unchanged.

## Deviations and notes

- The brief's Chromium-off the shelf `TMPDIR="$PWD/..."` from `packages/yakka-analytics`
  exceeds the unix-socket limit; the repo-root `.scratch/t` directory was used instead.
- `Sec-Fetch-Site` is absent from Playwright's intercepted request headers on this build;
  the proof asserts it is `same-origin` only when present, as the A6 wording allows.
- The lifecycle screenshot captures the page without the dialog open; the left-anchored
  dialog geometry and typed-id behaviour are asserted in the A6 group.
- No contradiction found between this brief and the contracts it cites.
