# 6-04 — Capability schema publication and filter alignment

Status: done with concerns.

## What changed

- `/schema` now publishes `filters` and `predicate` (`measures`, `lenses`, `undefined`) for
  `session`, `artifact`, `content`, `execution`, `plan` and `time`. `filters` comes from
  `store.CohortGrainFilters`, the same table 6-03's cohort parser validates, so there is no second
  filter list. `predicate.measures` is read from the grain's already-published `measures`;
  `predicate.lenses` reuses the filter names, except at `time` where only `id` is a predicate lens
  and every other filter is listed in `undefined` with `not_defined_for_grain`.
- Added the `content` grain: aggregate/cohort-only, identity `content_hash`, measure `score`,
  required kind/check, lenses `harness`, `session_model`, `repo_id`, `plan`, `scorer`,
  `screen_verdict`, `band`, `id`. `features.cohort` is not advertised.
- `/schema.budgets` adds `scope_elements: 64`, `scope_values: 64` and
  `value_bytes: {default: 256, id: 1024}`; the artifact grain's existing `predicate_budgets` key
  is unchanged.
- `exclude=` dimension whitelist is derived from the same published filter table, so every
  published name is accepted and an unpublished one is still 400.
- On `/entities?grain=session` list mode, `harness`, `session_model` and `session_repo` filter the
  lifetime-derived provenance values, `id` filters `conversation_id`, and `model=` aliases
  `session_model`. Legacy `/conversations` keeps fact-level `harness` (covered by a fixture).
- The artifact route parses `session_model` and maps it to the writing session's model lens;
  `model=` remains its alias.
- `/entities?grain=time` carries `ignored_filters` from the per-measure ignored list (e.g.
  `model=` against `commits`/`hook_events`), and accepts `id` include/exclude against the bucket
  identity.

Files: `analytics_query.go`, `analytics_entities.go`, `analytics.go`,
`analytics_artifact_population.go`, new focused `analytics_schema_capability_test.go`, and this
report.

## Check before

Added `analytics_schema_capability_test.go` first. Before the change, the schema test failed:

```
--- FAIL: TestAnalyticsSchemaPublishesFiltersPredicatesAndContent (0.02s)
panic: interface conversion: interface {} is nil, not []interface {}
  ... serve.strs ... TestAnalyticsSchemaPublishesFiltersPredicatesAndContent
FAIL	github.com/codyhamilton/yakka/packages/yakka/internal/serve	0.028s
```

## Check after

```
GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/serve \
  -run 'TestAnalytics(SchemaPublishes|SessionLensFilters|TimeIgnoredFilters|ExcludeAccepts)' -count=1
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/serve	0.123s
```

Brief's focused command (8 tests, all pass):

```
GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/serve -run 'Analytics(Schema|Entity|Time|Session)' -count=1 -v
--- PASS: TestAnalyticsSchema
--- PASS: TestAnalyticsSessionTimeEntitiesAndExclusions
--- PASS: TestAnalyticsSessionScatterDeterministicSampleHasWholePopulationMarginals
--- PASS: TestAnalyticsSessionMeasuresReconcileWithLegacyQuery
--- PASS: TestAnalyticsSessionScatterMarginalsHonorWhere
--- PASS: TestAnalyticsSchemaPublishesFiltersPredicatesAndContent
--- PASS: TestAnalyticsSessionLensFilters
--- PASS: TestAnalyticsTimeIgnoredFilters
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/serve	0.719s
```

Full required suite:

```
GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/store	6.913s
--- FAIL: TestAnalyticsActivityMergesAndPagesEqualTimeRows (0.01s)
--- FAIL: TestAnalyticsActivityProbeCountsLateArrivalWithoutRows (0.01s)
FAIL	github.com/codyhamilton/yakka/packages/yakka/internal/serve	27.298s
```

Both serve failures are the pre-existing `time.Now()` fixture failures recorded in
IMPLEMENTATION.md's Phase 6 baseline and owned by 6-06; this unit did not touch activity code.
`go build ./internal/...` and `git diff --check` pass.

## Deviations and contradictions

- Session lens filters are applied on the list path. Session scatter and aggregate still call the
  shared fact filter, so `harness`/`model` there remain fact-level and `session_model`/
  `session_repo` are not accepted. The brief's evidence exercises the entity list route; bringing
  scatter/aggregate to the same lens meaning needs their own population/sampling work.
- `sessionLensPage` scans the in-window session population in 500-row pages and reads lifetime
  provenance per page when a lens filter is present. Unfiltered requests keep the existing SQL
  keyset path byte-identical. Filtered pagination therefore costs a full population scan.
- 6-03's `CohortGrainFilters("time")` includes `stage`, but the shared filter has no `stage`
  include field (only `exclude=stage:`); `stage=` on time requests is currently not parsed.
  Publishing the shared table keeps `/schema` aligned with the resolver, but "accepted under its
  own name" is not yet true for that one include name. No contract change was made here.
- The artifact route still rejects `cohort=` outright; artifact cohort resolution is outside this
  brief (route integration/proof units).
