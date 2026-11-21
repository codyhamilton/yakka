# Brief: phase3-02 — Account connection, authentication and error routes

Consumer: a product build worker for Plan 30 phase 3, account routes and shell recovery.
Owned paths: `packages/yakka-analytics/web/js/identity/flows.js` (the `login`, `callback`, `settings` and `device` branches only; leave the `profile` branch and `account-console.js` to `phase3-01`); `packages/yakka-analytics/web/js/app.js` (the account branch, signed-out header note, not-found branch, session-exempt list and `SHELL_ROUTES`/`renderNotFound` only); `packages/yakka-analytics/web/js/core/router.js` (account titles and not-found title only); `packages/yakka-analytics/web/css/account.css` (extend the file created by `phase3-01`); `packages/yakka-analytics/web/index.html` only if a link is needed; `packages/yakka-analytics/tests/identity/browser.test.mjs` (the login/callback/settings/device/not-found subtests only). Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase3-02-account-routes.md` listing S-settings, S-login, S-callback, S-device, S-notfound, C1, C10 and V1–V5 with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: `phase3-01-account-console` (it owns the profile branch, `account-console.js`, the account CSS foundation and the first account test edits).
Runs alongside: nothing in wave 2.
Budget: about 12 files read, about 550 lines changed, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 802–816 — **S-settings** and **S-login**.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 851–898 — **S-callback**, **S-device**, **S-notfound**.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 900–913 — the account-request authority paragraph and A3/A6 field contracts embedded in device/settings; do not re-open A1–A5.
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 99–131 and 134–141 — **V1–V5, C1, C10**, the metadata/tenant-loading rule and T1–T3 status vocabulary.
5. `packages/yakka-analytics/web/js/identity/flows.js` lines 18–95 — current login/callback/settings/device and `deviceApprovalPayload`/`deviceDenialPayload`.
6. `packages/yakka-analytics/web/js/app.js` lines 68–139, 276–288, 398–409, 829–872 and 986–1002 — header, account/nav active state, not-found, session-exempt list, theme.
7. `packages/yakka-analytics/web/js/core/router.js` lines 7 and 28–70 — route table, account titles and not-found record.
8. `packages/yakka-analytics/web/contract/{return-path.js,session-gate.js}` lines 1–24 and 1–15 — safe return, OAuth login path and auth-gate exceptions you must preserve.
9. `packages/yakka-analytics/web/contract/transport.js` lines 16–23, 63–76 — `authInit`, callback manual redirect, logout.
10. `packages/yakka-analytics/tests/identity/browser.test.mjs` lines 64–150 — the stub host and the subtests you update; `tests/identity/contracts.test.mjs` lines 12–19 and 42–58 — security contracts that must not weaken.
11. `docs/plans/30-analytics-operable-chrome/mockups/{settings,login,callback,device,notfound}.png` and the matching `mockups/src/*.html` — visual order/density reference only.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Every non-analytics account route keeps the dense shell, truthful tenant/theme state and reachable navigation while preserving the existing return-path, session-gate, OAuth callback, device-payload and logout security behaviour; the error route never triggers analytics reads or a dead end.

## Contract

Settled by DESIGN.md:

- **S-settings:** heading `Connection settings`; one full-width `Connection` section, all fields left aligned in a 480px input column with the remaining width empty. Fields: `API base URL` (stored base, blank means transport default), `Bearer token` password input (the stored key is never rendered as plaintext), buttons `Save settings`, `Clear settings`, `Sign out`. Save writes `yakka-analytics-base` trimmed with no trailing slash and `yakka-analytics-key`, invalidates transport/session caches and reloads the same safe route. Leaving the password input blank must keep the existing stored key; only `Clear settings` removes `yakka-analytics-base` and `yakka-analytics-key`, and it resets the connection without touching owned server tokens. Validate the base as an absolute `http:`/`https:` URL and reject browser-unsafe protocols with inline `Enter an absolute http(s) API base URL.`. Sign out posts `/logout` with JSON `{}` and `credentials: include`; success goes to `/login`; failure stays on the route with inline `Sign out failed.` and no optimistic logout. No query field carries credentials.
- **S-login:** heading `Sign in`; text exactly `Sign in to your Yakka account to continue.`; link `Continue with GitHub` to the existing `oauthLoginPath(safeReturnPath(location.search.get('return')))`; no enabled tenant selector until `/me` authenticates, and the disabled tenant field reads `Sign in to select a tenant`; Theme works. Error text is escaped, never HTML.
- **S-callback:** heading `Completing sign in`; noninteractive status exactly `Completing sign in…`; the existing manual-redirect callback contract and safe response-target validation are unchanged. Failure shows exactly `Sign in failed. Please try again.` plus `Try sign in again` → `/login`, preserving only a safe `return` query value. Never show `code`, `state`, credentials or raw API body in the status.
- **S-device:** heading `Device approval`; code entry form then approval form in the left 480px column. User code prefilled from `user_code`, normalized uppercase; `Continue` reads `GET /v1/device/grant?user_code=`. The **global C1 header tenant** is the only approval tenant (mandatory owned active tenant); remove the local per-form tenant select entirely. `Scope` select options `Choose access` (default, approval disabled), `Read`=`read`, `Read and write`=`read_write`; `Lifetime` 1d/1w/1m/3m default/6m/1y; optional `Token name` default blank, never prefilled from the device host. `Approve` posts `POST /v1/device/authorize` with `{user_code,tenant,scope,lifetime,name?}`; `Deny` posts the same endpoint with `{user_code,action:'deny'}` and no scope. Keep `deviceApprovalPayload`/`deviceDenialPayload` exact. Never echo an issued bearer. Success text exactly `Device approved.` or `Device denied.`; expired/unknown code keeps the form and shows the inline reason.
- **S-notfound:** heading `Page not found`; full-width text exactly `No page matches this address.`; links `Open Start` and `Open Pulse` preserving the authorized tenant and committed scope; unknown path rendered with `textContent` (escaped, never injected); Theme and authenticated Tenant remain visible. No tables, charts, analytics filter bar, schema read, count read or fake results. The route stays reachable when signed out; when unauthenticated the tenant field reads `Sign in to select a tenant`.
- **C1/C10/V:** the header tenant select and Theme remain visible and truthful on every account route; time/repo/kind controls are absent. V1 rows are 46/32/32/32px, body/main full width with 12px gutters; V2 30px left-aligned rows; V3 real `--yk-*` tokens, no white surfaces; V4 no decorative chips, gradients, centred cards or hidden tenant; V5 nav order and `aria-current` unchanged. Account sections use the full width, never a centred card.

Settled by the code: `/settings` is currently in `sessionExempt`, so no `/me` is read for it; `/login` and `/oauth/callback` are session-exempt by contract; the not-found route currently falls through to the analytics schema/scope path and renders a list of every shell route. `sessionGateDecision` is the auth boundary; it must keep redirecting signed-out data routes to `/login?return=`. The not-found route is a UI exception only, because it performs no analytics read.

## Changes

- `router.js`: set the exact account titles `/login`→`Sign in`, `/oauth/callback`→`Completing sign in`, `/device`→`Device approval`, `/settings`→`Connection settings`; leave `/profile` to `phase3-01`. Keep every route classification and the `/missing`/unknown-path not-found behaviour. Do not add a new page route; `/missing` is naturally not-found.
- `app.js`:
  - Keep `/login` and `/oauth/callback` session-exempt; load `/v1/me` for `/settings` (without letting the gate redirect it), and mount the header from the real `me`/`meStatus`.
  - Add an explicit `signedOut`/empty-note state to `mountTenantHeader` so `/login`, `/oauth/callback` and an unauthenticated error route show a disabled field reading `Sign in to select a tenant`. Do not change the existing local/token-bound notes or the `Create a tenant to view analytics` state.
  - In the account branch, append the exact heading and call `renderIdentity` with the account context (the same shape `phase3-01` introduced). Do not add analytics scope controls.
  - Render not-found before any `transport.schema`, facet or scope request; bypass the signed-out redirect only for `record.kind === 'not-found'` (no data read is possible), mount the truthful header, then call the new `renderNotFound`. Remove the old all-routes list. Preserve the render-generation guard and `setShellState('ready','true')`.
  - Update `markActiveNav`/hash handling so account anchor links set `aria-current="location"` for the matching hash and clear it on hash change; keep analytics `aria-current="page"` behaviour. Preserve `SHELL_ROUTES` as an exported constant if other code imports it, but the not-found view no longer prints it.
- `flows.js`:
  - `login`: exact heading supplied by the router; exact sentence and link; safe return; escaped error; no tenant read.
  - `callback`: exact in-flight status; keep the manual redirect/type check and `oauthCallbackTarget`; on any failure replace raw messages with the exact failure sentence and add `Try sign in again` → `/login` plus only a safe `return`.
  - `settings`: heading `Connection`; left 480px column; base populated from storage; password input always blank and never set from storage; save validation, key preservation when blank, transport/session invalidation through a same-route reload, clear of both keys plus reset/reload, and non-optimistic sign-out. Do not render either key in a URL or log.
  - `device`: remove the local tenant select and its localStorage writes; read the current tenant from the header/account context; build the payload through the existing helpers; use the exact labels/options/copy; preserve request URLs, normalization, no bearer echo and the disabled/pending rules. Keep the existing data-testid hooks the contract tests rely on.
- `account.css`: add the 480px input column, full-width section, inline signed-in/availability note and error styles; reuse the profile table/row foundation from `phase3-01`. No new dependency, no animation.
- Update only the login/callback/settings/device/not-found subtests in `tests/identity/browser.test.mjs`; add a not-found assertion that captures requests and proves no `/v1/analytics/` read, that Start/Pulse links preserve `tenant` and committed scope, and that the unknown path is text (not markup). Keep A1–A5/F7 profile tests green.
- Capture 1440×900 light/dark screenshots of `/settings`, `/login`, `/oauth/callback` (failure state), `/device` and `/missing` under `.scratch/plan30-chrome/phase3-u2/` and compare region order, widths, row density and copy with the matching `mockups/<screen>.png` and `mockups/src/<screen>.html`; the written contract wins where they differ.

### Keep untouched

`account-console.js` and the profile branch (owned by `phase3-01`); lifecycle HTML/Go; analytics nav/filter/panel/explorer/CSS code; `transport` auth semantics; `return-path.js` and `session-gate.js` (do not weaken or add auth exceptions to the gate); the account session behaviour for `/profile` and `/device` except the header note; and the existing lifecycle security tests. Do not edit the `.spec.ts` e2e files: this repo's documented runner is `node --test ... *.test.mjs`, there is no Playwright config for them, and they already assert pre-Plan-30 shapes (`device` token-name prefill, `Approved.`, settings clear-by-empty-save). Record that as a stale-suite note; do not claim them as evidence.

## Done evidence

Identify or write the failing check before changing code; the current callback/device/settings subtests assert the old copy and tenant picker and must fail first.

- `cd packages/yakka-analytics && mkdir -p .scratch/identity-tmp && TMPDIR="$PWD/.scratch/identity-tmp" PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/identity/browser.test.mjs tests/identity/contracts.test.mjs` → all pass, including the exact callback failure/retry, device global-tenant payload and success copy, blank token name, settings key non-render/preserve/clear, sign-out failure, and not-found no-analytics-read assertions.
- Observable: `/missing` performs zero `/v1/analytics/` requests, shows the exact sentence, and its Start/Pulse links keep `tenant` and the committed query.
- Observable: a settings save with the password field untouched keeps the existing key; `Clear settings` removes both keys; the stored key never appears in the DOM, URL or a request query.
- `cd packages/yakka-analytics && node --test tests/static-shell.test.mjs` → still passes.
- `git diff --stat` shows only the owned paths and the report.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` for browser work), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` in this repo (Vitest `--maxWorkers=3` only if ever used), no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
