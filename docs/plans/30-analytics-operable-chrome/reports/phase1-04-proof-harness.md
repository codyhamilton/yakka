# Handoff — phase1-04 real-Go two-tenant proof harness

Status: done with concerns. Branch `feat/30-analytics-operable-chrome`. Owned new files only: the Go fixture, the Node harness, the Phase 1 Chromium acceptance suite, the legacy count unit, and this report.

## What changed

- `packages/yakka/internal/serve/plan30_harness_test.go` (new, build tag `plan30harness`): real remote-auth server, mock GitHub owner, two owned tenants, real cookie session, loopback-only control routes, and seed assertions before `PLAN30_HARNESS_READY`. Repaired the brief/artifact arithmetic: the brief artifact version is seeded under existing session `s1`, and `plan30MarkerA` appears only in rejections 1 and 4. Conversation expectation is now 0 matched events, 2 rejections, 2 rows. Window observations remain 16; all-history observations remain 23.
- `packages/yakka-analytics/tests/plan30/harness.mjs` (new): spawns the tagged Go fixture, serves `web/` same-origin with the declared `_headers` CSP and client-route fallback, reverse-proxies `/v1/`, installs the real session, and exposes delay/hold/append controls. Scratch only under `.scratch/plan30-harness/`; no request interception.
- `packages/yakka-analytics/tests/plan30/phase1-acceptance.test.mjs` (new): one real-Chromium suite for S1, N1, C1–C11, V1/V4/V5, T1–T4, diagnostics and 1440×900 screenshots. Failures are collected by ID so one finding does not hide the rest.
- `packages/yakka-analytics/tests/plan30/legacy-counts.test.mjs` (new): proves the legacy count strip names the missing capability and links to Ledger without a fabricated zero.

## Done evidence

Direct fixture (compiled test binary, real pipe closes stdin):

```
go test -c -tags plan30harness -o .scratch/plan30-chrome/serve.test ./internal/serve
sleep 12 | .scratch/plan30-chrome/serve.test -test.run '^TestPlan30Harness$' -test.v -test.count=1
→ PLAN30_HARNESS_ORIGIN=http://127.0.0.1:46479
→ PLAN30_HARNESS_READY
→ --- PASS: TestPlan30Harness (12.00s)
→ PASS
```

Combined Phase 1 evidence:

```
cd packages/yakka-analytics
node --test tests/plan30/phase1-acceptance.test.mjs tests/plan30/legacy-counts.test.mjs
→ 21 tests, 20 pass, 1 parent fail
→ all 18 acceptance subtests and both legacy subtests report ok
→ parent collects five product findings:
   C7-compare: Compare lost cmp=period on Reset
   C7-default-chips: 1 removable default chip(s) present
   C11-cohort-scope: generated cohort scope={...,"tz":null}
   C11-pick-sel: pick/sel survived: pick=s3| sel=null
   C11-cohort-request: 12 cohort request(s) rejected: 400 ...
```

Plan 29 regression:

```
node --test tests/plan29/phase3-acceptance.test.mjs
→ 10 tests, 5 pass, 5 fail (4 subtests + parent)
```

The four Plan 29 subtest failures are pre-existing product-state failures, not caused by the new test-only files: `getComputedStyle` on a missing element in full-width geometry; `/sessions?win=all` row height 35; coarse-pointer buttons 28px; committed measurement drift (`768.rowHeight 30 != 27`, `768.gutter 8 != 12`, `390.rowHeight 30 != 27`). No product or Plan 29 file was changed.

## Acceptance IDs

