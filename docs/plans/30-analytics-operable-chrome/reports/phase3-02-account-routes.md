# Report: phase3-02 — Account connection, authentication and error routes

Status: done with concerns. Branch `feat/30-analytics-operable-chrome`. The unit's own
evidence passes; one stale test outside the brief's owned paths still asserts the old
not-found heading (named under Deviations and notes).

## What changed

- `web/js/core/router.js`: exact account titles `/login`→`Sign in`,
  `/oauth/callback`→`Completing sign in`, `/device`→`Device approval`,
  `/settings`→`Connection settings`; not-found title `Page not found`. All route
  classifications stay unchanged.
- `web/js/app.js`: `/settings` now loads `/v1/me` while remaining session-gate exempt;
  `/login` and `/oauth/callback` stay session-exempt. `mountTenantHeader` has an explicit
  `signedOut` state (`Sign in to select a tenant`). `/profile`, `/settings` and `/device`
  mount the header from `authorizedTenant` and receive the phase3-01 account context. The
  not-found branch renders before any schema/facet/scope read and bypasses only the
  signed-out data-route redirect. `renderNotFound` is the new, escaped
  `Page not found` / `No page matches this address.` view with tenant/scope-preserving
  `Open Start` and `Open Pulse` links and no all-routes list. A `hashchange` listener keeps
  account `aria-current="location"` in sync. `SHELL_ROUTES` stays exported.
- `web/js/identity/flows.js`: new login sentence/link, exact callback in-flight and failure
  copy with a safe `return` retry link, full-width Connection settings section (480px
  column, key never hydrated, blank-key preservation, same-route reload on save,
  clear-both keys plus reload, non-optimistic sign-out with exact inline failure), and a
  device form with no local tenant select. Device approval uses the global header tenant,
  blank token name, `Choose access` default, `3m` lifetime, exact success copy and the
  unchanged `deviceApprovalPayload`/`deviceDenialPayload` helpers.
- `web/css/account.css`: 480px control column, full-width connection/device sections,
  inline status/error styling and not-found link row; existing `--yk-*` tokens, no
  animation, shadow or centred card.
- `tests/identity/browser.test.mjs`: callback/device/settings/not-found subtests rewritten
  for the new contracts; stub gained `failLogout`, a 404 expectation for unknown device
  codes and a one-time base seed so settings clear can be asserted. A1–A5/F7 profile
  subtests remain green.

## Checks

| ID | Verdict | Evidence |
|---|---|---|
| S-settings | pass | `/settings` h1 `Connection settings`; full-width `Connection` section with 480px left column. Base loads from storage, password input is always blank even when `yakka-analytics-key` exists. Save trims/strips trailing slash, rejects browser-unsafe protocols with `Enter an absolute http(s) API base URL.`, preserves the stored key when the password is blank, and reloads the same route; Clear removes both keys and reloads; Sign out posts `/logout` with body `{}` and credentials, fails inline with `Sign out failed.` and no navigation, then goes to `/login` on success. No credential appears in the DOM, URL or request query (asserted). |
| S-login | pass | h1 `Sign in`; exact sentence `Sign in to your Yakka account to continue.`; `Continue with GitHub` href is `oauthLoginPath(safeReturnPath(return))` (`https://api.yakka.build/oauth/login?return=%2Fdevice%3Fuser_code%3Dabcd-efgh` on the Pages host). Header tenant is a disabled `Sign in to select a tenant`; error text uses `textContent`. |
| S-callback | pass | h1 `Completing sign in`; noninteractive `Completing sign in…`; callback manual redirect/type check and `oauthCallbackTarget` unchanged. Both denial and API-error paths replace the status with exactly `Sign in failed. Please try again.` and add `Try sign in again` → `/login` with only a safe `return`; the rendered text contains no code, state, credential or raw API body. |
| S-device | pass | h1 `Device approval`; code entry then approval form in the left 480px column; code prefilled normalized uppercase from `user_code`; Continue reads `GET /v1/device/grant?user_code=`. No `device-tenant` select exists; the global header tenant B is the approval tenant. Scope defaults to `Choose access` with Approve disabled, then `Read`/`Read and write`; Lifetime 1d/1w/1m/3m(default)/6m/1y; Token name blank and never pre-filled. Approve posts `{user_code,tenant,scope,lifetime}`; Deny posts `{user_code,action:'deny'}` with no scope. Success is exactly `Device approved.` / `Device denied.`; unknown code keeps the form with the inline reason; no bearer is echoed. |
| S-notfound | pass | `/missing` h1 `Page not found`, exact `No page matches this address.`, escaped path text, `Open Start`/`Open Pulse` links keeping `tenant`, `win` and `repo_id`, authenticated tenant and Theme visible, no tables/charts/filter bar, zero `/v1/analytics/` requests (signed in and signed out). Signed out shows `Sign in to select a tenant`. |
| C1 | pass | Header `#tenant-select` remains the only tenant control (260px, `/me` order, active-only options); it is visible and truthful on every account route, disabled with the exact sign-in text where the contract requires it. Device and settings have no competing tenant select. |
| C10 | pass | Existing `#theme-toggle` is untouched; light and dark screenshots for all five routes use the existing saved-theme behaviour and `--yk-*` tokens. |
| V1 | pass | Existing 46/32/32px shell rows and 12px gutters; page h1 is 32px; body/main full width; screenshots are 1440×900 with `scrollWidth` 1440. |
| V2 | pass | Native controls are at least 28px high; account text is left aligned; no new table is introduced on these routes; existing 30px account-table rows from phase3-01 are unchanged. |
| V3 | pass | `account.css` uses only `--yk-bg/surface/surface-alt/text/muted/border/focus/danger`; light surfaces are `#f4f6f8`, dark `#1b2734`; no `rgb(255,255,255)` surface or chart background appears. |
| V4 | pass | No decorative chips, gradients, shadows, animations, centred cards, hidden tenant or invented membership/IAM controls; sections are full width with empty remaining width. |
| V5 | pass | Analytics nav order and hrefs are untouched; account nav order unchanged; `aria-current="location"` follows the matching account hash and clears on hash change, while analytics keeps `aria-current="page"`. |

