# 9-06 — Workspace acceptance and phase proof

Status: `blocked` (the three proof specs and the phase-proof case set are
written and run; five product defects below fail required checks. This unit is
read-only over the product, so nothing is fixed here and the phase cannot
close until 9-01/9-03 land fixes.)

## What changed

- `tests/workspace/acceptance.test.mjs` — one Chromium phase proof over the
  committed fixture/stub, 70 recorded cases plus a final summary test. Covers:
  all 15 Start paths and their destinations; legacy `/schema` disabling 10
  paths with the missing-feature reason; `/b/pulse` five-frame settle; river
  inspect for session/artifact/execution provenance; calendar brush preview
  (no push, no `from`/`to`) and zoom commit (push, clears `sel`); Follow off,
  probe counts without acknowledging, acknowledge advances and refetches, a
  500 probe holds the watermark; chips/tray/typed population, unknown URL key
  preserved, unsupported join and ignored filter named; per-panel capability
  inspector (queries, grain, units, basis, budgets, coverage, caveat) and the
  schema-driven movers chooser with the nearest supported choice; saved board
  URL round trip; ledger beyond 20,000 rows (unique, non-increasing, unpriced
  never `$0`); `/ops` admin vs member; every frame state; coarsened badge.
- `tests/workspace/deep-links.test.mjs` — direct loads of all-history,
  `cmp=period` disabled warning, a ten-year finite window with tz/filter/panel
  override/cohort across reload, Back and Forward, unknown path in the shell,
  `maxInFlight <= 4`.
- `tests/workspace/degradation.test.mjs` — the `legacy` scene: river gated as
  unsupported with feature/source, the other panels' verbatim `range too wide`
  with retry, no window rewrite, no page/CSP error.
- `docs/plans/20-analytics-reset/reports/9-06-workspace-acceptance.md` — this
  handoff.

No product, harness, stub, fixture, chart or other test file was edited. Not
committed: this brief commits when the done evidence passes, and it does not.

## Check output

Before (the specs did not exist): `Could not find .../acceptance.test.mjs`.

After, the brief's command:

```
$ NODE_PATH=… node --test tests/workspace/acceptance.test.mjs \
    tests/workspace/deep-links.test.mjs tests/workspace/degradation.test.mjs
# tests 7 # pass 3 # fail 4
```

Passing: Start paths, saved board/ledger/ops, deep links. Failing: two product
cases in the acceptance spec, its summary, and degradation. The acceptance
summary prints `Phase 9 acceptance summary (66/70 cases)`; the four failing
cases are the three entity-fact cases and the coarsened badge.

Whole workspace suite:

```
$ NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=… \
  node --test tests/workspace/*.test.mjs tests/*.test.mjs
# tests 85 # pass 81 # fail 4
```

All 81 pre-existing/non-failing tests pass; the four failures are the new
proof cases above, so there is no regression. Chart kits:
`tests/charts-cat/*.test.mjs tests/charts-time/*.test.mjs` → `# tests 68 # pass 68`.
`git diff --check` is clean. `rg -n "data-test|__test|stub|fixture" web` finds
only pre-existing `data-testid` attributes in `web/js/identity/flows.js`; the
new specs add no test hook. No `/tmp`, fixed sleep or animation/timing
assertion in the new specs.

## Failing checks and owning units

1. **Panels do not gate on `/schema` requirements.** Under `legacy`, river
   renders `error` with `range too wide (range too wide)` instead of
   `unsupported` naming `activity` and its source. `panel-frame.js:load()` never
   consults `panel.requires`; only `app.js:pathAvailability` gates Start links.
   Owner: 9-01 (frame/board gate); 9-03 already declares `requires: ['activity']`
   (`river.js:228`). Evidence: degradation problems list.
2. **Result-state errors carry no retry.** The legacy panels render `error`
   with no button. `panel-frame.js` attaches `retry: load` only in the catch;
   `classifyResult(result)` for a returned `errorState` has no `retry`, and the
   panels do not supply one. Owner: 9-01 panel-frame (attach the frame's own
   retry for any `error`), 9-03 panels. Evidence: pulse-strips/movers/calendar/
   coverage `retry: false`.
