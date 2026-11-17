# Brief: 8-05 — Treemap and gallery acceptance

Consumer: the Phase 8 chart-kit worker; this unit closes the phase outcome.
Owned paths: `packages/yakka-analytics/web/js/charts/yk-treemap.js`, `packages/yakka-analytics/tests/gallery/{treemap.html,treemap.js,fixture-treemap.js,index.html,index.js}`, `packages/yakka-analytics/tests/charts-cat/{treemap.test.mjs,acceptance.test.mjs}`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/8-05-treemap-acceptance.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 8-01, 8-02, 8-03, 8-04.
Runs alongside: nothing; it owns the gallery index and the phase proof over the other four units.
Budget: 16 files to read, about 1,000 lines to change, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.5 — "Elements" for `<yk-treemap>`, "Colour registry", "Rules from the dataviz discipline", "Testability surface"; all of it is the acceptance yardstick.
2. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 8 outcome line; Interaction model Gestures table, Linking, Accessibility and responsiveness baseline; Chart kit; the `treemap` catalog entry (composition of a measure over two lenses, repo then model).
3. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.7 — Chromium only, `playwright-core` test-only, Node's runner, no fixed sleeps, wait on `html[data-idle]`/end-state, console/CSP failure, at most four in-flight requests.
4. `packages/yakka-analytics/web/js/charts/svg-base.js`, `yk-bars.js`, `yk-ranges.js`, `yk-matrix.js`, `yk-lanes.js` — the shared base and the four completed elements. Import them; do not edit them.
5. `packages/yakka-analytics/web/js/charts/{colour-registry,formatters,tooltip,legend,badges,table,selection}.js` — exports only; `paletteReport`, `fixedNeutralDistinctness`, `THRESHOLDS` are the committed palette proof.
6. `packages/yakka-analytics/tests/gallery/{harness.mjs,fixture.js,index.html,index.js,time-series.js}` and `packages/yakka-analytics/tests/charts-time/acceptance.test.mjs` — the index, theme-switch and acceptance patterns.
7. The four Phase 8 pages/fixtures/specs from 8-01 to 8-04 — read them to drive the same pages; do not edit them.

Read ranges and grep; do not read a whole file to find one section.

## Goal

Deliver `<yk-treemap>` for a two-lens composition and make the gallery index link all five Phase 8 pages, with one acceptance spec that proves the phase outcome across every element and mode: fixture values, inspect/selection/legend, an accessible keyboard-operable table, stable entity colours and styles across engines and filters, distinct fixed neutrals, both-theme palette, and keyboard/touch reaching every action without hover.

## Contract

- CONTRACTS.md 17.5 "Elements": `<yk-treemap>` takes a `spec` (series, units, formatters, entity keys) and `data`, emits `select`, `inspect` and `brush`, exposes `inspect()`, and composes a measure over two lenses. This element has no continuous time axis, so it reports `brush: null` and emits no brush.
- CONTRACTS.md 17.5 "Colour registry": top-level groups are entities and take fixed slots; a `(other)` bucket is labelled and distinct; a toggle never repaints a surviving group. "Fixed neutrals" keep six distinct styles.
- CONTRACTS.md 17.5 "Rules from the dataviz discipline": a legend at two or more groups, units in the frame, no chart without a table, and no mark the interaction model cannot act on.
- CONTRACTS.md 17.5 "Testability surface" and 17.7: `data-chart`/`data-state`, `inspect()` with plot, series, marks, `xToPx`/`yToPx`; real Chromium mouse/keyboard/touch at `inspect()` coordinates; no fixed sleeps; no animation; no `/tmp`; nothing branches on being under test.
- DESIGN.md Phase 8 outcome is the acceptance checklist, quoted in the done evidence below. The palette thresholds and the no-animation rule are settled; do not change `charts.css` tokens or `colour-registry.js` values.
- Settled: SVG with the shared tooltip, legend and registry; one runtime dependency; no new route, grain, join, measure, panel or gesture.

## Changes

