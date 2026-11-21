# Execution report: phase2-05 — Distribution and Compare panels

Unit: U5. Branch: `feat/30-analytics-operable-chrome`. Commit: this unit's commit
(plain-summary title, no `Yakka-Phase` trailer). Status: **over budget**.

## What changed

- `dist-ranges.js`, `dist-hist.js`, `dist-ecdf.js`: the six literal G captions are
  registered and selected by `spec.scope.captionKey`; the literal is used only
  while the selected measure is `cost_usd`, the resolved grain/group match the G
  item and the comparison mode matches (single vs `cmp=period`), otherwise the
  P10 template is used.
- `distributionSpec` resolves grain/group from `scope.grain`/`scope.dim`, then
  the top-level `spec.grain`/`spec.split`, then the per-item default. P4 renders
  Measure, Grain and Group by in registry order, intersected with `/schema`, keeps
  an incompatible selected group visible and disabled with an explanation, and
  refuses an invalid call+session lens instead of fetching.
- Tables use the exact G columns and group-ascending / current-before-previous /
  bin-edge-ascending order. `unpriced` is stated once per group/period. Table and
  chart mount through `mountPanelViews`; `yk-ranges`/`yk-chart` remain the chart
  elements.
- F2 and plan/event/tool/source are checked before the read and again against
  `ignored_filters`; the panel returns no marks and the exact
  `This chart cannot apply {label}. Change the filters to view it.`
- Compare refuses all history with `Choose a finite period to compare periods.`
  and zero reads, and appends
  `An event exactly at the shared boundary belongs to both periods.` to the
  displayed basis and result `basis` for period compare.
- New `tests/operable-chrome/distribution-captions-unit.test.mjs`; updated
  `tests/trends-quality/compare.test.mjs` for the new `boxTableRows` shape and
  `tests/trends-quality/cohort-compare.test.mjs` for scheduler request dedupe.

## Checks

| ID | Result | Evidence |
|---|---|---|
| G-ranges | pass | Literal caption, `conversation/session_repo/cost_usd` defaults on the wire, box/whisker with p95, exact 10-column table, group asc/current first. New unit + `/b/cost` browser. |
| G-hist | pass | Literal caption, `call/harness/cost_usd`, fixed returned bins, groups as separate small multiples, exact 6-column table, bin edge asc. New unit + `/b/cost` browser. |
| G-ecdf | pass | Literal caption, `conversation/model/cost_usd`, cumulative bin n / total, percent 0–100, exact 5-column table, edge asc. New unit + `/b/cost` browser. |
| G-compranges | pass | Literal caption, current then previous rows and table, shared finite-window refusal, shared-boundary note. New unit + `/b/compare` browser. |
| G-comphist | pass (deviation) | Literal caption, both periods against the same fixed bins, exact table, current first. Grouped bars are rendered as paired small multiples (see Deviations). |
| G-compecdf | pass | Literal caption, both periods as two series, exact table, current first. New unit + `/b/compare` browser. |
| P4 | pass | Grain labels `Model call`/`Session`; group intersection `model, harness, session_model, session_repo`; measure intersection `DIST_MEASURES`; defaults per item and Compare `call/model`; incompatible group disabled with explanation; invalid call+session refused before read. Unit cases + chooser render. |
| P8 | pass | Show table / Show chart local toggle via `mountPanelViews`; Data details remains closed by default in the shared frame; no query change on toggle. Browser `/b/cost` and `/b/compare`. |
| P9 | pass (preserved) | Chart elements and `wireChartScope` on ECDF unchanged; no chart or inspector code was edited. Existing chart interaction tests still pass. |
| F2 | pass | `kind=brief`, plus plan/event/tool/source, return `unsupported` with the exact F sentence and zero distribution reads for all three panels. Unit loop; browser analytics delta was 2 schema reads only. |
| T1 | pass (shared) | Header kept; the shared frame renders the one-row loading status. No panel-local table markup replaced it. |
| T2 | pass (shared) | Empty distributions return the shared `emptyState`; table header plus the shared empty row/actions. |
| T3 | pass (shared) | 400/other errors map to `unsupportedState`/`errorState` with Retry in the shared frame; no raw body shown. |
| T4 | n/a | Distribution responses are not paginated; no paging control is offered. |
| T5 | pass (shared) | No marks before valid data; caption stays visible above the shared state/table; lower-bound/unpriced and omitted-group facts are text below the chart. |
| S-cost (distribution) | pass | DOM order `dist-ranges`, `dist-hist`, `dist-ecdf` after columns/rank/costmap; two-column layout; captions above charts; every chart >=160px; every table row 30px. |
| S-compare (distribution) | pass | DOM order `dist-ranges`, `dist-hist`, `dist-ecdf`, then lines, slope full width; two equal columns; captions above charts; chart minimum and 30px rows measured. |
| V3 | pass | Charts use the existing `yk-*` chart surface/tokens; no white surface, gradient, shadow or animation was added. |

