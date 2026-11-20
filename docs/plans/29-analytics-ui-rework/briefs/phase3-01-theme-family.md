# Brief: phase3-01 — One inherited active-theme token family across document, shadow roots and canvas

Consumer: Phase 3 build worker.
Owned paths: `packages/yakka-analytics/web/css/charts.css`, `packages/yakka-analytics/web/js/charts/styles.js`, `packages/yakka-analytics/web/js/charts/yk-chart.js`, `packages/yakka-analytics/web/js/charts/canvas-scatter.js`, `packages/yakka-analytics/web/js/charts/scatter.js`, `packages/yakka-analytics/web/js/charts/svg-base.js`, `packages/yakka-analytics/web/js/charts/legend.js`, `packages/yakka-analytics/web/js/charts/tooltip.js`, `packages/yakka-analytics/web/js/charts/table.js`, `packages/yakka-analytics/web/js/theme-bootstrap.js`. Touch nothing else. `index.html` belongs to `phase3-02`; it will link `/css/charts.css` so the `:root` family reaches the document.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase3-01-theme-family.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing. `phase3-02` and `phase3-03` consume the token names below; do not rename them without recording a contradiction.
Runs alongside: `phase3-02`, `phase3-03` (disjoint paths), then `phase3-04`.
Budget: 14 files to read, about 350 lines to change, 35 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md` — Domain "Dense workspace and theme", lines 102–113; phase outcome lines 199–204. The theme sentence is binding: "One active-theme token family supplies the document, chart hosts and shadow roots. Panels, plots, table headers/alternation, controls, legends, tooltips, selections, axes and grids all derive from it. Plots inherit the panel surface; canvas fills use its resolved token. Remove white/light-only fallback surfaces from the data presentation path. Dark uses the dark panel surface; light uses an off-white surface, with no pure-white plot canvas. Theme changes repaint existing SVG, uPlot and canvas charts without losing selection, hidden series, URL state or data."
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md` — D16 (line 46) and "Theme and density proof" (lines 87–91). D16 records Ledger sticky headers and Cost controls at `rgb(255,255,255)` on a `#1b2734` app surface because chart tokens live only in shadow roots; the gallery already redraws engines dark→light→dark and scatter canvas `(2,2)` was `[27,39,52,255]` dark and `[255,255,255,255]` light.
3. `docs/design/09-analytics-workspace-contracts.md` — lines 12–13 and chart-element bullet at line 139.
4. `packages/yakka-analytics/web/css/charts.css` — the token blocks `:root,:host` (7–63) and `html[data-theme='dark'],:host-context(...)` (65–121); the component rules that consume surfaces (`.yk-chart` 137–144, legend 169–228, tooltip 277–347, badges 335–347, tables 349–395, hit targets 423–432).
5. `packages/yakka-analytics/web/js/charts/styles.js` — all 53 lines. `loadChartStyles` adopts `charts.css` + uPlot CSS into each shadow root; `readToken` reads computed values from the host; `watchTheme` observes `data-theme`.
6. `packages/yakka-analytics/web/js/charts/yk-chart.js` — host styles 34–51, theme watch 120–125, scatter tokens 456–466, canvas creation 468–486, uPlot axis/colour reads 300–370.
7. `packages/yakka-analytics/web/js/charts/canvas-scatter.js` — 96–160 (canvas sizing, `ctxFor`, `drawAxes`, `drawBase` fill).
8. `packages/yakka-analytics/web/js/theme-bootstrap.js` — all 12 lines.
9. Grep, do not read whole files: `grep -n "surface\|#fff\|#ffffff\|readToken" packages/yakka-analytics/web/js/charts/*.js`.

## Goal

Make the chart kit own one inherited active-theme token family that is identical in the document, chart hosts and shadow roots, with an off-white light surface and no pure-white plot canvas, and prove a theme change repaints existing SVG/uPlot/canvas charts without losing selection, hidden series, URL state or data.

## Contract

Settled by DESIGN lines 111–112 and 201 and `docs/design/09` line 13. Cite these; do not widen into shell geometry, panel density, routes or chart data semantics. The chart family is consumed by `phase3-02` (app shell) and `phase3-03` (panels/tables), so define the canonical names here and keep them stable:

- `--yk-bg` — the page background behind panels and tables. Light is an off-white/grey distinct from the panel surface; dark is `#111923` (or the existing dark page value).
- `--yk-surface` — the panel/plot/table surface. Light is off-white, not `#fff`; dark is `#1b2734` (or the existing dark panel value).
- `--yk-surface-alt` — alternate table row surface.
- `--yk-text`, `--yk-muted`, `--yk-border`, `--yk-grid`, `--yk-focus`, `--yk-danger`, `--yk-warning`, `--yk-warning-bg`, `--yk-error-bg`, `--yk-selected`, `--yk-excluded`.
- Existing `--yk-chart-surface`, `--yk-chart-text`, `--yk-chart-muted`, `--yk-chart-border`, `--yk-chart-grid`, `--yk-chart-focus` stay valid and resolve to the same values (`--yk-chart-surface` may be `var(--yk-surface)`); `--yk-tooltip-*`, `--yk-legend-surface`, `--yk-badge-*`, categorical/status/sequential/diverging tokens keep their current meaning.
- The gallery (`packages/yakka-analytics/tests/gallery/*.html`) links `charts.css` directly and must keep working; that is why the family stays in `charts.css` and is not moved into `app.css`.

