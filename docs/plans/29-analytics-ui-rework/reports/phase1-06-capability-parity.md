# Phase 1 unit 06: capability parity, score-series resolution and session scatter

Status: **done with concerns**.

## What changed

- `packages/yakka/internal/serve/analytics_artifact_schema.go` — added
  `retainedChecks(ctx, tenant, kind)`, the one retained-plus-active per-kind
  catalogue (active catalogue checks ∪ `LatestContentScores` names, sorted,
  deduplicated). `artifactChecks` now builds `/schema.checks_by_kind` from it, so
  discovery and validation share one union.
- `packages/yakka/internal/serve/analytics.go` — `/scores` output and
  `analyticsScoresByLens`'s selected-check map now use `retainedChecks`. A
  retained historical check is returned and selectable with no active checks
  catalogue.
- `packages/yakka/internal/serve/analytics_score_series.go` —
  - `/score-series` accepts only `day`, `week`, `month`; any other unit
    (including `auto` and `hour`) returns 400 `unsupported_resolution` with
    `supported_buckets:["day","week","month"]`.
  - Removed the `range too wide` refusal. An explicit `max_cells` cell budget
    (default 20000, matching `/schema.budgets.max_cells`; an explicit value may
    only lower it) replaces the old implicit guard. Cells are counted as returned
    buckets × returned check/series groups. A breach returns 400 `too_many_cells`
    with `max_cells` and either the next supported coarser `suggested_bucket` that
    fits or `suggested_action:"reduce_splits_checks_or_choose_window"`. Series and
    buckets are never clipped.
  - `analyticsScoreSeriesByLens`'s selected-check map also uses `retainedChecks`.
- `packages/yakka/internal/serve/analytics_query.go` — `/schema.resolutions` now
  carries `routes:{"score-series":{buckets:["day","week","month"],auto:false}}`
  while keeping the legacy global `auto`/`year`/`multi_year_steps`. Added
  `commits` and `unpriced_calls` to `grains.session.scatter_fields`.
- `packages/yakka/internal/serve/analytics_entities.go` — session scatter field
  whitelist now accepts `commits` and `unpriced_calls`; both are already produced
  by the session entity query, so no new grain or measure was added.
- `packages/yakka/internal/serve/analytics_capability_parity_test.go` (new) —
  `TestAnalyticsRetainedChecks`, `TestAnalyticsCapabilityParity`,
  `TestScoreSeriesRouteCapability`, `TestSessionScatterCommits`.

No response shapes changed beyond check discovery, the new refusals and the two
scatter fields.

## Done evidence

Tests were written first and run against the pre-change handlers through a Go
`-overlay` of the five HEAD files (no worktree or branch change).

Before:

```
$ GOTOOLCHAIN=auto GOMEMLIMIT=8GiB go test -overlay ../../.scratch/phase1-06/overlay.json ./internal/serve \
    -run 'TestAnalyticsCapabilityParity|TestAnalyticsRetainedChecks|TestScoreSeriesRouteCapability|TestSessionScatterCommits' -count=1
--- FAIL: TestAnalyticsRetainedChecks: retained design check missing from /scores: []
--- FAIL: TestAnalyticsCapabilityParity: discovery and /scores disagree: schema=map[legacy-check:true quality:true] scores=map[]
--- FAIL: TestScoreSeriesRouteCapability: route resolutions missing: map[auto:true ...]
--- FAIL: TestSessionScatterCommits: scatter field commits not published: [cost_usd tokens_in ...]
FAIL
```

After:

```
$ cd packages/yakka && GOTOOLCHAIN=auto GOMEMLIMIT=8GiB go test ./internal/serve \
    -run 'TestAnalyticsCapabilityParity|TestAnalyticsRetainedChecks|TestScoreSeriesRouteCapability|TestSessionScatterCommits' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.109s

$ GOTOOLCHAIN=auto GOMEMLIMIT=8GiB go test ./internal/serve \
    -run 'TestAnalyticsScores|TestAnalyticsScoreSeries|TestAnalyticsQuery' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.091s

$ GOTOOLCHAIN=auto GOMEMLIMIT=8GiB go test ./internal/serve \
    -run 'TestScoreSeriesErrors|TestScoreSeriesShape|TestScoreSeriesAcceptsWideRange|TestAnalyticsSchema$|TestAnalyticsSessionScatter' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.700s
```

`gofmt -l` reported nothing; `go vet ./internal/serve` passed. Toolchain:
default go1.24.2, `GOTOOLCHAIN=auto` used **go1.27.1**.

Harness observable (phase1-01, direct HTTP from Node; no browser, no sleeps,
data under ignored `.scratch/`):

```
$ node .scratch/phase1-06/harness-observe.mjs
{"route":{"auto":false,"buckets":["day","week","month"]},
 "retainedCheck":"legacy-check","seriesStatus":200,
 "scatterRows":3,"scatterMeasures":["commits","cost_usd","unpriced_calls"]}
```

## Deviations

- The brief says to commit the unit. The orchestrator directive for this run says
  not to commit and to leave changes plus this report in the working tree for the
  orchestrator to commit. Followed the orchestrator; nothing was committed.
- Production parity was not attempted: the run forbids reading the trial
  credentials and touching the running Plan 28 trial. Recorded as a gate.
- Cell budget counts the response's returned buckets × check/series groups (the
  brief's wording), not the requested window grid, so ordinary all-history reads
  do not fail merely because the window is long. Suggestions for a coarser bucket
  use the returned bucket span.
- The four required tests run against a fixture with retained scores and no active
  catalogue; the harness fixture is the same shape on `plan29-a`.

## Unfinished work

- Full-suite pin owner: update `packages/yakka/internal/serve/analytics_pageset_test.go`
  `pagesetRecordServed`/`pagesetRecordRefusals` from `61/14` to `65/10` (or re-pin
  the record). The four flips are the intended capability parity: retained
  historical check reads and the `commits`/`unpriced_calls` scatter now return 200
  instead of a documented capability refusal.
- Production parity read of `/v1/analytics/schema`,
  `/score-series?kind=design&check=<retained>&bucket=month&all=1` and the session
  scatter shape, by whoever holds the authorized tenant credentials.
- Phase 1 verifier: confirm the client (phase1-04) consumes
  `resolutions.routes["score-series"]` and the two new scatter fields on `plan29-a`.

## Known problems

- Session scatter marginals for `commits` and `unpriced_calls` are all-zero because
  `distributionValueSQL` has no case for them (`internal/store/distribution.go:241-256`)
  and returns `0`. Row values in `rows[].m` are correct; only the marginal
  histograms are degenerate. Fixing that needs a distribution measure addition
  outside this unit's owned paths.
- The cell-budget breach is detected after the store query, so it bounds the
  response but does not save the query work. The design asks for an output cell
  budget, which this satisfies; it is not a pre-query cost guard.

## Gates

- gate: production parity — not attempted; the run forbids reading the trial
  credentials and touching the running Plan 28 trial.
- gate: full `go test ./internal/serve` — `TestAnalyticsPageSetSmoke` fails on the
  now-stale pinned 61/14 split (65 served / 10 refused after this unit). The
  intended 200s are correct; the pin lives in a file outside this unit's owned
  paths.
- gate: Go 1.27.1 toolchain — satisfied; `GOTOOLCHAIN=auto` used go1.27.1.
