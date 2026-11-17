# 6-07 — Schema-driven cohort proof

Status: done with concerns.

## What changed

- Added `internal/serve/analytics_cohort_proof_test.go`.
  - `TestCohortSchemaEnumeration` reads `/schema.grains` and, for every published
    `predicate.measures` and `predicate.lenses` entry on every source grain, builds a minimal
    valid cohort and asserts the resolver answers it. Every `predicate.undefined` entry must be
    400 `unsupported_join` with a reason. No hand-maintained pair list: the values come from
    `/schema`; only the published `<check>`/`<kind>` placeholders are expanded to a catalogue
    check and the design kind. The run resolves 132 published pairs across 6 source grains.
  - `TestCohortFeatureAdvertisedAfterProof` asserts `features.cohort` is true.
  - `TestCohortInvariantFrozenScope` proves 17.3.1 invariant 4 for every published filter name
    on session, artifact, plan, execution and time, using a fixture where session `s1` has two
    harnesses and a `(mixed)` model. Each cohort source scope is built from the same
    include/exclude applied as ordinary `/entities?grain=g` filters; the compare is on
    `population.scope_n`.
  - `TestCohortInvariantAssociations` proves invariants 1 and 2: the association identity holds
    on every response that can carry a target association (`/query`, `/series`, `/summary`,
    `/explore`, `/activity`, `/entities?grain=time`) and on a time cohort's source association;
    the time rejection source resolves exactly the distinct existing sessions of the associated
    rows (2 sessions from 3 associated rejections, with one missing id and one orphan).
  - `TestCohortInvariantSessionPartition` proves invariant 3 on `/summary`.
  - `TestCohortInvariantScopeExcludeDiffersFromOp` proves invariant 5: on the same source,
    `scope.exclude` yields `[keep-b]` while `op=exclude` yields `[cut-a]`.
- Advertised `features.cohort: true` in `analytics_query.go` only after the enumeration passed.
- Updated the schema-absence assertions in the existing tests to assert the now-proved flag.

## Gaps fixed in earlier units

- **6-05b non-session population `scope_n`.** Artifact, plan and execution entity populations
  reused the post-cohort count for both `scope_n` and `cohort_n`. Each now computes the
  pre-cohort count with the cohort restriction removed while keeping the post count as
  `cohort_n`.
- **6-05b session lens population counts.** With a cohort and a session lens filter, the
  target's `scope_n` came from `ConversationCount(withoutCohort(f))`, which ignores lifetime
  lens filters, and `cohort_n` could come from the same unfiltered count. The list path now
  counts the lens population directly (pre- and post-cohort).
- **6-04/6-05 artifact population with a hashless version.** `artifactPopulation` called
  `ArtifactContentBytes`, `ArtifactVersionScores` and `ArtifactScreen` with an empty hash,
  turning a legacy hashless `artifact_version` into a 500. It now reports `content_unavailable`
  and leaves the row readable.

These are confined to the existing serve paths and add no grain, join, route or contract.

## Check output

Before (flag still absent; enumeration written, code unfixed). The enumeration itself already
passed, so the offer-implies-resolve claim held before the flag moved:

```
GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/serve -run TestCohortSchemaEnumeration -count=1 -v
    analytics_cohort_proof_test.go:165: resolved 132 published cohort pairs across 6 source grains
--- PASS: TestCohortSchemaEnumeration
```

The invariant tests failed before the earlier-unit fixes, naming the concrete rows:

```
--- FAIL: TestCohortInvariantFrozenScope
    session filter session_model include: panel scope_n 1 != cohort scope_n 2
    session filter session_repo include: panel scope_n 1 != cohort scope_n 2
    artifact filter scorer include: panel scope_n 5 != cohort scope_n 0
    artifact filter id include: panel scope_n 5 != cohort scope_n 2
    plan filter session_model include: panel scope_n 2 != cohort scope_n 1
    execution filter shape include: panel scope_n 2 != cohort scope_n 1
    time filter conversation_id exclude: panel scope_n 1 != cohort scope_n 0
--- FAIL: TestCohortInvariantScopeExcludeDiffersFromOp
    scope.exclude include rows = [cut-a], want [keep-b]
--- FAIL: TestCohortInvariantAssociations
    time rejection source resolved_n = 0, want 2 distinct associated sessions
```

The `scope.exclude` failure was a test-construction error (the element was placed in `include`),
not a product gap; the fixture was corrected to use `scope.exclude`.

After:

```
GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/store  6.963s
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  29.399s
```

The existing `TestAnalyticsCohortRouteAcceptance` continues to pass: all eleven 17.3.1 accepting
routes return 200 and `/facets`, `/entity`, `/conversation`, `/content`, `/baselines` and
`/schema` return 400 `cohort_invalid` with reason `route_not_supported`.

## Deviations and concerns

- Dynamic schema entries are families. The enumeration resolves `/schema`'s literal
  `score:<check>`, `design_score:<check>`, `brief_score:<check>`, `report_score:<check>`,
  `band:<check>` and `artifacts:<kind>` through one catalogue design check and the design kind.
  The resolver code path is identical for every member of the family; iterating every catalogue
  check would multiply the same assertion.
- Invariant 4 is proved through `/entities?grain=g` with the same include/exclude supplied to the
  target request as ordinary filters, so the target's pre-cohort `scope_n` is the panel total.
  Content has no `/entities` route (scores-only), so it is outside the `/entities?grain=g`
  invariant; time is covered with two fields (its route requires 2 to 4) and hour buckets so a
  cohort restriction does not introduce new buckets.
- Ordinary `exclude=<name>:<value>` cannot express a dynamic name containing a colon, because
  the legacy exclude parser cuts at the first colon. Include is proved for those names
  (`band:<check>`); exclude is proved for every name without a colon. Structured cohort
  `scope.exclude` accepts the colon names.
- The enumeration skips `/schema` grains without a `predicate` (activity), which offer no
  cohort pairs.
