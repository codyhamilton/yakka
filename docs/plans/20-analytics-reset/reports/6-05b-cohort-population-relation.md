# 6-05b — Typed population, relation and association reporting

Status: done with concerns.

## What changed

- `store.AnalyticsFilter` now carries the resolved source metadata (`CohortSourceGrain`,
  `CohortMapping`, `CohortOp`), set by `parseFilter` from the `CohortRelation` that
  `CohortSessionSubquery` already returned. No re-resolution in handlers.
- New store reads in `analytics_cohort.go`:
  - `CohortCount` returns `|C|` as `COUNT(*)` over the existing parameterized positive source
    subquery, inside the same SQL/deadline, without materialising session ids.
  - `RejectionAssociations` classifies rejections in a filter's own scope into associated
    (recorded conversation id names a conversation with a non-`session_action` fact), missing
    (no conversation id) and orphan (id names no such session). It never inner-joins
    unassociated rows away.
  - `ContentHashCount` is the content-hash population of `/scores` and `/score-series`.
- New `serve/analytics_population.go` builds the shapes once: `cohortSessionCounts` (distinct
  in-window sessions before/after restriction), `cohortRelation` (17.3.1 relation object with
  `source_grain`, `target_grain`, `mapping`, `op`, `resolved_n`, `resolved_unit`, `associations`,
  optional `target_sessions`), `sessionPopulation` and `contentPopulation`.
- Wired the cohort-bearing fields into every accepting route except the 6-06-owned time/activity
  work: `/query`, `/distribution`, `/summary`, `/series`, `/conversations`, `/executions`,
  `/scores` (plain and lens), `/score-series` (plain and lens), `/explore`, and
  `/entities` session list/aggregate/scatter, artifact (list/aggregate/groups/scatter),
  plan and execution. `/conversations` and `/executions` gain a population object only with a
  cohort; routes whose population already existed report `relation: null` without a cohort.
- Session-unit `scope_n`/`cohort_n` now come from the pre-/post-restriction distinct-session
  counts, so the invariant is reportable. Non-session populations add
  `relation.target_sessions = {unit, scope_n, cohort_n}`.
- Rejection target-side associations appear on `/query` and `/series` only when the measure/metric
  is `rejections`, and always on `/summary` and `/explore`; `treatment` is `dropped` for
  `op=include`, `kept` for `op=exclude`.

## Check before and after

Failing check first written as `analytics_cohort_population_test.go`. Before the change (tracked
changes stashed, new test in place) it cannot compile because the surface is absent:

```
internal/serve/analytics_population.go:14: f.CohortSourceGrain undefined
internal/serve/analytics_population.go:37: t.CohortCount undefined
internal/serve/analytics_population.go:51: t.RejectionAssociations undefined
FAIL github.com/codyhamilton/yakka/packages/yakka/internal/serve [build failed]
```

After:

```
GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/serve \
  -run 'TestCohortRelation|TestCohortSessionInvariant|TestCohortRejectionAssociations|TestCohortPopulationUnits|TestAnalyticsCohort' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.349s
```

Required suite:

```
GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1
ok   github.com/codyhamilton/yakka/packages/yakka/internal/store  6.934s
--- FAIL: TestAnalyticsActivityMergesAndPagesEqualTimeRows (0.01s)
--- FAIL: TestAnalyticsActivityProbeCountsLateArrivalWithoutRows (0.01s)
FAIL github.com/codyhamilton/yakka/packages/yakka/internal/serve  27.474s
```

The two serve failures are the pre-existing `time.Now()` activity failures owned by 6-06; this
unit did not touch activity code. `go build ./internal/...` and `gofmt` pass.

## Deviations and concerns

- Non-session populations (artifact/plan/execution rows, score content hashes) report their own
  unit and use the route's existing post-restriction count for both `scope_n` and `cohort_n`;
  the true pre-/post-restriction session counts are carried on `relation.target_sessions`. The
  contract only fixes the session-target invariant, which is proved on `/summary`.
- `/scores` and `/score-series` report one top-level `content_hash` population rather than a
  population per check. The evidence item (unit is `content_hash`) holds; "per check" is
  approximated by one content population because there is no empty/eligible split to report.
- The failure/association shapes are added to every accepting route, but no store-level unit test
  was added; `RejectionAssociations` and `CohortCount` are exercised through the serve routes.
- The "before" run above is a compile failure of the new surface, not a behavioural assertion.
  The 6-05 report had already recorded that responses carried no `population.relation`.
- Budget: this unit ran past the brief's 24 tool turns while wiring all routes; the code is
  complete and the required suite passes apart from the 6-06 activity failures.

## Contradictions

- "No-cohort responses stay exactly as before" versus the done evidence "no-cohort responses
  still report `relation: null`". Adding the `relation` key to populations that lacked it changes
  the no-cohort JSON. The contract's explicit `relation: null` requirement was followed for
  routes that already have a population; routes that had no population object gain one only when
  a cohort is present, so their no-cohort responses are unchanged.
