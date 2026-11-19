# 13-02 Server pageset smoke and p95 alignment handoff

Status: done.

## What changed

`packages/yakka/internal/serve/analytics_pageset_test.go` now consumes 13-01's committed browser
record instead of the deleted Overview/Usage generator:

- Strict parser over `testdata/browser-request-shapes.json`: `json.Decoder` with
  `DisallowUnknownFields`, trailing-data check, version 1, label/route shape, `GET` on
  `/v1/analytics/*`, non-empty query keys, pinned request count (75) and pinned SHA-256
  `420015134d2d3ee8861ee97e449a06e7bed3268d30492e34cdcd0b74012a5c2c`, and at least one canonical
  `all=1` request.
- Exact request URLs rebuilt from each recorded method/path/query pair with `url.Values.Add`, so
  repeated `dim`/`fields` values and every parameter are preserved verbatim.
- `TestAnalyticsPageSetSmoke` (ungated) generates the committed deterministic fixture
  (`internal/analyticsfixture`) into a `t.TempDir()` under `TMPDIR`, serves it as tenant
  `fixture-tenant`, and classifies all 75 requests at the contract concurrency of 4. It asserts the
  exact served/refusal split and fails on any 5xx, unexpected 4xx, or 400 that does not name an
  unsupported dimension, field, mode, check or scorer.
- `TestAnalyticsPageSet` is the opt-in profiler, gated by `YAKKA_PAGESET_PROFILE=fixture` (documented
  in the test comment). It classifies the full record, then times only served cases (one discarded
  warm-up plus 4 samples), reports the record's exact case count and the maximum p95, and fails any
  served case over the unchanged 500 ms bound. EXPLAIN runs for the slowest served requests that
  carry an explicit `from`/`to` window.
- Documented capability refusals are the 400s the deterministic first-party stub (superset schema)
  elicits but the Go API explicitly refuses; they are accepted as the capability-degradation path,
  not by weakening any 200 requirement or p95 rule. Routes, server contracts, the 500 ms threshold,
  the fixture generator and all other benchmark files are untouched.

## Evidence before

The old smoke passed but did not read the record at all (it built the deleted Overview/Usage shapes
and a 399-day "all" clamp), so it could not catch board drift:

```
--- PASS: TestAnalyticsPageSetSmoke (0.40s)
```

The pre-fix run of the new smoke (prior handoff, before commit `ceb7e915`) failed 15 shapes,
including one genuine 500 (`compare:window#1` `/distribution` `read failed`, now fixed by
`ceb7e915`: no such table `dist_samples`).

## Evidence after

```
$ mkdir -p .scratch/p13
$ TMPDIR=$PWD/.scratch/p13 GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve \
    -run '^TestAnalyticsPageSetSmoke$' -count=1 -v -timeout 20m
browser record: 12 scenarios, 75 requests, 9 all=1
browser record smoke: 75 requests across 12 scenarios = 61 served (200) + 14 documented capability refusals (400)
--- PASS: TestAnalyticsPageSetSmoke (198.33s)
```

```
$ TMPDIR=$PWD/.scratch/p13 GOMAXPROCS=3 GOMEMLIMIT=8GiB YAKKA_PAGESET_PROFILE=fixture \
    go test -p=3 ./internal/serve -run '^TestAnalyticsPageSet$' -count=1 -v -timeout 25m
page request-set profile: 75 recorded cases across 12 scenarios; 61 served cases timed,
  14 documented capability refusals excluded; 4 timed runs each, concurrency 4,
  bound p95<=500ms, fixture fixture-tenant
max p95 283.7 ms across 61 cases (bound 500 ms)
--- PASS: TestAnalyticsPageSet (204.12s)
```

Counts and split: **75 recorded requests / 12 scenarios / 9 canonical `all=1`; 61 served (200),
14 documented capability refusals (400)**. Max p95 over the 61 served cases: **283.7 ms**
(`/v1/analytics/schema`), inside the unchanged 500 ms bound.

The 14 refusals are the documented capability gaps recorded against the stub: 7
`/query` `dim=session_model` for `cost_usd`/`unpriced_calls` ("unsupported dimension"), 4
`/entities` scatter ("unsupported time mode" / "unsupported session scatter field commits"), 1
`/entities` artifact field `kind` ("unsupported artifact field"), and 2 `/score-series`+`/scores`
`check=clarity` ("unknown check clarity").

`git diff --check` is clean. Data audit: the committed JSON is request metadata only (method, path,
query); the fixture is test-only, generated from the committed `analyticsfixture` package into a
temp directory and removed with the test. `.scratch/p13` is removed before the closing commit.

## Departures

- The brief states the split is "currently 60 served, 15 documented refusals". The verified split is
  **61/14**: `ceb7e915` fixed the `/distribution` concurrent-read bug (no such table `dist_samples`),
  so `compare:window#1` now returns 200 instead of the earlier 500. The smoke pins 61/14, the
  verified outcome; a 500 still fails.
- The profiler gate is named `YAKKA_PAGESET_PROFILE=fixture` (the previous seam was
  `YAKKA_BENCH_DIR`). The brief permits another gate name if documented; the exact command is above.

## Carried items

- Server-maintenance owner: the 14 recorded shapes remain server capability gaps (session-model
  `/query` dimensions, `mode=scatter`, artifact `kind`, and the jev check/scorer catalog). They are
  recorded and accepted as documented refusals; implementing them is a server-contract change
  outside 13-02.
- None for this unit; the `/distribution` 500 was fixed by `ceb7e915`.
