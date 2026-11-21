# Brief: phase3-01 — Account console: tenants, membership, tokens

Consumer: a product build worker for Plan 30 phase 3, account console and shell integration.
Owned paths: new `packages/yakka-analytics/web/js/identity/account-console.js`; `packages/yakka-analytics/web/js/identity/flows.js` (the `profile` branch and its imports only); `packages/yakka-analytics/web/js/app.js` (the account-route branch and the minimal account-session helpers it needs); `packages/yakka-analytics/web/js/core/router.js` (account anchors/titles only); `packages/yakka-analytics/web/index.html` (the account CSS link only); new `packages/yakka-analytics/web/css/account.css`; `packages/yakka-analytics/tests/identity/browser.test.mjs` (the profile/tenant/token subtests and host fixture only). Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase3-01-account-console.md` listing A1–A5, F7, S-profile, C1, C10 and V1–V5 with pass/fail and evidence (rubric in `packages/yakka/catalogue/checks/execution-report.json`), and include it in the commit.
Depends on: nothing.
Runs alongside: `phase3-03-lifecycle-page` (disjoint paths). No other unit runs in wave 1.
Budget: about 10 files read, about 700 lines changed, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 784–800 — **S-profile**, its region map, order and acceptance sentence.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 900–913 — **A1–A6** and the account-request authority paragraph; A6 is read here for the link contract but its target page is owned by `phase3-03`.
3. `docs/plans/30-analytics-operable-chrome/DESIGN.md` line 95 — **F7** filter applicability for account/lifecycle.
4. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 99–160 — **V1–V5, C1, C10** and the shared metadata/tenant-loading rules at line 131.
5. `packages/yakka-analytics/web/js/identity/flows.js` lines 1–117 — current profile list/markup and the `call`/`status`/`field` helpers to preserve.
6. `packages/yakka-analytics/web/js/app.js` lines 68–139, 177–195, 829–872 and 995–1002 — header mount, tenant change, account branch, theme toggle and render-generation guard.
7. `packages/yakka-analytics/web/js/core/router.js` lines 7 and 57–66 — `ACCOUNT_PATHS` and `accountTitle`.
8. `packages/yakka-analytics/web/index.html` lines 16–31 — current nav and CSS links.
9. `packages/yakka-analytics/web/contract/{transport.js,session-gate.js}` lines 12–23 and 43–60 — session auth, `authorizedTenant` precedence and `tenantOptionLabel`.
10. `packages/yakka-analytics/tests/identity/browser.test.mjs` lines 15–140 — the stub host and the subtest idiom you extend.
11. `docs/plans/30-analytics-operable-chrome/mockups/profile.png` and `mockups/src/profile.html` — visual order/density reference only.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

One dense, full-width account console at `/profile` restores discoverable tenant creation, owned-membership inventory and token management using only the existing session-authenticated APIs, with the global tenant controlling token inventory and no invented IAM surface.

## Contract

Settled by DESIGN.md:

- **A1 owned membership:** `GET /v1/me` supplies `github_login` and `tenants[].id,name,lifecycle_state,lifecycle_generation`. The table heading is `Tenants & membership`; columns are `Name` 240px, `Immutable ID` 260px, `Your access` 100px, `Lifecycle state` 160px, `Generation` 100px, `Actions` (remaining width). `/me` order. `Owner` derives only from the owned-tenant list. `Use tenant` commits C1. Empty `You do not own any tenants yet.`, loading `Loading tenants…`, error `Could not load tenants.` plus `Retry account`. No invitations, member editor or role write.
- **A2 create tenant:** label `New tenant`, blank default, `maxlength=64`, trim; reject control characters with the visible exact text `Use 1–64 characters with no control characters.` Button `Create tenant` posts `POST /v1/tenants` with exactly `{name}`. Disable during the request. Success refreshes `/v1/me`, selects the returned tenant through C1, focuses the new row. `409` shows `You already have a tenant with this name.` and leaves the input. Never double-submit.
- **A3 create token:** global C1 is the only tenant selector and supplies the mandatory tenant with adjacent immutable-ID text; there is no second tenant form select. Controls: `Token name` default `token` (trimmed empty omits `name`), `Scope` (`Read`=`read` default, `Read and write`=`read_write`), `Lifetime` (`1 day`=`1d`, `1 week`=`1w`, `1 month`=`1m`, `3 months`=`3m` default, `6 months`=`6m`, `1 year`=`1y`). `Create token` posts exactly `{tenant,scope,lifetime,name?}` to `POST /v1/tokens`. With no tenant selected the button is disabled and `Create a tenant to issue a token.` is visible. Success shows the plaintext once in a labelled read-only selectable output with `Copy this token now. It will not be shown again.`, buttons `Copy token` (clipboard only) and `Dismiss token` (erase DOM and local variable). Copy failure `Select and copy the token manually.` Never write the plaintext to localStorage, sessionStorage, the URL, console/logs or a token-list read; tenant switch and any navigation clear it.
- **A4 token inventory:** `GET /v1/tokens` returns all owned tokens and the client filters by exact `token.tenant === selected tenant`; never send an invented tenant filter. Columns `Name` 220px, `Tenant` 180px, `Scope` 140px, `Created` 160px, `Expires` 160px, `State` 120px, `Action` (remaining). `created_at` DESC then `id` ASC. Include revoked rows as `Revoked` with no action. No secret column. Empty `No tokens for this tenant.`; loading `Loading tokens…`; error `Could not load tokens.` with Retry named tokens. Derive `Active`, `Expired`, `Revoked` only from the real `expires_at`/`revoked` fields.
- **A5 revoke token:** only active tokens offer `Revoke`. It opens an inline confirmation with exact text `Revoke {name}? Clients using it will lose access.` and buttons `Cancel` and `Revoke token`; the confirmation content may wrap on its own line but must not stretch the 30px token row. Cancel sends nothing. Confirm posts `POST /v1/tokens/{encodeURIComponent(id)}/revoke` with `{}`, disables while pending, and on `204` refetches inventory. Failure keeps the row unchanged, never labels it revoked and offers a click-only `Retry revoke`; never auto-retry.
- **F7:** the membership section lists all owned tenants; the token list is scoped to the selected tenant; there are no time, repository or kind controls and no invitation controls.
- **S-profile order:** identity line, `Tenants & membership` section, then token form/table. `/profile#tenants` and `/profile#membership` target the same owned-tenant section; `/profile#tokens` targets the token section. The account nav is `Tokens`→`/profile#tokens`, `Tenants`→`/profile#tenants`, `Membership`→`/profile#membership`, `Settings`→`/settings`, `Device approval`→`/device`.
- **V/C/T:** viewport-width body, 12px gutters, 46/32/32/32px shell rows, 30px single-line table rows, left alignment, tabular numerals, native controls, 28px minimum controls, no shadows, no decorative chips, no white panel surfaces, real `--yk-*` tokens, light and dark. C1 is the header tenant select and is always visible; C10 is the existing Theme button. No analytics filter bar or count strip.
- **A6 boundary:** this unit renders the per-owned-tenant link `Reset or delete… (API owner page)` to the configured API origin `/profile/lifecycle?tenant={id}` in the same tab. It must not implement or call reset/delete. The page itself is `phase3-03`.