## Changes

1. **One family in `charts.css`.** Rewrite the light `:root,:host` token block to define the canonical names above. Light `--yk-bg` and `--yk-surface` are off-white (for example `#eef1f4` and `#f4f6f8`; do not use `#fff`/`#ffffff` for the surface). Keep `:host` so shadow roots get the values without relying on document inheritance; keep the existing dark selector pair `html[data-theme='dark'], :host-context(html[data-theme='dark'])` and set the same canonical names. `--yk-chart-surface` must equal `--yk-surface` in both themes. Keep `color-scheme` correct.
2. **Remove white data surfaces from chart chrome.** In `charts.css`, `.yk-chart`, `.yk-legend`, `.yk-legend button`, `.yk-table`, `.yk-table-wrap`, `.yk-table thead th`, `.yk-hit-target` and the table row/selection rules use the canonical tokens with no white literal fallback. Tooltip surfaces may stay intentionally dark (`--yk-tooltip-surface`), but they must follow the active family. Do not leave a `var(--token, #ffffff)` fallback on the data presentation path.
3. **Canvas fill is the resolved token.** `canvas-scatter.js` already fills `tokens.surface`. In `yk-chart.js` pass the resolved `--yk-surface` (or `--yk-chart-surface`) into `tokens.surface`; ensure the light value is the off-white token and the dark value is the dark panel token. If a literal fallback remains, use `transparent`/`currentColor`, never white.
4. **Typography floor.** Chart tick/label/table text must be at least 12 CSS px. With the shell moving to a 13 px root, `0.72rem` is below the floor: set explicit `12px`/`0.92rem` for `.yk-cat-label`, `.yk-cat-tick`, `.yk-cat-value`, table cells and tooltip rows, and keep `font-variant-numeric: tabular-nums` on values. Do not add animations or transitions.
5. **Repaint without state loss.** Keep `watchTheme` driving `#schedule`/`#render`; verify that a `data-theme` change rebuilds the uPlot/SVG/canvas using the new tokens while `#hidden`, `#selection`, `#brush`, `#history`/URL state and `#data` survive. Do not reset hidden series, selection or history in the theme path.
6. **Stable element contract.** `inspect()` keys, `yk-table` structure/classes, legend keys, tooltip classes and selection events are consumed by tests and panels. Keep them.

### Keep untouched

- Chart data semantics, transforms, scales, gesture engine, selection model, colour-registry slot assignment and `inspect()` output shape.
- Vendored uPlot version and `STYLE_SOURCES` contract (still `charts.css` + uPlot CSS).
- `index.html`, `app.css`, `workspace.css` and every per-panel CSS file (owned by `phase3-02`/`phase3-03`).
- Routes, board presets, URL semantics, saved boards, Go handlers. No new visualization or library.

## Done evidence

Identify the failing check before changing code; report output before and after. The before value is expected to show the light surface `#ffffff`/`rgb(255,255,255)`.

- `grep -nE "#fff|#ffffff" packages/yakka-analytics/web/css/charts.css packages/yakka-analytics/web/js/charts/*.js` → no white literal remains on a data presentation surface; list any intentional non-data literal explicitly.
- A one-off Chromium sampler under the ignored `.scratch/phase3-01/` (not `/tmp`) using `packages/yakka-analytics/tests/gallery/harness.mjs` + `loadBrowserEnvironment()`: open `/gallery/scatter.html`, wait for `data-idle`, sample the first `.yk-scatter-canvas:not(.yk-scatter-overlay)` pixel `(2,2)` and the host `getComputedStyle(host).getPropertyValue('--yk-chart-surface')` in light and dark. Expected after: dark RGBA equals the dark token (`[27,39,52,255]`), light RGBA equals the off-white token and is not `[255,255,255,255]`. Record the exact RGBA and token strings in the report.
- Toggle `document.documentElement.dataset.theme` light→dark→light on the same page; after each toggle wait for the chart `data-state="ready"`, then assert the canvas pixel matches the new token, `inspect().marks.length` is unchanged, a hidden series stays hidden and a selection survives. Report before/after.
- `node --test --test-concurrency=1 packages/yakka-analytics/tests/charts-time/acceptance.test.mjs packages/yakka-analytics/tests/charts-cat/acceptance.test.mjs` → pass (gallery palette/theme replay).
- `node --test --test-concurrency=1 packages/yakka-analytics/tests/charts-time/scatter.test.mjs` → pass (canvas fallback contract).

Commands run from the worktree with `GOTOOLCHAIN=auto PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192`. Large scratch stays under `.scratch/phase3-01/`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
