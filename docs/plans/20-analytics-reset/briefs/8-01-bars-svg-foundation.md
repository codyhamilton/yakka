# Brief: 8-01 — Bars and the shared SVG categorical element foundation

Consumer: the Phase 8 chart-kit worker; 8-02 to 8-05 import the shared element contract and the gallery/test seams this unit establishes.
Owned paths: `packages/yakka-analytics/web/js/charts/{svg-base,yk-bars}.js`, `packages/yakka-analytics/web/js/charts/formatters.js` (the `text` kind seam only), `packages/yakka-analytics/web/css/charts.css` (the categorical/chart-kit additions only), `packages/yakka-analytics/tests/gallery/{bars.html,bars.js,fixture-bars.js}`, `packages/yakka-analytics/tests/charts-cat/{browser.mjs,bars.test.mjs}`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/8-01-bars-svg-foundation.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: Phase 7.
Runs alongside: nothing; it establishes the shared element, CSS and test seams the other four units compose.
Budget: 14 files to read, about 950 lines to change, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.5 — "Elements" for `<yk-bars>` (ranked, stacked, 100 percent, lollipop, slope; takes a `spec` of series, units, formatters and entity keys and `data`; emits `select`, `inspect` and `brush`; exposes `inspect()`), "Colour registry", "Rules from the dataviz discipline" and "Testability surface". These are binding; quote them, do not rewrite them.
2. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 8 outcome; Interaction model Gestures table (hover/focus, click, modifiers, keyboard, touch), Linking, Accessibility and responsiveness baseline; Chart kit; "Scope vocabulary for `refine` and `execute`".
3. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.7 — Chromium only via `playwright-core`, Node's runner, no fixed sleeps, wait on `html[data-idle]`/`data-state`, console/CSP failure, at most four requests in flight.
4. `packages/yakka-analytics/web/js/charts/{colour-registry,formatters,tooltip,legend,badges,table,styles,selection}.js` — exports only; reuse them, do not rewrite them.
5. `packages/yakka-analytics/web/js/charts/yk-chart.js` — read its `spec`/`data` setters, `whenSettled()`, `inspect()` shape and its `select`/`inspect`/`brush` events as the element contract to mirror. Do not edit it.
6. `packages/yakka-analytics/tests/gallery/{harness.mjs,fixture.js,time-series.html,time-series.js}` and `packages/yakka-analytics/tests/charts-time/{browser.mjs,time-series.test.mjs}` — the harness, loader, fixture and settled-state spec patterns.
7. `packages/yakka-analytics/web/css/charts.css` — the existing tokens, frame, legend, tooltip, table, focus, 900 px and reduced-motion rules.

Read ranges and grep; do not read a whole file to find one section.

## Goal

Provide one shared SVG element foundation for the five Phase 8 elements and deliver `<yk-bars>` in ranked, stacked, 100 percent, lollipop and slope modes, proven in the same deterministic gallery the phase uses.

## Contract

- CONTRACTS.md 17.5 "Elements": `<yk-bars>` covers ranked, stacked, 100 percent, lollipop and slope; it takes a `spec` (series, units, formatters, entity keys) and `data`, emits `select`, `inspect` and `brush` events, and exposes `inspect()` for tests.
- CONTRACTS.md 17.5 "Testability surface" is the shape to mirror: every chart carries `data-chart` and `data-state`, `inspect()` returns window, selection, bucket, series visibility, plot rectangle, `xToPx`/`yToPx`, cursor and marks, and the tooltip carries the key under the cursor. Nothing branches on being under test.
- CONTRACTS.md 17.5 "Colour registry": entities take slots keyed `namespace:name`; eight hues then labelled/patterned neutrals; `(mixed)`, `(none)`, `(multi)`, `unknown`, `unscored` and `(other)` keep fixed distinct styles; a filter or toggle never repaints a surviving series.
- CONTRACTS.md 17.5 "Rules from the dataviz discipline": no dual axes, a legend at two or more series, units and time basis in the frame, zero-based bars, no chart without a table, no mark the interaction model cannot act on.
- DESIGN.md Interaction model: hover/focus highlights the same entity key; click/Enter inspects; Shift/Ctrl/Cmd-click or the row checkbox toggles selection; Alt-click or `x` excludes; legend click toggles, focus filters, Ctrl-click isolates; keyboard arrows, Enter, Space, `o`, `f`, `x`, `c` then `a`–`d`, Esc; touch tap inspects with targets at least 44 px. A chart with no continuous time axis emits no `brush`.
- CONTRACTS.md 17.7: real Chromium events at `inspect()` coordinates; no sleeps; no animation; no `/tmp`; tests are not shipped.
- Settled: SVG with the shared tooltip, legend and registry; one runtime dependency; no new route, grain, join, measure, panel or gesture; no palette change.

## Changes

