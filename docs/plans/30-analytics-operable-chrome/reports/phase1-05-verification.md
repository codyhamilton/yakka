# Verification — Phase 1 selected tenant and filter set

Verified 2026-11-22 00:20 AEST on branch `feat/30-analytics-operable-chrome`. Tested tree: `a80e59e3` (scope/Ledger fixes) plus the cohort-scope grain fallback committed with this report.

## Acceptance

```
cd packages/yakka-analytics
PUBLIC_CANVAS_TEST_MODE=true node --test --test-reporter=spec \
  tests/plan30/phase1-acceptance.test.mjs tests/plan30/legacy-counts.test.mjs
→ 21 tests, 21 pass, 0 fail (34.8s)
→ subtests: S1, N1, C1, C2, C3/C4, C5, C6, C7, C8, C9, C10, C11,
  V1/V4/V5, T1, T2, T3, T4, screenshots, and both legacy-count tests
```

The suite spawns the real Go fixture with a real cookie session and two disjoint tenants, serves `web/` same-origin, and drives headless Chromium with `PUBLIC_CANVAS_TEST_MODE=true`; it does not intercept requests. The first run after the fixer commit still failed `C11-cohort-request` on 6 requests. Cause: Ledger builds a session cohort from its static event-grain schema, so `scopeElements` did not know the session grain and copied the event-only `tool`/`stage` filters; the server correctly answered `400 unsupported_join` (`not_defined_for_grain`). Fix: `selection-tray.js` now falls back to the server's published per-grain cohort scope lenses when a panel schema does not publish the target grain. The rerun is the 21/21 above.

Unit coverage added in `tests/plan30/phase1-fixes.test.mjs` for default chips, advanced-row removal, cohort timezone, created-cohort grain scope, facets parameters, and Compare Reset. Focused node run: 27 tests, 27 pass (`tests/workspace/tray.test.mjs`, `tests/operable-chrome/{scope-unit,ledger-states-unit}.test.mjs`, `tests/plan30/phase1-fixes.test.mjs`). Go suite from the fixer run: `go test ./internal/serve ./internal/store` pass.

## Check IDs

| ID | Result | Evidence |
| --- | --- | --- |
| S1 | pass | Delayed 400ms tenant B selection; every post-selection analytics request carries B, URL/counts are B, no A text/row; delayed A fetch cannot paint after two frames; Back/Forward restore through fresh generations; history changes only on committed selections. |
| N1 | pass | 30d `8,406 / 4 / 12,480`; 100→200 rows; full `/explore` traversal 8,410; all-history `12,480 / 9 / 12,480`; activity `16` then `23`; repo/kind intersections; marker conversation has 2 rows; empty window; foreign tenant 403 with no A fallback. |
| C1 | pass | Tenant select visible; `/me` order; B selection tears down A and issues B; reload remembers; URL B wins. Fixture has no pending tenant, so the pending-disabled branch is not exercised. |
| C2 | pass | 7d/1d/90d write `win` and request frozen bounds with no `win`; legacy `24h` label; custom validation; DST-invalid New York error; one Apply per commit. |
| C3/C4 | pass | Served repo facets; missing repo preserved; repeated/multiple forms; drafts issue no reads; Apply issues one read set; unsupported kind blocks Apply. |
| C5 | pass | Browser/UTC/Brisbane/URL zones; URL zone selected; timezone changes summary `tz` without changing retention counts. |
| C6 | pass | Three edits issue no analytics reads and show `Unapplied changes`; Apply issues one read set and one push; second Apply none; Back restores inputs. |
| C7 | pass | Reset clears filters/cohorts/exclusions/selection/custom window, keeps tenant/tz/panel, and reasserts `cmp=period` on `/b/compare`; default scope chip is no longer removable. |
| C8 | pass | All history sets `win=all`, clears bounds, keeps tenant/repo/kind, clears cursor, issues `all=1`, shows 100 of 12,489. |
| C9 | pass | Appending a B fact then Refresh starts a new generation, shows 4 events/1 rejection/5 rows, resets Ledger to page one, leaves no stale rows. |
| C10 | pass | Theme toggles and persists; dark has no white surfaces; height stable; light restored for screenshots. |
| C11 | pass | Advanced rows from deep link; unrelated URL preserved on removal; window never reset; Remove `tool` also clears `pick/sel`; created session cohort carries a non-empty IANA `tz` and only session-grain scope lenses; zero cohort 400s. |
| V1 | pass | 1440×900: identity 46px, both nav rows 32px, heading 32px, filter row ≥44px, count line 32px; main left 0, 12px gutter, no page scroll. |
| V4 | pass | No lifecycle nav; no invite/add/change-role controls; Theme follows tenant; tab order brand→tenant→theme→nav. |
| V5 | pass | Exact analytics and account nav order/hrefs; brand→`/`; correct `aria-current`; every nav click resolves. |
| T1 | pass | Delayed first page keeps header, one full-span 30px `Loading Event ledger…` row with `aria-busy=true`, no prior rows; real rows replace it. |
| T2 | pass | Empty and error rows use exact text and one 30px full-span row; counts are unavailable, not zero; All history/Reset actions work. |
| T3 | pass | Real 503 busy: exact heading, detail, code `busy`, focusable Retry; release drains and retry succeeds; 401/403 text exact; foreign `/explore` 403. |
| T4 | pass | First page 100 unique keys; delayed Load more shows disabled `Loading…`; 200 unique; held next page shows `Retry next page` and keeps rows; retry continues without duplicates; scope change clears cursor. |

## Screenshots and mockups

Full-page, 1440×900 viewport, dark (mockup reference) and light, under `.scratch/plan30-chrome/screens/` (gitignored), with `.txt` body dumps. Each was taken from the real app against the Go fixture.

| Screen | Shot | Mockup | Comparison |
| --- | --- | --- | --- |
| Start | `start.png`, `start-light.png` | `mockups/start.png` | Shell, nav rows, tenant/theme, filter row, counts, density and dark surfaces match. Start still renders grouped question links instead of the S-start "Choose a question" table; assigned to phase 2 by the unit briefs. |
| Pulse | `pulse.png`, `pulse-light.png` | `mockups/pulse.png` | Shell, controls, counts, panel order and the observation line match. Existing panels remain stacked/full-width rather than the mockup's compact board; P-layout and chart catalogue are phase 2. |
| Ledger | `ledger.png`, `ledger-light.png` | `mockups/ledger.png` | Shell/controls/counts match; denominator now sits once above the table in every state. The older wider column set is retained; the S-ledger nine-column contract is phase 2. |
| Trends | `trends.png`, `trends-light.png` | `mockups/trends.png` | Board shell and controls captured; existing full chart catalogue makes the page very tall. Chart/P layout is phase 2. |

## Plan 29 regression and gates

`node --test tests/plan29/phase3-acceptance.test.mjs` remains at 5 pass / 5 fail, unchanged from the U4 handoff: missing `.topbar`/`footer` geometry, `/sessions?win=all` 35px rows, 28px coarse-pointer buttons, and the 768/390 measurement record. These are the pre-Plan-30 responsive/measurement expectations (Plan 30 V2 explicitly sets 30px data rows and 28px minimum controls) and belong to later phases; no Plan 29 file was edited.

Gates (not automatable here): `gate: signed-in production check tenant switch, counts and cohort creation against the deployed API and real sign-in`; `gate: signed-in production check screenshot comparison at 1440×900 on deployed data`.
