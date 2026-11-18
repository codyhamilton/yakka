# 9-05c — Pulse wiring fixer

Status: `done with 2 known spec gates`. The three 9-03/9-04 wiring gaps are
closed in the owned paths. Two unrelated checks in unowned specs still fail and
are recorded as gates below; neither is weakened.

## What changed

- `web/js/app.js` — one side-effect import of `./panels/index.js`, so the
  shipped shell registers the five Phase 9 panels and the `pulse` preset.
  `renderBoard` now augments the panel load context with a router-backed
  `clear(cause)` handle; the five panels never import the router. A filter,
  select or cohort cause is removed from the current state with the existing
  `chips.js` helpers and pushed through `router.pushScope`, which re-renders.
- `web/contract/url-state.js` — the prior-search loop no longer copies a shared
  filter key from the prior search. A key removed from the new `state.filters`
  therefore stays removed; unknown keys still round-trip. Reserved keys and
  panel overrides keep their existing handling.
- `web/js/panels/pulse-strips.js` — `emptyCausesFor(scope, clear)` names only
  the applied filters/excludes, cohorts and selection, each with a clear
  callback. `summaryIsEmpty` recognises an explicitly all-zero summary. The
  strips panel now returns `empty` for an all-zero summary and clears its body.
- `web/js/panels/{river,movers,calendar,coverage}.js` — each empty result now
  returns `emptyState(emptyCausesFor(scope, clear))`; a fallback scope cause
  names the window when no clearable cause applies. Movers adds an explicit
  empty result when every lens has no rows; coverage when the server publishes
  no coverage and the summary is explicitly zero. Panel refreshes pass `clear`
  through so a measure/Follow refresh keeps working Clear buttons.
- `tests/workspace/pulse.test.mjs` — removed the in-spec
  `import('/js/panels/index.js')` + `popstate` workaround, so the spec proves
  the real `/b/pulse` route settles five panels. Added a pure cause/clear check
  and a Chromium spec: a filtered `/b/pulse` renders the river `empty` state
  naming `harness: orca`, and its **Clear filter** button removes the filter
  from the URL and re-renders the river `ready`.
- `tests/url-state.test.mjs` — regression: remove a filter, encode against the
  old search, and assert it is gone while another filter and an unknown key
  survive.
- `docs/plans/20-analytics-reset/reports/9-05c-wiring-fixer.md` — this report.

## Check output

Before (HEAD `ff58a31` source facts):

```
$ git show HEAD:.../web/js/app.js | grep -n "panels/index.js"
(no output)

$ git show HEAD:.../web/contract/url-state.js | sed -n '36,38p'
  for (const [key, value] of prior) {
    if (!RESERVED.has(key) && !PANEL.test(key) && !(key in (state.filters || {})) && !(key in (state.unknown || {}))) out.append(key, value);
  }

$ git show HEAD:.../web/js/panels/river.js | grep -n "emptyState"
      return emptyState([{ kind: 'scope', label: `no observations in window ${scope.win || 'all'}`, clear: null }]);
```

After:

```
$ NODE_OPTIONS=--max-old-space-size=8192 PUBLIC_CANVAS_TEST_MODE=true \
  NODE_PATH=/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules \
  node --test packages/yakka-analytics/tests/url-state.test.mjs
# tests 4  # pass 4  # fail 0

$ ... node --test packages/yakka-analytics/tests/workspace/pulse.test.mjs
# tests 12  # pass 12  # fail 0
  (both Chromium specs ran; the empty-river Clear filter spec passed)

$ ... node --test packages/yakka-analytics/tests/workspace/*.test.mjs \
  packages/yakka-analytics/tests/url-state.test.mjs
# tests 69  # pass 67  # fail 2
  not ok ledger.test.mjs "empty and error follow the frame vocabulary" — clean-console assertion after the intentional legacy 400
  not ok start.test.mjs "workspace Start, routes, deep links, saved boards and Follow" — expects /b/pulse to read "Delivered in Phase 9: Pulse"
```

Both failures are the gates already recorded by 9-05d; the start one is now
reached because gate 1 makes `/b/pulse` a delivered board, as required. No
fixed sleeps, no animation/timing assertions, Chromium only, no `/tmp`, and no
product branch on test mode were added.

## Deviations

- Empty-result handling was added to `pulse-strips`, `movers` and `coverage`,
  which previously had no empty branch. They key on an explicitly all-zero
  summary, no groups in any lens, or no coverage plus a zero summary. A missing
  field remains "not supplied", not zero, and the state vocabulary is unchanged.
- An applied `exclude` is named as a `filter` kind (label `exclude …`) so the
  9-01 frame's existing vocabulary is reused rather than extended.
- `emptyCausesFor` also handles a scope `pick`/`sel` as a selection cause. The
  Pulse board scope does not currently carry either, so no selection cause is
  invented for these panels.

## Gates

- `gate: update tests/workspace/start.test.mjs (outside this fixer's owned paths) so /b/pulse asserts the delivered five-panel board instead of "Delivered in Phase 9: Pulse"; closing the shell-import gate makes the old named-destination assertion stale.`
- `gate: ledger.test.mjs's third Chromium spec calls diagnostics.assertClean() after the intentional legacy 400; Chromium logs a console error for any failed fetch. Allow that single 400 entry as ops/start/follow do, or change the product outside this brief. Recorded already by 9-05d.`

## Commit

Committed to `feat/20-analytics-reset` with a plain-summary title and this
report. No push, merge, deploy, rebase, other branch/worktree or secret touched.
