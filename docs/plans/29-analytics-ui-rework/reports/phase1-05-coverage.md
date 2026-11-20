# Phase 1 unit 05: empty-ledger schema and coverage facts

Status: **done**.

## What changed

- `packages/yakka/internal/store/session_entities.go` — `AnalyticsCoverage`:
  - The session aggregate `SUM(CASE ...)` columns that returned `NULL` on an
    empty ledger are wrapped in `COALESCE(...,0)`, so a fresh tenant yields zero
    `total` / `with_session_repo` / `without_session_repo` instead of a scan
    error.
  - Added a top-level `usage` recency entry (`first_ts`, `last_ts`,
    `last_received_at`) derived only from `type='hook_event' AND
    norm_event='usage'` rows. It is `null` when there are no usage facts, never a
    zero timestamp.
  - Added `units: {ts:"unix_seconds", received_at:"unix_nanoseconds"}` so the
    client converts seconds vs nanoseconds by contract. No revision identifier
    was invented.
  - Existing `facts` (per-type `first_ts`/`last_ts` in Unix seconds and
    `last_received_at` in Unix nanoseconds), `sessions` and
    `scored_content_by_kind` keys are unchanged; `facts` remains an empty
    object, not nil, on an empty ledger.
- `packages/yakka/internal/store/coverage_empty_test.go` (new) —
  `TestAnalyticsCoverageEmpty`: fresh store returns no error, empty `facts`,
  zero session counts, null usage and the explicit units.
- `packages/yakka/internal/serve/analytics_empty_schema_test.go` (new) —
  `TestAnalyticsSchemaEmptyTenant`: fresh tenant `GET /v1/analytics/schema` is
  200 (not `read failed`), `coverage.facts` is empty, session counts are zero
  and `coverage.units` is explicit.

`/schema` route construction beyond the coverage payload, catalogue,
resolutions, scatter, plan and conversation code were not modified.

## Done evidence

Before (tests written first, `GOTOOLCHAIN=auto`, `GOMEMLIMIT=8GiB`, cwd
`packages/yakka`):

```
$ go test ./internal/store -run '^TestAnalyticsCoverageEmpty$' -count=1
--- FAIL: TestAnalyticsCoverageEmpty (0.01s)
    coverage_empty_test.go:12: empty ledger coverage: sql: Scan error on column
    index 1, name "SUM(CASE WHEN coalesce(r.n,0)>0 THEN 1 ELSE 0 END)":
    converting NULL to int is unsupported
FAIL

$ go test ./internal/serve -run '^TestAnalyticsSchemaEmptyTenant$' -count=1
--- FAIL: TestAnalyticsSchemaEmptyTenant (0.01s)
    analytics_empty_schema_test.go:13: empty schema: 500 {"error":"read failed"}
FAIL
```

After:

```
$ go test ./internal/store -run '^TestAnalyticsCoverageEmpty$' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/store  0.011s

$ go test ./internal/serve -run '^TestAnalyticsSchemaEmptyTenant$' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.014s

$ go test ./internal/store -run 'TestAnalytics|TestCoverage' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/store  0.825s

$ go test ./internal/serve -run 'Analytics' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  195.412s
```

Toolchain: the default is go1.24.2; `GOTOOLCHAIN=auto` fetched and used
go1.27.1 (the `go.mod` `go 1.27.1` directive). `gofmt -l` reported no files.
No `/tmp`, fixed sleeps, agents, network, fly/wrangler, deploy or secrets were
used.

## Deviations

- The brief says to commit the unit; the orchestrator directive for this run says
  not to commit and to leave changes and the report in the working tree for the
  orchestrator to commit. Followed the orchestrator: nothing was committed.
- The brief's production-parity step asks to read
  `/home/codyh/.config/yakka/trial.env` + `client.toml` and query the running
  trial tenant. The orchestrator forbids reading/printing secrets and touching
  the Plan 28 trial, so parity was not attempted; recorded as a gate below.
- The browser observable is owned by parallel unit phase1-01 (tenants
  `plan29-b`/`plan29-a`); not run in this unit.

## Unfinished work

- Phase 1 fresh-tenant browser check (phase1-01): confirm `plan29-b` shows a
  valid schema with an explicit zero/empty Coverage state, and `plan29-a` shows
  both last-event and latest-usage times with plausible dates.
- Production parity read of `/v1/analytics/schema` against the deployed tenant,
  by whoever holds the authorized credentials.

## Known problems

- None found in this unit's code beyond the fixed empty-ledger path. No
  non-trivial bug was observed outside this unit's done evidence.

## Gates

- gate: production parity — not attempted; the run forbids reading the trial
  credentials and touching the running Plan 28 trial.
- gate: browser observable — deferred to phase1-01 (no browser in this worker).
- gate: Go 1.27.1 toolchain — satisfied; `GOTOOLCHAIN=auto` fetched go1.27.1.
