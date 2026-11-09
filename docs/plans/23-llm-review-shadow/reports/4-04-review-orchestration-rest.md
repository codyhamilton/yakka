# Phase 4 unit 4-04 — Review orchestration and REST routes

Status: `done`

## Delivered

- Added server-only review config validation and availability gates for credential, exact Haiku model, live effort, trial enablement, positive spend cap and tenant/repository allowlist. Local mode, missing or invalid settings, unpriced models and unlisted repositories make zero provider requests.
- Composed repo-scoped criteria resolution, packet building, provider validation, tier-aware pricing, content-addressed capture retention, durable `review_run` ingest and tenant-bound idempotency. Rolling spend reservations and started claims persist in the server data directory; retries reserve separately and timeouts retain their worst-case charge.
- Added authenticated `POST /v1/reviews` and filtered `GET /v1/reviews`; POST requires a bearer `read_write` token, GET permits read scope, receipt responses omit captured input, and `detail=full` adds only the validated payload. Dry runs build and estimate without a call or record.
- Preserved Phase 3 criteria resolution. PR criteria collect each phase Outcome by composing the landed resolver within the selected repository. Updated only the review fact and review environment sections in docs/design/01 and docs/design/03.

## Evidence

Command (from `packages/yakka`):

```sh
ulimit -v 8388608 && GOMAXPROCS=3 TMPDIR="$PWD/.test-tmp" go test -p=3 ./internal/review ./internal/serve ./internal/ingest ./internal/store
```

Output:

```text
ok github.com/codyhamilton/yakka/packages/yakka/internal/review 2.197s
ok github.com/codyhamilton/yakka/packages/yakka/internal/serve 11.832s
ok github.com/codyhamilton/yakka/packages/yakka/internal/ingest 0.419s
ok github.com/codyhamilton/yakka/packages/yakka/internal/store 7.698s
```

`git diff --check` — clean (no output).

Fake fixtures reach every terminal status: `ok`, `ok_partial`, `timeout`, `api_error`, `invalid_output`, `unavailable`, `refused_capture`, `refused_disclosure`, `refused_criteria`, `skipped_budget` and `skipped_duplicate`. They also cover credential rejection, retries, redaction and unsupported findings, unchanged-key resume after trial/budget preflight, changed build models and effort identities, concurrent cap and in-flight reservation, persisted unknown claims, dry-run zero calls, read/write scope, GET filters and tenant isolation. Default, retry and historical requests assert their explicit model/effort fields. No credentials, paid/live calls, deploy, Fly or Wrangler actions were used.

Departures: none. Unfinished work: none. Known problems: none observed. No Phase 4 outcome case or verification gate is blocked.
