# Phase 2-04 report — Trends/Cost time-series, rank and treemap panels

Status: done with concerns (two chart-kit limitations are named below; unowned
acceptance tests still assert the superseded wide tables and sort order).

## What changed

- `trend-columns.js`: G-columns caption and defaults (`cost_usd/model/columns`);
  charts now `columns/lines/area` (cumulative and share removed); long table
  Bucket, Group, Value (unit) sorted time asc then group asc; `filterRefusal`
  before and after the read; `mountPanelViews`; exported
  `CUMULATIVE_REFUSAL`/`chooseColumnsSpec` so an old `chart=cumulative|share`
  deep link renders the exact sentence and a Choose columns action that writes
  `chart=columns` without a read.
- `trend-lines.js`: G-lines and G-complines captions; `cost_usd/model/lines`
  default with a Lines/Area P3 choice; `cmp=period` requests both equal windows
  and aligns the previous series by elapsed offset while the table keeps each
  period's real date; long table; cumulative/share refusal; F refusal.
- `trend-multiples.js`: G-multiples caption; fixed `cost_usd/model/lines`; one
  chart per lexical group, time-synced via `scaleGroup`; table Group, Bucket,
  Value; measure/group chooser only; F refusal.
- `rhythm.js`: G-rhythm caption; fixed `hook_events`, `weekday`+`hour_of_day`,
  `bucket=none`; no chooser; full Mon–Sun × 00–23 matrix; table Weekday
  (Mon=1), Hour (0–23), Hook events, weekday/hour asc; F refusal.
- `rank.js`: G-rank, G-toolsrank, G-planrank and G-slope captions selected by
  `scope.captionKey`; rank table Group, Value (unit) sorted value desc/group
  asc; slope table Group, Previous/Current/Change (unit) sorted current
  desc/group asc; fixed Tools and plan configurations with no chooser; plan
  table narrowed to Group, Value (USD) with overlap/lower-bound text kept;
  slope refuses without `cmp=period` and a finite window; F refusal.
- `treemap.js`: G-costmap and G-toolsmap captions (tool category when `tool` is
  not published); parent fixed to harness; cost child model, tools child
  tool/tool_kind; table Parent, Child, Value (unit) sorted value desc then
  identity asc; no Tools chooser; cost/tools refusals retained; F refusal.
- `trends.css`: 160px minimum for every owned chart, rank/rhythm grid, refusal
  and Choose columns button; V3 tokens only.
- Tests: new `tests/operable-chrome/trends-captions-unit.test.mjs` (literal
  captions, table columns, wire defaults, F refusal with zero reads, cumulative
  refusal/choose-columns, slope refusal, plan-rank language);
  `tests/trends-quality/trends.test.mjs` and `cost.test.mjs` updated to the
  long-table/chart-option/sort contract. `rank-preset.test.mjs` needed no change.

## G items

| ID | Result | Evidence |
|---|---|---|
| G-columns | pass | Unit: literal, defaults on the wire (`cost_usd`, `dim=model`, `auto`), columns `Bucket/Group/Value (USD)`; Chromium charts options now `columns,lines,area`. |
| G-lines | pass | Unit: literal and defaults; area alternative offered; long table; Chromium settles. |
| G-multiples | pass | Unit: literal, `['lines']`, Group/Bucket/Value; groups lexical and one chart per group in render path. |
| G-rhythm | pass | Unit: literal, fixed measure/dims/bucket, no chooser, exact table headers; rhythm row mapping test passes. |
| G-rank | pass | Unit: literal, `cost_usd/model/rank`, value-desc/group-asc table; Chromium Cost rank settles. |
| G-costmap | pass | Unit: literal, parent harness/child model, Parent/Child/Value; Chromium rows match the fixture in value-desc order. |
| G-toolsmap | pass | Unit: literal plus tool-category fallback literal, fixed hook/harness/tool, Parent/Child/Value (events); cost-by-tool guard retained. |
| G-toolsrank | pass | Unit: literal, fixed `hook_events/tool/rank`, no chooser. |
| G-planrank | pass | Unit: literal, plan defaults on `/entities`, Group/Value (USD), overlap/lower-bound text; Workflow browser test passes. |
| G-slope | pass | Unit: literal, exact four-column table, finite-window/`cmp=period` refusal with zero reads; Compare browser test passes. |
| G-complines | pass | Unit: literal, previous aligned by offset with real dates in the table; Compare browser test passes. |

## P controls

- **P1** pass (trend columns/lines/multiples/rank/treemap measure), **P2** pass
  (group/child; Tools fixed), **P3** pass (columns↔lines↔area; rank↔slope).
  **P4–P7** n/a. **P8** pass (one local chart/table toggle per panel, details
  retained), **P9** pass (shared inspector/selection through `yk-chart`/
  `yk-bars`/`yk-treemap`/`yk-matrix`), **P10** pass (eleven literals via
  `captionFor` keyed on `scope.captionKey`; no raw identifier in a caption).

## T and S

| ID | Result | Evidence |
|---|---|---|
| T1–T5 | pass | Shared frame keeps header/caption/state; tables use `pulse-table` 30px rows and exact columns; refusal keeps the caption and leaves no marks; empty/error/unsupported states unchanged. |
| S-trends | pass | Preset order unchanged; Trends browser test settles five panels, chooser writes `p1`, zoom clears `win/sel`. |
| S-cost | pass | Cost browser test settles six panels, treemap/rank exact values, reparenting fixed to harness, split change on trend; distribution/family panels untouched. |

## Commands

Before: the three named suites had 22 pass / 0 fail. After:

- `node --test tests/operable-chrome/trends-captions-unit.test.mjs tests/trends-quality/trends.test.mjs tests/trends-quality/cost.test.mjs tests/plans-artifacts/rank-preset.test.mjs` → **29 pass, 0 fail**.
- `node --test tests/trends-quality/compare.test.mjs` → 8 pass.
- `NODE_OPTIONS=--max-old-space-size=8192` and `PUBLIC_CANVAS_TEST_MODE=true` used for Chromium.

## Deviations and unowned failures

- **Shared Y domain for G-multiples is not expressible** with the current
  `yk-chart` seam (`charts/scales.js` accepts only auto Y or the column zero
  pin). This unit may not edit `charts/*`, so the small multiples share a time
  scale via `scaleGroup` and the same unit, but not a forced common Y maximum.
  Named, not silent.
- **Previous-period dashed line for G-complines is not expressible**:
  `yk-chart` has no dashed-series option and `charts/*` is out of bounds. The
  previous series is drawn solid with its period in the legend/tooltip.
- `treemap.js` ignores a stale `scope.parent` override and always uses harness,
  per the G items; the old Cost browser assertion for a `session_repo` parent
  was updated to assert the fixed parent instead.
- Plan rank's table is the literal Group/Value (USD); the former diagnostic
  columns moved into the overlap/lower-bound notes and the inspector.
- `tests/workspace/acceptance.test.mjs` → 2 pass / 3 fail; failures are the
  saved-board `tenant=fixture-tenant` URL assertion (outside this unit), a Pulse
  click timeout, and the summary line that reports the first failure. Not
  edited.
- Unowned `tests/trends-quality/acceptance.test.mjs`, `tools.test.mjs` and
  `cohort-compare.test.mjs` still assert the superseded wide tables, fixture
  row order, or distribution panel counts; they are not in this unit's test
  list and were not edited. No failure points at a caption, default or refusal
  introduced here.