## Test evidence

Before the implementation the rewritten subtests failed against the old behaviour:
callback status showed raw `denied` / `exchange failed` instead of the exact failure
sentence, the device form still had `device-tenant` and said `Approved.`, and the header
on `/login` read `Token-bound tenant` instead of `Sign in to select a tenant` (the run
reported 9 failing subtests).

After:

- `TMPDIR=<repo-root .scratch/t> PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test packages/yakka-analytics/tests/identity/browser.test.mjs packages/yakka-analytics/tests/identity/contracts.test.mjs` → 24 tests, 24 pass.
- `cd packages/yakka-analytics && node --test tests/static-shell.test.mjs` → 3 tests, 3 pass.
- `node --test tests/plan30/phase1-acceptance.test.mjs` → 19/19 pass.
- `node --test tests/operable-chrome/phase2-acceptance.test.mjs` (run alone; the two acceptance files share a port-bearing Go harness and must not run concurrently) → 1 test/20 subtests pass.
- Screenshots at 1440×900, light and dark, under
  `.scratch/plan30-chrome/phase3-u2/`: `settings-{light,dark}.png`, `login-{light,dark}.png`,
  `callback-{light,dark}.png`, `device-{light,dark}.png`, `notfound-{light,dark}.png`.
  Compared with `mockups/{settings,login,callback,device,notfound}.png` and
  `mockups/src/*.html`: region order, full-width sections, 480px left column, copy and
  light/dark tokens match; the written contract wins for the 160px chart minimum (not on
  these routes) and for the mockups' inline field labels, which are stacked here inside the
  same 480px column.

## Deviations and notes

- The brief's `TMPDIR="$PWD/.scratch/identity-tmp"` run from `packages/yakka-analytics`
  exceeds Chromium's unix-socket path limit (`Socket path too long`, 126 chars). Tests
  were run with the same gitignored `.scratch/` tree rooted at the repo (`/home/codyh/
  workspace/yakka-build/30/.scratch/t`, under the 107-char limit). No `/tmp` was used.
- The settings test harness seeds the API base once per context and stubs the
  default-origin `/v1/me` 401 only for the moment after Clear blanks the base; this keeps
  the port-bound fixture quiet without changing product behaviour.
- Device field labels are stacked inside the 480px column rather than inline as in the
  mockup HTML. The written contract specifies a 480px left column, and stacked native
  labels remain exact in copy and order.
- `tests/workspace/deep-links.test.mjs` is stale for the mandated not-found change: it
  expects `#app h1` to match `/Not found/`, while the binding S-notfound heading is
  `Page not found`. The brief's owned paths exclude that file, so it was not edited and
  now fails on that one assertion. Update it to `Page not found` (the
  `.not-found-routes a` count assertion already passes with the two new links).
- `tests/e2e/*.spec.ts` were not run or edited; as the brief records, they assert
  pre-Plan-30 shapes: device token-name prefill from the host and `Approved`, the sentence
  `Check this matches the code in your terminal`, and settings clearing the key when saved
  empty. These are stale, not evidence for this unit.
- No known unresolved problem in the owned product code.
