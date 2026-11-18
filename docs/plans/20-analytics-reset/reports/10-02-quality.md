# 10-02 — Quality preset

Status: `done with concerns`. The four Quality panels and the `quality` preset
are delivered and the Chromium spec passes. Two documented seams did not match
the brief's assumptions (chooser shape and the `/baselines` path); both are
worked around without editing another unit's files, and are stated below.

## What changed

- `web/js/panels/score-ranges.js` (new) — hash-weighted box ranges. Reads
  `/scores?kind` for the catalogue, `/baselines?population=content&kind&check`
  for scorers and the p25/median/p75 baseline, then
  `/scores?kind&check&scorer&dim&limit`. Each box carries n, the
  `content_hash` population unit and the selected scorer's p25–p75 as
  `spec.baseline` labelled `all-time scorer baseline`. A missing baseline is
  `baseline_unavailable`, never `unscored`. `omitted_groups`/`omitted_n` are
  printed. Also exports the shared Quality helpers (`renderQualityChooser`,
  `qualityScope`, `resolveScorer`, `baselineBand`, `contentSplits`, …).
- `web/js/panels/score-trend.js` (new) — hash-weighted series. Bucket from the
  finite scope (`day` ≤90d, `week` ≤2y, `month` otherwise; `win=all` → month);
  `/score-series?kind&bucket&check&scorer&dim` with p25/median/p75 as three
  named `<yk-chart type="lines">` series per group, the server's actual bucket,
  and the all-time baseline printed in the note. States that a hash may recur
  in several buckets and series n is not the window population.
- `web/js/panels/score-strips.js` (new) — file-weighted strip. Requests
  `/entities?grain=artifact&check&fields=score:<check>,<lens>&sort&limit`, one
  strip mark per returned file keyed by the compact canonical JSON identity
  `{"path","repo_id"}`, with `spec.entities` destinations
  `/artifact?repo_id=…&path=…&hash=…`. Shows `returned_n of eligible_n files`
  and `missing_by_reason.unscored`, labels the population files, and names the
  Phase 12 artifact reader.
- `web/js/panels/band-mix.js` (new) — file-weighted band composition from
  `/entities?grain=artifact&mode=aggregate&stat=count&dim=band:<check>&dim=kind`.
  `<yk-bars type="stacked">` with `low`, `mid`, `high`, `unscored` and
  `baseline_unavailable` as separate series, each count, the omitted groups,
  the file population and the selected check/scorer baseline provenance.
  `band:<check>` stays a structured lens; no legacy `exclude` string and no
  `id` cohort.
- `web/js/panels/p10-quality.js` — registers the four panels and the `quality`
  preset with canonical starting specs, replacing the empty preset shell.
- `web/css/quality.css` (new) — population/note layout only, no colour values.
- `tests/trends-quality/quality.test.mjs` (new) — five pure specs plus two
  Chromium specs.

## Checks, before and after

Before (working tree, no quality spec yet):

- `node --test tests/trends-quality/quality.test.mjs` → `Could not find
  'tests/trends-quality/quality.test.mjs'`.
- `node --test tests/trends-quality/{trends,compare}.test.mjs` → 17/17 pass.

After:

- `PUBLIC_CANVAS_TEST_MODE=true node --test tests/trends-quality/quality.test.mjs`
  (8G systemd scope) → 7/7 pass. Chromium: `/b/quality` settles four `ready`
  frames; ranges are labelled content hashes with a drawn
  `[data-baseline="true"]` band; strips show `3 of 3 files`, `1 missing:
  unscored` and the Phase 12 notice; band-mix names all five bands; a check
  change regroups and the surviving `harness:orca` colour is unchanged; the
  `jev-0` (n=0) scorer is `baseline_unavailable`; inspecting a strip mark opens
  `/artifact?repo_id=repo-a&path=docs/a.md&hash=h1`; an unknown check is a named
  unsupported state; `maxInFlight <= 4`; no console/page/CSP error.
- `node --test tests/trends-quality/{trends,compare}.test.mjs` → 17/17 pass
  (10-01 stays green).
- `git diff --check` → clean.

Fixture counts used by the pure and browser specs: content population
`n=12` (groups 7/5, `omitted_groups=1`, `omitted_n=2`), series points 2 with
groups `model:claude`/`model:gpt`, files `3` (`missing_by_reason.unscored=1`),
bands `2/3/1/1/1` with `omitted_groups=1`.

## Deviations from the brief (with reasons)

1. **Chooser shape.** The brief says to use 10-01's `renderChooser` for kind,
   check, scorer and split. It only renders measure/split/chart, and
   `p10-shared.js` is 10-05's path, not 10-02's. I added
   `renderQualityChooser` in `score-ranges.js` that follows the same
   `p10-chooser` markup and `spec` event, and stores kind/check/scorer in
   `spec.scope` because `canonicalPanelSpec` only preserves
   grain/measures/split/chart/scope.
2. **Baselines path.** CONTRACTS 7.2 and the brief put baselines at
   `GET /v1/baselines` outside `/analytics`; the P10 stub in
   `tests/workspace/stub-api.mjs` serves `/v1/analytics/baselines`. The panel
   calls `transport.request('baselines', …)` to follow the contract. The
   Chromium spec intercepts `/v1/baselines*` with Playwright.
3. **Chromium bodies.** The done evidence says the spec proves values against
   `tests/trends-quality/fixture.mjs`. That file only re-exports the workspace
   fixture, whose `p10Scores` has empty `groups`, `p10Entities` returns no
   rows, and `p10ScoreSeries` has no groups; the workspace fixture is 10-01's
   owned path, so I could not extend it under "Touch nothing else". The
   Chromium spec therefore imports `p10Schema()` from that fixture and supplies
   deterministic group/entity bodies through Playwright routes in the spec
   file.
4. **score-strips has no scorer selector.** The brief's strip request has no
   scorer parameter and an artifact's scorer is a row attribute; its chooser
   offers kind/check/lens only.

## Problems / unfinished

- `tests/workspace/fixture.mjs`'s P10 `/scores`, `/score-series`, `/baselines`
  and `/entities` bodies are placeholders (empty groups/rows, and baselines at
  `/v1/analytics/baselines`). A 10-05/10-06 fixture extension is the clean fix;
  until then the Quality browser spec must route-mock those bodies.
- The `quality` question path (`/b/quality?…&p1=content,score,…`) opens the
  preset; the per-panel `check`/`scorer` selections are written into
  `p1.scope`, which the shared spec/URL grammar tolerates but does not model as
  first-class fields.
- `artifact_feedback` was not requested for this unit (the refinement run
  recorded the service unreachable with `invalid_context`).
- Gate: none; playwright-core and the Chromium 1243 cache were present.
