# 9-03 — Pulse preset, river, feed, brush and movers

Status: `over budget` (deliverable complete; this unit's checks pass). About
1,820 added lines against the brief's ~1,200, with 65 tool turns not exceeded.
`IMPLEMENTATION.md` was not written because it is outside this brief's owned
paths; the handoff is here instead.

## Budget note

The overrun is the five panel renderers plus their pure helpers and the two
Chromium specs. Nothing was left half-built. The report itself is the only
unowned-path artifact and the brief names it explicitly.

## What changed

- `web/js/panels/pulse-strips.js` (new) — shared window arithmetic
  (`currentWindow`, `previousWindow`; `all` has no previous), request-parameter
  helper, stylesheet loader, the strip model (cost/calls/sessions/events/
  artifacts/commits/rejections plus the `/scores` median with kind, check,
  scorer and n), unpriced/lower-bound formatting, and the shared typed table.
  The panel renders the table; previous-period and no-previous distinctions are
  explicit. `/summary` is called for the current and previous equal window and
  `/scores?kind=design` for the median.
- `web/js/panels/river.js` (new) — `mapActivityList`, kind-keyed
  `laneRows` (entity key `type:identity`), and a `<yk-lanes>` timeline with the
  event-time basis, preserved `ignored_filters` and cursor notice. Renders
  Follow bound to 9-01's `createFollow`: off by default, interval, four typed
  counts, acknowledged watermark, Check now, Acknowledge; acknowledge refetches
  the feed once; probes report late counts without moving the acknowledged
  watermark; errors name the failure and leave the watermark unchanged.
- `web/js/panels/movers.js` (new) — schema-limited measure chooser, harness and
  `session_model` ranked change (current vs previous equal window) from
  `/query` totals plus day-bucket series, `<yk-bars type="lollipop">` and the
  shared table with current/previous/change/unpriced/sparkline/n. The repo lens
  is offered only when `/schema` lists `session_repo` for the time grain;
  otherwise the panel says it is not offered. Per-group `n` and unpriced counts
  are named "not supplied" rather than invented; the `unpriced_calls` query is
  only issued when the schema offers it.
- `web/js/panels/calendar.js` (new) — `/query?bucket=day` rows into
  `<yk-matrix type="calendar">`, measure chooser, coarsening label, the labelled
  transient brush preview, Zoom to selection/double-click that writes `from`/
  `to`, pushes history and clears `sel`, and the shared-entity-key caveat.
- `web/js/panels/coverage.js` (new) — typed groups for facts by type and last
  receive, session repo attribution, scored/total hashes per kind, priced/total
  calls, data by source, rejections by stage, screen state, and
  compaction/pending/screen-gap/scorer/revision state. Every group names its
  unit and denominator; no blended percentage is computed.
- `web/js/panels/index.js` — imports the five modules, registers them, and
  registers the `pulse` preset (the five ids, one shared scope) through
  `registerPreset`; idempotent.
- `web/css/pulse.css` (new) — layout for the five panels and their tables;
  loaded idempotently through an absolute `/css/pulse.css` link; no animation or
  transition.
- `tests/workspace/pulse.test.mjs` — nine pure checks (previous window,
  unpriced lower bound, `all` = no previous, quality median naming, repo-lens
  absence, ranking/naming, coverage units/no percentage, river types/clocks,
  calendar rows/coarsening, registry validity) and one Chromium spec over the
  workspace harness with deterministic activity/query/scores responses:
  five panels settle `ready`; river shows four types and opens the inspector;
  strips compare and never show `$0.00`; the movers chooser offers only
  schema measures and names the absent repo lens; the calendar brushes with no
  URL change, previews peers, then zoom pushes `from`/`to` and clears `sel`;
  `maxInFlight <= 4`; no console/page/CSP error.
- `tests/workspace/follow-ui.test.mjs` — Chromium spec: Follow off at load,
  start probe reports the four typed counts, a manual probe adds one request
  without moving the acknowledged watermark, acknowledge advances it to
  `MTAwMA` and refetches the feed once, an injected probe error leaves the
  watermark unchanged, and a check while the document is hidden performs no
  probe. The one induced 500 is the only allowed console error; page errors and
  CSP violations must be empty.
- `docs/plans/20-analytics-reset/reports/9-03-pulse.md` — this report.

## Check output

Before (brief command, files absent):

```
$ NODE_PATH=… node --test …/tests/workspace/pulse.test.mjs …/tests/workspace/follow-ui.test.mjs
Could not find '…/pulse.test.mjs, …/follow-ui.test.mjs'
```

After:

```
$ NODE_PATH=… NODE_OPTIONS=--max-old-space-size=8192 node --test \
    …/tests/workspace/pulse.test.mjs …/tests/workspace/follow-ui.test.mjs
# tests 11
# pass 11
# fail 0
# skipped 0
```

Regression:

```
$ NODE_PATH=… node --test …/tests/workspace/engine.test.mjs …/tests/workspace/tray.test.mjs
# tests 16
# pass 16
# fail 0
```

`git diff --check` is clean over the owned files; no `data-test`/`__test`/stub/
fixture hook exists in the six product files or `pulse.css`.

## Browser observations

- `/b/pulse` settles five frames: river, pulse-strips, movers, calendar,
  coverage all `ready` under the deterministic interception.
- River shows four observation kinds and Enter on the lanes opens the shared
  inspector with the row's provenance.
- Calendar drag writes `sel` and shows "Peer preview only", with no `from`/`to`;
  Zoom writes absolute `from`/`to` and clears `sel`.
- Follow is off at load, reports session/version/execution/rejection counts,
  advances only on acknowledge, keeps `MTAwMA` on an injected probe error, and
  does not probe while hidden.
- Movers offers only `cost_usd`, `model_calls`, `commits` under the fixture
  time grain and names `session_repo` as absent; coverage shows sessions,
  hashes, calls and rejections with their own units.
- `maxInFlight <= 4`; no page error or CSP violation.

## Deviations from the brief, with reasons

1. **The shell does not load the panel barrel.** `web/js/app.js` imports
   `panels/panel-frame.js` directly and never imports `panels/index.js`; no
   other module in `app.js`'s graph imports it. Because the brief forbids
   changing `app.js`, the Chromium specs import `/js/panels/index.js` and
   re-dispatch the current `/b/pulse` route before asserting the five panels.
   The shipped `/b/pulse` route therefore still renders the Phase 9 named
   destination until the shell imports the barrel.
   `gate: add one side-effect import of ./panels/index.js to web/js/app.js (an unowned file) so /b/pulse renders the registered preset in the product; then the in-spec import-and-popstate step can be deleted.`
2. **The 9-01 frame does not render a panel body.** `createPanelFrame` owns the
   body element but `load()` never receives it, and `app.js` starts each
   panel's load before appending the grid. Within this unit's owned paths the
   five panels locate their own frame body by `data-panel` and paint on the
   following microtask (`whenPanelBody`). This is scheduling, not a test
   branch. A frame-level mount seam would be cleaner but is outside the brief.
3. **Pulse strips use the shared table, not bars.** The brief allows either an
   existing element or the shared table. The table carries current, previous,
   change and detail for all eight strips; no new chart type was added.
4. **Movers sparklines are labelled daily block text**, derived from the
   `bucket=day` series, inside the shared table; the ranked change itself is
   `<yk-bars type="lollipop">`. The brief asked for "bars with sparklines"; a
   second chart element per lens was not used to keep the panel within the
   no-new-chart-type rule and the request budget.
5. **Movers `n`** comes from the response's typed population only at whole-
   response level; per-group attribution is not supplied by `/query`, so the
   table says "not supplied per group" rather than dividing the population.
   Unpriced per group is fetched from `unpriced_calls` only when the schema
   offers it.
6. **Calendar and river brush commits** write the URL with the existing
   `contract/url-state.js` codec and dispatch `popstate`, because `app.js` has
   no `brush` listener and no router object is passed to a panel. The router
   still owns the navigation; no new route or storage key was added.
7. **Empty states name the scope that produced zero but pass no clear
   callback**, because the panels are not given the router; the frame renders
   the cause text without a Clear button. This is weaker than the brief's
   "offers to clear each".
8. **Cohorts are not forwarded** by the shared panel scope-parameter helper:
   it passes `from`/`to`/`win`/`tz` and the shared filters but not the `cohort`
   JSON parameter. The Phase 9 panels therefore honour window/filter scope, not
   cohort scope.

## Contradictions in the brief

- The brief requires "Observable on `/b/pulse`: five panels settle `ready`" and
  also says "do not change `app.js`". `app.js` does not import
  `panels/index.js`, so the preset cannot be registered in the shipped shell
  without that unowned one-line change. Recorded as a gate above rather than
  silently editing `app.js`.
- The brief says every panel is the 9-01 frame and the frame owns rendering,
  but the frame exposes no body/container to `load()` and the board does not
  render panel results. The microtask body lookup above is the narrowest
  owned-path workaround; a frame mount seam belongs to 9-01.

## Unfinished / known problems

- `gate: import ./panels/index.js from web/js/app.js` as above; until then the
  product's `/b/pulse` is still the named destination and the specs must import
  the barrel themselves.
- Empty-panel Clear actions and cohort forwarding are not wired (items 7 and 8
  above); both need a router/handle the panels do not receive under this
  brief's owned paths.
- If a future server schema omits `unpriced_calls` for the time grain, movers
  shows "not supplied" for unpriced counts rather than issuing a rejected
  request; if it offers the measure, the per-group query runs.
- No Go, chart-kit, harness, stub, router, frame or app file was changed.

## Commit

Committed to `feat/20-analytics-reset` with a plain-summary title; this report
is included. No push, merge, deploy, rebase or other branch/worktree touched.
