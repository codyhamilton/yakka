# Phase 3 unit 01 — inherited active-theme token family

Status: done.

## What was built

One canonical active-theme token family now lives in `packages/yakka-analytics/web/css/charts.css` on `:root` and `:host`, with matching values in `html[data-theme='dark'], :host-context(html[data-theme='dark'])`. Document, chart hosts and shadow roots resolve the same values because the light block carries `:host` and the dark block carries `:host-context`.

Canonical names defined in both themes: `--yk-bg`, `--yk-surface`, `--yk-surface-alt`, `--yk-text`, `--yk-muted`, `--yk-border`, `--yk-grid`, `--yk-focus`, `--yk-danger`, `--yk-warning`, `--yk-warning-bg`, `--yk-error-bg`, `--yk-selected`, `--yk-excluded`.

The existing chart names stay valid as aliases: `--yk-chart-surface`, `--yk-chart-text`, `--yk-chart-muted`, `--yk-chart-border`, `--yk-chart-grid`, `--yk-chart-focus` are `var(--yk-<same semantic>)` in both themes, so `--yk-chart-surface === --yk-surface` everywhere. `--yk-legend-surface` aliases the surface. Tooltip, badge and categorical/neutral/cohort/status/sequential/diverging tokens keep their existing values and meaning.

Light is off-white: `--yk-bg: #eef1f4`, `--yk-surface: #f4f6f8`, `--yk-surface-alt: #e9edf1` (no pure-white data surface). Dark keeps `--yk-bg: #111923`, `--yk-surface: #1b2734`, `--yk-surface-alt: #223141`.

Chart chrome now consumes the canonical family with no white literal fallback: `.yk-chart`, `.yk-legend`, `.yk-legend button`, `.yk-table`, `.yk-table-wrap`, `.yk-table thead th`, `.yk-hit-target`, `.yk-cat-*`, mark focus/selection rules, plus new canonical alternate-row (`--yk-surface-alt`), selected-row (`--yk-selected`) and excluded-row (`--yk-excluded`) rules.

Typography floor: `.yk-cat-label`, `.yk-cat-tick`, `.yk-cat-value`, `.yk-table` cells/caption and tooltips are explicit `12px`; tabular numerals are retained on values. The canvas scatter tick font was raised from `11px` to `12px` to keep canvas ticks on the same floor. No animations or transitions were added.

Canvas path: `yk-chart.js` reads `--yk-surface` (falling back to `--yk-chart-surface`) into `tokens.surface`; `canvas-scatter.js` fills with that resolved token and falls back to `transparent`, never white. `watchTheme` remains the repaint trigger and neither theme path resets `#hidden`, `#selection`, `#brush`, history/URL state or `#data`.

## Files changed (owned paths only)

- `packages/yakka-analytics/web/css/charts.css`
- `packages/yakka-analytics/web/js/charts/yk-chart.js`
- `packages/yakka-analytics/web/js/charts/canvas-scatter.js`

`styles.js`, `scatter.js`, `svg-base.js`, `legend.js`, `tooltip.js`, `table.js` and `theme-bootstrap.js` needed no edits; their contracts were already compatible and were left untouched.

## Evidence

### White-literal grep

Before (HEAD copy under `.scratch/phase3-01/before/`):

```
charts.css:10:  --yk-chart-surface: #ffffff;
charts.css:18:  --yk-legend-surface: #ffffff;
charts/canvas-scatter.js:154:    ctx.fillStyle = tokens.surface || '#ffffff';
charts/colour-registry.js:9:  light: '#ffffff',
```

After:

```
charts/colour-registry.js:9:  light: '#ffffff',
```

The one remaining literal is intentional and not a data presentation surface: `colour-registry.js` uses `SURFACE.light` as the contrast baseline for the committed palette report. That file is not in this unit's owned paths. No white literal remains in `charts.css` or any chart rendering path.

### Chromium sampler

Script: ignored `.scratch/phase3-01/sample-theme.mjs`, using `tests/gallery/harness.mjs` and `tests/charts-time/browser.mjs` (`loadBrowserEnvironment()`). It opens `/gallery/scatter.html`, waits for `data-idle`, samples the first `.yk-scatter-canvas:not(.yk-scatter-overlay)` at device pixel `(2,2)`, reads host and document tokens, then toggles `documentElement.dataset.theme` light→dark→light. It waits for `data-state="ready"` and a canvas pixel matching the resolved token before reading again.

