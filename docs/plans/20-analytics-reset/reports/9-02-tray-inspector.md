# 9-02 — Chips, selection tray, inspector and capability inspector

Status: `done`.

## What changed

- `web/js/core/selection-model.js` — pure Boolean predicate grammar (`and`,
  `or`, `not`, `range`, `in`, `is_null`), canonical JSON with sorted keys,
  numbers, commutative children and deduplicated `in` values; cohort
  `{v:1,grain,scope:{from,to,tz,include,exclude},predicate,op,source?}` with
  canonical same-lens merging; `op` defaulting to `include`; leaf/value/depth,
  scope element/value/value-byte and 8 KiB encoded-URL budget checks; pick
  encode/decode; selection objects and unit/sample count formatting.
- `web/js/core/chips.js` — applicable scope/filter/cohort/selection chips,
  "not applied here" for filters the grain or response does not apply,
  push-history removal of scope/filter/cohort chips, pure add/remove helpers,
  and the legend-focus map from a series `lens` (falling back to a mapped
  namespace) to a contract filter. A measure-only series yields no filter and
  the key is named unmapped.
- `web/js/core/selection-tray.js` — tray model and actions: Make cohort A–D,
  Filter all, Exclude (`op=exclude`), Zoom (time), Open as list, Clear. It
  states grain, predicate, and "N units of M in scope; S sampled marks
  visible" from the panel's typed population, freezes the absolute window and
  applied include/exclude elements when promoting a cohort, validates budgets
  before writing `ca`–`cd`, and never clips.
- `web/js/core/inspector.js` — side panel on wide screens and bottom sheet at
  `max-width: 899px`, entity facts and Open / Filter to / Exclude / Add to
  cohort / Copy link, defined focus order, visible focus, Esc close, focus
  return, and copy of the committed URL.
- `web/js/core/capability-inspector.js` — a drawer on every panel from the
  panel's `requests()` metadata and `/schema`: route+parameters as provenance,
  grain, units, time basis, budgets, coverage, caveats, missing features with
  their source, and the nearest supported choice for unsupported combinations.
  It issues no request.
- `web/js/app.js` — mount only: wraps `panel.load` to capture the typed
  population, mounts chips, tray, inspector and capability drawer into the
  9-01 frame seams, and routes select/filter/cohort/open/inspect intents.
- `web/css/workspace.css` — chip, tray, inspector, bottom sheet, drawer and
  focus styles; no animation or transition.
- `tests/workspace/{tray,inspector,capability}.test.mjs` — 7 pure checks and 6
  Chromium specs.

## Check output

Before: the three spec files did not exist, so the brief's command reported
`Could not find '…/tray.test.mjs, …/inspector.test.mjs, …/capability.test.mjs'`;
`url-state.test.mjs` and `workspace/engine.test.mjs` already passed on the
9-01 branch.

After, the brief's command:

```
$ NODE_PATH=… PUBLIC_CANVAS_TEST_MODE=true node --test \
  …/tests/workspace/tray.test.mjs …/tests/workspace/inspector.test.mjs …/tests/workspace/capability.test.mjs
# tests 13
# pass 13
# fail 0
# skipped 0
```

After, the no-regression command:

```
$ NODE_PATH=… node --test …/tests/url-state.test.mjs …/tests/workspace/engine.test.mjs
# tests 12
# pass 12
# fail 0
```

Observable coverage: two selected keys format as "2 sessions of 1,880 in
scope; 38 sampled marks visible"; in the browser the tray reads
"2 sessions of 1,880 in scope" and Make cohort A writes a canonical `ca`
(`v:1`, grain, `in(id)` predicate, absolute from/to) that renders as a cohort
chip and fits the URL budget; a filter chip removal is a push-scope
change through the router; a measure-only legend focus adds no null filter chip
and the panel shows "not applied here: sessions", while a series `lens:'harness'`
pushes `harness=orca`; clicking and Enter open the inspector with
`harness:orca`, 800 px renders the bottom sheet, all five actions exist, Esc
returns focus to the chart, and Copy link returns the committed `pick`; the
drawer lists `/v1/analytics/entities` with `grain`/`sort` parameters, grain,
`cost_usd: USD`, basis, `max_cells`, coverage, caveat and
`nearest supported choice: measure cost_usd`, and a missing
`entities_session` names Phase 9; no page error or CSP violation and
`maxInFlight <= 4`.

## Departures from the brief and why

- `Filter all` and `Exclude this` write a definition to the first free cohort
  slot (`ca`–`cd`) and set `cmp=cohorts`, because the published URL codec has
  no separate "active cohort" key. The brief says "applies it to the board" but
  does not name a key; inventing one would be a contract change.
- The absolute cohort window is derived from a relative `win` with fixed
  durations (`m` = 30 days, `y` = 365 days) when no absolute `from`/`to` exists,
  because this unit has no server-resolved window to read. The brief requires
  fixed absolute bounds when promoted.
- `app.js` captures the typed population by wrapping `panel.load` rather than
  adding a getter to `panels/panel-frame.js`, which this brief does not own.
- The capability drawer is appended to the frame element because the 9-01 frame
  exposes chip/chooser/inspector slots and no drawer slot.
- Chart `brush`/`zoom` events are not wired to `sel`/`from`/`to`; only the
  tray's Zoom action commits a time selection. The brief's owned done evidence
  does not require brush wiring, and panels that emit brush arrive with 9-03+.
- Entity facts use the chart's series label and unit for each measured value;
  no server entity detail route is invented to enrich them.

## Contradictions named

- The brief and DESIGN both say `Filter all` applies a cohort to the board, but
  the published URL state (DESIGN "URL is the state") defines only `ca`–`cd`
  and `cmp`, with no active-cohort parameter. Recorded above rather than
  resolved silently.
- The brief asks for a drawer "on every panel"; 9-01's frame has no capability
  slot, so this unit appends the drawer to the frame element without editing
  the frame.

## Unfinished and known problems

- None blocking. Real charts are delivered by later units (9-03+); this unit's
  browser specs inject a `<yk-bars>` into a public demo panel to drive the
  contract without a product test branch.
- The browser Back restoration of a removed scope chip is proven through the
  router's push-scope wiring and the pure chip model, not a separate browser
  assertion; the brief's done evidence lists it as observable, and the router
  is the same one 9-01 proves for scope/Back.
- A panel that publishes no `requests()` metadata shows "No query metadata is
  published by this panel" rather than an invented route.

gate: none — playwright-core and the Chromium 1243 cache were present; no
secret, deployment, migration or external system was needed.
