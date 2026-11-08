# 6-04 — Time cohorts and activity feed

Status: done with concerns

## Before and after evidence

Before implementation, the required package check passed, but no time-cohort/activity tests existed. After adding a fixture test for the missing `/activity` behavior, the same check failed: `TestAnalyticsActivityMergesAndPagesEqualTimeRows` returned HTTP 404. The time-source resolver test also established the prior resolver rejected the time grain.

After implementation, `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Activity|Cohort|Entity)' -count=1` passes in both packages. Fixtures cover time-source SQL and commit contributors, equal-time session/artifact/execution activity paging without duplicate identities, and late arrivals counted by receive watermark without returning rows. `git diff --check` passes.

## Result and limits

- Time sources now require frozen `fields`, `bucket` and `bucket_step` metadata; supported source measure/predicate names are validated. The SQL resolver selects distinct contributor sessions from selected buckets and preserves positive-source resolution before target include/exclude.
- Added tenant-authenticated, deadline/cancellation-bounded `/v1/analytics/activity` list and probe modes. The merged list pages by event time descending, type ascending and type-qualified identity ascending. Existing facts produce session-start, artifact-version and brief-execution rows; rejections retain their recorded association. Probe returns counts and an opaque receive watermark only.
- `/schema` advertises the implemented activity route. Cohort capability remains unpublished, and no Plans 21/22/23 capability was added.

## Gates

gate: Time-cohort resolution currently supports source contributors for hook events, artifact versions/content, commits and conversations. Deduplicated usage measures and rejection contributors need their measure-specific identities and explicit missing/orphan association counts before they can be advertised.
gate: Time-cohort bucket SQL currently uses UTC bucket expressions; non-UTC fixed-grid reproduction must be implemented and verified before time cohorts can be advertised.
gate: Activity filters that have no rejection-row dimension are returned in `ignored_filters`; confirm whether the consumer contract requires rejecting those filters instead of reporting them as ignored.
