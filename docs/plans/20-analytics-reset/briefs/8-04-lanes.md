# Brief: 8-04 — Timeline and gantt lanes

Consumer: the Phase 8 chart-kit worker; 8-05 proves the combined gallery.
Owned paths: `packages/yakka-analytics/web/js/charts/yk-lanes.js`, `packages/yakka-analytics/tests/gallery/{lanes.html,lanes.js,fixture-lanes.js}`, `packages/yakka-analytics/tests/charts-cat/lanes.test.mjs`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/8-04-lanes.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 8-01.
Runs alongside: 8-02 and 8-03; each owns a disjoint element, gallery page, fixture and spec.
Budget: 10 files to read, about 750 lines to change, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.5 — "Elements" for `<yk-lanes>` (timeline and gantt lanes, with markers; same `spec`/`data`, events and `inspect()`), "Colour registry", "Rules from the dataviz discipline", "Testability surface".
2. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 8 outcome; Interaction model Gestures table (drag on a time axis, markers, keyboard `[` `]`, touch Select mode), Linking, Accessibility and responsiveness baseline; Chart kit; the `plan-timeline` and `session-lanes` catalog entries.
3. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.7 — the Chromium, settled-state, no-sleep, console/CSP and in-flight rules.
4. `packages/yakka-analytics/web/js/charts/svg-base.js` and `yk-bars.js` from 8-01 — the shared element lifecycle, optional brush wiring, `inspect()` shape and mark model. Import the base; do not edit it.
5. `packages/yakka-analytics/web/js/charts/{colour-registry,formatters,tooltip,legend,badges,table,selection}.js` — exports only.
6. `packages/yakka-analytics/tests/gallery/{harness.mjs,fixture.js,bars.html,bars.js}` and `packages/yakka-analytics/tests/charts-cat/{browser.mjs,bars.test.mjs}` — the settled-page and spec patterns.

Read ranges and grep; do not read a whole file to find one section.

## Goal

Deliver `<yk-lanes>` for timeline and gantt lanes with markers, spans and a real time axis, brushing that axis through the shared wiring, and inspect/selection/legend/table behaviour proven in the gallery.

## Contract

- CONTRACTS.md 17.5 "Elements": `<yk-lanes>` covers timeline and gantt lanes, with markers; it takes a `spec` (series, units, formatters, entity keys) and `data`, emits `select`, `inspect` and `brush`, and exposes `inspect()`.
- CONTRACTS.md 17.5 "Rules from the dataviz discipline" and DESIGN.md `plan-timeline`: markers are sized by nothing and coloured by kind; the time basis is named in the frame; a table shows every plotted span and marker; no mark the interaction model cannot act on.
- DESIGN.md Interaction model: hover/focus highlights the entity key; click/Enter inspects; Space and the row checkbox select; Alt-click and `x` exclude; `o`/`f`/`c` then `a`–`d`/Esc emit their intents; drag on the time axis emits `brush`; `[` `]` move an edge; touch Select mode drags the brush; tap inspects; targets at least 44 px.
- DESIGN.md Workspace shell: unpriced calls are hollow markers, never `$0`; a marker's `priced:false` is shown hollow and named.
- CONTRACTS.md 17.7: real Chromium events at `inspect()` coordinates; no fixed sleeps; no animation; no `/tmp`; tests are not shipped; nothing branches on being under test.
- Settled: SVG with the shared tooltip, legend and registry; no new dependency, route, grain, join, measure or gesture; no palette change.

## Changes

- `yk-lanes.js`: `<yk-lanes>` with `spec.chart = 'lanes'` and `spec.type` `timeline` or `gantt`.
  - Spec: `{ chart, type, title, units, x: { label, kind: 'time' }, series: [{ key, label, kind, unit }], timeBasis?, coverage?, sample?, resolution?, empty?, unsupported? }`.
  - Data: `lanes: [{ key, label }]` in the spec or `data.lanes`, and items `{ key, lane, kind, at? }` for markers or `{ key, lane, kind, start, end }` for spans; optional `values`, `n`, `priced`, `coverage`. `timeline` draws one lane per entity with markers; `gantt` draws spans, optionally with markers. Markers are never sized by a value; colour and shape come from the registry by `kind`.
  - A drag on the time axis emits `brush { from, to, aligned: true }` and `inspect().brush`; `[` `]` move an edge; Esc clears selection before brush. The table lists each span's start/end and each marker's time, lane, kind, value and unit.
  - Every marker/span carries `data-entity-key` and the 8-01 mark shape; the legend groups by `kind` when there are two or more kinds and toggles a kind without repainting survivors.
- `lanes.html`/`lanes.js`/`fixture-lanes.js`: deterministic test-only data for both modes, including a priced and an unpriced marker and the shared entity keys (`model:atlas`, `harness:orca`, `repo:core`, `kind:test`); external modules only; settle every element, then set `data-idle`.
- `tests/charts-cat/lanes.test.mjs`: pure checks for time-to-pixel mapping, timeline/gantt item shapes, marker colour-by-kind and priced/unpriced marking, plus a Chromium spec driving real mouse, keyboard and touch at `inspect()` coordinates.

### Keep untouched

Do not edit `svg-base.js`, `yk-bars.js`, `yk-chart.js` or any Phase 7 module; if the shared base cannot carry this element, report it rather than editing the foundation. Do not edit `tests/gallery/index.html`/`index.js`, another unit's page, fixture or spec, the harness, the vendored uPlot files, Go code, or the stale `tests/e2e*`, `tests/hosted` and `tests/identity` trees. Add no dependency, route, panel, grain, join, gesture or sample data to the product; no `/tmp`; no animation or fixed sleep. Do not implement the Phase 11 session-detail panel, its 5,000-event cap or cross-grain linking; this unit is the element only.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-cat/lanes.test.mjs` → passes, or skips with the exact named browser reason.
- Timeline → markers land at the fixture times in the correct lanes; table and `inspect()` values match `fixture-lanes.js`; markers are coloured by kind and sized by nothing.
- Gantt → spans match their start/end and lane; overlapping spans remain distinguishable; the table lists every span.
- Brush → a real drag on the time axis emits `brush` with finite `from`/`to`/`aligned:true` and `inspect().brush` reflects it; Esc clears it; `[` and `]` move an edge; touch Select-mode drag brushes.
- Real interaction → hover/focus highlights the key; click/Enter emits `inspect`; Space/checkbox selects; Alt-click/`x` excludes; `o`/`f`/`c` then `a`–`d` emit their intents; touch tap inspects at a target of at least 44 px.
- Priced/unpriced → an unpriced marker is hollow and named, never formatted as `$0`.
- Table → keyboard operable (ArrowUp/ArrowDown, Space, Enter) and unit-labelled.
- Both themes → the same kind keeps its slot and pattern; no animation; no `console.error`, page error or CSP violation; at most four analytics requests in flight.
- `NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules node --test packages/yakka-analytics/tests/charts-cat/*.test.mjs` → the accumulated Phase 8 specs all pass.

If `playwright-core` or Chromium is unavailable, report `gate: browser acceptance needs playwright-core under NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules and the Chromium 1243 cache`; never install it.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, how the time-axis brush uses the 8-01 wiring, any shared-base assumption that did not hold, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
