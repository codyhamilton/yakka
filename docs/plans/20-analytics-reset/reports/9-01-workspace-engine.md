# 9-01 — Workspace engine, view spec and Start

Status: `over budget` (deliverable complete; this unit's checks pass).

## Budget

About 2,035 added and 61 deleted lines across 23 files, against the brief's
~1,500 changed lines. No product scope was added. The overrun is the test
harness (stub API, fixture shapes, Chromium spec) plus the engine modules the
later Phase 9 units consume. Nothing was left half-built, so no
`IMPLEMENTATION.md` handoff was written (that file is also outside the brief's
owned paths).

## What changed

- `web/contract/url-state.js` — `p<n>` now keeps the raw string in `panels`
  for the existing tests and adds decoded `panelSpecs` beside it; encode writes
  raw strings first and canonical JSON only when no raw value exists. All
  existing keys, defaults, unknown-key preservation and `from`/`to` precedence
  are unchanged.
- `web/js/core/view-spec.js` — canonical spec shape, `p<n>` encode/decode,
  preset-plus-override merge, and panel-beats-board scope precedence. Pure, no
  DOM. The canonical form sorts measures and scope keys, so equal specs produce
  one URL.
- `web/js/core/panel-state.js` — the six-state vocabulary (`loading`, `ready`,
  `empty`, `error`, `unsupported`, `cancelled`), allowed transitions, empty
  causes, unsupported text and result classification. Badge logic stays in
  `charts/badges.js`.
- `web/js/core/follow.js` — off-by-default probe loop over
  `/activity?mode=probe&after=<acknowledged watermark>`. Only a successful
  probe records counts and a pending watermark; `acknowledge()` is the only way
  the next probe moves forward; errors and aborts never advance it; hidden
  documents never probe.
- `web/js/core/saved-boards.js` — named board URLs in `yakka-analytics-boards`
  (save/rename/delete/lookup/open); opening navigates to the stored URL.
- `web/js/core/router.js` — route records for Start, boards, explorers,
  account and named later destinations; lazy `ledger.js`/`ops.js`; push and
  replace entry points (`pushScope`, `replaceTransient`); unknown paths stay the
  in-shell not-found view.
- `web/js/panels/{registry,panel-frame,index}.js` — registry shape, duplicate-id
  and unknown-chart validation, preset-panel validation, schema-driven
  `chooserOptions`, and one frame with `data-chart`/`data-state`/`data-idle`,
  badges, chip/chooser/inspector slots, `setState`/`setPopulation`/`setBasis`
  and `panel.load({scope, spec, signal, scheduler})`.
- `web/js/boards/{presets,board}.js` — the seven non-Pulse presets as named rows
  with delivering phases; `pulse` reserved for 9-03; board assembly at most 12
  panels with named reasons for missing presets or panels.
- `web/js/explorers/ledger.js`, `web/js/ops.js` — Phase 9 named-destination
  pages that 9-04/9-05 replace without touching the router.
- `web/js/app.js` — router dispatch, schema-once, Start's 15 fixed question
  paths with hrefs or disabled reasons, scope bar, coverage strip, board frames,
  saved boards, Follow control, plus the existing session gate, identity,
  theme, schema status and request footer. `document.documentElement` now
  carries `data-state`/`data-idle` for the browser gate.
- `web/css/{app,workspace}.css`, `web/index.html` — scope bar, coverage strip,
  panel grid, state/badge presentation, 900 px single column, visible focus, no
  animation; one stylesheet link added.
- `tests/workspace/{harness,stub-api,fixture,browser,engine.test,start.test}.mjs`
  — CSP-faithful static server with client-route fallback and stats, a
  manifest-derived deterministic stub API (`default`, `legacy`,
  `missing-feature`, admin/member, empty/error), the shared Chromium loader,
  nine pure checks and two Chromium specs.

## Check output

Before (the brief's command):

```
$ NODE_PATH=… node --test …/tests/workspace/engine.test.mjs …/tests/workspace/start.test.mjs
Could not find '…/engine.test.mjs, …/start.test.mjs'
```

Before, existing non-browser suite: `node --test packages/yakka-analytics/tests/*.test.mjs` → 12 pass, 0 fail.

After, this unit:

```
$ NODE_OPTIONS=--max-old-space-size=8192 PUBLIC_CANVAS_TEST_MODE=true \
  NODE_PATH=… node --test --test-concurrency=1 \
  …/tests/workspace/engine.test.mjs …/tests/workspace/start.test.mjs
# tests 11
# pass 11
# fail 0
```

After, unchanged codec/shell/scheduler specs:

```
$ NODE_PATH=… node --test …/url-state.test.mjs …/static-shell.test.mjs …/request-scheduler.test.mjs
# tests 9, pass 9, fail 0
```

After, existing non-browser suite: 12 pass, 0 fail.

The Chromium specs prove: 15 Start paths with hrefs, or disabled reasons under
`missing-feature`; `/b/trends` Phase 10 and `/b/pulse` Phase 9 named
destinations; `win=all`, filters, exclusions and `p1` survive reload and Back;
a ten-year `from`/`to` survives reload with its `tz`; a delivered demo
board renders a `ready`/`data-idle` frame with typed population and basis; a
saved board stores the current URL and reopens at it; Follow is off by default,
probes, acknowledges `MTAwMA`, and keeps that watermark on a failed probe; no
page error or CSP violation; `maxInFlight <= 4`.

## Deviations and interpretations

- Over budget as above; the deliverable is complete.
- The hidden-document Follow observable is proven in `engine.test.mjs`; the
  browser proof is deferred to 9-03/9-06 because Follow's contracted home is
  the river panel and Pulse is not delivered by this unit. A board-level Follow
  control exists so 9-03 can attach to it; no invented river UI was added.
- Scope bar and coverage strip render on named later destinations as well as
  boards, so deep-link/Back evidence is observable at `/b/trends` before a
  board exists.
- Saved-board reopen is proven in-document through `openBoard`'s navigation.
  A full reload in 9-01 would forget a preset registered by the test through the
  public registry, since no board ships in this unit.
- The induced failed probe is the one expected `console.error` (Chromium logs
  the 500 the product is showing). `assertClean()` runs before it; afterwards
  the spec asserts no page errors and no CSP violations.
- `registerPreset` rejects more than 12 panels, and `assembleBoard` also guards
  the limit, so an oversize preset fails at registration rather than rendering.
- The canonical codec lives in `js/core/view-spec.js`; `contract/url-state.js`
  imports its decode/encode helpers so there is one codec. This is a
  contract→js import for pure functions only.
- `/schema` publishes the activity flag as `analytics_activity` in the Go code
  while CONTRACTS.md 17.2 names `activity`; the path check accepts either.

## Contradictions

- CONTRACTS.md 17.2 lists feature flag `activity`; `analytics_query.go`
  publishes `analytics_activity`. Handled as an alias, not silently resolved.
- The brief asks the browser spec to prove hidden-document Follow before Pulse
  (9-03) exists. Follow's contracted toggle is in the river panel, so that
  browser step is deferred; the semantics are proven purely now.

## Unfinished / known problems

- None blocking. The browser-level hidden-document Follow case and panel-state
  rendering with real panels remain for 9-03 and are re-proven by 9-06, as the
  brief states.
- `gate: none` — playwright-core and Chromium 1243 were present; no external
  system, secret or deployment was needed.
