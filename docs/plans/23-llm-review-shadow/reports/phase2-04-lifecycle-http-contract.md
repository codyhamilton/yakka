# Report: phase2-04 — Owner lifecycle HTTP contract and refusal ordering

Status: `done with concerns`

Branch: `feat/23b-review-controls-trial`

## What changed

- New `packages/yakka/internal/serve/tenant_lifecycle_http.go`:
  - Route parsing accepts only `POST /v1/tenants/<id>/reset` and `DELETE /v1/tenants/<id>`; other methods return `405` with `Allow`, other subpaths `404`, and `/v1/tenants` create is untouched.
  - Gate order is exactly: any `Authorization` header (`403 tenant_lifecycle_ui_only`) → local/keyless (`403` same body) → owner cookie session (`401 session_required` with sign-in hint) → exact public-API `Origin` + `Sec-Fetch-Site: same-origin` when present + `X-Yakka-UI: tenant-lifecycle` (`403`) → JSON content type (`415 json_required`) → registry existence/ownership without `s.tenant()` (`404 tenant_not_found` / `403 tenant_owner_required`, including admin non-owner) → exact nonempty `confirm_tenant_id` (`400 tenant_confirmation_mismatch`) → trustworthy lifecycle marker (`409 legacy_tenant_cleanup_unsupported`) → engine.
  - Engine mapping: nil → `204` no body; busy/conflict → `409 tenant_busy`; incomplete/timeout/fault → `503 tenant_cleanup_incomplete`; legacy → `409`; late not-found/non-owner → `404`/`403`. No success on failure.
  - Mandatory human-owner sentence is in the route doc comment and the 403 body.
- `packages/yakka/internal/serve/serve.go`: one registration line `mux.HandleFunc("/v1/tenants/", s.handleTenantLifecycleRoute)` so the refusal also applies in local/keyless mode.
- New `packages/yakka/internal/serve/lifecycle_http_test.go`: refusal matrix, success/repeat semantics, fault/busy mapping, local mode, legacy tenant, and guessed MCP tools.
- This report.

## Check output

Before (first targeted run; test-side expectation bug — MCP places the JSON-RPC error at the reply top level):

```
--- FAIL: TestLifecycleHTTPGuessedMCPToolsAreUnknown (0.03s)
    lifecycle_http_test.go:436: reset_tenant result: map[string]interface {}{"error":map[string]interface {}{"code":-32602, "message":"unknown tool"}, "id":"call-id", "jsonrpc":"2.0"}
FAIL
```

After (`TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp`):

```
$ prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'LifecycleHTTP|Lifecycle|Reset|Delete'
ok  .../internal/serve  0.921s

$ prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve
ok  .../internal/serve  13.284s

$ go vet ./internal/serve && go build ./...
(no output)
$ git diff --check
(no output)
```

The refusal matrix asserts the exact status/error (and the 403 message), `Allow` on 405s, and an unchanged digest of the tenant directory, registry tokens/lifecycle, grants, claims and spend for every refusal. Success tests prove reset keeps id/name/owner/marker with a new generation, purges tokens/grants/attributed spend while the provider-wide total is unchanged and another tenant's bytes survive, wipes again on a repeated reset, and that delete removes identity before a repeat returns `404`. Local mode, legacy, guessed MCP tools and `?tenant=`/admin-name authorization were each covered.

## Departures

- **Line budget:** ~839 changed lines (176 production, 663 tests) against ~300. The required refusal matrix, each asserting unchanged state across four stores, accounts for the test size. Following the phase2-03 precedent I finished rather than stopping, because every done-evidence check passes; flagged as a concern.
- **Timeout proof:** the test drives `context.DeadlineExceeded` through the existing engine `LifecycleFault` seam at `after-begin`; the handler maps the resulting `ErrTenantCleanupIncomplete` to `503`. A real request deadline against an idle tenant would finish successfully, so this seam is the deterministic way to prove a timeout result is never `204`. No real blocked-review deadline was driven.
- 405/404 subpath bodies use the existing generic `{"error":"not found"}` / `{"error":"method not allowed"}`; the contract specifies only status and `Allow`.
- `ErrTenantLifecycleConflict` (unreachable in normal operation) is mapped to `409 tenant_busy`.

## Contradictions

- **Local non-JSON POST:** the contract says local mode returns `403 tenant_lifecycle_ui_only`, but the pre-existing `localGuard` runs before the mux and returns `415` for any local non-JSON POST, so a non-JSON local reset is refused before the lifecycle gate. A JSON local reset (and any local DELETE) gets the required `403`. The owned paths allow only route registration in `serve.go`, so `localGuard` was not changed.

## Problems / unfinished

- The busy test reaches busytown via `BeginTenantReset` then a DELETE; it proves the engine-level `409 tenant_busy` mapping but does not hold a real in-flight review/cleanup gate.
- Reset-generation cursor invalidation, `/v1/me` rendering, the API-origin profile view and Pages selection clearing are later units (2-05, 2-06, 2-08) and are not touched here.
- No other known problems.
