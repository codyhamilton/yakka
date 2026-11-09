# Report: phase2-localguard-fix — local lifecycle refusal ordering

Status: `done`

Branch: `feat/23b-review-controls-trial`

## Defect

In local/keyless mode `localGuard` wraps the whole handler. Its generic
`POST` content-type check answered `415 content type must be application/json`
before `/v1/tenants/<id>/reset` could apply the lifecycle contract's local-mode
`403 tenant_lifecycle_ui_only`. A local `DELETE /v1/tenants/<id>` was already
unaffected because the guard checks only `POST`. This was the carried
contradiction recorded in `phase2-04-lifecycle-http-contract.md`.

## Fix

`packages/yakka/internal/serve/serve.go`:

- The generic local `POST` content-type check now skips the lifecycle route
  subtree (`/v1/tenants/`), so those requests reach
  `handleTenantLifecycleRoute` and its own method, credential and local-mode
  refusals.
- Added `tenantLifecyclePath`, a prefix predicate for that subtree.
- The loopback Host check remains first and unchanged for every route, so
  DNS-rebinding protection is preserved; non-loopback requests still get
  `403 local mode accepts only loopback hosts`.
- No local lifecycle success path is added: the lifecycle handler still returns
  `403 tenant_lifecycle_ui_only` whenever `!s.cfg.Remote()`.

`packages/yakka/internal/serve/lifecycle_conformance_test.go`:

- The local-mode block now covers both `POST /v1/tenants/local/reset` with a
  non-JSON `Content-Type` and `DELETE /v1/tenants/local`, asserting the exact
  `403 tenant_lifecycle_ui_only` plus the mandatory message.
- Each case snapshots and re-checks `lifecycleStateDigest` over the tenant
  directory, registry (tokens and lifecycle record), reservations and grants,
  proving no effects.
- `TestLocalModeHTTP` continues to prove `/v1/ingest` non-JSON POSTs get `415`
  and non-loopback hosts get `403`.

## Check output

Before the fix, the new regression case reproduced the defect:

```
--- FAIL: TestLifecycleConformanceRefusalsNoEffects/local_reset
    lifecycle_conformance_test.go:368: status=415 body={"error":"content type must be application/json"} want=403
--- PASS: TestLifecycleConformanceRefusalsNoEffects/local_delete
```

After (`TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp`,
`GOMEMLIMIT=8GiB`):

```
$ go test ./internal/serve/ -run 'TestLifecycleConformanceRefusalsNoEffects/local' -count=1 -v
--- PASS: TestLifecycleConformanceRefusalsNoEffects/local_reset
--- PASS: TestLifecycleConformanceRefusalsNoEffects/local_delete
PASS
ok  .../internal/serve  0.042s

$ go test ./internal/serve/ -count=1
ok  .../internal/serve  14.535s

$ go vet ./internal/serve
(no output)

$ gofmt -l packages/yakka/internal/serve/serve.go packages/yakka/internal/serve/lifecycle_conformance_test.go
(no output)
$ git diff --check
(no output)
```

## Scope

Only `serve.go`, `lifecycle_conformance_test.go` and this report changed. No
push, merge, deploy, credentials, paid/live calls, other worktrees or plans,
review or close-out. Test artifacts used
`TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp` with an 8 GiB memory
cap; nothing wrote to `/tmp`.
