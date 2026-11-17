# 6-06 — Time cohorts and activity observation types

Status: done.

## What changed

- Time cohort resolution in `store/analytics_cohort.go`:
  - A time source now resolves scope elements instead of refusing them. Each non-`id` scope
    element is validated against the named source fields at parse time; an element that applies
    to no field is `unsupported_join` naming the filter and a source field.
  - Scope include/exclude is applied per source measure through `cohortTimeScopeFilter`, so a
    dimension only restricts the measures that actually carry it (`tool` cannot restrict
    `rejections`, and is refused when no named field carries it).
  - `id` is the time bucket identity. Scope/predicate `id` values translate through
    `cohortTimeBucketKeys` into the route's bucket keys; an id from another zone matches nothing.
    Non-`id` time predicate lenses remain `unsupported_join` with
    `reason: not_defined_for_grain`.
  - The resolver keeps its 14 measures in six CTEs (`hook_b`, `conv_b`, `art_b`, `commit_b`,
    `usage_b`, `reject_b`) and selects buckets by predicate, field presence and `id`. Sessions
    come from per-field contributors joined on the selected buckets, so a time cohort still
    resolves to distinct sessions. Rejections contribute only sessions that also have a
    non-`session_action` fact.
  - `CohortRelation` gained `SourceRejections`; `CohortSessionSubquery` sets it when a time
    source includes `rejections`.
  - New `TimeCohortSourceAssociations` classifies rejections in the selected buckets:
    total, associated, missing (`no_conversation_id`) and orphan (`orphan_conversation_id`).
    Unassociated rows are counted, never inner-joined away.
- Target-side reporting:
  - `store.AnalyticsFilter` carries `CohortSourceAssociation`, populated by `parseFilter` from
    `TimeCohortSourceAssociations` when the relation says the source is time+rejections.
    `withoutCohort` clears it.
  - `cohortRelation` appends a `side:"source"`, `contributor:"rejection"`,
    `treatment:"selected"` association entry from those counts.
  - `/entities?grain=time` now builds its population once (`timePopulation`), adds
    `relation.target_sessions = {unit:"session", scope_n, cohort_n}` when a cohort is present,
    and includes the source association when `fields` contains `rejections`. The bucket unit,
    `scope_n`, `cohort_n`, `eligible_n` and `returned_n` remain bucket-row counts.
  - `parseFilter` now maps `ErrUnsupportedJoin` from `ParseCohortDefinition` to the
    `unsupported_join` HTTP code, so parser-level scope refusals are reported like resolver
    refusals instead of `cohort_invalid`.
- Activity observation types:
  - `store.ActivityTypeCounts` counts `session_start`, `artifact_version`, `execution` and
    `rejection` in a filter's scope.
  - `/activity` reports `population.by_type` with `{unit, scope_n, cohort_n}` per type
    (`session`, `version`, `execution`, `rejection`). `scope_n` is counted with the cohort
    cleared and `cohort_n` with it applied, so the two differ exactly when a cohort restricts the
    observation. A cohort also adds `relation` with `target_sessions` and any source association.
  - Activity list rows and their `typed_observation` population keep their existing units; the
    by-type counts are never equated with the row unit.

## Check before and after

Before, the required suite failed on the two non-deterministic activity tests:

```
--- FAIL: TestAnalyticsActivityMergesAndPagesEqualTimeRows (0.01s)
    analytics_activity_test.go:27: page 0 rows=[]
--- FAIL: TestAnalyticsActivityProbeCountsLateArrivalWithoutRows (0.01s)
    analytics_activity_test.go:67: late probe=map[counts:map[...:0] ...]
FAIL github.com/codyhamilton/yakka/packages/yakka/internal/serve
```

Both constructed their facts from `time.Now()` while querying a fixed window. They now use
`2026-11-08T12:00:00Z`; the first also asserts `population.by_type` units and counts.

Focused new checks (store): time scope include/exclude, `id` scope/predicate buckets, refusal of
an inapplicable filter and of a non-`id` predicate lens, and time source association
classification (total 6, associated 4, missing 1, orphan 1, contributors `[c1]`).
Focused new checks (serve): time `target_sessions` (`unit session`, `scope_n 2`, `cohort_n 2`),
inapplicable time filter as `400 unsupported_join`, and `/activity` `by_type` plus
`target_sessions` under a session cohort (`session_start` scope 2 / cohort 1).

After, required suite:

```
GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1
ok   github.com/codyhamilton/yakka/packages/yakka/internal/store  7.498s
ok   github.com/codyhamilton/yakka/packages/yakka/internal/serve  28.454s
```

`gofmt -l` is clean on the touched files.

## Deviations and concerns

- **Owned-path contradiction.** The brief's Owned paths are the time resolver in
  `store/analytics_cohort.go`, `store/activity.go`, `serve/analytics_activity.go`, their focused
  tests and this report. Closing the brief's required gaps also needed small edits in
  `serve/analytics.go` (`parseFilter` association population and `unsupported_join` mapping),
  `serve/analytics_population.go` (`cohortRelation` source association) and
  `serve/analytics_entities.go` (time population relation). These are the only edits outside the
  Owned paths; no new grains, joins, routes, dependencies or contract changes were introduced.
- Time populations keep their existing bucket-row `scope_n`/`cohort_n` meaning; the session
  counts required by 17.3.1 are reported on `relation.target_sessions` rather than replacing the
  bucket counts. This mirrors the 6-05b treatment of non-session populations.
- `/activity` `by_type` is computed for every activity response, including without a cohort (the
  two counts are then equal). It does not add `relation` without a cohort, matching the route's
  pre-existing population shape.
- Source associations are reported only for time cohorts whose source fields include
  `rejections`, because only then can rejections contribute the target sessions.