| ID | Result | Evidence |
| --- | --- | --- |
| S1 | pass | A delayed 400ms, select B; all post-selection analytics requests carry B, URL/counts are B, no `plan30-a-only` text/row; a real delayed A `event-counts` fetch is captured and two frames later no A paint; Back restores A with a fresh request, Forward restores B; history changes only on committed selections. |
| N1 | pass | 30d counts `8,406 / 4 / 12,480`, 100→200 rows, full `/explore` traversal 8,410 rows; all-history counts `12,480 / 9 / 12,480` and `100 rows displayed of 12,489 matching records`; activity `16` then `23` observations; repo/kind intersections `4,204`, `2`, `2`; marker conversation has 2 rows (briefs/01 and 03, not 02/reports/01); 2020 empty row; foreign tenant 403 and unavailable state with no A fallback. |
| C1 | pass | Selector visible; `/me` order A then B with name+ID labels; foreign absent; selecting B starts a new generation, issues a B read and no A read; reload remembers B; URL B wins over remembered A. Limitation: the fixture has no pending tenant, so the pending-disabled branch is not exercised. |
| C2 | pass | 7d/1d/90d write `win` and read frozen absolute bounds with no `win` on the API; legacy `win=24h` selects `URL window: 24h` (see contradiction); custom blank/from≥to disables Apply with the exact error; valid custom applies once; DST-invalid New York wall time shows the exact error and keeps Apply disabled. |
| C3/C4 | pass | Served repo facets; `repo-missing` preserved as `repo-missing (not in this window)`; repeated repos use the multiple form; 3-control edit issues no reads and shows `Unapplied changes`; Apply issues one read set with the exact filters; `kind=weird` preserved as `Unsupported kind: weird` with Apply disabled. |
| C5 | pass | Browser zone, UTC, Australia/Brisbane and a URL zone (`Europe/London`) are present; URL zone selected; changing tz changes `tz` on the summary read without changing retention counts. |
| C6 | pass | Three edits issue no analytics reads and show `Unapplied changes`; Apply issues one read set and one history entry; second Apply issues none; Back restores inputs without a push. |
| C7 | **fail** | Two findings: Compare Reset drops `cmp=period`; default Ledger has one removable chip (`window 30d ×`). Reset otherwise removes filters/cohorts/exclusions/selection/custom window and preserves tenant, tz and `p1`. |
| C8 | pass | All history sets `win=all`, clears `from/to`, keeps tenant/repo/kind, clears cursor, issues `all=1`, and shows 100 of 12,489 rows with repo-a counts. |
| C9 | pass | Appending one B fact then Refresh starts a new generation, shows 4 events/1 rejection/5 rows, resets Ledger to page one and leaves no stale rows. |
| C10 | pass | Theme toggles and persists; dark mode has no `rgb(255,255,255)` surfaces; layout box height is stable; light/dark restored for screenshots. |
| C11 | **fail** | Three findings: generated cohort scope has `tz:null`; 12 cohort requests return 400; removing `tool: Read` leaves `pick=s3|`. Advanced rows, deep-link reload and unrelated URL preservation otherwise pass. |
| V1/V4/V5 | pass | 1440×900: identity 46px, analytics nav 32px, account nav 32px, heading 32px, filter row ≥44px, count line 32px; `<main>` left 0, 12px gutter, inner right ≤1440, no page scroll; exact 13 analytics and 5 account nav orders/hrefs; brand→`/`; correct `aria-current`; Theme right of tenant; no lifecycle nav. |
| T1 | pass | Delayed A: header stays, one full-span 30px `Loading Event ledger…` row with `aria-busy=true`, no prior rows/zeros; real rows replace it. |
| T2 | pass | Empty and error rows use the exact text and a single 30px full-span row; counts strip is unavailable, not zero. |
| T3 | pass | Real 503 busy from the hold control: `Could not load Event ledger.`, `The server is busy; retry shortly.`, code `busy`, focusable Retry; release drains and retry succeeds; 401/403 action/detail text exact; foreign `/explore` is 403. |
| T4 | pass | First page limit 100, 100 unique keys; delayed Load more shows disabled `Loading…`, 200 unique keys; held next page shows `Retry next page` and keeps 200 rows; retry continues with no duplicate identities; scope change clears cursor and returns to limit 100. |

## Failed findings (not fixed here)

