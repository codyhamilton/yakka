# Report: 6-02 — Cohort scope elements and bounded grammar

Status: done

## What changed

Replaced the rejected `[]string` scope lists with the signed structured element grammar from
CONTRACTS.md 17.3.1, in `packages/yakka/internal/store/analytics_cohort.go`.

- `CohortScope.Include/Exclude` are now `[]CohortScopeElement` (`Lens`, `Values`). Each element is
  strict-decoded (unknown fields rejected); bare strings, `null` elements, `null`/missing `values`
  and empty `values` are `cohort_invalid`. `[]` is accepted; `null` or an absent list stays
  `cohort_invalid`.
- Added one shared `cohortGrainFilters` table for session, artifact, content, execution, plan and
  time, plus exported `CohortGrainFilters(grain)` so the schema unit publishes the same table
  rather than hand-listing names. `band:<check>` is a prefix entry; its check is left to the
  resolver unit's catalogue validation, as the brief directs.
- Lens validation: a name in no grain's filters is `cohort_invalid`; a name published for another
  grain but not this one returns `unsupported_join` via the new `CohortScopeLensError`
  (`Reason: "not_defined_for_grain"`, `Try` = this grain's filter names, `Unwrap` =
  `ErrUnsupportedJoin`).
- Canonicalisation: same-lens elements merge, values deduplicate and sort lexically, elements sort
  by lens. Budgets are counted on the merged form: `scope_elements` > 64, `scope_values` > 64 per
  lens, `value_bytes` > 256 (1,024 for composite-identity `id` on artifact/plan/execution/time).
  The definition key is computed over this canonical form.
- Added `SQLExpression` and `CompileCohortScope(scope, columns)` returning a WHERE fragment and
  args: OR within a lens, AND across lenses, includes first then excludes as `NOT IN`. An unmapped
  lens returns `not_defined_for_grain` with the mapped names as `try` rather than being ignored.
- Predicate grammar, its limits, canonical ordering, the 8 KiB ceiling and all non-scope errors are
  unchanged.

## Checks before and after

Before (implementation file at HEAD, new focused tests in place):

```
internal/store/analytics_cohort_test.go:310:19: undefined: CohortScopeElement
internal/store/analytics_cohort_test.go:354:21: undefined: SQLExpression
internal/store/analytics_cohort_test.go:355:20: undefined: CompileCohortScope
FAIL github.com/codyhamilton/yakka/packages/yakka/internal/store [build failed]
```

After:

```
GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store -run 'Cohort' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/store  0.057s
```

New cases cover: `[]` accepted; null/missing list, null element, bare string, missing/empty values
rejected; unknown-for-any-grain name `cohort_invalid`; published-name-outside-grain
`unsupported_join`/`not_defined_for_grain` with `try`; each of `scope_elements`, `scope_values` and
`value_bytes`; composite `id` at 1,024 bytes accepted and 1,025 rejected; canonical merge/dedup/sort
and key stability across element/value order; include+exclude SQL and args; unmapped-lens error.

Full required suite:

```
GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1
ok    github.com/codyhamilton/yakka/packages/yakka/internal/store   6.807s
--- FAIL: TestAnalyticsActivityMergesAndPagesEqualTimeRows
--- FAIL: TestAnalyticsActivityProbeCountsLateArrivalWithoutRows
FAIL  github.com/codyhamilton/yakka/packages/yakka/internal/serve  26.973s
```

The two serve failures are the pre-existing activity failures recorded in IMPLEMENTATION.md, owned
by 6-06 (they compare `time.Now()` with a fixed 2026-11-08 window). Not touched here. `git diff
--check` passes.

## Deviations

- `CohortSessionSubquery` still rejects non-empty `include`/`exclude`, now with the message
  "scope include/exclude is not yet bound by this resolver". The brief asked for the compiler to be
  exposed so the resolver unit binds it; wiring every grain's source CTE to add lens columns here
  would be resolver work, not grammar work. The Boolean rule lives only in `CompileCohortScope`.
- The parsed universe of "published" names is the shared filter table. `/schema` does not publish
  `filters` yet (6-04); publishing from `CohortGrainFilters` makes the two agree.
- `band:<check>` accepts any non-empty check at parse time; catalogue validation stays with the
  resolver unit, per the brief.
- Time's filter list is the shared dimensions its measures apply plus `id`; `session_repo` and
  `session_model` are absent until the time route parses them, per 17.3.1.

## Known problems and contradictions

- No contradiction found between the brief and CONTRACTS.md 17.3.1 for the scope grammar.
- The pre-existing predicate `cohortLenses` table is now narrower/different than the new filter
  table (session predicate `in` still allows `origin`, `has_artifacts`, `repo_id`, `model` and not
  `id`). The brief says keep predicate grammar unchanged, so it was left as is; the resolver/schema
  units still owe 17.3.1's predicate-lens alignment.
- Scope validity can be proved here, but end-to-end scope filtering is not yet observable until
  the resolver unit binds `CompileCohortScope`.
