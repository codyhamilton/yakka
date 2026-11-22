# Report: phase3-02 — Go tests for adoption, the flag and the unmarked regression lock

Status: done

## What changed

Owned paths only:

- `packages/yakka/internal/serve/registry_lifecycle_test.go` — renamed `TestLegacyTenantReportsUnsupported` to `TestUnmarkedTenantReportsUnmarked` and switched the expected state to `lifecycleStateUnmarked`; every other assertion in it is unchanged (null generation, no record, reset/delete still `ErrLegacyTenantCleanupUnsupported`, owner and not-found errors). Added `TestAdoptUnmarkedTenants` (fixture with `default`, `t-legacy`, `t-marked`; sorted return, 32-hex marker/generation, distinctness, `t-marked` unchanged, disk re-open equality, second call `nil, nil` with byte-identical `registry.json`, `BeginTenantReset` nil, `tenantsOwnedBy` all active with generation), `TestAdoptSkipsNamesWithoutOwner`, and `TestAdoptSaveFailureRestoresMemory` (blocked `r.path`, error, no in-memory record, unchanged `r.dirty`, later successful and persisted adopt). Added the `isHex32` helper.
- `packages/yakka/internal/serve/adopt_startup_test.go` (new) — `writeLegacyAdoptFixture` plus `TestNewAdoptsWhenFlagOn`, `TestNewLeavesUnmarkedWhenFlagOff`, and `TestNewAdoptSecondStartIsByteIdentical` (B4 evidence).
- `packages/yakka/internal/serve/serve_test.go` — `TestConfigAdoptFlag` next to the `ConfigFromEnv` tests: unset/`"true"`/`"1"`/`" TRUE "`/`"false"`/`"0"`/`"maybe"`.
- `packages/yakka/internal/serve/lifecycle_http_test.go` — added `TestLifecycleHTTPAdoptedTenantKeepsConfirmations` after the unchanged flag-off `TestLifecycleHTTPLegacyTenantRefused`: four refusals (mismatched body, missing `X-Yakka-UI`, bearer plus owner cookie, non-owner) each digest-unchanged and with no tenant directory, then a correct reset returns 204.

No product code, `fly.toml`, design doc or mockup touched. `lifecycle_conformance_test.go`, `mcp_lifecycle_test.go` and the engine helpers are unchanged.

## Check output

Before: the package did not compile, because `registry_lifecycle_test.go` still referenced the removed `lifecycleStateUnsupported` (reproduced by restoring the committed test file and running the renamed test; `isHex32` was also not yet defined at that moment):

```
$ TMPDIR=... go test ./internal/serve -run TestUnmarkedTenantReportsUnmarked -count=1
internal/serve/adopt_startup_test.go:134:55: undefined: isHex32
internal/serve/registry_lifecycle_test.go:102:30: undefined: lifecycleStateUnsupported
FAIL	github.com/codyhamilton/yakka/packages/yakka/internal/serve [build failed]
```

After (all with `TMPDIR=/home/codyh/workspace/yakka-build/31/.scratch/t`):

```
$ gofmt -l internal/serve/registry_lifecycle_test.go internal/serve/adopt_startup_test.go internal/serve/serve_test.go internal/serve/lifecycle_http_test.go
(no output)

$ go test ./internal/serve -run 'TestUnmarkedTenantReportsUnmarked|TestAdopt|TestNewAdopt|TestNewLeavesUnmarked|TestConfigAdoptFlag|TestLifecycleHTTPAdopted|TestLifecycleHTTPLegacyTenantRefused' -count=1
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/serve	0.092s

$ go test ./internal/serve -count=1          # B1
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/serve	287.409s
$ go vet ./...                               # B1
(no output)

$ git diff --check
(no output)
```

## B4 evidence

`TestNewAdoptSecondStartIsByteIdentical` writes one legacy fixture, starts with the flag on, reads `registry.json`, closes, starts again with the same config and dir, and compares bytes. The test log:

```
registry.json SHA-256 after first start:  c7caf1a71d040288d924375bc5d73298203d963439f7234403b526d91e53806a
registry.json SHA-256 after second start: c7caf1a71d040288d924375bc5d73298203d963439f7234403b526d91e53806a
```

The values are equal; the first start adopted `t-legacy` (`active`, 32-hex marker and generation) and the second start left the marker and generation unchanged. The run used `TMPDIR` under `.scratch/t`.

## B3 inspection

Commands and result:

```
$ grep -rniE 'lifecycle_state|lifecycleState|lifecycle|unmarked|unsupported' \
    packages/yakka/internal/serve/mcp.go packages/yakka/internal/mcp/mcp.go \
    packages/yakka/cmd/yakka/sync.go packages/yakka/internal/drain/cli.go \
    plugins/yakka/client/yakka.py
```

Only matches: unrelated reader/declaration failures (`unsupported_reader`, `unsupported_declaration`, `unsupported MCP reader version`, `unsupported typed policy`) and `mcp.go:794` mapping `ErrTenantLifecycleBusy` to `tenant_busy`. No match refuses, hides or words a tenant by `lifecycle_state`; `tenant_busy` is an in-progress-operation refusal, not a state label. The `toolList` at `internal/mcp/mcp.go:212,217` and `sync.go` name tenants only by id/`--to`; `drain/cli.go` has no tenant/lifecycle wording. `grep -rniE 'lifecycle_state|lifecycle|unmarked|unsupported' plugins/yakka/skills` returned nothing. `TestNewLeavesUnmarkedWhenFlagOff` is the regression lock for MCP `tools/list` and token minting on an unmarked tenant.

## Departures

- In `TestAdoptUnmarkedTenants`, the `tenantsOwnedBy(204)` "all three active" assertion runs **before** `BeginTenantReset(204, "default")`, because `BeginTenantReset` flips `default` to `resetting`. Both §3.8 assertions are still asserted; only their order changed. This resolves the brief's listed order, which cannot hold both states at once.
- `TestNewLeavesUnmarkedWhenFlagOff` compares `registry.json` immediately after `New` (the normalised fixture), before `putLifecycleSession`, the analytics/MCP reads or `remoteIssueToken`, because the later `POST /v1/tokens` and session writes necessarily change the registry.
- The B4 test reuses the same token-bearing legacy fixture helper; the token is not required by B4 but does not alter the idempotence evidence.

## Unfinished / gate

- `gate: B2's combined grep also needs phase3-03's docs; B5's Plan 23 amendment is phase3-03's and the dated code comment is phase3-01's.`
- `gate: signed-in production check of Cody's live default tenant is not automatable; this unit proves the flag on/off paths against fixtures only.`
