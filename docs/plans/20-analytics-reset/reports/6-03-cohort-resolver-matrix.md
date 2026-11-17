# 6-03 — Full cohort resolver matrix

Status: **done with concerns**.

## What changed

- Extended the cohort measure/lens tables to the 17.3.1 matrix for session, artifact,
  content, execution and plan: `first_ts`/`last_ts`, `id`, artifact writer measures,
  `score:<check>`, `band:<check>`, `scorer`, execution `brief_score:<check>` /
  `report_score:<check>`, and plan `artifacts:<kind>`, `design_score:<check>` and the
  derived execution/span measures.
- Added source resolvers for the missing grains:
  - session: in-window measures with lifetime-derived `harness`, `session_model` and
    `session_repo` (`(none)`, `(multi)`, `(mixed)`, `unknown`);
  - artifact: selected version, earliest writer, writer attribution, scores, band
    baseline and writer measures; `content_bytes` via a deterministic SQLite function
    bound to the tenant blob directory;
  - content: `/scores` representative (`ts,row_hash,repo_id,path`) and the
    representative's writing session, with required `source:{kind,check}`;
  - execution: one row per in-window brief with the existing `execShapeSQL` and
    dynamic brief/report scores;
  - plan: associated sessions as sessions active in the window with lifetime artifact
    facts under `(repo_id,plan)`, plus existing plan derived measures.
- Applied canonical scope include/exclude to every non-time source population using
  that grain's own lens columns, and kept `op=exclude` target-side.
- `CohortSessionSubquery` now accepts optional `CohortResolveOptions` (blob directory
  and active check catalogue) and returns `CohortRelation` mapping/unit metadata with
  `ResolvedN`.
- Added focused matrix tests: every static/dynamic measure and lens per grain,
  `id` lenses, content kind/check, artifact scorer+source.check, band, plan derived
  measures, lifetime session lenses, scope include/exclude vs `op=exclude`, empty
  source, and unknown check.

## Checks

Before the fixes, the new focused tests failed with:

```
resolver SQL: missing argument with index 13
resolve: cohort_invalid: unknown check "d.x"
```

The first was dynamic predicate expressions reused for both range bounds binding only
one argument list; the second was artifact `source.check` validated against an empty
kind. Both are fixed.

After:

```
GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/store  6.75s

GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1
ok  .../internal/store  6.96s
FAIL .../internal/serve
  TestAnalyticsActivityMergesAndPagesEqualTimeRows
  TestAnalyticsActivityProbeCountsLateArrivalWithoutRows
```

The two serve failures are the pre-existing, wall-clock-dependent activity tests owned
by 6-06 (recorded in `IMPLEMENTATION.md`); they are not caused by this change.

## Deviations and concerns

- **Time grain.** The existing time contributor resolver is reused unchanged. Time
  scope include/exclude and the time `id` lens still return `unsupported_join`; the
  time resolver is owned by 6-06/6-04b. This conflicts with this brief's "all six
  grains" wording, but crossing into the time resolver would exceed this unit's
  boundary and duplicate 6-06. Time fields that do not apply also remain 6-06 work.
- **Catalogue validation.** Dynamic checks and content kind/check are validated only
  when `CohortResolveOptions.Checks` is supplied. The current `serve` call site passes
  no options, so it remains permissive until the target-integration unit threads the
  active catalogue. The resolver API supports the required validation.
- **`content_bytes`.** Implemented as `wf_cohort_blob_bytes(dir,hash)` because the
  measure requires filesystem stat. Callers must pass the tenant blob directory in
  `CohortResolveOptions.BlobDir`; target integration must supply it.
- **Plan association.** Association and `sessions` now follow 17.3's "active in the
  window with lifetime plan artifacts" rule. The older 6-01 plan entity SQL derives
  associations from in-window artifact facts only; target integration should confirm
  both paths use the contract rule.
- No new grain, join, route or schema publication was added.