Settled by the code: the existing `flows.js` profile reads `me` and only renders a tenant form and a flat token `<ul>`; `app.js` mounts the header but account routes currently never canonicalize the selected tenant or re-mount the header after an account write. The worker must reuse the existing `transport.request`, `status`, `field`, `button` and session helpers rather than add a second HTTP client or session store.

## Changes

- Add `account-console.js` exporting `renderAccountConsole(root, context)`; `flows.js` calls it for `/profile`. Keep the module free of router/URL ownership: it receives `{api, me, meStatus, tenant, onRefreshMe, onSelectTenant, onStatus}` from `app.js`.
- `app.js`: in the account branch, load `/v1/me` for `/profile` as it already does, resolve the current tenant with the existing authorized-tenant rule, canonicalize a missing tenant once with `replaceState` using the reserved `tenant` field, mount the header with that tenant, and pass the account context to `renderIdentity`. `onRefreshMe` must replace the app's cached session result and re-mount the header (a fresh `GET /v1/me`); `onSelectTenant(id)` must commit through the existing `changeTenant` path exactly once. Do not add a second tenant store. Preserve render-generation checks and teardown.
- `router.js`: keep `/profile` in `ACCOUNT_PATHS`; change only its account title to `Account, tenants & tokens`. Keep every other route and title unchanged for `phase3-02`.
- `index.html`: link the new `account.css` after the existing stylesheets. Do not change the nav, header or topology.
- `account.css` (new): full-width account sections, an identity line, tables with the exact widths above and 30px rows, a 480px form column where the screen contract says so, inline confirmation rows that do not stretch the data row, and light/dark values from the existing `--yk-*` tokens. No max-width wrapper, no centred card, no pills, no gradients, no animation.
- Implement A1–A5 and F7 exactly as cited. Use text nodes/`textContent` for API-derived names, ids, token names and errors. Export small pure helpers for token filtering/state derivation if that keeps the test honest, but no new backend.
- Extend `tests/identity/browser.test.mjs` to cover: two owned tenants with generation/state; owned table columns, order and `Owner`; `Use tenant` changes header and token list; A2 invalid input sends no request and valid create sends exact JSON then selects/focuses the returned tenant; A3 exact payload, one-time plaintext, copy/dismiss, navigation/tenant-switch clears the plaintext and no storage/URL leak; A4 client filtering (tenant A→B removes A names), revoked/expired state, no secret column; A5 Cancel no write, exact revoke request, failed revoke stays `Active`, Retry requires a click; A6 link href/label. Keep the existing login/callback/device/settings subtests passing; `phase3-02` owns their contract changes, so do not rewrite them here beyond what the shared host change requires.
- Capture 1440×900 light/dark `/profile` screenshots under `.scratch/plan30-chrome/phase3-u1/` and compare region order, widths, row density and copy with `mockups/profile.png` and `mockups/src/profile.html`; the written contract wins where they differ.

