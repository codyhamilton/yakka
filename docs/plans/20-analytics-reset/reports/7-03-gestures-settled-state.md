# 7-03 — Gesture and settled-state engine

Status: done.

## What changed

- `web/js/charts/selection.js` — Boolean entity selection as disjoint
  `include`/`exclude` key sets: pure union, toggle, add, remove, stable
  ordering, compact `pick` encode/decode and the serialisable
  `selectionPredicate()` used by `inspect()`, `select` and the later tray.
  Identities come only from gestures or the table checkbox.
- `web/js/charts/gestures.js` — one intent engine over the uPlot overlay:
  hover, click-to-inspect, Shift/Ctrl/Cmd-click add and Alt-click exclusion,
  4 px drag threshold, brush preview, Shift-drag pan, Ctrl/Cmd-wheel zoom
  around the cursor, double-click commit, legend intents, keyboard grammar,
  *Select* mode, pinch and 44 px controls. It emits intents only; the element
  owns state, history and events.
- `web/js/charts/history.js` — the sole URL writer, through
  `web/contract/url-state.js`. `sel`/`pick` replace; window/filter/zoom/pan
  push; zoom and pan clear `sel`; `hide` replaces; `popstate` re-decodes and
  hands the whole state back. Hover and in-progress drags never write.
- `web/js/charts/yk-chart.js` — composition seam: wires the engine, selection,
  brush/zoom/pan, highlight propagation (`yk-highlight`) across linked charts,
  legend toggle/focus/isolate, table checkbox and row inspect, and extends
  `inspect()` with selection, keys, brush, inspected key/index/series,
  highlight, select mode and URL state. 7-02 modes, scale groups, thresholds,
  table, tooltip and states are otherwise intact. uPlot's own x-drag is
  disabled because this engine owns brushing.
- `tests/gallery/gestures.html` + `gestures.js` — two linked charts over the
  same fixture entity keys and a test-only `<output>` mirroring the emitted
  `inspect`/`select`/`brush`/`zoom`/`pan`/`filter`/`open`/`cohort` state.
- `tests/charts-time/gestures.test.mjs` — pure selection/brush/window checks
  plus a Chromium spec at `inspect()` coordinates covering every gesture table
  row and its URL/history endpoint, with no sleeps.

## Check output

Before (interrupted attempt), the browser spec failed the final pinch/history
assertion with `sel` still in the URL and `brush` still set:

```
not ok 4 - gesture and settled-state gallery proves the interaction contract in Chromium
  actual: '?repo_id=core&win=30d&pick=day%3A8%2Cday%3A9%7Cday%3A7&sel=1609804800025%7E1610668800087'
  expected: doesNotMatch /sel=/
# pass 3 / fail 1
```

Root cause: the engine committed pinch and pan with `currentWindow()`
(`{min,max}` from uPlot) while the element's `#zoomTo`/`#panTo` settle
handlers read the history contract's `{from,to}`; both commits returned early,
leaving the transient brush and `sel` in place. `gestures.js` now converts
settled intents through `currentWindowRange()` — no assertion was weakened.

After:

```
$ NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules \
  node --test packages/yakka-analytics/tests/charts-time/gestures.test.mjs
# tests 4 / pass 4 / fail 0

$ NODE_PATH=... node --test \
  packages/yakka-analytics/tests/charts-time/{foundations,time-series,gestures}.test.mjs
# tests 21 / pass 21 / fail 0

$ node --test packages/yakka-analytics/tests/*.test.mjs
# tests 12 / pass 12 / fail 0
```

Browser acceptance ran on playwright-core 1.63.0 and the Chromium 1243 cache;
there is no browser gate. The spec proves: hover and keyboard focus inspect and
link without URL or history change; modifiers and the row checkbox produce the
Boolean predicate with stable colours; a brush replaces `sel`, zoom/double-click
push `from`/`to` and clear `sel`, Back restores the prior scope and brush;
Shift-drag pans and Ctrl-wheel zooms around the cursor; legend toggle/isolate
make no request and focus pushes one filter; Space/`x`/`c`+`a`–`d`/`o`/`f`/`[`
`]`/`+`/`-`/`Esc` settle their named states with `Esc` clearing selection before
brush; touch tap, Select-mode drag and pinch work; all interactive targets are
at least 44 px; no console error, page error, CSP violation or >4 in-flight
request.

## Deviations and interpretations

- `#zoomTo` and `#panTo` are element helpers; the engine still only emits
  intents, matching the brief's state/event boundary.
- `f` zooms to the inspected bucket (window push) when the row has a following
  bucket, and otherwise falls back to the legend filter; the brief names both
  filter and time-window settling and the row has no tray/inspector yet.
- `o` and `c`+`a`–`d` emit `open`/`cohort` events and mirror state only. No
  inspector, tray or cohort mutation UI is built; those are later units.
- Legend isolate hides every other series and writes `hide` with `replace`;
  focus writes the matching contract filter (`repo` → `repo_id`, etc.) with
  `push`. A series key with no matching lens name emits `filter` without a URL
  change rather than inventing a key.

## Contradictions

None found between this brief and DESIGN.md Interaction model (Gestures,
Linking, URL is the state) or CONTRACTS.md 17.5/17.7.

## Unfinished / known problems

None in this unit. Scatter rectangles (7-04), the gallery index (7-05), the
selection tray, inspector product UI, cross-grain requery and cohort population
queries are untouched.