Command:

```
GOTOOLCHAIN=auto PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 \
  node .scratch/phase3-01/sample-theme.mjs
```

Before (HEAD copy): light pixel `[255,255,255,255]`, host/document `--yk-surface` `#ffffff`, `--yk-chart-surface` `#ffffff`, `--yk-bg` empty; dark pixel `[27,39,52,255]`, tokens `#1b2734`; back-to-light `[255,255,255,255]`. The script failed on "light plot canvas is off-white, not pure white", which is the expected failing check.

After: light pixel `[244,246,248,255]`, host and document `--yk-surface` `#f4f6f8`, `--yk-chart-surface` `#f4f6f8`, `--yk-bg` `#eef1f4`; dark pixel `[27,39,52,255]`, tokens `#1b2734`, `--yk-bg` `#111923`; back-to-light `[244,246,248,255]`.

State survived both toggles: `inspect().marks.length` stayed `5000`, selection keys stayed `["point:00000"]`, hidden series `cohort:alpha` stayed `visible: false`, final theme `light`. `watchPage.assertClean()` passed (no console/page/CSP errors).

### Required tests

Before (HEAD copy):

```
GOTOOLCHAIN=auto PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 \
  node --test --test-concurrency=1 \
  <copy>/tests/charts-time/acceptance.test.mjs \
  <copy>/tests/charts-cat/acceptance.test.mjs \
  <copy>/tests/charts-time/scatter.test.mjs
```

Result: exit 0, `tests 18`, `pass 18`, `fail 0`, `skipped 0`.

After (worktree):

```
GOTOOLCHAIN=auto PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 \
  node --test --test-concurrency=1 \
  packages/yakka-analytics/tests/charts-time/acceptance.test.mjs \
  packages/yakka-analytics/tests/charts-cat/acceptance.test.mjs \
  packages/yakka-analytics/tests/charts-time/scatter.test.mjs
```

Result: exit 0, `tests 18`, `pass 18`, `fail 0`, `skipped 0`.

## Deviations from the brief

- No commit was made. The brief says commit to the branch, but the orchestrator for this run explicitly said not to commit and to leave the change and report in the working tree for the orchestrator to commit. The report is written but uncommitted.
- Added canonical alternate-row, selected-row and excluded-row table rules in `charts.css` (`--yk-surface-alt`, `--yk-selected`, `--yk-excluded`). The brief asks for table row/selection rules to use canonical tokens and the design names table alternation, so the names are exercised rather than defined but unused.
- Raised the canvas scatter tick font from `11px` to `12px`. The brief lists the CSS typography selectors, but its rule is "chart tick/label/table text must be at least 12 CSS px", which the canvas tick also has to satisfy.

## Unfinished / deferred

None in this unit's scope. Shell geometry, per-panel CSS, index link to `charts.css`, tables in panels and routes remain with `phase3-02`/`phase3-03`/`phase3-04`.

## Known problems

- `packages/yakka-analytics/web/css/app.css`, `trends.css`, `ledger.css` and `scatter.css` still contain their own white fallbacks or separate surface variables; those are other units' owned paths and were not touched.
- `colour-registry.js` keeps `SURFACE.light = '#ffffff'` as a test contrast baseline. The palette report still passes with that conservative baseline; it is not rendered.

## Gates

- `grep -nE "#fff|#ffffff"` on `charts.css` + `charts/*.js`: only the intentional non-data contrast baseline in `colour-registry.js`.
- Light plot canvas pixel `[244,246,248,255]`, off-white and not `[255,255,255,255]`; dark `[27,39,52,255]`, equal to `#1b2734`.
- Host and document resolve the same `--yk-surface` / `--yk-chart-surface` in both themes, including shadow-root canvas fills.
- Theme light→dark→light preserves marks, selection and hidden series.
- `charts-time/acceptance`, `charts-cat/acceptance`, `charts-time/scatter`: 18/18 pass before and after.