### Keep untouched

`flows.js` login/callback/settings/device bodies, the account session gate and transport auth semantics, `mountTenantHeader` for non-account routes, the not-found branch, lifecycle HTML/Go, analytics nav/filter/panel/explorer code, all CSS other than the new `account.css` plus its `index.html` link, every Go file, and the existing lifecycle security tests. Do not add endpoints, invites/roles/membership writes, CORS changes or token secrets in storage/URLs/logs.

## Done evidence

Identify or write the failing check before changing code; the current profile test asserts the old flat list and must fail first.

- `cd packages/yakka-analytics && mkdir -p .scratch/identity-tmp && TMPDIR="$PWD/.scratch/identity-tmp" PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/identity/browser.test.mjs tests/identity/contracts.test.mjs` → all pass, including the new A1–A5/F7 assertions and the unchanged payload/return-path/device contracts.
- Observable: with two owned tenants, selecting B removes every A token row; creating a token shows the plaintext once and a reload/navigation leaves no plaintext in DOM, storage or URL; cancel sends no revoke; a failed revoke keeps the row `Active` with a click-only Retry.
- Observable: the account nav renders in the exact V5 order and `/profile` has no analytics filter bar, count strip or chart.
- `git diff --stat` shows only the owned paths and the report.

## Constraints

8G memory cap (`NODE_OPTIONS=--max-old-space-size=8192` for browser work), `PUBLIC_CANVAS_TEST_MODE=true` for Chromium, `node --test` in this repo (Vitest `--maxWorkers=3` only if ever used), no animation/timing tests, no fixed sleeps, no `/tmp` (gitignored `.scratch/` only), no secrets or trial token, no deploy/fly/wrangler, no tenant reset/delete, never the default tenant, no other worktrees or branches. Do not run review, terminal review or close-out.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
