# 3-02 Bounded aggregate storage reads

Status: done with concerns

## Delivered

- Usage query aggregation now runs through SQL dedupe, ranking, folding and grouping. Cost and priced/unpriced calls use deterministic SQLite scalar functions backed by the existing Go pricing contract, so exact existing pricing/null behavior is retained without retaining scanned calls in Go.
- Distribution writes samples to SQLite temporary storage, groups conversations there, and computes exact interpolated percentiles with window functions. Go retains only returned top groups and bins. Its ordering, top truncation, cost bins and unpriced behavior remain covered by existing store tests.
- Score series streams the hash/bucket population into a SQLite temporary table, joins scores by hash, selects the latest score per hash/check and computes exact quartiles in SQL. This removes the dynamic `IN` bind list. A new regression proves 32,767 distinct hashes succeed.
- Store bucketing supports `year` and internal `year:<step>` 1/2/5-style steps while leaving the published legacy bucket list unchanged.

## Candidate comparison

Direct SQL aggregation fits usage values and exact score ranks: dedupe, joins and percentile ordering stay in SQLite and Go receives only output groups. A Go streaming accumulator would avoid keeping input rows but still make Go memory scale with distinct hashes or conversations for exact ranks. Day rollups would add storage, rebuild and write-path costs and cannot replace arbitrary requested groupings; no new storage tier was added. Distribution and score rank work uses SQLite temporary work tables/window sorts, which may spill to disk and preserves exact values. No approximation was introduced.

## Verification

- Before changes: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store -run 'Test(Query|Distribution|ScoreSeries|Usage|HookRollup|ConversationRollup)' -count=1` passed. Thus the pre-change suite did not identify a failing storage check; the issue was unbounded implementation shape.
- After changes: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store -count=1` passed, including the new 32,767-hash ScoreSeries regression. The focused Query/Distribution/ScoreSeries/Usage run also passed.
- Stale route assertions remain: `TestDistributionRangeTooWide` and `TestScoreSeriesRangeTooWide` fail because they expect the removed range refusal and receive 200. Their tests are outside this brief's owned paths, so they were not changed.

## Concerns and unfinished work

- The brief's explicit allocation-growth check was not added. The SQL/temp-table implementation removes scanned-row collections from these three paths, but no stable heap-allocation comparison at increasing row counts was measured.
- Year and multi-year grouping is implemented in store bucket expressions. The owned paths do not include the serve planner, so `bucket=auto` retry across year/multi-year levels and delivery of executable month-overflow suggestions are not wired here; the Phase 3 integration owner must connect the planner to the internal `year` / `year:<step>` bucket spellings and test them end to end.
- The requested route-test refresh is actionable in the serving unit: update the two named assertions to verify wide-range acceptance. No route or unrelated path was modified.
- The 14-turn brief budget was exceeded while implementing and fixing the SQL aggregation paths.