1. **C7-compare** — `removeAdvancedRow`/reset canonical state sets `cmp:'off'` (`web/js/core/chips.js:249`); the Compare route does not reassert `cmp=period`. Observed after Reset on `/b/compare?win=30d&cmp=period`: `cmp` absent.
2. **C7-default-chips** — `chipModel` unconditionally pushes a removable window chip (`web/js/core/chips.js:84`). Default Ledger shows `window 30d ×`; count is 1.
3. **C11-cohort-scope** — `absoluteScope` returns `tz:null` when `state.tz` is unset (`web/js/core/selection-tray.js:14-22`); the server requires a cohort scope tz (`internal/store/analytics_cohort.go:361-363`). Observed scope: `from`/`to` present, `include` tool Read, `exclude` stage screen, `tz:null`.
4. **C11-cohort-request** — 12 cohort requests return 400. Two causes: the null scope tz above, and the client sends `cohort` to `/v1/analytics/facets`, which calls `refuseCohort` and returns 400 `cohort_invalid/route_not_supported` (`internal/serve/analytics.go:118-124, 464-466`). The latter also rejects a valid cohort.
5. **C11-pick-sel** — `removeAdvancedRow` only clears `pick` when the removed row is `pick` (`web/js/core/chips.js:234-242`); removing `tool: Read` leaves `pick=s3|` (and `sel` was already absent).

## Screenshots

Dark (mockup reference) and light, full-page at 1440×900, under `.scratch/plan30-chrome/screens/`:

- `start.png` / `start-light.png`
- `pulse.png` / `pulse-light.png`
- `ledger.png` / `ledger-light.png`
- `trends.png` / `trends-light.png` (one board)
- matching `.txt` body dumps for each primary shot

Comparison: shell, nav rows, tenant/theme fields, filter bar, counts strip, density and dark surfaces match the mockups. Pulse panel order and the `16 observations displayed of 16 matching observations` line match. Start still renders grouped question links rather than the DESIGN S-start Question paths table, and Ledger still renders the older wider column set (Select/Event/Harness/Tool/Model/Source) rather than the DESIGN S-ledger nine columns; the prior phase reports assign the full S-start/S-ledger content to phase 2, so these are recorded as phase-2 visual gaps, not Phase 1 ID failures. Trends is captured as the board shell; its full chart catalogue is phase 2.

## Deviations and limitations

- **S1 delayed-A capture:** `scheduler.supersedeAll()` aborts the app's in-flight A request on tenant change, so the app's delayed A response cannot be captured with `waitForResponse`. The suite instead issues a separate real delayed A `event-counts` fetch and proves it cannot paint after two frames. The rest of S1 uses the real app.
- Browser context timezone is pinned to UTC for deterministic custom-window assertions; C2 explicitly selects `America/New_York` for the DST case and C5 selects `Europe/London` for the URL-zone case.
- C1 allows the server-created `default` tenant in the option list but never selects it; the fixture has no pending tenant, so the pending-disabled branch is not exercised. The foreign tenant is not in `/me`, so it is absent rather than disabled.
- `kind=weird` is deliberately injected by C3/C4; its 400s are filtered from the diagnostics check as intentional invalid input. Cohort 400s are also filtered from diagnostics because C11 records them explicitly.
- The screenshot primary files are dark (to match the mockups); `-light` files show the light theme. Theme was set on the document only for screenshots, not persisted.

## Contradictions

- **Brief vs DESIGN, C2 legacy label:** the brief says old `24h` renders as “24 hours”; DESIGN line 120 says a legacy valid duration URL gets the literal additional selected option “URL window: {duration}”. The implementation follows DESIGN and the suite asserts `URL window: 24h`. Not resolved silently.
- **Brief S1 vs client scheduler:** the brief asks to capture the delayed A response with `waitForResponse`; the client aborts in-flight requests on tenant change, so that exact capture is impossible without interception. The real delayed fetch above is the deviation.

## Phase 2 / unfinished

Full S-start Question paths table, full S-ledger nine-column contract, caption registry, P1–P10, A/G screens, T5 and the remaining F exceptions remain phase 2 per the prior phase reports. No product code or Plan 29 file was changed by this unit.
