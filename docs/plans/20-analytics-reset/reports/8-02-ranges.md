# 8-02 — Ranges and distributions

Status: **over budget** (deliverable complete; every done-evidence check passes).

## Budget

About 1,116 changed lines against the brief's ~700, and more than the ten-file
reading budget: CONTRACTS.md 17.5/17.7, DESIGN.md, `svg-base.js`, `yk-bars.js`,
the six helper modules, the gallery harness/fixture/bars page and the bars and
browser specs. The overrun is the element's four modes plus a pure/browser spec
pair. Reported `over budget` as the brief asks. `IMPLEMENTATION.md` was not
written because the user restricted work to this brief's owned paths.

## What changed

- `web/js/charts/yk-ranges.js` — new `<yk-ranges>` on the 8-01
  `SvgChartElement`; imports the base, never edits it. Exports
  `RANGE_TYPES`, `SUMMARY_FIELDS`, `normaliseRangesType`, `percentile`,
  `fiveNumberSummary`, `sampleLabel`, `binLabel`, `aggregateDots` and
  `buildRangesModel` plus `YkRanges`/`defineRanges`.
  - `box`: derives min/q1/median/q3/max/p95 from `values`, draws whiskers and
    caps, the box, median, a labelled p95 shape and an optional
    `spec.baseline = { from, to, label }` band named in the frame behind the
    marks. `n` and `unpriced` appear in the table and tooltip.
  - `histogram`: follows `spec.bins` in order, zero-fills a bin missing from
    data, labels each range, zero-based count axis.
  - `strip`: one mark per observation, deterministic lanes, shared entity keys,
    sampled marks get a dashed ring and a `sample of N of M` label/aria-label.
  - `dots`: one aggregated dot per key (`aggregateDots` sums duplicate keys),
    zero-based measure axis, fixed dot size.
  - Never emits `brush`; the base's default `supportsBrush()` returns false, so
    `inspect().brush` is `null`.
- `tests/gallery/{ranges.html,ranges.js,fixture-ranges.js}` — deterministic,
  listed values only, shared keys `model:atlas`, `harness:orca`, `repo:core`,
  `kind:test`; every mode plus empty/unsupported; external modules only; settles
  every element then sets `data-idle`.
- `tests/charts-cat/ranges.test.mjs` — five pure checks (summary/p95, baseline
  exclusion, fixed bins/zero-fill, strip sampling, dot aggregation) and one
  Chromium spec driving real mouse, keyboard, touch and both themes.
- `docs/plans/20-analytics-reset/reports/8-02-ranges.md` — this report.

## Check output

Before (no spec, fixture or element existed):

```
$ NODE_PATH=... node --test packages/yakka-analytics/tests/charts-cat/ranges.test.mjs
Could not find 'packages/yakka-analytics/tests/charts-cat/ranges.test.mjs'
```

After:

```
$ NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=... PUBLIC_CANVAS_TEST_MODE=true \
  node --test --test-concurrency=3 packages/yakka-analytics/tests/charts-cat/ranges.test.mjs
# tests 6
# pass 6
# fail 0

$ NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=... PUBLIC_CANVAS_TEST_MODE=true \
  node --test --test-concurrency=3 packages/yakka-analytics/tests/charts-cat/*.test.mjs
# tests 25
# pass 25
# fail 0
```

Chromium ran (playwright-core 1.63.0, Chromium 1243); no browser gate. It proves:
ready/empty/unsupported; box marks and table match the fixture's six summaries,
`n` and `unpriced`; baseline band is drawn and named while appearing as no mark
and in no `inspect().marks`; histogram fixed boundaries, counts and zero-based
`yScale.min`; strip sampled flags and `sample of 6 of 24` labels; dots aggregate
and match the table; hover/focus highlight and tooltip key; click and Enter
inspect; Space, Shift-click and the row checkbox include; `x` and Alt-click
exclude; `o`, `f`, `c` then `b`, Esc intents; a real touch tap at a ≥44 px
target; both themes keep the slot/pattern while the token colour changes; no
animation; no console/page/CSP error; at most four analytics requests in flight;
no `brush` event and `brush: null` on all four modes.

## Deviations and interpretations

- `spec.series` declares the measured value; the box model derives the six
  summary series (plus `unpriced`) for tooltip/legend and adds `n`/`unpriced`
  table columns. The base couples tooltip and legend to one series list, so a
  box renders a legend of its summary statistics whose swatches are summary
  slots, not the entity slots used by the boxes. Functionally sound but a
  shared-base limitation; see known problems.
- Histogram rows are aligned to `spec.bins`, not to data order; a data row whose
  bin is not declared is ignored (the brief makes `spec.bins` authoritative).
- Strip reuses the shared entity key for each observation of that entity, so
  selecting a key selects all its observations; `group` names the lens group.
- Dots aggregate duplicate keys by summing the measure and `n`; this is the
  "aggregated one dot per category" behaviour.
- Baseline uses existing `--yk-chart-grid` with `fill-opacity` and
  `pointer-events: none`. No CSS file was edited (not an owned path).
- The `p95` text label is emitted at plot level after the marks, not inside the
  mark group. Inside the group Chromium skipped the mark's own hit rect at its
  centre once the label was present; moving it out (still a visible label) fixed
  real pointer hits. This is a browser hit-testing workaround, not a contract
  change.

## Contradictions

- The brief's budget clause says to write a handoff in `IMPLEMENTATION.md` when
  over budget, but `IMPLEMENTATION.md` is outside the owned paths the same
  brief and the user restrict work to. The handoff is this report instead.
- No contradiction found between the brief and CONTRACTS.md 17.5/17.7 or
  DESIGN.md.

## Unfinished / known problems

- The box legend lists summary statistics with summary colours rather than
  entity colours; fixing it needs a base seam that separates tooltip series from
  legend series (not edited here).
- The over-budget clause could not be followed literally without touching
  `IMPLEMENTATION.md`; recorded above.
- Browser evidence needs playwright-core under the stated `NODE_PATH` and the
  Chromium 1243 cache; the spec skips with the named reason when absent. Neither
  was installed or added.
- No other unfinished work in the owned paths. Sibling 8-03/8-04 commits landed
  on the shared worktree during this run; none of their files were touched.
