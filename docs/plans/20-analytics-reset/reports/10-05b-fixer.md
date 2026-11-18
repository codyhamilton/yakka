# 10-05b — Fixer: cohort scope retention and two-sided cohort compare

Status: done with concerns (the two 10-05 gaps are closed; one pre-existing
workspace acceptance failure and one pre-existing chart-render race remain
outside this unit).

## What changed

- `core/view-spec.js`
  - `cleanPanelScope` now preserves `scope.cohorts` as a `ca`–`cd` object of
    cleaned strings, so `effectiveScope` carries cohort state to every panel.
  - `effectiveScope` lets an explicit board `cmp` (a URL compare mode) beat a
    preset's default `cmp`; without a board `cmp` the panel/preset default still
    wins. This makes `/b/compare?cmp=cohorts` compare cohorts while
    `/b/compare?cmp=period` and `/b/compare` stay period comparisons.
- `panels/p10-shared.js`
  - Removed the `location.search` fallback from `scopeWithCohorts`; the request
    seam now reads cohorts only from the panel scope. `cohortParams`,
    `comparisonPlan` and `requestParams` are unchanged otherwise.
- `panels/dist-hist.js`, `panels/dist-ecdf.js`
  - Loaders use the shared `comparisonPlan`. Under `cmp=cohorts` they issue A and
    B (or A and no-cohort "all in scope") distribution requests, render both
    labelled populations, and print `comparisonSummary` with typed populations,
    returned/eligible counts, coverage and per-side unpriced counts. The split
    lens renders one `data-split` group per split value, with a chart column per
    cohort. Period/single-cohort rendering keeps its previous shape and tables.
- `panels/trend-lines.js`
  - `cmp=cohorts` issues two `/query` requests (A/B or A/all) and renders one
    `data-split` small multiple per split value, each with a cohort-A and
    cohort-B series; `comparisonSummary` prints both populations. Period compare
    and single mode keep the existing overlay/table behaviour.
- `panels/rank.js`
  - `cmp=cohorts` issues two requests and renders one `data-split` slope per
    split value (A against B), with both populations summarised. Period compare
    keeps the previous/current slope; single mode keeps ranked bars.
- `panels/dist-ranges.js`
  - Cohort compare now renders one `data-split` range chart per split value with
    one box row per cohort; the basis and note still name both populations and
    per-side unpriced counts. Period/single mode is unchanged.
- `panels/trend-columns.js`
  - Added an `await paintedChart.whenSettled()` before the loader returns so
    `data-idle` means the chart has rendered. This stabilises the existing Cost
    assertion that inspects a chart immediately after settling; no chart, data
    or table behaviour changed.
- `tests/trends-quality/cohort-compare.test.mjs`
  - Added a pure test that `effectiveScope` retains `ca`/`cb`, that the board
    compare mode wins over a preset default, that `requestParams` builds
    `cohort=` from that scope, and that a decoy `globalThis.location` is never
    read.
  - Added a browser test on `/b/compare?cmp=cohorts`: a second panel
    (`dist-hist`) issues both cohort-labelled requests, renders Cohort A and B
    with the typed `call in scope` population, and every compare panel renders
    more than one `[data-split]` small-multiple group.

## Evidence

Before (from the 10-05 report; this unit's named checks did not exist):

```
$ node --test tests/trends-quality/cohort-compare.test.mjs
# tests 9
# pass 9
# fail 0

$ node --test --test-concurrency=1 tests/trends-quality/*.test.mjs
# tests 46
# pass 46
# fail 0
```

After:

```
$ NODE_PATH=… PUBLIC_CANVAS_TEST_MODE=true node --test tests/trends-quality/cohort-compare.test.mjs
# tests 11
# pass 11
# fail 0
# skipped 0

$ NODE_PATH=… PUBLIC_CANVAS_TEST_MODE=true node --test --test-concurrency=1 tests/trends-quality/*.test.mjs
# tests 48
# pass 48
# fail 0
# skipped 0
```

Workspace suite (`tests/workspace/*.test.mjs`, per-file, `--test-concurrency=1`):

```
acceptance   1 fail (pre-existing)         capability  2/2 pass
deep-links   1/1 pass                      degradation 1/1 pass
engine       9/9 pass                      follow-ui   1/1 pass
inspector    4/4 pass                      ledger     11/11 ok (file exits 1, no failed subtest)
ops         14/14 pass                     pulse      12/12 pass
start        2/2 pass                      tray        7/7 pass
```

The whole glob stops after the failing `acceptance.test.mjs`; running the rest
per file gives the counts above. The one failure is pre-existing and unrelated:
`acceptance.test.mjs` still expects `/b/cost` to name “Delivered in Phase 10”
though 10-03/10-04 already delivered it. Verified by stashing this unit's web
changes and rerunning `acceptance.test.mjs`: it fails identically on the tip
commit. `ledger.test.mjs` exits 1 after all 11 subtests pass; that exit quirk is
also present without this change.

`git diff --check` is clean.

## Deviations

1. **`trend-columns.js` settlement wait.** Owned file, no required fix named it,
   but the existing Cost spec races the chart render after `data-idle`. The wait
   is a no-op for correctness and removes the race (compare+cost was 3/3 green
   after it).
2. **Board `cmp` precedence.** To make `/b/compare?cmp=cohorts` possible while
   `COMPARE_SPECS` (outside this unit's paths) hard-codes `scope.cmp='period'`,
   `effectiveScope` gives a board-level `cmp` precedence over the panel/preset
   default. Other panel scope keys still override the board. The existing
   `/b/compare?cmp=period` and `/b/compare` behaviour is unchanged.
3. **Scope of two-sided compare.** Implemented for the five compare-preset
   panels named in the brief. `trend-columns`, `trend-multiples` and `mix` still
   send a single first-cohort request under `cmp=cohorts`; they are not compare
   preset panels and this brief did not ask for them.

## Contradictions

- The 10-05 report described the `scopeWithCohorts` location fallback as the
  intended workaround; this unit removes it now that `cleanPanelScope` retains
  `cohorts`, as 10-05's own Departure 1 recommended.
- No contradiction between the fixer brief and CONTRACTS.md 17.3/17.3.1 was
  found: `cohort` still goes only on accepting routes, `cmp` never reaches the
  wire, and both populations keep their typed units.

## Gates / carried

- Pre-existing `tests/workspace/acceptance.test.mjs` failure: it still treats
  `/b/cost` (and the other delivered P10 presets) as named later destinations.
  Needs an acceptance-spec update in a workspace-owned unit, not here.
- Pre-existing chart render race: `inspect()` can see an empty chart between
  `data-idle` and the chart's animation frame. The `trend-columns` wait covers
  the Cost spec; other specs that inspect `yk-ranges`/`yk-bars` immediately
  could still race.
- Browser environment was available; no specs skipped.
