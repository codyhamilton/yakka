# Report: phase3-01 — Server adoption, the flag and the `unmarked` rename

Status: done

## What changed

Owned paths only:

- `packages/yakka/internal/serve/registry_lifecycle.go` — state block replaced with the §3.1 constants (`lifecycleStateUnmarked` replaces `lifecycleStateUnsupported`); `TenantLifecycleRecord` comment carries the dated 22 Nov 2026 policy change and its reversal of the Plan 23 follow-up rule; `TenantLifecycle` comment says "not yet adopted"; added `AdoptUnmarkedTenants` and `newActiveLifecycleRecord` exactly as §3.1(4) (two-phase build, single save, save-failure restoration, sorted ids, idempotent `nil, nil`); added `"sort"`.
- `packages/yakka/internal/serve/registry.go` — `createTenantLocked` now calls `newActiveLifecycleRecord()`; the two `newLifecycleValue` calls and the literal are gone. Behaviour identical.
- `packages/yakka/internal/serve/session.go` — `tenantsOwnedBy` derives `lifecycleStateUnmarked`; generation and sort unchanged.
- `packages/yakka/internal/serve/serve.go` — `Config.AdoptUnmarkedTenants` field + comment (§3.4(1)); `ConfigFromEnv` reads it through `envTruthy` before the loopback early return; `envTruthy` added below the function; `New` adopts after `OpenRegistry` and before `s := &Server{…}` and logs/continues on error (§3.4(3)).
- `packages/yakka/internal/serve/review_cursor.go` — exact §3.5 unmarked/flag-off comment.
- `packages/yakka/internal/serve/tenant_lifecycle.go` — `Legacy tenants do;` → `Unmarked tenants do;`; `legacy marker` → `missing marker`.
- `packages/yakka/internal/serve/device_grants.go` — `empty for tenants without a record`; `A tenant without a record (not yet adopted) accepts only an empty approval while it still has none.`

No `fly.toml`, test, design-doc or mockup file touched. `device.go` needed no edit.

## Check output

Before the change: `registry_lifecycle.go` held `lifecycleStateUnsupported` and the legacy comment; `session.go` emitted `lifecycleStateUnsupported`; neither `AdoptUnmarkedTenants` nor `newActiveLifecycleRecord` nor `envTruthy` existed; the three comments still said "legacy"/"unsupported legacy"; the dated `22 Nov 2026` comment was absent.

After the change:

```
$ cd packages/yakka && go build ./...            → BUILD_OK (success)
$ gofmt -l <the seven owned files>               → (no output)
$ grep -c 'func (r \*Registry) AdoptUnmarkedTenants()' registry_lifecycle.go → 1
$ grep -c 'func newActiveLifecycleRecord()' registry_lifecycle.go            → 1
$ grep -c 'func envTruthy' serve.go                                         → 1
$ grep -c 'AdoptUnmarkedTenants bool' serve.go                              → 1
$ grep -n 'lifecycleStateUnsupported' registry_lifecycle.go session.go      → (no output)
$ grep -niE 'lifecycleStateUnsupported|unsupported legacy|`unsupported`|legacy tenants' \
    registry_lifecycle.go session.go review_cursor.go device_grants.go      → (no output)
$ grep -c '22 Nov 2026' registry_lifecycle.go                               → 1
$ git diff --check                                                          → (no output)
```

## Departures

None. The override skipped DESIGN §3.6 entirely: no `fly.toml` line and no `fly.toml` comment were added, matching the brief's standing rule.

## Unfinished / gate

- `gate: B1 (go test ./internal/serve, go vet ./...) is closed by phase3-02, which renames the test constant after this unit.` Tests were not run: `registry_lifecycle_test.go` still names the removed `lifecycleStateUnsupported`, so the package tests do not compile until phase3-02.
- `gate: B5’s Plan 23 amendment is closed by phase3-03; this unit writes only the dated code comment.`
