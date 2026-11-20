# Brief: phase3-04 — Real-Go real-Chromium Phase 3 acceptance and committed geometry/token record

Consumer: Phase 3 build worker (verification unit; no product code).
Owned paths: `packages/yakka-analytics/tests/plan29/phase3-acceptance.test.mjs` (new), `packages/yakka-analytics/tests/plan29/phase3-measurements.json` (new committed record/baseline), and only if a read-only helper is required, `packages/yakka-analytics/tests/plan29/harness.mjs`. Touch no product file and no other test file.
Commits: commit to the current branch when the suite passes on the fixed tree, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase3-04-acceptance.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit. The report must cite the exact command, the viewports, the measured numbers and the resolved tokens for both themes.
Depends on: `phase3-01`, `phase3-02`, `phase3-03` (all product units). Do not run it as the phase outcome until they are green.
Runs alongside: nothing (wave 2).
Budget: 14 files to read, about 500 new lines, 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md` — Phase 3 outcome lines 199–204; Domain "Dense workspace and theme" lines 102–113; Assumptions 2 and 5 (lines 31–36, 52–57).
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md` — D16 (line 46), "Theme and density proof" (87–91): the 1920 measurement was `main.getBoundingClientRect().width === 1120`; gallery scatter pixel was `[27,39,52,255]` dark and `[255,255,255,255]` light.
3. `docs/plans/29-analytics-ui-rework/REVIEW.md` — Phase 3 assessment line 15.
4. `docs/design/09-analytics-workspace-contracts.md` — lines 12–13.
5. `packages/yakka-analytics/tests/plan29/harness.mjs` — all 282 lines. It spawns the real-Go fixture, serves `web/` with the declared CSP, proxies `/v1/`, and exposes `startPlan29Harness()` → `{origin, upstreamOrigin, tenants, counts, dataRoots, diagnostics, attach, watch, waitIdle, tenantId, cookie, installSession, selectTenant, close}`.
6. `packages/yakka-analytics/tests/plan29/harness.test.mjs` — all 65 lines (session/tenant pattern, skip behaviour, cleanup).
7. `packages/yakka-analytics/tests/charts-time/browser.mjs` — all 53 lines (`loadBrowserEnvironment`, `launchBrowser`, `SKIP_REASON`, Chromium 1243 path).
8. `packages/yakka-analytics/tests/charts-time/gestures.test.mjs` — 110–210 only (real mouse hover, Shift/Ctrl/Alt selection, drag brush, keyboard Arrow, URL/history assertions; no fixed sleeps).
9. `packages/yakka-analytics/tests/charts-time/scatter.test.mjs` — 100–230 only (scatter canvas count, rectangle selection, `inspect()` marks/geometry, table alternative).
10. `packages/yakka-analytics/tests/workspace/acceptance.test.mjs` — 1–120 and its `settleShell`/`settlePanels` helpers; `tests/gallery/harness.mjs` 110–144 (`watchPage`, CSP capture).
11. `packages/yakka-analytics/tests/static-shell.test.mjs` (34 lines) and `tests/release-matrix/record.test.mjs` (43 lines) — what static/release checks assert.
12. `packages/yakka-analytics/web/js/app.js` 538–635 (route settle, `#app`, theme toggle) and `packages/yakka-analytics/web/index.html` (selectors).

## Goal

Commit a real-Go, real-Chromium Phase 3 acceptance suite plus a committed record of the measured geometry and each theme's resolved tokens, so the orchestrator can run one command and cite where the Phase 3 outcome is met: full-width/dense layout at 1920/1366, responsive and 200% reflow, one active-theme family across document/shadow/canvas with no pure-white plot canvas, real interaction survival, and readable empty/unauthorized/error states. Stub-only tests cannot close this phase.

## Contract

