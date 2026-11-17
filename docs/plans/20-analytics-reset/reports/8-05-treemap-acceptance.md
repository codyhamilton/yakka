# 8-05 — Treemap and gallery acceptance

Status: **done with concerns**. All done evidence passes on the current tree
(HEAD `3246525`). One known limitation remains outside this unit's owned paths:
the box legend colour limitation from 8-02.

## What changed

- `packages/yakka-analytics/web/js/charts/yk-treemap.js` — `<yk-treemap>` plus
  pure `TREEMAP_LABEL_MIN`, `squarify`, `layoutTreemap`, `buildTreemapModel`,
  `defineTreemap`; squarified two-level layout, area proportional to the
  measure, parent colouring through the registry, labelled `(other)` tail,
  parent legend, shared table/tooltip/selection/keyboard, `brush: null`,
  `window: null`. The table row keeps a local keydown guard for the same keys
  the shared table now handles.
- `packages/yakka-analytics/tests/gallery/{treemap.html,treemap.js,fixture-treemap.js}`
  — deterministic two-lens fixture (`repo` then `model`, fixed neutrals, two
  undeclared tail parents), composition/empty/unsupported elements, event log,
  `data-idle`. No timers or sleeps.
- `packages/yakka-analytics/tests/gallery/{index.html,index.js}` — Phase 8
  `bars`/`ranges`/`matrix`/`lanes`/`treemap` links plus the four Phase 7 links,
  theme/case/fixture outputs. Index settles at once.
- `packages/yakka-analytics/tests/charts-cat/{treemap,acceptance}.test.mjs` —
  treemap pure + Chromium proof; phase acceptance across the index and all five
  pages.

No product module outside `yk-treemap.js` was edited. No dependency, route,
grain, join, gesture or sample data was added.

## Check output before and after

The prior attempt's failing baseline (unchanged): `treemap.test.mjs` 3 pass /
2 fail; `acceptance.test.mjs` 6 pass / 2 fail, with `matrix-calendar` the only
failing detail; `tests/charts-cat/*.test.mjs` 36 pass / 2 fail.

Current tree, after the orchestrator's `3246525` fixes:

- `NODE_PATH=… node --test tests/charts-cat/treemap.test.mjs` → **5/5 pass**.
- `NODE_PATH=… node --test tests/charts-cat/acceptance.test.mjs` → **8/8 pass**
  (index + bars + ranges + matrix + lanes + treemap + palette).
- `NODE_PATH=… node --test tests/charts-cat/*.test.mjs` → **38/38 pass**.
- `node --test tests/*.test.mjs` → **12/12 pass**.
- `git diff --check` → clean.
- Treemap area error `2.77e-17`, zero overlapping pairs, minimum cell about
  `81.7 px`.

All runs used `NODE_OPTIONS=--max-old-space-size=8192
PUBLIC_CANVAS_TEST_MODE=true` and the stated `NODE_PATH`. No `/tmp`, no fixed
sleep, no animation, no inline `style=` attribute, and no test branch in
product code.

## Acceptance checklist

- Index links five Phase 8 cases plus four Phase 7 cases, theme/case/fixture
  outputs, idle — **pass**.
- Per page/mode table and `inspect()` values, `data-state`, `data-chart`, plot,
  `xToPx`/`yToPx` — **pass** (matrix calendar now included).
- Real-mark inspect; Space/checkbox/Shift-click selection; Alt-click/`x`
  exclusion; legend toggle/focus — **pass** on every page with the applicable
  control.
- Accessible table keyboard (ArrowUp/Down, Space, Enter) — **pass on the
  treemap**; the shared `table.js` guard fixed the bars/ranges Space
  double-toggle.
- Same entity `cssVar`/`shape`/`pattern` across bars, ranges, matrix, lanes
  (`kind:test` series) and treemap parent groups; legend toggle leaves a
  survivor unchanged — **pass**.
- Six fixed neutrals distinct by `cssVar`/`shape`/`pattern`/`label` — **pass**.
- `paletteReport()` has no failures in both themes; `fixedNeutralDistinctness()`
  true; theme switch keeps the entity slot and changes the token value —
  **pass**.
- Keyboard/touch without hover; targets at least 44 px; no animation/transition
  — **pass** (sub-pixel lane target rounds to 44).
- No console/page/CSP error; at most four analytics requests in flight —
  **pass**.

## Contradictions resolved outside this unit

1. **Matrix calendar table and `inspect()` values were empty.** Fixed in
   `3246525` by reading `cell.data.value/n/coverage` after `calendarLayout()`
   rebuilds calendar cells. The acceptance check was not weakened.
2. **Bars/ranges table Space was a no-op.** Fixed in `3246525`: `table.js`
   stops propagation for Space/Enter/ArrowUp/ArrowDown before the base root
   handler, so row and root no longer both toggle. `yk-treemap.js` keeps its
   own local guard; that is now redundant but harmless and within its owned
   path.

## Remaining known problems

- **Box legend colour limitation (8-02, outside owned paths).** `yk-ranges`
  box derives six summary series, so `ranges-box` lists summary statistics
  (`min`, `q1`, `median`, `q3`, `max`, `p95`) with summary colours instead of
  entity colours. Fixing it needs a shared-base seam separating tooltip series
  from legend series. Acceptance exercises the legend with the summary keys and
  still proves toggle/focus and a stable survivor; it does not claim the box
  legend is entity-coloured.
- The uncommitted `IMPLEMENTATION.md` handoff written by the prior attempt was
  left untouched because it is outside this brief's owned paths; the plan-level
  outcome record is the orchestrator's file to commit.

## Deviations and report contradictions

- Ran with the requested `NODE_OPTIONS` and `PUBLIC_CANVAS_TEST_MODE`, beyond
  the literal command lines in the brief.
- The brief's budget clause says to write an `IMPLEMENTATION.md` handoff when
  over budget, but that file is outside the owned paths the same brief
  restricts. The prior attempt wrote there anyway; this run records the
  handoff here and leaves that file uncommitted.
- No contradiction between the brief and CONTRACTS.md 17.5/17.7 or DESIGN.md
  Phase 8.
