# Phase 3 runner note

After the 3-04 unit commit, the independent row-growth check exposed a per-sample Go scan in distribution histogram binning. The store now calculates histogram counts in SQLite for only the selected groups; Go receives at most `top × 22` bin rows.

Two tests compare Go `TotalAlloc` for 128 versus 2,048 scanned usage or distribution rows after query-path warmup. Usage stayed at 3,288 bytes; distribution changed from 21,360 to 21,856 bytes. Both pass the fixed-overhead tolerance at a 16× input increase. ScoreSeries is covered by the existing 32,767-distinct-hash success test and streams each hash through a SQLite temporary population, but no cross-size allocation comparison was added because per-row driver/bind churn dominates total allocations; its peak-retention bound remains supported by the SQL/output shape rather than a direct measurement.

The keyset page traversal also now has a fixture test with 20,005 equal-time facts: a 20,000-row first page and five-row second page return 20,005 distinct keys with no duplicates or omissions.

Integrated verification after this follow-up: `GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 7.349s; serve 24.905s). The all-time/auto fixture benchmark and runtime cancellation/concurrency evidence are recorded in `reports/3-04-runtime-bounds-and-benchmark.md`.
