# 3-04 Runtime bounds and benchmark

Status: done with concerns

## Delivered

- Added tenant-scoped heavy-read concurrency bound (four requests), a measured one-second default query deadline, 503 `busy`/`query_timeout` responses with retry guidance, and bounded response buffering so timed-out work cannot emit a partial body.
- Verified the modernc SQLite `QueryContext` cancellation path reaches `sqlite3_interrupt`. A file-backed recursive query test confirms deadline response shape and that the sole reader is usable immediately after interruption. The concurrency test checks busy status and retry behavior while a heavy read holds the slot.
- Completed `/explore` keyset paging over stable event ordering, using the first-page received-at and rejection-id watermarks. Added page traversal/tie/watermark coverage and the event `priced` field. This required narrow `internal/store/analytics.go` and `internal/store/analytics_test.go` changes beyond the brief's owned-path list; root authorized this integration and will amend the brief.
- Applied `partial_reasons` to the analytics route responses. Added private multi-year step buckets to `auto` retries and executable bucket suggestions; `/schema` now publishes the effective budgets, resolutions and measured deadline.
- Added all-time and `auto` to the committed synthetic fixture benchmark. Across 2,647 cases, the maximum observed p95 was 4.4 ms; among 335 `auto` cases the maximum was 4.1 ms. The one-second deadline is over 200 times the fixture maximum and twice the contractual p95 ceiling.

## Candidate comparison

SQLite's context-aware query cancellation was selected over HTTP-only cancellation: driver source calls `sqlite3_interrupt`, and the file-backed test proves both interruption and reader release. A tenant-scoped semaphore was selected over relying on the connection pool because pool waiting alone does not provide the required explicit busy response.

## Verification

- Before: Phase 3.03 recorded stale wide-window assertions (expected 400, received 200) and missing `/explore` paging/route coverage.
- After: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 6.012s; serve 23.965s). Focused deadline interruption/reader release and heavy-read concurrency tests passed. `git diff --check` passed.
- Fixture benchmark completed, including all-time and `auto`; full output had 2,647 cases and met the existing p95 bound.

## Remaining evidence and gates

The stable heap-growth check remains unverified. Usage and score aggregation run in SQL; distribution scans its SQLite temporary population row by row and retains only bounded output. A post-GC heap snapshot would not prove peak heap behavior, while an allocation threshold would also count driver scan and SQLite binding churn and would be sensitive to row shape. No reliable peak-heap harness is present in this unit.

gate: run the analytics benchmark with owner-provided `YAKKA_BENCH_DIR` to add real-corpus evidence.
