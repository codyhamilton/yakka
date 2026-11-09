# Report: phase2-02 — Claim and reservation ownership plus anonymous spend transfer

Status: `done`

Branch: `feat/23b-review-controls-trial`

## What changed

- `internal/review/availability.go`:
  - Reservations document is now format `version: 2`. New spend entries carry `tenant` + `version`; new claims are `claimRecord{id,tenant,version}` records instead of bare strings.
  - Version-1 files still decode: `spent` keeps its `at/amount/key/attempt` shape, `claimed map[string]string` becomes tenant-less/version-0 records. Legacy rows stay readable for duplicate lookup and are never assigned a tenant, removed, retargeted or refunded.
  - Added `WaitTenant(ctx, tenant)` plus a change-notification channel. It waits while the tenant has an in-flight claim/ephemeral call, wakes on `finish`/`finishClaim`, and returns `ctx.Err()` on cancellation/deadline.
  - Added `TenantResidue(tenant)` for read-only cleanup checks.
  - Added `PurgeTenant(tenant)`: under one lock, filters tenant claims and attributed spend, appends anonymous spend entries containing only the original `At`/`Amount`, and performs one atomic save. The provider-wide total is preserved; a repeat purge (including after reload) returns without saving. On save failure the previous `spent`/`claimed` state is restored and an error is returned; `active` is only cleared after a successful save.
  - `begin` records the tenant it already received; `beginEphemeral` and `reserveRetry` attribute their spend. `settle`/`finish`/`finishClaim` semantics are unchanged.
- `internal/review/orchestrator.go`: unchanged. Its `begin(key,id,tenant,amount)` and `claimState(key)` call sites already pass/receive what the new record type exposes.
- `internal/review/availability_test.go` (new): persisted tenant/version and reload; hand-written version-1 document duplicate lookup plus purge non-interference; tenant A purge leaving B, anonymous same-`At`/`Amount` rows and exactly unchanged total; repeat/reload purge idempotence; wait release on `finishClaim`/`finish`, blocking while held, and cancellation.

## Check output

Before implementation the new checks could not compile (`PurgeTenant`, `TenantResidue`, `WaitTenant` absent). The first run after the implementation failed on two test expectations:

```
--- FAIL: TestReservationLegacyVersionOneStaysUnattributed
    availability_test.go:119: purge removed a legacy claim
--- FAIL: TestReservationPurgeTenantTransfersAnonymously
    availability_test.go:171: tenant B claim changed: "b-id" 1
```

The first was the test helper reading only the v2 `claims` key; the second was the test leaving tenant B's call active. Both were test-side corrections, not production defects.

After (`TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp`, outside `/tmp` and the repo):

```
$ TMPDIR=... prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review -run 'Reservation|Claim|Review|Ephemeral|Duplicate|Restart'
ok  github.com/codyhamilton/yakka/packages/yakka/internal/review  1.867s

$ TMPDIR=... prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review
ok  github.com/codyhamilton/yakka/packages/yakka/internal/review  4.665s

$ go build ./internal/review && go vet ./internal/review
(no output)

$ git diff --check
(no output)
```

## Deviations

- Line budget: about 526 changed lines (166 production insertions plus a 360-line new test file) against the ~250-line guidance. File reads (8) and tool turns stayed within budget; the excess is required evidence tests.
- Anonymous replacement entries deliberately omit `version` as well as tenant/key/attempt, satisfying “carrying only the same `At` and `Amount`”. They still expire on the normal 24-hour `At` cut.
- `orchestrator.go` needed no edits; no review identity, status, retry or `review_usage` content changed.
- The save-failure restore path is implemented but not separately tested; the required tests cover the successful and idempotent paths.

## Contradictions

None found between the brief and the cited `DESIGN.md` contracts. The version-1 compatibility and “no separate synthetic counter” constraints are both preserved: anonymous rows feed only the shared provider-wide cap and carry no tenant identity.

## Problems / unfinished

- None blocking. Cleanup orchestration (draining, journal, 204/503) belongs to the Phase 2 serve/registry units; this unit now provides the attributed records, quiescence wait, residue check and exactly-once purge they need.
