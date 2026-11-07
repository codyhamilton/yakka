# 3-03 Paged reads and honest coverage

Status: done with concerns

## Delivered

- `/series` now groups daily and Monday-start weekly buckets in the requested IANA timezone, including daylight-saving transitions. A deterministic SQLite scalar uses Go's timezone database for calendar boundaries.
- Conversation usage events expose the server's `priced` result alongside `cost_usd`; an unpriced zero-cost call stays explicitly unpriced. `/conversation`, `/distribution` and `/score-series` now report `partial: true` and `partial_reasons: ["compaction_incomplete"]` when compaction is required.
- Updated the two stale wide-window assertions to expect successful responses.

## Candidate comparison

For `/explore`, the contract-compliant strategy is keyset traversal on `(event_time desc, source_type asc, source_key asc)` bound to the canonical filters, resolved window and first-page receive watermark. Offset paging and a response cap cannot prove a stable traversal under late arrivals. The route handler and shared cursor live in `serve/analytics.go`, which is explicitly outside this unit's owned paths; no store-only cursor was added because it would not be reachable through the API.

## Verification

- Before: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestDistributionRangeTooWide|TestScoreSeriesRangeTooWide' -count=1` failed both stale assertions: each expected 400 and received 200.
- After: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed.
- Added checks for local calendar day bucketing, priced and unpriced conversation events, partial reason output, and wide-window acceptance. `git diff --check` passed.

## Carried integration and deviation

The 20,000-plus `/explore` cursor traversal, stable tie paging, receive watermark and explore-event `priced` JSON field remain unimplemented because their HTTP handler is in the excluded `serve/analytics.go`. `partial_reasons` also needs to be applied to every other analytics route in that shared handler. No cursor traversal result is claimed by this unit.

gate: phase owner must integrate `/explore` keyset paging and watermark in `serve/analytics.go`, expose explore `priced`, and apply `partial_reasons` across all analytics routes before Phase 3 closure.