- `svg-base.js`: one shared base custom element that composes `adoptChartStyles`, `ColourRegistry`, `createTooltip`/`tooltipModel`, `createLegend`, `createBadges`/`badgeModel`, `createTable` and `selection.js`. It owns the common lifecycle (`spec`/`data` setters, `whenSettled()`, `connectedCallback`/`disconnectedCallback`), `data-chart`/`data-state` (`loading`, `ready`, `empty`, `unsupported`, `error`), the `ready` shell (title, basis, badges, legend when two or more series, plot host, table), `inspect()`, and the `select`, `inspect` and optional `brush` event wiring. Subclasses supply the geometry and the mark/table model. `inspect().marks` entries expose `key`, `index`, `x`, `y`, `values`, `px`, `py` and `style` (`cssVar`, `shape`, `pattern`) so 8-05 can compare engines. Brush wiring exists but is only reported when a subclass declares a continuous time axis (8-03 calendar, 8-04 lanes); this element reports `brush: null`.
- `yk-bars.js`: `<yk-bars>` with `spec.chart = 'bars'` and `spec.type` `ranked`, `stacked`, `percent`, `lollipop` or `slope`. Data rows are `{ key, label?, values: { <seriesKey>: number }, n?, coverage? }`; the spec is `{ chart, type, title, units, x: { label, kind: 'text' }, series: [{ key, label, unit, kind }], top?, sort?, timeBasis?, coverage?, sample?, resolution?, empty?, unsupported? }`. Ranked sorts by the measure and puts the tail beyond `top` in a labelled `(other)` bucket; stacked and percent are zero-based; percent normalises each category to 1 and formats with the percent kind; lollipop draws a zero-based stem and dot; slope joins one start and one end mark per entity, ordered by change, with both values in inspect/tooltip/table. Every mark carries `data-entity-key`; keys resolve through the registry, including the six fixed neutrals.
- `formatters.js`: the one Phase 7 helper edit. Add `kind: 'text'` to `formatValue` so a categorical axis label returns verbatim and a missing label returns `NULL_TEXT`. Existing kinds and money/null rules are unchanged. Name this seam in the report.
- `web/css/charts.css`: add one categorical section for the plot, axis, label, mark-focus and shared lane/matrix/treemap-agnostic chrome. Both theme token blocks already exist; add no tokens, no transitions and no animations. Element-specific geometry styles belong in the element module's own constructable stylesheet, not this file.
- `tests/gallery/bars.html`, `bars.js`, `fixture-bars.js`: external modules only; deterministic data for every bar mode, including at least `model:atlas`, `harness:orca`, `repo:core`, `kind:test` and all six fixed neutral keys; settle every element, then set `data-idle`. Product code must not import the fixture.
- `tests/charts-cat/browser.mjs`: re-export the established Chromium loader (`../charts-time/browser.mjs`) so every Phase 8 spec shares the same launch path and named skip reason. Do not duplicate the loader or add a dependency.
- `tests/charts-cat/bars.test.mjs`: pure model checks for sort and `(other)`, stacking, 100 percent normalisation, lollipop geometry and slope pairing, plus a Chromium spec driving real mouse, keyboard and touch at `inspect()` coordinates.

### Keep untouched

Do not edit `yk-chart.js` or any Phase 7 element or module except the named `formatters.js` seam, and do not change existing formatter output. Do not edit `tests/gallery/index.html`/`index.js` (8-05 owns the index), another unit's page, fixture or spec, `tests/gallery/harness.mjs`, the vendored uPlot files, Go code, or the stale `tests/e2e*`, `tests/hosted` and `tests/identity` trees. Add no dependency, `package.json`, build step, route, panel, grain, join or gesture; no sample data in the product; no `/tmp`; no animation or fixed sleep.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-cat/bars.test.mjs` → passes, or skips with the exact named browser reason.
- Each mode (`ranked`, `stacked`, `percent`, `lollipop`, `slope`) → table and `inspect()` values match `fixture-bars.js`, including the `(other)` bucket and 100 percent shares; `inspect()` exposes `data-chart`, `data-state='ready'`, plot, series and `marks` with `key`/`x`/`values`/`px`/`py`/`style`.
- Real interaction → hover and focus highlight the same key; click and Enter emit `inspect`; Space, the row checkbox and Shift/Ctrl/Cmd-click toggle include; Alt-click and `x` exclude; legend toggle hides a series without a request and leaves a surviving series' `cssVar`/`shape`/`pattern` unchanged; `o`, `f`, `c` then `a`–`d` and Esc emit the contract intents; a real touch tap inspects a mark at a target of at least 44 px.
- Table → keyboard operable (ArrowUp/ArrowDown, Space, Enter) and shows unit-labelled plotted values.
- Fixed neutrals → `(mixed)`, `(none)`, `(multi)`, `unknown`, `unscored` and `(other)` render six distinct `cssVar`/`shape`/`pattern`/label combinations, and none is merged into `(other)`.
- Both themes → the same entity keeps its slot and pattern; no animation; no `console.error`, page error or CSP violation; at most four analytics requests in flight.
- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-cat/*.test.mjs` and `node --test packages/yakka-analytics/tests/*.test.mjs` → the accumulated Phase 8 and existing suites still pass.

If `playwright-core` or Chromium is unavailable, report `gate: browser acceptance needs playwright-core under NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules and the Chromium 1243 cache`; never install it and never add it to a committed dependency file.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, the shared `svg-base.js` public surface the later units must use, the exact `formatters.js` seam added, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
