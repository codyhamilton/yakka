# Report: phase2-01 — Registry lifecycle foundation and `/me` recovery fields

Status: `done with concerns`

Branch: `feat/23b-review-controls-trial`

## What changed

- `registry.go`: `registryDoc` gains additive `lifecycle` map (`Version` stays 1, field omitted when empty); `Registry` loads/saves it. `createTenantLocked` now mints a fresh random marker + generation and `active` state for `CreateTenant` and `EnsureDefaultTenant`. `TenantInfo` gains `LifecycleState` and `LifecycleGeneration *string` (legacy serialises `null`).
- New `registry_lifecycle.go`: `TenantLifecycleRecord{Marker,Generation,State,Operation}`, state/op constants, sentinel errors (`ErrTenantNotFound`, `ErrTenantOwnerRequired`, `ErrLegacyTenantCleanupUnsupported`, `ErrTenantLifecycleBusy`, `ErrTenantLifecycleConflict`), `TenantLifecycle`/`TenantGeneration` reads, `BeginTenantReset`/`BeginTenantDelete` (owner check → marker check → busy check, persist via `saveLocked`), `CompleteTenantReset` (new generation, `active`, clear op, purge tokens), `CompleteTenantDelete` (remove owner/name/lifecycle, purge tokens), and `PurgeTenantTokens`. Sessions are never touched.
- `session.go`: `tenantsOwnedBy` reads the lifecycle map in memory (never `s.tenant()`/disk); missing record → `unsupported` + nil generation; in-progress states stay listed.
- `device_grants.go`: `purgeTenant(tenant)` drops only grants whose attributed `tenant` matches; pending grants (empty tenant) are left alone.
- Tests: `registry_lifecycle_test.go` adds creation/default/restart, `/me` active view, legacy-unsupported + begin refusal ordering, reset→active→delete→absent transitions with generation/marker/name assertions, token purge (revoked+expired) preserving another tenant and sessions, and grant purge. `tenants_test.go` compares the now-pointer generation field by value.

## Check output

Before (tests written first):

```
$ go test -count=1 -p=3 ./internal/serve -run 'Tenant|Registry|Lifecycle|Me'
internal/serve/registry_lifecycle_test.go:29:14: r.TenantLifecycle undefined ...
internal/serve/registry_lifecycle_test.go:30:24: undefined: lifecycleStateActive
...
FAIL  ... [build failed]
```

After:

```
$ TMPDIR=... prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'Tenant|Registry|Lifecycle|Me'
ok  .../internal/serve  0.503s

$ TMPDIR=... prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve
ok  .../internal/serve  12.386s

$ go vet ./internal/serve   # clean
$ go build ./...            # clean
$ git diff --check          # no output
```

## Deviations

- Size budget: ~565 changed lines (191 prod + 302 test + 72 edit insertions) against the ~350 guidance. The five required new test scenarios account for most of it; production code is ~190 lines. Phase1-01 set the precedent of reporting this as `done with concerns`.
- Completion methods purge the tenant's tokens themselves (in addition to exposing `PurgeTenantTokens`). The Changes section describes completion as owner/name/lifecycle removal and a separate purge method, but the Done Evidence says "completing reset/delete removes all tokens"; folding the purge into completion satisfies both and matches the design's "revoke/remove every old token".
- Exported sentinel errors and `TenantLifecycleRecord` so phase2-03/2-04 can map refusals without re-deriving ordering.

## Problems / unfinished

- No HTTP routes, disk erasure, store close, reservation cleanup or profile view here, as scoped.
- `Begin*` persists immediately; completion persists immediately. Later units must treat a failed `saveLocked` as "operation not begun" for the engine's resume logic.

## Contradictions

None found. The brief's separate token-purge method and the done-evidence wording "completion removes all tokens" are reconciled by completion calling the same internal purge; noted above rather than resolved silently.