Settled by DESIGN lines 199–204 and 102–113. This unit proves the outcome; it does not change product behaviour. The acceptance must use the real Go handlers and the phase1-01 two-tenant fixture (`plan29-a` populated, `plan29-b` empty). `PUBLIC_CANVAS_TEST_MODE=true`; no animation/timing assertions and no fixed sleeps; wait on `html[data-idle=true]`, every `[data-panel][data-idle=true]`, and `yk-chart[data-state=ready]`.

## Changes

Create `packages/yakka-analytics/tests/plan29/phase3-acceptance.test.mjs` with one `node:test` file (skip cleanly with `loadBrowserEnvironment().reason` when Chromium/playwright-core is absent). Use `startPlan29Harness()`, `launchBrowser()`, `harness.attach(context)`, `harness.installSession(context, 'plan29-a')`, `harness.selectTenant(context, 'plan29-a')`, `harness.waitIdle(page)`, and `harness.close()` in `finally`. Test at least these cases, each recording expected/actual and failing with the route and viewport named:

1. **Full-width geometry at 1920×1080 and 1366×900.** Visit `/`, `/b/pulse`, `/b/trends`, `/b/cost`, `/b/quality`, `/b/tools`, `/b/workflow`, `/b/compare`, `/b/scatter`, `/plans`, `/sessions`, `/ledger`, `/ops`, `/artifact`, one session detail (`/sessions/<id>` from `/sessions` rows) and one plan detail (`/plans/<repo>/<plan>` from `/plans` rows). For each: `#app` left/right equal the topbar/footer content edge; `mainWidth === documentElement.clientWidth - 2*gutter` within 1 px (gutter 12); `mainWidth >= 1800` at 1920 and `>= 1270` at 1366 (no 1120/1000 cap); body computed `font-size` 13 px and line-height ≈17.55 px; `documentElement.scrollWidth <= clientWidth + 1`. Record `viewport, clientWidth, mainLeft, mainWidth, gutter, bodyFont, bodyLineHeight, documentScrollWidth`.
2. **Density and local scroll.** On `/ledger`, `/plans`, `/sessions`: first `tbody tr` height in [28, 32] px; first `thead th` computed `position` `sticky`; the table's scroll container computed `overflow-x` is `auto` or `scroll`; a numeric cell is `text-align:right` with `font-variant-numeric:tabular-nums`; `.panel-grid` computed `gap` 8 px; a `.workspace-panel` computed padding 6–8 px, border-width 1 px, radius ≤2 px; an ordinary chart host height 200–260 px.
3. **One theme family + canvas pixels.** On `/b/scatter` with populated session scatter, wait ready. Read from the chart's shadow root the first `.yk-scatter-canvas:not(.yk-scatter-overlay)` and sample `getImageData(2,2,1,1).data`; read `getComputedStyle(host).getPropertyValue('--yk-surface')` / `--yk-chart-surface`, the panel computed background, and the Ledger `thead th` background. In dark: canvas RGBA equals the dark token (`[27,39,52,255]` at the current value) and Ledger header is not `[255,255,255,255]`. In light: canvas equals the resolved off-white token and is not pure white; Ledger header is not pure white. Click `#theme-toggle` light→dark→light; after each click wait for idle/ready and assert the canvas pixel follows the token. Across the toggles assert `inspect().marks.length` is unchanged, a legend-hidden series stays hidden, a selection survives, `location.search` is unchanged and the panel data rows are unchanged.
4. **Real interaction and table alternative.** On `/b/trends` (uPlot) and `/b/scatter` (canvas): real mouse hover over a mark using `inspect()` geometry → tooltip/highlight settles; keyboard `Tab`/`ArrowRight` reaches the chart/legend; click a legend button to hide/show a series and assert the series survives a theme toggle; drag a time brush on the uPlot chart and assert `inspect().brush`; rectangle-select on the scatter and assert a selection; click/keyboard-open a mark → inspector opens with entity facts; the shadow `.yk-table` alternative has rows and a keyboard selection (`Space`/`Enter`) emits the existing select/inspect intent. This proves hover, brush, toggle, drill-through and the table alternative, not just their presence in markup.
5. **Responsive, coarse pointer and 200% reflow.** At 768×900 the `.panel-grid` is one column; at 390×844 the computed gutter is 8 px and `documentElement.scrollWidth <= clientWidth + 1`; tables still scroll locally. With a `hasTouch: true` context, visible buttons have height ≥44 px. Emulate 200% browser zoom by halving the CSS viewport of 1366×900 (683×450): no document horizontal overflow, controls remain operable, tables scroll locally, and the page settles. Record the measured widths.
6. **States in both themes.** Use real reads: tenant `plan29-b` (empty) for an explicit empty state; `/ops` as a non-admin tenant for an explicit unauthorized/permission state; `/sessions/<unknown-id>` (or another confirmed real failing read) for an explicit error/refusal state. In light and dark assert the state text is visible, is not rendered as a zero/“no data” row, and its text/background contrast is ≥4.5:1 using a small luminance helper. Record the state string and colours.
7. **Baseline record.** Write `tests/plan29/phase3-measurements.json` once from the green run (gate behind `YAKKA_PHASE3_RECORD=1` so normal runs do not dirty the tree): `{phase, routes, viewports, geometry:{1920:{clientWidth,mainWidth,gutter,rowHeight,panelGap,plotHeight},1366:{...},768:{...},390:{...}}, tokens:{light:{...resolved values},dark:{...}}, canvas:{light:[...],dark:[...]}, header:{light,dark}}`. The test compares the current run to the committed baseline with a small tolerance for scrollbar/clientWidth and zero tolerance for colour tokens; diff output names the failing key.

