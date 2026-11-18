# 10-06 — Trends, compare, quality, cost and tools acceptance

Status: `done`. The Phase 10 outcome is proved independently on the closing
tree over the five presets. The new acceptance proof passes 6/6; the whole P10
suite passes 54/54, the Phase 9 workspace suite 72/72 and both chart kits 68/68.
Nothing skips, no product path was edited and no check was weakened.

## What was done

- Added `tests/trends-quality/acceptance.test.mjs`: six Chromium proofs over the
  committed P10 stub/fixture, one per named probe (completeness/grouping,
  long-history/linked time, comparison, quality units, cost/tools honesty,
  linked actions/tables).
- Added `tests/trends-quality/acceptance-fixture.mjs`: additive scene rows only
  (long-history year buckets, all-unpriced and priced-zero summaries, special
  mix groups, a colon-sensitive check, same- and different-grain cohorts). The
  unit fixtures' default bodies are unchanged.
- Every read is through `inspect()`, table text or URL/state; waits are on
  `data-idle`, `data-state` or the public `inspect()` surface. No fixed sleeps,
  no `/tmp`, no animation/timing assertion, no product test branch.

## Probes and observed results

1. **Completeness and grouping.** All five presets settle exactly their catalog
   panel lists (`trends` 5, `compare` 5, `quality` 4, `cost` 6, `tools` 4) and
   every frame is `ready`. A Trends measure change keeps `model:claude`'s
   legend colour (`--yk-cat-6`); the split change regroups to the harness table
   equal to the fixture; the chart change to `lines` persists in `p1`. A
   schema-refused `unpriced_calls × session_model` is `unsupported` with
   “not published for this measure”. Compare changes measure/split/chart on
   `trend-lines` (`p4`); Quality changes check/split/scorer; Cost's treemap
   measure change keeps the surviving parent series and its child change
   regroups; Tools' rank lens changes `tool → tool_kind` and the table equals
   the fixture.
2. **Long history and linked time.** `win=all` and `win=10y` both receive the
   server's `bucket=year` (`requested auto`, `coarsened true`) and the basis
   names “coarsened them to year”; the table's bucket set is the fixture's 11
   year starts. A settled zoom writes absolute `from`/`to` and clears `win`;
   reload keeps the dates and `/b/trends`; Back keeps the preset; Forward
   restores the same `from`/`to`. `/b/compare?win=all&cmp=period` shows the
   finite-period copy and issues no previous-window (`to=…`) distribution.
3. **Comparison.** A finite period comparison requests absolute bounds on both
   sides, including a previous window, and names both periods plus unpriced
   coverage. A session A/B cohort comparison shows “Cohort A/B”, `call in
   scope` and `resolved by the cohort`, with both canonical cohorts on the
   wire. A single cohort against all-in-scope names both. A session-vs-artifact
   pair is refused with “same source grain” and cohort B is never requested.
   Compare plus split renders more than one `[data-split]` group on every
   compare panel.
4. **Quality units.** `score-ranges` and `score-trend` name distinct content
   hashes; `score-strips` and `band-mix` name files (`3 of 3 files; 1 missing:
   unscored`). The selected scorer's all-time p25 0.45 – p75 0.85 band is
   drawn (`[data-baseline="true"]`); scorer `jev-0` (n=0) shows
   `baseline_unavailable`, and a null score is `unscored`. A check change keeps
   a surviving group's colour. Inspecting a strip mark opens
   `/artifact?repo_id=repo-a&path=docs%2Fa.md&hash=h1` and the panel names the
   Phase 12 reader.
5. **Cost and tools honesty.** A partially priced group says “lower bound, 3
   calls unpriced” and `$4.25+`; the partial group's unpriced count stays 2 in
   the table. An all-unpriced summary says “all 5 calls unpriced / no priced
   cost” and never `$0.00`; a priced zero says “real zero” and `$0.00`.
   `unknown`, `(mixed)`, `(none)` and `(multi)` stay separate series and never
   fold into `(other)`. The histogram counts, tool/kind groups and the 7×24
   rhythm grid equal the fixture. A repo cost total and cost-by-tool are
   `unsupported` with their `try` (`/distribution?dim=session_repo`,
   `hook_events by tool`).
