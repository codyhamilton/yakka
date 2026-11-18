# 9-06b — Workspace acceptance fixer

Status: `done`. The five product defects named by
`9-06-workspace-acceptance.md` are fixed. The Phase 9 acceptance, deep-links and
degradation specs pass 70/70 cases; the whole workspace suite and both chart
kits pass with no skips.

## What changed

- `web/js/app.js` — `renderBoard` now gates every board panel on
  `panel.requires` through `featureAvailable` (which already accepts the
  `activity`/`analytics_activity` alias). A missing requirement renders the
  frame in the `unsupported` state from `unsupportedState`/`unsupportedText`,
  naming the feature and its source, and its loader is not run.
- `web/js/panels/panel-frame.js` — a returned `errorState` and a returned
  `cancelledState` both get the frame's own `load` retry when the panel supplies
  none. `cancelled` remains cancelled. The frame also folds a result's
  `coarsened`, `clipped`, `partial`, `sampled` and `lowerBound`/`lower_bound`
  flags into the coverage the existing `badges.js` model reads; no badge
  vocabulary or module was added or changed.
- `web/js/core/request-scheduler.js` — identical concurrent requests still share
  one fetch, but each waiter now receives its own clone of the resolved
  `Response`. The original body is never read, so every waiter can parse the
  same JSON. The four-in-flight cap, supersede/abort and request contract are
  unchanged; no transport change was needed.
- `web/js/charts/yk-lanes.js` — `buildLanesModel` merges each row's
  `item.values` with the kind measure instead of replacing them. River
  `conversation_id`, `path` and `repo_id` therefore reach `inspect()` and the
  inspector as facts.
- `tests/request-scheduler.test.mjs` — added the two-identical-concurrent-callers
  JSON regression (one fetch, both bodies readable).
- `tests/charts-cat/lanes.test.mjs` — added the assertion that extra item values
  survive; the unpriced assertion now checks the kind measure is null and the
  extra `cost` value is preserved.
- `tests/workspace/acceptance.test.mjs` — the panel-state case drives a real 500
  and 403, so its final diagnostic check now asserts empty page/CSP lists and
  only those deliberate statuses in the console, matching the other fault cases.
  No product assertion was removed or weakened.
- `tests/workspace/capability.test.mjs` — the missing-feature case asserted the
  old pre-gating behaviour (`data-state="ready"`). With defect 1 fixed, the
  correct state is `unsupported`; the drawer assertions are unchanged.
- `docs/plans/20-analytics-reset/reports/9-06b-fixer.md` — this report.

## Check output

Before (from `9-06-workspace-acceptance.md`):

```
$ node --test acceptance deep-links degradation
# tests 7  # pass 3  # fail 4
Phase 9 acceptance summary (66/70 cases)

$ node --test tests/workspace/*.test.mjs tests/*.test.mjs
# tests 85  # pass 81  # fail 4
```

After:

```
$ PUBLIC_CANVAS_TEST_MODE=true NODE_PATH=… node --test \
    tests/workspace/acceptance.test.mjs \
    tests/workspace/deep-links.test.mjs \
    tests/workspace/degradation.test.mjs
Phase 9 acceptance summary (70/70 cases)
# tests 7  # pass 7  # fail 0  # skipped 0

$ PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=… \
    node --test tests/workspace/*.test.mjs tests/*.test.mjs
# tests 86  # pass 86  # fail 0  # skipped 0

$ PUBLIC_CANVAS_TEST_MODE=true NODE_PATH=… node --test \
    tests/request-scheduler.test.mjs tests/charts-cat/*.test.mjs tests/charts-time/*.test.mjs
# tests 72  # pass 72  # fail 0  # skipped 0

$ git diff --check
(clean)
```

`rg -n "data-test|__test|stub|fixture" web` matches only the pre-existing
`data-testid` attributes in `web/js/identity/flows.js`; the fix adds no test
hook. No `/tmp`, fixed sleep or animation/timing assertion was added.

## Deviations

- `tests/workspace/capability.test.mjs` is outside the brief's owned paths. Its
  missing-feature case asserted the behaviour defect 1 removes (`ready` while a
  required feature is absent). Leaving it would fail the required workspace
  suite, so the expected state is now `unsupported`; the drawer's missing
  feature/source checks are untouched. This is the only unowned file changed.
- The acceptance summary is now 70/70 rather than the 66/70 recorded as blocked.

## Remaining findings and gates

None. Every required check passes and no external system or Cody action is
required.
