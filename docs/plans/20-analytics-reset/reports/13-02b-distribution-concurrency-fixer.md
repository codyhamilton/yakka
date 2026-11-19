# 13-02b — Distribution concurrency fixer

Status: `done`.

## Root cause

`Tenant.Distribution` built `TEMP TABLE dist_samples` across several independent
`t.rdb` calls (CREATE/DELETE, INSERT, then three queries). `database/sql`
returns each call's connection to the pool between statements, so concurrent
Distribution calls could execute the sequence on different SQLite connections.
A temp table is per-connection, so the INSERT or a later query could hit a
connection with no `dist_samples`, producing `SQL logic error: no such table:
dist_samples` (or read another call's rows), which serve maps to HTTP 500
`{"error":"read failed"}`.

## Fix

`packages/yakka/internal/store/distribution.go` leases one `*sql.Conn` with
`t.rdb.Conn(ctx)` at the start of the call and runs every statement of that
call on it; `conn.Close()` releases it. The first `rows` set is now closed
before the bin query starts, since a pinned connection holds only one active
operation. Query text, response shape, ordering, percentiles and bin logic are
unchanged.

## Regression test

`TestDistributionConcurrentReads` in
`packages/yakka/internal/store/distribution_test.go` runs 80 calls over 6
measures and both grains (top 10, dim model) with 4 workers. It fails if any
call errors. The pool is set to `SetMaxIdleConns(0)` so the per-statement
connection churn that exposes the bug is deterministic instead of a rare
interleaving.

Before (HEAD code, 10 runs, all failed):

```
--- FAIL: TestDistributionConcurrentReads
    80/80 concurrent distribution calls failed; first: SQL logic error: no such table: dist_samples (1)
```

After (5 runs):

```
--- PASS: TestDistributionConcurrentReads (0.22s)
--- PASS: TestDistributionConcurrentReads (0.21s)
--- PASS: TestDistributionConcurrentReads (0.18s)
--- PASS: TestDistributionConcurrentReads (0.19s)
--- PASS: TestDistributionConcurrentReads (0.19s)
PASS
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/store	0.992s
```

## Required checks

```
$ TMPDIR=.scratch/p13 GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store -count=1
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/store	13.014s

$ TMPDIR=.scratch/p13 GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -count=1
FAIL	TestAnalyticsPageSetSmoke (233.71s)

$ ... go test -p=3 ./internal/serve -count=1 -skip 'TestAnalyticsPageSet'
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/serve	43.547s

$ git diff --check
(no output)
```

## Deviation / known problem

- `TestAnalyticsPageSetSmoke` fails in this worktree because the unowned,
  uncommitted `packages/yakka/internal/serve/analytics_pageset_test.go` change
  sends requests that return 400 for unrelated routes (e.g. `unsupported
  dimension session_model for cost_usd`, `unsupported time mode`); at HEAD that
  file has no such test. This is outside the owned paths and untouched here.
  The rest of `./internal/serve` passes with the pageset tests skipped.
- The regression test uses `SetMaxIdleConns(0)` on the tenant read pool. This
  does not change production behaviour; it forces each statement onto a fresh
  connection so the connection-affinity bug is caught on every run rather than
  intermittently.

No other paths were touched. No gates.
