# Execution report: phase2-06 — Quality score panels

Unit: U6. Branch: `feat/30-analytics-operable-chrome`. Commit: this unit's commit
(plain-summary title, no `Yakka-Phase` trailer). Status: **over budget**
(~1,037 diff lines with the new test against the ~500 budget; the four panels,
shared score helpers and exact copies stayed one coherent unit).

## What changed

- The four panels now register the literal G captions and select them by
  `spec.scope.captionKey`; only `design`→kind and `clarity`→check are substituted.
  Non-G keys, repeated multi-kind scopes and unsupported filters use the P10
  template, so the caption never claims a scope the request did not use.
- `score-ranges.js` owns the shared score helpers: `SCORE_UNIT`
  (`normalized score (0–1)`), `BASELINE_LABEL`, `MULTI_KIND_REFUSAL`,
  catalogue/default-check/scorer resolution (first lexical scorer with a positive
  baseline, else first lexical, else unsupported), content-baseline reads,
  `baselineBand`, the exact 11-column table, content-version population copy and
  `renderScoreControls` (Check, Scorer, and Group by for ranges/trend only).
- `score-trend.js` derives day ≤90d, week ≤730d, else month; all-history uses the
  schema retained span. The table is long by bucket/group with Count and
  quartiles, and omits a group the server did not report in a bucket. Median is
  marked solid and quartiles dashed in the series metadata.
- `score-strips.js` keeps one dot per latest file identity `(repo_id, path)`,
  never per content hash; table is Repository, Path, Kind, Score, Scorer,
  Observed in identity order, with the artifact-reader destination retained.
- `band-mix.js` derives bands from `band:{check}`, shows only present bands in
  published order, uses human labels (`baseline unavailable`, not snake_case),
  and carries the five fixed tokens on its series metadata.
- All four removed inline chart/table markup for `mountPanelViews` and the old
  kind/scorer/one-item chooser rows for the single P5 control row. `quality.css`
  changed only the chart minimum from 200px to 160px.
- New `tests/operable-chrome/quality-captions-unit.test.mjs`; rewrote
  `tests/trends-quality/quality.test.mjs` (the old file asserted the superseded
  chooser, copy and table shapes).

## Checks

| ID | Result | Evidence |
|---|---|---|
| G-scores | pass | Literal caption; clarity/harness defaults; content-version population and copy; all-history baseline band from the selected scorer; exact 11 columns, group asc; `—` for missing and `0` only for a real zero. Unit + `/b/quality` browser. |
| G-scoretrend | pass (deviation) | Literal caption; `session_model` lines; day/week/month chosen from window, retained span for all-history; exact 6-column long table, time/group asc. Dashed outer lines are metadata only (see Deviations). |
| G-strips | pass | Literal caption; fixed kind grouping and `score:clarity`; one dot per latest file, duplicate identity collapsed; exact 6-column table, identity asc; file population separately stated. |
| G-bands | pass (deviation) | Literal caption; `band:{check}` from P5; only present bands; human labels and published order; exact 3-column table, kind asc then band order; five fixed tokens on series metadata. Horizontal stacking is not supported by `yk-bars` (see Deviations). |
| P2 | pass | Shared window/repo/kind scope via `requestParams`; bare URLs render Design defaults. |
| P5 | pass | Check then Scorer (then Group by for ranges/trend) in catalogue order; defaults clarity/first lexical scorer with a positive baseline; changes push one `pN` and reload only that panel; no extra selectors. |
| P8 | pass | Show chart / Show table via `mountPanelViews`, default chart, no query change. |
| P9 | pass | Chart elements and `wireChartScope` unchanged; no chart/inspector code edited. |
| T1–T5 | pass (shared) | Frame header/loading kept; empty → shared empty state; errors → unsupported/error with Retry; no paging (not paginated); no marks before data, caption above the state, basis/notes below. |
| F1 | pass | File identity is `(repo_id, path)` and each dot opens the exact artifact reader; content hashes are counted once in ranges/trend. |
| F2 | n/a | Distribution-only check; not a score route. |
| F3 | pass | Active unsupported filters return the exact F sentence with no marks before and after the read; score kind is the global kind else Design, and Design is named in the title/caption. |
| F4 | pass | Baselines are not date-filtered; the exact all-history baseline label is used; schema/baseline metadata reads carry the tenant. |
| F5 | pass | Artifact destinations keep exact identity; score tables use the scoped window. |
| F6 | n/a | Operations footprint is not a score route. |
| F7 | n/a | Account/lifecycle is not a score route. |
| S-quality | pass | DOM order ranges, trend, strips, bands; two equal columns per row; literal captions above the chart; every chart ≥160px; every row 30±1px at 1440×900. |
| V3 | pass | Existing `yk-*` surface/tokens; no white surface, gradient, shadow or animation added. |

