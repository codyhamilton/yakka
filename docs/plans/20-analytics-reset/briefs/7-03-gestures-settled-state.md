# Brief: 7-03 — Gesture and settled-state engine

Consumer: the Phase 7 chart-kit worker; 7-04 and 7-05 use the same gesture grammar.
Owned paths: `packages/yakka-analytics/web/js/charts/{gestures,selection,history}.js`, `packages/yakka-analytics/web/js/charts/yk-chart.js` (the composition seam only), `packages/yakka-analytics/tests/gallery/{gestures.html,gestures.js}`, `packages/yakka-analytics/tests/charts-time/gestures.test.mjs`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title. Do not push, merge, deploy, rebase or touch another branch or worktree.
Report: before committing, write `docs/plans/20-analytics-reset/reports/7-03-gestures-settled-state.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 7-02.
Runs alongside: nothing; it edits the same `<yk-chart>` composition the later scatter unit extends.
Budget: 14 files to read, about 1,100 lines to change, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Interaction model, especially the Gestures table (quote every row) and Linking; Workspace shell and state "URL is the state" (history rules) and "Panel states".
2. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.5 — "Testability surface" and the dataviz rules; 17.7 — settled-state waiting and real events.
3. `packages/yakka-analytics/web/contract/url-state.js` — reserved keys (`sel`, `pick`, `hide`, `cmp`, `ca`–`cd`) and `decodeUrlState`/`encodeUrlState`; import it read-only.
4. `packages/yakka-analytics/web/js/charts/yk-chart.js`, `legend.js`, `table.js` — the primitives this unit wires.
5. `packages/yakka-analytics/tests/gallery/harness.mjs` and `tests/charts-time/browser.mjs` — the test-only server, skip gate and waiting helpers.

Read ranges and grep; do not re-read a file already in context.

## Goal

Wire the interaction contract's gestures into `<yk-chart>` with one settled-state machine: hover/inspect, selection union/subtraction, brush versus zoom, pan, legend, keyboard, touch and history, verified with real events at `inspect()` coordinates.

## Contract

- DESIGN.md Interaction model Gestures table is binding, row by row: hover/keyboard focus; click to inspect; Shift/Ctrl/Cmd-click or the row checkbox to add, Alt-click to subtract; drag on a time axis to brush `sel`, Shift-drag to pan, Ctrl/Cmd-wheel to zoom around the cursor, double-click or *Zoom to selection* to commit `from`/`to` and clear `sel`; legend click toggles `hide` with no request, legend focus (button or Alt-click) filters, Ctrl-click isolates; the keyboard grammar (`arrows`, `Enter`, `Space`, `o`, `f`, `x`, `c` then `a`–`d`, `[` `]`, `+` `-`, `Esc` clears selection then brush); touch tap inspects, a *Select* mode button turns drag into brush, pinch zooms, targets are at least 44 px.
- DESIGN.md Workspace shell "URL is the state": window/filter/cohort/compare changes push history; hover and an in-progress drag do not; a committed brush/selection replaces its transient parameter; zoom pushes and clears `sel`; Back restores the full prior scope/cohorts/panels. Use the existing codec and its key names; do not invent a URL key.
- DESIGN.md Interaction model Linking: same-grain marks highlight by entity key across loaded charts; a selection is a Boolean entity predicate with positive and exclusion parts; no fetch occurs for hover, legend toggle or same-grain highlight. The tray, cross-grain requery and inspector actions are not this phase; emit the settled state and event they will consume.
- CONTRACTS.md 17.5 "Testability surface": `inspect()` exposes window, selection, bucket, series visibility, plot rectangle, `xToPx`/`yToPx`, cursor and marks, and the tooltip carries the key under the cursor. `data-state` is the panel-state vocabulary; badges come from 7-01.
- No new gesture, route, dependency or contract. The product must not branch on being under test.

## Changes

- `selection.js`: the Boolean entity selection value with positive and exclusion sets, union/subtraction, stable ordering, and a serialisable predicate for `inspect()`, `select` and later tray consumption. Never infer identities from samples.
- `gestures.js`: pointer, mouse, keyboard and touch handling mapped exactly to the gesture table. Real drag threshold, brush preview, pan, wheel zoom around cursor, double-click commit, legend intents, keyboard navigation across marks/series, *Select* mode, pinch, 44 px targets. Hover and in-progress drag update `inspect()` but not history.
- `history.js`: commits the settled state through `web/contract/url-state.js`: `replaceState` for the transient `sel`/`pick` key, `pushState` for window/filter/cohort/compare changes, zoom pushes and clears `sel`; hover and in-progress drag do nothing. `popstate` restores the decoded state. Do not edit the codec; if a required key is missing, stop and report it.
- `yk-chart.js`: compose the gesture engine and selection state; keep 7-02's modes, scale groups, thresholds, table, tooltip and `inspect()` contract intact; add `inspect().selection` and the inspected key.
- Gallery: `gestures.html`/`gestures.js` with two linked charts over the same entity keys and a test-only `<output>` that mirrors the emitted `inspect`/`select`/`brush` state; external modules only.
- `tests/charts-time/gestures.test.mjs`: real mouse/keyboard/touch events at coordinates from `inspect()`, endpoint URL/history assertions, waits on `data-idle`/`data-state`; no sleeps.

### Keep untouched

Do not implement rectangles for scatter (7-04), the gallery index (7-05), the tray, inspector product UI, cross-grain requery or cohort population queries. Do not edit `web/contract/url-state.js`, `web/index.html`, `web/js/app.js`, the vendored uPlot files or Go code. Do not add a dependency, a URL key or a gesture.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `node --test packages/yakka-analytics/tests/charts-time/gestures.test.mjs` → passes, or skips with the exact named browser reason.
- Hover and inspect → a real mouse move and a keyboard focus both set the inspected key, highlight the same key in the linked chart, show the tooltip key, and leave the URL and `history.length` unchanged.
- Selection → Shift/Ctrl/Cmd-click and the table row checkbox add; Alt-click subtracts; `inspect().selection` and the `select` event carry the Boolean predicate; surviving marks keep their colours.
- Brush versus zoom → a time drag sets the transient `sel` by `replaceState`; zoom and double-click push `from`/`to`, clear `sel`, and Back restores the prior state; Shift-drag pans without a selection; Ctrl/Cmd-wheel zooms around the cursor.
- Legend → toggle changes `inspect().visible` and `hide` without a request; focus sets the one filter by a push; Ctrl-click isolates.
- Keyboard → every grammar key changes the settled state named in the table, including `Esc` clearing selection before brush.
- Touch → tap inspects; *Select* turns drag into a brush; pinch changes the time window; every interactive target is at least 44 px.
- `node --test packages/yakka-analytics/tests/*.test.mjs` → the earlier suite, 7-01 and 7-02 checks still pass; no `console.error`, page error or CSP violation.

If `playwright-core` or Chromium is unavailable, report `gate: browser acceptance needs playwright-core under NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules and the Chromium 1243 cache`; never install it.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently. If a gesture row cannot be settled without a tray or product inspector, say which row and stop at the event/state boundary; do not invent that UI.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
