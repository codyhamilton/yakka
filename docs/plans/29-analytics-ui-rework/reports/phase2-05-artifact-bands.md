# Phase 2 unit 05 — Grouped artifact band counts

Status: done with concerns (retained measurement used the synthetic retained workload, not a
prepared diagnostic-copy ledger).

## What changed

- `internal/store/artifact_entities.go`
  - `ArtifactGroupedCount` computes `mode=aggregate&stat=count` groups in SQLite from file
    membership under the same window/filter/cohort predicates, the lifetime-selected latest
    version per `(repo_id,path)`, the selected check's latest score per content hash, and the
    all-time per-kind/per-scorer content baseline. It returns observed groups, per-lens distinct
    cardinality for the cell budget, and the total selected-file population.
  - `ArtifactBandThresholds` loads the selected check's per-kind/per-scorer p25/p75 once per
    request from the distinct-content baseline (latest score per hash/check, partitioned by
    scorer). It uses `wf_kind(path)`, matching the per-file kind derivation.
  - Supported grouped lenses: `repo_id`, `kind`, `plan`, `source`, `scorer`, `band:<check>`, plus
    the `scorer=` equality filter. Band rule is unchanged: strict `< p25` = low, `> p75` = high,
    inclusive p25..p75 = mid, no score = unscored, no baseline = baseline_unavailable.
- `internal/serve/analytics_artifact_population.go`
  - Count aggregates take the grouped path when there are no `where`/predicate/`fields`/cohort
    constraints and no provenance (harness/session_model) lens or exclusion. Predicates, ranges,
    `fields=`, cohorts, `screen_verdict`/`harness`/`session_model` lenses and their exclusions stay
    on the existing population path unchanged. List and scatter are untouched.
  - Group labels, sort order, group `population` blocks, total statistics, `dims`, `cells`,
    `omitted_*` and the `too_many_cells` budget error reproduce the previous aggregate shape.
- New tests: `internal/serve/phase2_artifact_band_test.go` and
  `internal/store/phase2_artifact_aggregate_test.go`.

## Exact commands and results

Environment for every run: `GOTOOLCHAIN=auto GOMEMLIMIT=8GiB`,
`TMPDIR=/home/codyh/workspace/yakka-build/29/.scratch/plan29-p2-tmp`.

### Retained scale (synthetic retained workload, 239,810 facts / 21,000 scores / 7,440 sessions / 1,400 artifact files)

Command:

```
YAKKA_RETAINED_PROFILE=1 YAKKA_RETAINED_RUNS=20 YAKKA_RETAINED_SHAPE=artifact-band-mix \
YAKKA_RETAINED_OUT=<scratch> go test ./internal/serve -run '^TestAnalyticsRetainedWorkload$' \
  -count=1 -timeout 30m
```

Before (HEAD versions of the two owned files, restored afterwards):

```
artifact-band-mix alone: status=503 rows=0 p95=1001.3ms max=1001.3ms
artifact-band-mix load : status=503 rows=0 p95=1002.1ms max=1002.9ms
```

After:

```
artifact-band-mix alone: status=200 rows=9 p95= 227.0ms max= 233.2ms
artifact-band-mix load : status=200 rows=9 p95= 425.4ms max= 434.1ms
```

Both runs zero 503; alone and four-request-load p95 are under 500 ms. An intermediate
implementation that recomputed the SQL band CTEs per query measured 344/642 ms; the final
thresholds approach is the recorded after.

### New unit evidence

- `go test ./internal/serve -run '^TestAnalyticsArtifactBandAggregateGroupedCounts$' -count=1` →
  PASS. Fixture: two versions on one path (selected latest wins), five distinct scored contents
  at 0/.25/.5/.75/1, a duplicate path sharing the low hash, an unscored hash, a second scorer on
  the same check, and a scored README with no kind baseline. Asserts group keys/counts, total 9,
  group counts sum to the selected-file population, low/mid/high boundaries
  (0 low; .25/.5/.75 mid; 1 high), unscored and baseline_unavailable, scorer groups (7/1/1),
  `scorer=` filtering, and that list and scatter lens counts equal the aggregate.
- `go test ./internal/store -run '^TestArtifactGroupedCountMatchesSelectedPopulation$' -count=1` →
  PASS. Oracle compares grouped total to `ArtifactEntityCount`, sums groups, compares each band
  group to a Go re-classification from `ArtifactEntitiesPage` + `ArtifactVersionScores` +
  `LatestContentScores`, and compares kind groups to an independent raw SQL grouping of the
  selected files.

### Regressions

```
go test ./internal/serve -run 'TestAnalyticsArtifact' -count=1   -> ok
go test ./internal/store -run 'TestArtifact' -count=1            -> ok
go vet ./internal/store ./internal/serve                         -> clean
gofmt -l <four changed files>                                    -> empty
```

## List/scatter parity

`artifactPopulation` and the list/scatter dispatch are unchanged. The new serve test builds band
counts from both `mode=list` and `mode=scatter` responses on the same fixture and requires them to
equal the grouped aggregate exactly, so list/scatter response shapes and lens values are
byte-compatible with the prior path.

## Departures from the brief

- Not committed: the orchestrator commits each unit, per the task override.
- Count aggregates with `where`/predicate/`fields=`, a cohort, or harness/session_model/
  screen_verdict lenses or exclusions still call `artifactPopulation`. The brief's "do not call
  artifactPopulation" is satisfied for the retained band-mix shape and the plain entity-filter
  counts; the cited contract also says predicate/fields/populations behavior stays on the existing
  population path. This is a deliberate mode split, not a silent behavior change.
- The retained measurement uses the deterministic synthetic retained workload
  (`analyticsfixture.CreateRetained`), not a prepared diagnostic-copy ledger; no
  `YAKKA_RETAINED_LEDGER` source was supplied to this unit. The synthetic ledger meets the
  design's minimum scale.
- Band thresholds are derived with `wf_kind(path)` rather than the stored `facts.kind` column
  used by `LatestContentScores`. They agree for appended/compacted rows and keep the baseline
  consistent with the per-file kind lens.
- No index was added; the measured plan needed none, so there is no request for phase2-02.

## Unfinished work

- The fallback aggregate shapes above remain on the per-file population path and are not
  re-measured here. If Phase 2 acceptance re-runs request shapes that use artifact count
  aggregates with predicates or harness/session_model lenses, widen `ArtifactGroupedCount` to
  those lenses or accept the fallback explicitly.
- The retained measurement was not repeated against the prepared diagnostic-copy ledger;
  the orchestrator can rerun the same filtered command with `YAKKA_RETAINED_LEDGER=<copy>`.

## Known problems

- In one intermediate run (a since-discarded SQL-band implementation) the harness explain step
  reported `no such table: facts`; the final before and after runs did not reproduce it. It does
  not appear to be caused by this unit's code.
- Retained after rows=9 is expected for this shape: `scorer=jev-1.13.0` plus band×kind yields nine
  observed groups at this fixture; `min_rows` is 1.

## Gates

- `gate: retained-scale artifact-band-mix alone p95 227.0 ms <= 500 ms, status 200`
- `gate: retained-scale artifact-band-mix four-request load p95 425.4 ms <= 500 ms, status 200`
- `gate: pre-change retained-scale artifact-band-mix 503/1001 ms reproduced`
- `gate: grouped band/kind counts oracle and boundary tests pass (serve + store)`
- `gate: list and scatter artifact responses unchanged on the shared fixture`
- `gate: go vet ./internal/store ./internal/serve clean; gofmt clean`