## Evidence

Before: old `tests/trends-quality/quality.test.mjs` — 7 pass, 0 fail (it
enshrined the superseded chooser/table/copy). The new unit first failed one case
(a group row with no count for that bucket); `scoreTrendTableRows` now omits a
group the server did not report, then:

```
cd packages/yakka-analytics
NODE_OPTIONS=--max-old-space-size=8192 PUBLIC_CANVAS_TEST_MODE=true \
  node --test tests/operable-chrome/quality-captions-unit.test.mjs \
            tests/trends-quality/quality.test.mjs
# 14 tests, 14 pass, 0 fail

NODE_OPTIONS=--max-old-space-size=8192 node --test tests/operable-chrome/*-unit.test.mjs
# 74 tests, 74 pass, 0 fail
```

Browser evidence at 1440×900 with `PUBLIC_CANVAS_TEST_MODE=true`, diagnostics
clean: `/b/quality?win=30d` renders the four panels in the required 2×2 order;
captions are the four literals; control labels are Check/Scorer/Group by and
Check/Scorer; charts ≥160px; every table row 30±1px; the all-history baseline
band is present; changing Check to `structure` updates plot, baseline and caption;
selecting the `n=0` scorer labels `baseline unavailable` and removes the band.

## Deviations

- **Dashed quartiles.** `score-trend` marks quartile series `dash` in its spec, but
  panels cannot set line dash on `yk-chart` and `web/js/charts/*` is outside the
  owned paths. Median/quartile values and order are correct; the dash is visual
  only and is not applied.
- **Band status colours.** The five fixed tokens are attached to the band series
  (and asserted by the browser test), but `svg-base` colours series through the
  colour registry rather than a panel-supplied `cssVar`; `low`/`mid`/`high`/
  `baseline_unavailable` therefore fall back to categorical slots. `unscored`
  already maps to the fixed token. Applying the exact status fills needs a chart
  change outside this brief.
- **Stacked horizontal bars.** `yk-bars` only stacks vertically; horizontal bars
  are limited to ranked/lollipop. Bands render as the chart kit's stacked form
  with the correct series/table contract. This is the same chart limitation the
  old panel had; chart code was not edited.
- **Over budget.** ~1,037 changed lines including the rewritten test.

## Known problems / follow-ups

- `tests/trends-quality/acceptance.test.mjs` is unowned and still asserts the old
  control indices (`p1` index 2/3 for scorer/split), `distinct content hashes`,
  `all-time scorer baseline` and `baseline_unavailable`. Those assertions must be
  updated to the P5 row, content-version copy and human band label.
- `tests/plans-artifacts/acceptance.test.mjs` inspects a synthetic `score-strips`
  identity; it should still open the reader, but the strip now collapses
  duplicate identities and sorts by repo/path.

## Contradictions

- None between the brief and the cited contracts. The mockup shows all document
  kinds in strips/bands while the brief's "global kind else Design" fixes one
  kind; the written contract wins, so the default is Design and a selected global
  kind is refused only when repeated. The mockup's 112px plots also lose to the
  binding 160px minimum, as the brief states.
