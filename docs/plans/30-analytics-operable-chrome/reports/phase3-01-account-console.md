# Report: phase3-01 — Account console: tenants, membership, tokens

Status: done. Branch `feat/30-analytics-operable-chrome`. No failures outstanding.

## What changed

- New `packages/yakka-analytics/web/js/identity/account-console.js`: `renderAccountConsole(root, context)` plus pure `tokensForTenant`, `tokenState`, `sortTokens`.
- `web/js/identity/flows.js`: `/profile` delegates to the account console; all other identity bodies unchanged.
- `web/js/app.js`: `/profile` resolves the tenant with `authorizedTenant`, canonicalizes a missing `tenant` once with `replaceState`, mounts the header with it and passes `{api, me, meStatus, tenant, onRefreshMe, onSelectTenant, onStatus}`. `onRefreshMe` re-fetches `/v1/me` and re-mounts the header; `onSelectTenant` commits once through `changeTenant`; a pending focus is applied after render. Other account routes untouched.
- `web/js/core/router.js`: `/profile` title is `Account, tenants & tokens`; every other route/title unchanged.
- `web/index.html`: links `/css/account.css` after the existing stylesheets; nav untouched.
- New `web/css/account.css`: full-width sections, identity line, 30px single-line rows, exact column widths, 480px-capable wrapping form rows, inline confirmation row, light/dark `--yk-*` tokens, no shadows/pills/gradients/animation.
- `tests/identity/browser.test.mjs`: fixture extended for two owned tenants, generation/state, per-tenant tokens, exact create/revoke payloads, 409 and revoke failure controls; the old flat-list profile subtest was replaced by A1–A6 subtests. Login/callback/device/settings subtests unchanged apart from the shared host.

## Checks

| ID | Verdict | Evidence |
|---|---|---|
| A1 | pass | Browser subtest `A1 account nav...`: `/me` order, headers `Name, Immutable ID, Your access, Lifecycle state, Generation, Actions`, rows `Alpha/Owner/Active/3` and `Beta/Owner/Active/5`, measured widths 240/260/100/160/100, 30±1px rows, `Use tenant` moves header + token list. Empty `You do not own any tenants yet.`, loading `Loading tenants…`, error `Could not load tenants.` + `Retry account` exercised. No invite/member/role controls. `Refresh account` issues a fresh `/v1/me` and re-mounts the account view (asserted). |
| A2 | pass | Subtest `A2 create tenant...`: blank returns no request and shows `Use 1–64 characters with no control characters.`; control char rejected; `Delta` posts exactly `{"name":"Delta"}`, a fresh `/v1/me` is read, the returned tenant is selected (header + URL), and the new row receives focus. Duplicate shows `You already have a tenant with this name.` and keeps the input. Button/input disabled while pending. |
| A3 | pass | Subtest `A3 token payload...`: empty name posts `{tenant,scope,lifetime}` (no `name`); defaults post `{tenant,scope,lifetime,name:"token"}`; no tenant filter on `GET /v1/tokens`; plaintext appears once with `Copy this token now. It will not be shown again.`, copy works, dismiss removes it; no plaintext in localStorage, sessionStorage, URL or DOM after tenant switch/navigation; `Create a tenant to issue a token.` disables with no tenant. Copy failure text implemented. |
| A4 | pass | Subtest `A4 token inventory...`: headers exact, widths 220/180/140/160/160/120, no Secret column; client filters on exact `token.tenant` (GET has no tenant param); order `token-a1, token-a4, token-a2, token-a3` (created_at DESC, id ASC); states `Active, Active, Expired, Revoked` derived from `expires_at`/`revoked`; only Active rows offer Revoke; switching A→B removes all A rows. Error state `Could not load tokens.` + `Retry tokens`. |
| A5 | pass | Subtest `A5 revoke...`: exact text `Revoke alpha-active? Clients using it will lose access.`; Cancel sends nothing; confirm posts `{}` to `/v1/tokens/token-a1/revoke` once; success re-fetches and shows `Revoked`. Failed revoke keeps `Active`, shows a click-only `Retry revoke` and makes no automatic second request; a click then retries. Confirmation is its own row, data rows stay 30±1px. |
| A6 | pass (link only) | `href=https://api.yakka.build:<port>/profile/lifecycle?tenant=tenant-a`, same tab, label `Reset or delete… (API owner page)`. No reset/delete request is made; page body is owned by phase3-03. |
| F7 | pass | Memberships list all owned tenants (`Owner`); tokens filtered to the selected tenant; no time/repo/kind or invitation controls on the screen (asserted). |
| S-profile | pass | Region order identity line → `Tenants & membership` → token form/table; `/profile#tenants`, `#membership` target the membership section (`#membership` anchor inside it) and `#tokens` the token section; no chart/filter bar/count strip. Screenshots at 1440×900 light/dark. |
| C1 | pass | Header `#tenant-select` is the only tenant selector, always visible, width 260px; selecting B pushes one `tenant` URL change, updates the token inventory and header; canonical `?tenant=` is written once on first visit. |
| C10 | pass | Existing `#theme-toggle` unchanged; dark screenshot taken by clicking it and both themes use the existing tokens. |
| V1 | pass | Measured `body` and `scrollWidth` = 1440 at 1440×900; full-width sections, existing 46/32/32px shell rows, 12px gutters, no max-width wrapper. |
| V2 | pass | Header/table rows measured 30.5–31px (within 30±1), single-line ellipsis cells with titles, left alignment, tabular numerals, native 28px controls, visible focus (row `tabindex=-1`). |
| V3 | pass | `account.css` uses only `--yk-bg/surface/surface-alt/text/muted/border/focus/danger`; no literal white fills or shadows; light and dark screenshots. |
| V4 | pass | No chips/pills/gradients/shadows/animations/hero cards; no invitations, member editor, role write, hidden tenant select or invented IAM; no analytics filter controls. |
| V5 | pass | Account nav order and hrefs asserted exactly (`Tokens→/profile#tokens`, `Tenants→/profile#tenants`, `Membership→/profile#membership`, `Settings`, `Device approval`); analytics nav untouched; `aria-current` behaviour preserved. |