### Keep untouched

- No product code, CSS, JS, Go, routes, charts, handlers, requests or repairs.
- No stubs or interception on the acceptance path: every page uses the real Go API and cookie session. Use tenant `plan29-a`/`plan29-b` only; never the default tenant, no reset/delete, no secrets, no deployment.
- No `/tmp`; scratch under `.scratch/phase3/`; close the harness and remove its data root.

## Done evidence

Identify the failing check before the product fixes; report output before and after. Before (phase base `877f8195`), `main` at 1920 is 1120 px, body type is 16 px/1.5, the Ledger sticky header is `rgb(255,255,255)` in dark, and the gallery light canvas is `[255,255,255,255]`. If a disposable base copy is practical, run the new suite against a `git archive 877f8195` copy under `.scratch/phase3/base/` and record the red output; otherwise cite the EVIDENCE lines above and state the limitation in the report. Do not revert the working tree.

Exact command (run from `/home/codyh/workspace/yakka-build/29`):

```
GOTOOLCHAIN=auto PUBLIC_CANVAS_TEST_MODE=true \
NODE_OPTIONS=--max-old-space-size=8192 \
TMPDIR="$PWD/.scratch/phase3/tmp" \
node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/plan29/phase3-acceptance.test.mjs
```

Expected after: all cases pass; the report quotes the geometry/token/canvas numbers and the palette results. Then run the regression set (each must pass):

```
GOTOOLCHAIN=auto PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 \
node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/charts-time/acceptance.test.mjs \
  packages/yakka-analytics/tests/charts-cat/acceptance.test.mjs \
  packages/yakka-analytics/tests/workspace/acceptance.test.mjs \
  packages/yakka-analytics/tests/trends-quality/acceptance.test.mjs \
  packages/yakka-analytics/tests/scatter-sessions/acceptance.test.mjs \
  packages/yakka-analytics/tests/plans-artifacts/acceptance.test.mjs \
  packages/yakka-analytics/tests/static-shell.test.mjs \
  packages/yakka-analytics/tests/release-matrix/record.test.mjs \
  packages/yakka-analytics/tests/plan29/harness.test.mjs
```

Run `packages/yakka-analytics/tests/release-matrix/matrix.test.mjs` only if time permits; the phase proof is the real-Go acceptance above plus the static/release record check. No write outside the worktree.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the exact command and counts, the measured geometry/token/canvas table, the before/after red/green output, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