3. **The scheduler shares one `Response` between identical in-flight
   requests.** `request-scheduler.js:21` returns the prior promise for the same
   `METHOD url`; `contract/transport.js:31` then runs `response.json()` per
   caller. The second read rejects and `.catch(() => ({}))` yields an empty
   body. Under `legacy`, coverage shows `The server returned 400. (400)` while
   the other four show `range too wide` verbatim. This can silently empty any
   duplicate concurrent query. Owner: 9-01 scheduler/transport (clone per
   caller). Evidence: degradation problems list.
4. **A coarsened response shows no badge.** Calendar returns
   `coarsened: <requested !== effective>` (`calendar.js:184`), but
   `panel-frame.js:58` passes it to `badgeModel`, which reads `meta.badges`,
   `resolution`, `coverage`, `sample`, `unpriced`, `values`, `basis` and never
   `meta.coarsened` (`charts/badges.js:44-66`). Count of
   `[data-panel="calendar"] .yk-badge[data-kind="coarsened"]` is 0 after a
   week-effective response. Owner: 9-01 panel-frame badge mapping (or 9-03
   calendar emitting `badges: ['coarsened']`).
5. **River inspect opens the entity but not its facts.** The inspector shows
   the matching key (`activity observation session_start:fix-session_start`) and
   `kind/lane/at/priced`, but not `conversation_id`, `path` or `repo_id`.
   `river.js:laneRows` puts those fields in `values`, but
   `charts/yk-lanes.js:buildLanesModel` replaces `values` with
   `{ [kind]: measure }`, so the inspect event carries no provenance and
   `app.js:367` builds facts only from that reduced object. Owner: 9-03 river
   feed, with a cross-unit seam in `<yk-lanes>` (charts are outside 9-03's owned
   paths). Evidence: the three acceptance failures.

## Deviations and contradictions

- The Start gating case uses the `legacy` scene, not
  `missing-feature: 'activity'`. The stub's missing-feature scene sets
  `features.activity = false` but leaves `features.analytics_activity = true`,
  and `app.js:featureAvailable('activity')` accepts either alias, so the path
  correctly remains enabled. `legacy` removes every feature and disables 10
  paths; this is the scene the brief names.
- The brief's "matching session/artifact/execution provenance" is read as the
  entity's facts, not only its key, per DESIGN's "the entity's facts" in the
  inspect row. If the key alone is intended, failure 5 is not a defect.
- Expected 403/500 responses make Chromium log failed-resource entries. As in
  the 9-03/9-05 browser specs, the affected cases assert zero page errors and
  zero CSP violations and allow only the deliberate status in console.
- No contradiction between this brief and CONTRACTS.md was found beyond the
  above ownership seam.

## Gates

- `gate: 9-01 gate panel load on the registry requires against /schema and render unsupported with the missing feature and its source; 9-06 cannot edit product code.`
- `gate: 9-01 attach the frame's own retry to every error state, including a returned errorState, so old-server failures can be retried; 9-06 cannot edit product code.`
- `gate: 9-01 clone or buffer scheduler responses per caller so concurrent identical queries each get a readable body; 9-06 cannot edit product code.`
- `gate: 9-01 map the coarsened/search/clipped/lower-bound flags returned by panels into frame badges (or have 9-03 emit badges explicitly); 9-06 cannot edit product code.`
- `gate: 9-03 preserve river row facts through the lanes model or pass them to the inspector as facts; charts are outside 9-03's owned paths, so this needs a seam decision.`
- `gate: the stub's missing-feature scene leaves analytics_activity true when asked to remove activity; align the scene with featureAvailable or document the alias as intentional.`

## Known problems

- The acceptance spec needs a real 500 and a real 403 to prove Follow error
  holding and member refusal; those cases assert clean diagnostics before the
  fault and allow only that status afterwards. A fully clean run is not possible
  without a product branch or a response the browser does not log.
- The coarsened case drives the response through the test's query interception
  (`effective: 'week'`) because the stub has no coarsening control. It exercises
  the real calendar/frame path.
