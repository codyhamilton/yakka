# 6-03 — Cohort target-route integration

Status: done with concerns

## Before and after evidence

Before implementation, the new fixture-backed `/query` test failed: the fixed session cohort selected one session, but `/query?measure=conversations` returned both (`v=2`). The existing required cohort/query route check passed before implementation.

After implementation, `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Cohort|Query|Distribution|Conversation|Execution|Score|Explore|Entity|Activity)' -count=1` passes in both packages. The new route test verifies inclusion selects the one-session source and exclusion subtracts that resolved set, leaving the other session. `git diff --check` passes.

## Result and limits

- `parseFilter` now parses and resolves `cohort=` once for every existing handler that uses the shared filter. It stores the parameterized session subquery in `AnalyticsFilter`; fact-backed and rejection reads apply the target's own filter/window and then include or subtract the positive resolved session set. Exclusion uses `NOT IN` over the positive resolver output, never predicate complement.
- The cohort predicate disables hourly facet rollups, which cannot preserve the session membership constraint. Unfiltered requests retain their prior filter and response behavior.
- Malformed definitions return `cohort_invalid`; unsupported source mappings return `unsupported_join` with a reason before target queries produce output. No cohort capability was added to `/schema`; Plan 21/22/23 remain detect-only.
- This unit relies on the common shared-filter SQL path for route propagation. Response population metadata/count labels were not added to legacy non-entity response shapes; typed population metadata remains a phase-level integration concern.

## Gates

- gate: `scope.include` and `scope.exclude` element syntax is unspecified; non-empty lists remain rejected by the resolver.
- gate: content cohorts need selected kind/check metadata absent from the definition; the resolver continues to reject them.
- gate: source predicates requiring unsupported derived measures/lenses or time membership remain named errors; time cohort resolution belongs to 6-04.
