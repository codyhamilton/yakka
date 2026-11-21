# Report: phase3-03 — Tenant lifecycle page density, tenant link and return path

Status: done. Branch `feat/30-analytics-operable-chrome`. No failures outstanding.

## What changed

- `packages/yakka/internal/serve/lifecycle_profile.html`: rewrote the inline CSS into the dense Plan 30 shell with inline copies of the real `--yk-*` light/dark tokens; added the 46px identity row (brand → Pages Start, C1 tenant select, C10 Theme, `Return to analytics`), the 32px analytics and account nav rows, a 32px title band, the account context and the semantic owned-tenant table; the existing owner lifecycle list became a table (`Tenant name` 240px, `Immutable ID` 260px, `Lifecycle state` 180px, `Generation` 100px, `Actions` remaining) with 30px rows and `data-tenant-id`/`data-selected` hooks; the confirmation `<dialog>` is left-anchored (`inset:12px auto auto 12px`, `width:min(600px, calc(100vw - 24px))`).
- Added only the minimum script: URL `tenant` read, C1 select population/`replaceState`, row highlight, `Return to analytics` href (`https://yakka.build/?tenant={id}`), Theme persistence to `yakka-analytics-theme` on the API origin, and the reset/delete return-path update. `loadMe`, `unauth`, `render`, `openConfirm`, `submitConfirmed`, `ambiguousFailure`, `reportedFailure`, `failureMessage`, the destructive fetch and every security/recovery string are unchanged in meaning; no timers, loops, retry or credential strings were added.
- New test-only `packages/yakka/internal/serve/lifecycle_profile_phase3_test.go`: real `httptest` GET through the placeholder-mode collector asserting the table headers/widths/30px rows, C1 deep link/select/labels, C10 Theme, return link, nav order, left-anchored dialog, self-contained page, no V4 decoration and all existing security strings.
- `lifecycle_profile.go`, `serve.go`, the lifecycle engine and all existing lifecycle tests are untouched.

## Checks

| ID | Verdict | Evidence |
|---|---|---|
| A6 | pass | Real page still renders the human-owner sentence, exact reset/delete effect copy, blank `#typed-id`, Confirm disabled until exact id, Cancel no request. `lifecycle_profile_test.go`/`lifecycle_http_test.go`/`lifecycle_engine_test.go`/`lifecycle_conformance_test.go` pass unchanged. Browser proof against the real Go-harness template with Playwright route stubs: opening the dialog sent zero requests; reset sent exactly `POST /v1/tenants/t-a/reset` `{"confirm_tenant_id":"t-a"}`; delete sent exactly `DELETE /v1/tenants/t-b` `{"confirm_tenant_id":"t-b"}`; no Authorization/Bearer; no auto-retry. |
| S-lifecycle | pass | Region order identity → analytics nav → account nav → title → account context → table → left-anchored dialog. Measured 1440×900: identity 46px, analytics nav 32px, account nav 32px, title 32px, main.left=0, inner gutter 12px, `scrollWidth=1440`, table columns `[240,260,180,100,635]`, body rows 31px. No filter bar/chart/time/repo/kind control. |
| C1 | pass | `#tenant-select` is a native select labelled `Tenant`, width 260px, options from owned `/me` tenants in order as `{name} · {id}` (Go test); non-active options disabled and labelled with lifecycle state. Deep link `?tenant=t-b` selects and highlights the t-b row (browser proof); changing the select to t-a replaced `?tenant=t-a` via `replaceState` and moved the highlight (browser proof). No Pages `localStorage` reminder is read for selection. |
| C10 | pass | `#theme-toggle` flips `data-theme` light↔dark and writes `yakka-analytics-theme` on the API origin; head bootstrap defaults from the stored value else `prefers-color-scheme` (browser proof: dark stored, restored light). Light/dark screenshots captured. |
| V1 | pass | Full viewport width, `main.left=0`, content left 12px, right 1428, `scrollWidth=1440`; 46/32/32 bands; no max-width wrapper or centred card. |
| V2 | pass | Body `13px/1.35`, `h1` 19px, `h2` 14px; measured body rows 31px (within 30±1), single-line ellipsis cells with full-value `title`, left alignment, `font-variant-numeric: tabular-nums`, controls min-height 28px, 2px radii. |
| V3 | pass | Inline light/dark `--yk-bg #eef1f4/#111923`, `--yk-surface #f4f6f8/#1b2734`, `--yk-surface-alt`, `--yk-text`, `--yk-muted`, `--yk-border`, `--yk-selected` copied from `web/css/charts.css`; no remote token fetch; both themes captured. |
| V4 | pass | No chips/pills, gradients, shadows, animations/transitions, hero cards, analytics filter controls, invitations/member/role controls or hidden tenant selector (Go test negatives). |
| V5 | pass | Analytics row `Start, Pulse, Trends, Cost, Quality, Tools, Workflow, Compare, Scatter, Plans, Sessions, Ledger, Operations`, then account row `Tokens, Tenants, Membership, Settings, Device approval`, asserted in order as ordinary anchors to `https://yakka.build`; brand → Pages Start. |

