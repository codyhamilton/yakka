# 6-04b — Time-cohort contributor and timezone completion

Status: done with concerns

## Before and after evidence

Before this unit, report 6-04 recorded that the required store/serve query passed but no time-cohort contributor fixture existed, and that the resolver rejected the time grain. After this unit, `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Cohort|Entity)' -count=1` passes. New fixtures cover a New York calendar-day boundary, a deduplicated Claude usage message crossing that boundary, and an orphan rejection excluded from session membership. The full bounded store/serve suites pass (`go test -p=3 ./internal/store ./internal/serve -count=1`, store 6.916s, serve 25.562s). `git diff --check` passes.

## Result and limits

- Time-cohort bucketing now follows the captured calendar unit, step and timezone, including local DST boundaries and multi-year buckets.
- Source bucket evaluation aggregates the supported time measures: facts, deduplicated usage and receipt-time rejections. Membership contributors are limited to the named fields' existing fact/call/rejection identities and the inclusive source window. No causal pairing or synthetic sessions are introduced.
- Rejection membership includes only recorded conversation IDs that resolve to existing fact sessions. The resolver does not yet expose separate missing/orphan association counts through an existing response field.
- Source scope `include`/`exclude` lists remain rejected because their element syntax is unspecified by the current contract.
- Cohort capability remains unpublished.

gate: Add a defined response path for separate missing/orphan rejection association counts before publishing time-cohort support.

gate: Define source scope include/exclude element semantics before supporting non-empty source lists.