## Evidence

```
cd packages/yakka-analytics
node --test tests/operable-chrome/distribution-captions-unit.test.mjs \
  tests/trends-quality/compare.test.mjs \
  tests/trends-quality/cohort-compare.test.mjs
# 25 pass, 0 fail

node --test tests/operable-chrome/board-order-unit.test.mjs
# 4 pass, 0 fail (U2 order/spec/span contracts unaffected)

node --test tests/trends-quality/cost.test.mjs
# 7 pass, 1 fail: "cost settles six panels..." asserts the superseded
# distribution table shape (see Known problems)

node --test tests/trends-quality/acceptance.test.mjs
# 3 pass, 3 fail: tests 1 and 6 already assert U4 trend/rank table shapes;
# test 5 also asserts the old histogram column index 3
```

Browser evidence at 1440x900, `PUBLIC_CANVAS_TEST_MODE=true`, diagnostics clean:

- `/b/cost?win=30d`: panel order as above; captions exactly the six literals on
  the matching routes; chart heights 644–866px; table rows 30px (ranges 3,
  hist 14, ECDF 14); headers exactly the G lists.
- `/b/compare?win=30d`: order `ranges, hist, ecdf, trend-lines, rank`; captions
  exactly G-compranges/G-comphist/G-compecdf; chart heights 763–866px; table rows
  30px (ranges 4, hist 28, ECDF 14).
- `/b/cost?win=30d&kind=brief`: all three distribution panels `unsupported`, the
  exact F sentence, no marks; analytics delta 2 (schema/summary only, no
  distribution read).

## Deviations

- **G-comphist grouped bars.** The contract asks for grouped current/previous
  bars; `yk-ranges` histogram is single-series and `web/js/charts/*` is outside
  the owned paths. Implemented as one small multiple per group+period with the
  same fixed bins, and the table pairs both periods per bin. The caption and
  table compare heights/values correctly; the visual grouping is the gap.
- **Previous dashed/outlined series.** G-compranges/G-compecdf ask for a dashed
  or outlined previous series. `yk-ranges` and `yk-chart` expose no per-series
  dash style from a panel, and chart code was not edited. Previous rows/series
  are labelled and ordered; visual dashing/outline is not applied. This matches
  the U4 concern for G-complines.
- **Scheduler dedupe.** Compare's three distribution panels issue identical
  `call/model` reads in the same scope; the shared scheduler collapses them to
  two requests (one per cohort side). `cohort-compare.test.mjs` was updated from
  `>=4` to `>=2` distribution requests and still asserts both A and B.
- **Over budget.** ~790 changed lines including the new test, against the ~450
  budget. Continued because the six captions, P4 and exact tables are one
  coherent unit; no handoff blocker.

## Known problems / follow-ups

- `tests/trends-quality/cost.test.mjs` (owned by phase2-04) fails one test because
  it asserts the old distribution table values/shape. It must be updated to the
  G columns; this unit did not edit it.
- `tests/trends-quality/acceptance.test.mjs` is unowned and still fails tests 1
  and 6 on U4's long-format trend/rank tables; its cost-honesty test also reads
  `dist-hist` row index 3 as `Count`, which is now `To (USD)`. The needed update is
  to read the Count column by index 4 and the paired current/previous rows.
- Codebase-wide `distribution` reads must keep the fixed bin/edge shape; the new
  unit asserts the six captions, defaults, columns/order, finite-window refusal,
  boundary note and F2 refusal, but does not exercise a live P4 change.

## Contradictions

- None between the brief and the contracts. The brief's G-hist per-item wording
  (separate small multiples) and DESIGN's G-comphist wording (grouped bars) are
  reconciled as small multiples per group with paired period data, limited by the
  out-of-scope chart element.