## Checks before and after

- Before (new test against the committed `<ul>` page): `go test ./internal/serve -run TestLifecycleProfilePhase3Page` failed with `analytics nav missing "href=\"https://yakka.build/\">Start"`.
- After:
  - `cd packages/yakka && go test ./internal/serve -run 'Lifecycle' -count=1` → `ok` (existing profile/HTTP/engine/conformance + new phase3 page test).
  - `cd packages/yakka && go test ./internal/serve ./internal/store -count=1` → `ok` serve (310.820s), `ok` store (11.099s).
- Browser proof (scratch, `.scratch/plan30-chrome/phase3-u3/proof.mjs`): deep-link highlight, select→URL/highlight, Theme store, stubbed 204 reset keeps the tenant, stubbed 204 delete clears the selection to `Choose a tenant`, highlights nothing and targets the surviving `t-a` on `Return to analytics`; all assertions passed. No real reset/delete was issued.

## Screenshots and mockup comparison

- `.scratch/plan30-chrome/phase3-u3/lifecycle-light.png`, `lifecycle-dark.png`, `lifecycle-dialog.png` at 1440×900, plus `measure.json`, `dialog.json` and `proof.json`.
- Dialog geometry measured: `left=12`, `top=12`, `width=600`, blank typed id, Confirm disabled.
- Written contract wins over `mockups/lifecycle.png` / `mockups/src/lifecycle.html` where they differ: the mockup shows `State` and no `Generation` (implemented `Lifecycle state` + `Generation` per S-lifecycle), an inline "Confirmation appearance" panel (implemented the left-anchored `<dialog>` per A6/S-lifecycle), local `.html` nav links and a synthetic-data marker (implemented Pages-origin anchors, no marker), and larger list rows (implemented 30px rows). Mockup colours/regions (brand, tenant field, Theme, two nav rows, title, owner note, table) match.
- The harness `/v1/me` also lists the automatic `default` tenant owned by the login used for the screenshot; it is only displayed as a row and no lifecycle action was taken on it. Tenant A is selected and highlighted.

## Deviations and notes

- Rows measure 31px rather than a flat 30px because the native 28px action buttons sit on the 30px line box; this is inside the V2 `30±1px` tolerance and matches the account console's measured rows.
- A `Choose a tenant` placeholder option appears only after a delete (nothing selected), so the native select never visually auto-selects a fallback; initial load still applies the S1 URL-tenant → first-active precedence and canonicalizes `?tenant=` once.
- `NODE_PATH` and `PUBLIC_CANVAS_TEST_MODE=true` used for Chromium; no `/tmp`, no secret, no deploy, no real lifecycle write.
- No contradiction found between this brief and the contracts it cites.