## Test evidence

- Before: `tests/identity/browser.test.mjs` passed against the old flat `<ul>` profile, so the new assertions were written first; the rewritten A1–A5 subtests fail against the old module (missing `[data-account]`, no token table, old tenant form selector).
- After: `TMPDIR=<short scratch> PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/identity/browser.test.mjs tests/identity/contracts.test.mjs` → 21 tests, 21 pass.
- Regression: `tests/plan30/phase1-acceptance.test.mjs` → 19/19 pass; `tests/operable-chrome/phase2-acceptance.test.mjs` → 1/1 pass.
- Screenshots: `.scratch/plan30-chrome/phase3-u1/profile-light.png`, `profile-dark.png`; measured `scrollWidth=1440`, tenant columns `[240,260,100,160,100,538]`, row heights 30.5–31px.

## Deviations and notes

- The brief's `TMPDIR="$PWD/.scratch/identity-tmp"` makes Chromium fail with `Socket path too long` on this host; tests were run with the same gitignored `.scratch/` tree rooted at the repo (`.../30/.scratch/identity-tmp`). No `/tmp` was used.
- The token table shows `created_at` DESC, so `Read dashboard` (12 Nov) precedes `Laptop collector` (1 Nov) in the screenshot, contrary to the mockup's row order. The written A4 order wins.
- `Refresh account` is added per the DESIGN account paragraph; it is not in the mockup.
- The membership section keeps a separate full-width identity line plus the mockup's ownership note. Table captions are semantic but visually hidden, so they do not duplicate the section headings.
- Mockup nav links `Tenants`/`Membership` to `#membership`; the written S-profile contract (`#tenants`/`#membership` both target the same section) wins, and the existing nav hrefs are preserved.
- No known unresolved problems.
