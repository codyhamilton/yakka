# Report: phase2-gate-eviction-fix — delete gate eviction

Status: `done`

Branch: `feat/23b-review-controls-trial`

## Defect

Phase 2 intentionally kept per-tenant admission gates in memory after a
delete (`phase2-03-reset-delete-execution-engine.md` carried this as bounded
residue: "Per-tenant gate entries are retained in memory after delete"). Final
review found this is cleanup residue that should not outlive a successful
delete.

Removing the entry naively risks reopening storage: a request that obtained a
fresh gate after eviction must still be refused as unregistered before
`s.tenant` opens the tenant directory.

## Fix

`packages/yakka/internal/serve/tenant_lifecycle.go`:

- Added `evictTenantGate`, which drops `s.gates[name]` under `s.mu`.
- The successful `lifecycleOpDelete` branch calls it only after
  `CompleteTenantDelete` and after proving the id is unregistered and has no
  lifecycle record. That runs while `runTenantLifecycle`/resume still holds the
  gate's exclusive write lock.
- A racing post-delete request therefore either reaches the old gate (write
  side held, `TryRLock` fails with `ErrTenantLifecycleBusy`) or creates a new
  gate whose `TryRLock` succeeds and then fails the remote-mode
  `tenantRegistered` check with `ErrTenantNotFound` before any storage open.
  `s.tenant` repeats the registry check, so no lazy open is possible.
- Reset does not evict; reset behavior is unchanged.

## Tests

`packages/yakka/internal/serve/lifecycle_conformance_test.go`:

- Added `assertNoTenantGate` and asserted the deleted id has no `s.gates`
  entry after the HTTP `204` delete.

`packages/yakka/internal/serve/lifecycle_engine_test.go`:

- Asserted no gate remains after a direct `DeleteTenant` and after a
  restart-resumed delete (`TestLifecycleDeleteFaultResume`).
- The direct-delete test already calls `beginTenantUse` afterwards, so it also
  proves a newly created gate still fails on the unregistered check and does
  not recreate the directory.

## Check output

With the eviction call temporarily disabled, the new assertions reproduced the
residue:

```
--- FAIL: TestLifecycleConformanceResetDeleteThroughHTTP
    lifecycle_conformance_test.go:181: deleted tenant "t-..." still has an admission gate
--- FAIL: TestDeleteTenantErasesEverythingAndRefusesLazyAdmission
    lifecycle_engine_test.go:272: deleted tenant "t-..." still has an admission gate
--- FAIL: TestLifecycleDeleteFaultResume
    lifecycle_engine_test.go:393: deleted tenant "t-..." still has an admission gate
FAIL
```

After (`TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp`,
`GOMEMLIMIT=8GiB`):

```
$ go test ./internal/serve/ -run 'TestLifecycleConformance|TestDeleteTenantErasesEverything|TestLifecycleDeleteFaultResume|TestLifecycleFaultResumesSameOperation' -count=1
ok  .../internal/serve  1.230s

$ go test ./internal/serve/ -count=1
ok  .../internal/serve  14.510s

$ go vet ./internal/serve
(no output)

$ gofmt -l internal/serve/tenant_lifecycle.go internal/serve/lifecycle_conformance_test.go internal/serve/lifecycle_engine_test.go
(no output)

$ git diff --check
(no output)
```

## Scope

Only `tenant_lifecycle.go`, `lifecycle_conformance_test.go`,
`lifecycle_engine_test.go` and this report changed. No reset behavior, push,
merge, deploy, credentials, paid/live calls or external worktrees. Test
artifacts used `TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp` with an
8 GiB memory cap; nothing wrote to `/tmp`.
