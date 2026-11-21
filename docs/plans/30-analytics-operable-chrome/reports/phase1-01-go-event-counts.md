# Handoff — phase1-01 Go event-counts API and shared retained-record predicate

Status: done. Branch `feat/30-analytics-operable-chrome`.

## What changed

- `internal/store/analytics.go`: added `AnalyticsFilter.retainedRecordRejWhere()`, the corrected rejection-side predicate shared with event-counts. Rejection values are time=`at`, kind=`wf_kind(path)`, plan=`wf_plan(path)`, conversation/stage as stored; repo/harness/norm_event/event/tool/model/source are absent (`''`). Includes are OR within a field and AND across fields; excludes use the same values, so excluding a nonempty absent value keeps a rejection. `ExplorePage` now uses this helper. `rejWhere` and every other rejection caller are untouched.
- `internal/store/analytics_event_counts.go`: `Tenant.EventCounts` runs four `COUNT(*)` statements in one read-only transaction (matched facts, matched rejections, all facts, all rejections) and returns both triplets with `rows=events+rejections` and a UTC `CheckedAt` from that transaction. Errors return no partial object.
- `internal/serve/analytics_event_counts.go`: `GET /v1/analytics/event-counts` validates the full query-key vocabulary first (unknown key → 400 `unsupported_filter` with `reason` naming it), then reuses `parseFilter` with `route:"event-counts"`, and writes `matched`, `tenant_total`, `checked_at`, `unit:"retained_record"`.
- `internal/serve/serve.go`: route registered beside the other analytics routes, so it inherits tenant auth and the bounded four-request/one-second/cancellation wrapper.
- `internal/serve/analytics_query.go`: `/schema.features` now advertises `event_counts` and `record_filters`.
- New tests: `internal/store/analytics_event_counts_test.go` (N1 12,480/8,406 facts, 9/4 rejections, all five fact types, a direct manifest check, full paged Explore traversal, predicate table for include/exclude/conversation/absent fields, empty window) and `internal/serve/analytics_event_counts_test.go` (handler shape and reconciliation, conversation scope, `all=1`, unknown key, 503 busy, schema flags, foreign-tenant 403).

## Evidence before and after

Before (failing check, missing method):

```
internal/store/analytics_event_counts_test.go:76:17: tn.EventCounts undefined (type *Tenant has no field or method EventCounts)
FAIL github.com/codyhamilton/yakka/packages/yakka/internal/store [build failed]
```

After:

```
go test ./internal/store -run 'TestEventCounts|TestAnalyticsExplore' -count=1  → ok 1.079s
go test ./internal/serve -run 'TestEventCounts|TestAnalyticsSchema|TestAnalyticsExplore|TestAnalyticsRuntime' -count=1 → ok 0.093s
go test ./internal/store ./internal/serve -count=1 → store ok 8.798s; serve ok 236.274s
go vet ./internal/store ./internal/serve → clean
```

Observable contract covered by the handler tests: `unit:"retained_record"`, nonnegative integers, `matched.rows=matched.events+matched.rejections`, `all=1` makes matched events equal the tenant total, and `conversation_id` scoping returns only that conversation's facts and rejections.

## Departures and interpretation

- `EventCounts` returns the two triplets plus `CheckedAt` in one struct so the handler uses one UTC timestamp from the same read transaction, as brief change 4 requires.
- The rejection-side exclude map applies `kind`/`plan`/`repo_id`/`harness` as well as `conversation_id`/`norm_event`/`event`/`tool`/`model`/`source`, matching DESIGN.md line 75's "exclusions use the same values". The brief's change 1 names the last six explicitly because `rejWhere` already applies repo/harness includes but drops their excludes too.
- Foreign-tenant 403 "no such tenant" is exercised through the remote session path; the bearer path answers a tenant mismatch with the pre-existing 401 unauthorized, which this brief does not change.
- No existing Explore test encoded the old rejection-side ignore behaviour, so no expectation was updated; `TestAnalyticsExplore` still passes unchanged. `Summary`/`Series`/`Activity`/distribution rejection semantics are unchanged.

## Unfinished work

None in this unit. Phase-2 F refusal for the remaining rejection routes is explicitly out of scope.
