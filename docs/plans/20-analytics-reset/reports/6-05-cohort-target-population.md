# 6-05 — Cohort target routes, population, relation and associations

Status: done with concerns.

## What changed

- Wired the active check catalogue and tenant blob directory into cohort resolution.
  `parseFilter` is now a `*Server` method and calls
  `store.CohortSessionSubquery(cohort, s.cohortResolveOptions(ts))`, passing
  `s.opts.Checks` (per kind) and `<tenant dir>/blobs`. Dynamic `score:<check>` and
  `band:<check>` now validate against the loaded checks instead of only structurally, and the
  artifact resolver can measure `content_bytes`.
- Session lens filters now apply on `/entities?grain=session` scatter and aggregate as well as
  list. A shared `sessionLensPopulation` scans the in-window member population in paged
  `last_ts` order, filters on lifetime provenance, and callers either sort by the deterministic
  SHA-256 sample rule (scatter) or pass the matching session ids to the existing aggregate and
  marginal queries. Fact-level `harness`/`model` filters are cleared for these modes, matching
  the list path's lens meaning.
- Artifact `cohort=` resolves instead of rejecting: the explicit 400 in
  `analyticsArtifactEntities` is removed and the shared filter's cohort subquery restricts file
  membership through `ArtifactEntitiesPage.factWhere`.
- Centralised the accept/refuse decision: `refuseCohort` answers 400 `cohort_invalid` with
  `reason: "route_not_supported"` on `/facets`, `/entity`, `/conversation`, `/content`,
  `/baselines` and `/schema`. The eleven accepting routes keep resolving through the shared
  filter.
- Stopped publishing `stage` for the time grain: it was in `cohortGrainFilters("time")` although
  no include `stage=` filter is parsed. It is removed from that shared table (so `/schema` and
  the resolver agree), while `stage` stays in the legacy `exclude=` whitelist so requests without
  a cohort keep their prior behaviour.

## Check before and after

Before (committed behaviour recorded by 6-04 and visible in the pre-change handlers; not re-run
against a pre-change tree):

- `/entities?grain=artifact&cohort=...` → 400 `cohort_invalid` "artifact cohorts are not
  available".
- `/facets` parsed the shared filter and discarded a valid cohort, returning 200.
- `score:<check>`/`band:<check>` passed structural parsing even when the check was not loaded.

After (new focused tests):

```
GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/serve \
  -run 'TestAnalyticsCohort|TestAnalyticsSessionLens|TestAnalyticsArtifactCohort|TestAnalyticsSessionScatter' -count=1
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/serve	0.727s
```

The new tests cover all eleven accepting routes (200), the six refusing routes
(400 `cohort_invalid` / `route_not_supported`), known versus unknown dynamic checks through the
loaded catalogue, session lens filters on scatter and aggregate (including `(mixed)` and
`(multi)` lenses), and an artifact cohort that retains only the selected session's file.

Required suite:

```
GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/store	6.979s
--- FAIL: TestAnalyticsActivityMergesAndPagesEqualTimeRows (0.01s)
--- FAIL: TestAnalyticsActivityProbeCountsLateArrivalWithoutRows (0.01s)
FAIL	github.com/codyhamilton/yakka/packages/yakka/internal/serve	27.202s
```

The two serve failures are the pre-existing `time.Now()` activity failures owned by 6-06; this
unit did not touch activity code. `go build ./internal/...` and `git diff --check` pass.

## Deviations and concerns

- The brief's typed population/relation/association layer is not implemented. Responses carry the
  pre-existing population objects only; they do not add `population.relation` (`source_grain`,
  `target_grain`, `mapping`, `op`, `resolved_n`, `resolved_unit`, `associations`,
  `target_sessions`) or `/activity`'s `population.by_type`. Consequently the association identity,
  `cohort_n(op=include)+cohort_n(op=exclude)=scope_n`, and `resolved_n=|C|` evidence items are not
  proved by new response assertions. Target restriction itself already worked from 6-03. This is
  the main reason the status is done with concerns.
- Artifact entity populations still report `relation: nil` and their pre-cohort `scope_n`/`cohort_n`
  mapping; cohort membership is applied to facts, not reported as a relation.
- The time grain's `stage` include filter remains unsupported, so `stage` is no longer published.
  The contract expects time filters to include the shared dimensions its measures apply; this
  closes the published/accepted mismatch by removing the publication rather than adding parsing.
  Legacy `exclude=stage:<value>` is still accepted, preserving non-cohort request behaviour.
- Session lens scatter/aggregate scan the whole in-window member population in 500-row pages and
  hold the matching rows until the response; the list path already did this. The scan is inside
  the existing analytics deadline but is memory proportional to the member population.

## Contradictions

- The brief's done evidence asks for population/relation/association counts and the session-target
  invariant; this unit did not add those response members (see deviations). The route acceptance,
  artifact cohort, dynamic-check and lens-filter evidence is met.
- 17.3.1 lists `stage` among the time source filters while the accept rule requires every
  published name to be accepted under its own name. Removing it from the published table resolves
  the mismatch without changing CONTRACTS.md, but leaves the time `stage` include unimplemented.
