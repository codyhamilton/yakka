# Handoff — phase2-02 board assembly order, Start tables and shell wiring

Status: done. Branch `feat/30-analytics-operable-chrome`.

## What changed

- `web/js/panels/index.js`, `p10-{trends,cost,compare,quality,tools}.js`, `p11-scatter.js`, `p12-workflow.js`: exact S-screen panel order and G-item default specs; every spec carries its literal `scope.captionKey`; each preset declares its prescribed full-width ids (`pulse-strips`; `rank` for Compare; `river` for Workflow; empty otherwise, so the odd-final rule still applies).
- `web/js/boards/board.js`: `boardSpans(panelIds, fullWidth)` implements the twelve-column half/full map plus the odd-final flow panel; `assembleBoard` returns `fullWidth` and `spans`. `captionKey` is kept on `spec.scope` for the panel unit but removed from the runtime scope the panel receives, so it is not treated as an applied filter cause and never reaches a request.
- `web/js/app.js`: Start now renders a semantic `table.question-paths` (caption, Area/Question/Explanation, fixed group order, disabled text plus reason, scoped links) and a `table.saved-board-list` (Name/Open/Delete/URL summary, name ASC, empty text). Coverage strip removed from Start and board render (function retained for named screens). Compare board mounts a labeled Comparison select before the grid: period (default), off, cohorts (disabled below two valid slots), writing URL `cmp` plus every `pN.scope.cmp` in one `pushScope`. `data-span` set on normal, conflict and missing-feature panels.
- `web/css/workspace.css`: half span 6, `[data-span="12"]` span 12, old `data-chart` full-width rules removed, one-column collapse below 900px, 30px table rows and the specified Question/Saved-board column widths.
- New `tests/operable-chrome/board-order-unit.test.mjs`; `tests/workspace/start.test.mjs` extended with the Start table/geometry assertions.

## Evidence before and after

Before (new tests against the pre-change tree):

```
node --test tests/operable-chrome/board-order-unit.test.mjs tests/workspace/start.test.mjs
SyntaxError: ... board.js does not provide an export named 'boardSpans'
not ok 4 - Start regions, table columns and the two-column board geometry match phase 2
# tests 4  # pass 2  # fail 2
```

After:

```
node --test tests/operable-chrome/board-order-unit.test.mjs tests/workspace/start.test.mjs
# tests 7  # pass 7  # fail 0

node --test tests/operable-chrome/*.test.mjs
# tests 41  # pass 41  # fail 0

node --test tests/trends-quality/*.test.mjs tests/plans-artifacts/rank-preset.test.mjs \
  tests/plans-artifacts/workflow.test.mjs tests/scatter-sessions/*.test.mjs
# tests 114  # pass 113  # fail 1
```

The one failure is `cohort-compare.test.mjs` "a second compare panel issues both cohort requests…" and reproduces on the stashed base (pre-existing, outside owned paths).

## Owned checks

| Check | Result | Evidence |
|---|---|---|
| Board DOM order, all eight presets | pass | `board-order-unit` test 1; Pulse metrics first in `panels/index.js`. |
| Preset G defaults + literal caption keys | pass | `board-order-unit` test 2; every key from `G-metrics` through `G-dayxy` asserted. |
| Twelve-column spans, Pulse metrics first full row, odd final panel full | pass | `board-order-unit` test 3; rendered frames carry `data-span` in Start browser test. |
| `scope.captionKey` never on the wire | pass | `board-order-unit` test 4: spec keeps the key, runtime scope and request params do not. |
| S-start regions, columns, groups, disabled reasons | pass | `start.test` test 3: region order `h1/scope-controls/question-paths/saved-boards`, headers Area/Question/Explanation, five groups, 15 links, no coverage strip, no chart. |
| Saved-board table, name ASC, empty text, save form retained | pass | `start.test` test 3 (`table.saved-board-list`, four headers, `No saved boards yet.`, `.save-board` present). |
| Two 704px columns, 8px gap, 1416px full width at 1440 | pass | `start.test` test 3 measures grid/metrics 1416, pairs 704, gap 8. |
| Compare select period/off/cohorts, cohorts disabled <2, one push writes `cmp` and every `pN.scope.cmp` | pass | `start.test` test 3 (off writes `p1..p5` and no URL `cmp`); `compare.test.mjs` and `cohort-compare.test.mjs` exercise the control. |
| Coverage strip removed from Start/board; counts/Refresh/Advanced retained | pass | Function kept, only named screen calls it; `start.test` asserts absence and region order. |
| Start and shell regression (routes, deep links, saved boards, Follow) | pass | `start.test` tests 1–2; `deep-links.test.mjs` passes. |

Report rubric: `r.done_verifiable` pass (commands and table above); `r.departures_named` pass; `r.unfinished_actionable` pass; `r.problems_plain` pass; `r.nothing_unusable` pass.

## Departures, contradictions and known problems

- No departure from the owned contracts. One implementation detail: `captionKey` initially flowed into `entry.scope` via spec merge and appeared as a phantom empty-state filter cause; `assembleBoard` now strips it from the runtime scope while leaving it on the spec. This keeps the literal selector without inventing a wire field.
- Brief done evidence expects `tests/workspace/acceptance.test.mjs` to pass. It does not, for reasons outside owned paths: (1) pre-existing "a saved board stores its URL" failure where the actual URL includes `tenant=fixture-tenant` (reproduces on stashed base); (2) its `clickMark` helper uses the chart's render-time `clientPlot`, which is stale after the metrics panel above River grows, so the click lands above the mark and the inspector never opens. A direct click at the visible mark opens the inspector; the stale rectangle is in `web/js/charts/svg-base.js`, not owned. (3) The saved-board test still queries `.saved-board-list li`, which conflicts with the required table and is outside owned paths.
- `tests/workspace/pulse.test.mjs` tests 11 and 12 still assert the old `river, pulse-strips, …` DOM order; they fail against the required metrics-first order and are outside owned paths. Its "legacy server" test also fails on the stashed base.
- The `cohort-compare` failure above is pre-existing and unrelated.

## Unfinished work

None in the owned paths. Out-of-owned follow-ups: update `pulse.test.mjs` order expectations and `acceptance.test.mjs` saved-board/click helpers; fix the saved-board URL tenant expectation on base or in its owning unit; refresh `clientPlot` on reflow in `svg-base.js`.