- `yk-treemap.js`: `<yk-treemap>` with `spec.chart = 'treemap'`, data rows `{ key, parent?, label, value, values?, n?, coverage? }` and spec `{ chart, type: 'treemap', title, units, x: { label, kind: 'text' }, series: [{ key, label, unit, kind }], parents?: [{ key, label }], coverage?, sample?, resolution?, empty?, unsupported? }`. Lay out two-level rectangles (parent groups, child cells) with a squarified algorithm, area proportional to the measure, labels for every rectangle that fits and a labelled `(other)` bucket for the tail; colour by parent entity key through the registry; legend of parent groups when there are two or more, toggling a group without repainting survivors. Every rectangle carries `data-entity-key` and the 8-01 mark shape; the table lists parent, child, value and unit.
- `treemap.html`/`treemap.js`/`fixture-treemap.js`: deterministic test-only data with two lenses (repo then model), at least `model:atlas`, `model:beacon`, `repo:core`, `repo:docs` and a `(other)` tail; external modules only; settle every element, then set `data-idle`.
- `tests/gallery/index.html` and `index.js`: link the Phase 8 pages (`bars`, `ranges`, `matrix`, `lanes`, `treemap`) with stable `data-case` names, show the theme and case outputs like the Phase 7 index, and keep the Phase 7 links intact. Add no charts to the index; it settles at once.
- `tests/charts-cat/treemap.test.mjs`: pure checks for area proportion, parent/child containment, `(other)` and the layout's non-overlap, plus a Chromium spec for inspect/selection/legend/table and real keyboard/touch.
- `tests/charts-cat/acceptance.test.mjs`: one spec that opens every Phase 8 page and proves the phase outcome, reusing the 8-01 to 8-04 fixtures for expected values. It must check:
  - the index links all five Phase 8 cases;
  - per page and mode, table and `inspect()` values match the fixture, and `data-state`, `data-chart`, plot and `xToPx`/`yToPx` are present;
  - inspect on a real mark, selection by Space/checkbox/Shift-click, exclusion by Alt-click/`x`, and a legend toggle/focus on the pages that have two or more series or groups;
  - an accessible table is keyboard operable (ArrowUp/Down, Space, Enter) and shows plotted values;
  - the same entity key has the same `cssVar`/`shape`/`pattern` in at least two engines (for example bars and treemap) and in the lanes/matrix pages where it appears, and a legend toggle leaves a surviving entity's style unchanged;
  - `(mixed)`, `(none)`, `(multi)`, `unknown`, `unscored` and `(other)` are six distinct `cssVar`/`shape`/`pattern`/label combinations;
  - `paletteReport()` has no failures in both themes and `fixedNeutralDistinctness()` is true; switching `document.documentElement.dataset.theme` re-reads tokens and keeps the same entity slot;
  - keyboard and touch reach every applicable action on every element without needing a hover first; targets are at least 44 px; no animation or transition;
  - no `console.error`, page error or CSP violation, and at most four analytics requests in flight.

### Keep untouched

Do not edit `svg-base.js`, `yk-bars.js`, `yk-ranges.js`, `yk-matrix.js`, `yk-lanes.js`, `yk-chart.js`, `colour-registry.js`, `charts.css` or any Phase 7 module; if an element or the shared base cannot satisfy the acceptance checklist, report the contradiction rather than weakening a check or editing another unit's files. Do not edit another unit's page, fixture or spec, the harness, the vendored uPlot files, Go code, or the stale `tests/e2e*`, `tests/hosted` and `tests/identity` trees. Add no dependency, route, panel, grain, join, gesture or sample data to the product; no `/tmp`; no animation or fixed sleep.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-cat/treemap.test.mjs` → passes, or skips with the exact named browser reason.
- Treemap → areas are proportional to the fixture measure within the committed tolerance, parent/child rectangles do not overlap, every visible rectangle is labelled, `(other)` is distinct, and table/inspect values match.
- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-cat/acceptance.test.mjs` → passes, or skips with the exact named browser reason, and proves each checklist item in the Changes section.
- Gallery index → five Phase 8 case links plus the four Phase 7 links, with theme and case outputs.
- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-cat/*.test.mjs` → every Phase 8 spec passes.
- `node --test packages/yakka-analytics/tests/*.test.mjs` → the existing suite still passes.
- `git diff --check` is clean; no `/tmp`; no fixed sleep; no animation; no inline `style=` attributes; no test branch in product code.

If `playwright-core` or Chromium is unavailable, report `gate: browser acceptance needs playwright-core under NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules and the Chromium 1243 cache`; never install it.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, the acceptance checklist result item by item, any contradiction between an element and the contracts, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
