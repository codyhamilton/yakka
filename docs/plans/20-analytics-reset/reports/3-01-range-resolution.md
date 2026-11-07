# 3-01 Range resolution and budget responses

Status: done with concerns

## Delivered

- Shared filter parsing accepts long windows, `all=1` starts at the signed nanosecond minimum (so pre-epoch data is visible), and timestamps outside the inclusive representable interval return HTTP 400 with code `time_out_of_range` and the supported endpoints.
- `/query` accepts `bucket=auto` and a lower-only `max_cells` parameter, preserves requested window dates in additive metadata, reports requested/effective bucket, step, coarsening and cell count, and refuses visible over-budget/truncated results as `too_many_cells` or `too_many_series` with suggestions. Legacy omitted bucket defaults and `/schema.buckets` remain unchanged.
- Updated the current API contract and remote-service design notes to describe the new range behavior and the remaining storage-planner dependency.

## Candidate comparison

- Route-specific fit checks are small and reuse each route's bucket vocabulary, but they cannot correctly budget a time bucket multiplied by one or two returned dimensions. The multi-century fixture has 6,001 monthly buckets and a sparse two-dimension result that fits; window width alone would either refuse that valid result or miss a dense overflow.
- A shared cell planner can combine calendar span, actual returned key cardinalities and `max_cells`, then pick or suggest the next resolution consistently. This is the selected design because it matches the fixed bucket × key-tuple cell semantics and never weakens the 20,000-cell ceiling. This unit adds route-side checks only; year/multi-year grouping and auto retry require the storage query planner in 3-02.

## Verification

- Before: the new ten-year HTTP regression failed with `400 range too wide`.
- After: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestAnalytics(Query|Schema|Outcome)' -count=1` passed. Fixtures cover ten years, `all=1` with a 1900 fact, exact accepted and one-nanosecond-outside endpoints, auto day selection, explicit series/cell overflow, and a fitting 1700–2200 two-dimension result with both requested dates retained.
- `git diff --check` passed.
- Full `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -count=1` had two expected stale assertions in unowned files: `TestDistributionRangeTooWide` and `TestScoreSeriesRangeTooWide` still require the removed width refusal. Each currently receives 200. No unrelated test files were changed.

## Carried work and known problems

- 3-02 must add year and deterministic 1/2/5 multi-year storage grouping, make `auto` retry at those calendar resolutions after cell overflow, and ensure a month-overflow suggestion is executable.
- The server store still performs its existing 20,000-row slice before this handler sees `QueryResult`; this handler converts `Truncated` to an error and returns no sliced rows, but 3-02 must move overflow detection/planning before truncation.
- 3-02 or phase integration should update the two stale route tests named above to assert wide-window acceptance.
- This unit does not prove long-history heap, deadline, cancellation, concurrency or p95 behavior; these belong to 3-02/3-04.

No other departure or external gate.