6. **Linked actions and tables.** Legend focus emits a board filter chip for a
   published contract lens (`model`/`session_model: claude`); an unmapped key
   is named “not applied here: mystery:value”. A pick reaches the tray and
   names the mark. A cohort chip is shown and every P10 panel request carries
   `cohort=`; every panel shows a non-empty population unit. The Cost treemap
   table equals the fixture.

## Verification output

Before this unit there was no acceptance check on the tree: `git ls-files`
listed neither `tests/trends-quality/acceptance.test.mjs` nor its fixture, so
the named command failed with ENOENT and the only P10 evidence was the units'
own 48/48 suite.

After (Chromium 1243 via `playwright-core` under the shared `NODE_PATH`,
`PUBLIC_CANVAS_TEST_MODE=true`):

```
$ NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=… \
    node --test tests/trends-quality/acceptance.test.mjs
# tests 6  # pass 6  # fail 0  # skipped 0
```

```
$ NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=… \
    node --test --test-concurrency=1 tests/trends-quality/*.test.mjs
# tests 54  # pass 54  # fail 0  # skipped 0
```

A plain (parallel-file) run is flaky in the pre-existing Tools spec only
(`tools settles four panels…`, the route-interception race recorded by 10-05b):
it passed 54/54 on one run and 53/54 on another with this unit's files present.
`--test-concurrency=1` is the evidence run that report used.

```
$ NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=… \
    node --test tests/workspace/*.test.mjs
# tests 72  # pass 72  # fail 0  # skipped 0

$ NODE_OPTIONS=--max-old-space-size=8192 NODE_PATH=… \
    node --test tests/charts-cat/*.test.mjs tests/charts-time/*.test.mjs
# tests 68  # pass 68  # fail 0  # skipped 0
```

`git diff --check` is clean.

## Fixture counts used

Committed P10 scene: 2 harnesses, 2 models, 2 session models, 3 session repos,
2 tools, 2 tool kinds, 2 artifact kinds. Additive acceptance scene: 11 year
buckets; 3 summary states (partial/all-unpriced/priced-zero); 4 special mix
rows; 2 checks (one colon-sensitive, `design:clarity`) and 2 scorers (one
n=0); 3 artifact files (1 unscored) and 5 band rows; 2 session cohorts (A/B,
one exclude) and 1 artifact cohort.

## Departures

1. The quality probe serves its extra score/series/baseline/entity bodies
   through Playwright routes, because the committed P10 stub returns one scores
   and one artifact body that do not carry the colon check, the n=0 scorer or
   the band aggregate. The unit fixtures' defaults are unchanged; only the
   acceptance page is routed.
2. Back is asserted to keep the preset and take the browser to the prior board
   state; Forward restores the exact zoom `from`/`to` and preset. Reload is
   asserted to preserve the dates exactly. (The first draft assumed Back lands
   on `win=30d`; the app normalises the prior board entry.)
3. Probe 6 checks one table per preset (Trends, Cost treemap, Tools
   treemap/rank/mix/rhythm) rather than every table on every panel. The
   remaining tables are the same row mappers already asserted by the unit specs;
   no table assertion was weakened.
4. The whole-P10 evidence run uses `--test-concurrency=1` because of the
   pre-existing Tools race above; the acceptance spec itself passes with either
   concurrency.

## Contradictions and problems

- No contradiction remains between this brief and CONTRACTS.md 17.5/17.7. The
  brief's requirement that `tests/workspace/*.test.mjs` stay green holds: the
  workspace acceptance was updated for the delivered P10 presets in `6ec0ab2`,
  and the suite passes 72/72 here.
- Known problem, outside this unit's paths: the Tools spec's route interception
  is timing-sensitive under parallel test files (documented in 10-05b). It is
  not caused by this change and does not affect the acceptance proof.
- Known product seam, handled not hidden: charts paint on the frame after a
  panel goes idle. The acceptance proof waits on the public `inspect()` surface
  instead of sleeping or weakening the read.

## Unfinished

None in this unit's scope. The Phase 12 artifact reader remains the named,
design-only gap; the Quality panel says so and this proof checks that text.
