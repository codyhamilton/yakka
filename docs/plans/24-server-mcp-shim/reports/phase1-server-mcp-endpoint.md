# Phase 1: server MCP endpoint and registry

Status: done.

Implemented stateless authenticated `POST /v1/mcp` with no product tools. The registry owns declaration revisions, metadata snapshots, scopes, instructions, reader validation, typed local context, derived body budgets and cooperative deadlines. Its capability table is embedded. REST and MCP share bearer resolution; MCP refuses cookies and Origin. Structured logs exclude caller arguments/context/credentials. Updated the API table; client adoption remains Phase 4.

## Before

The retry inherited an uncommitted draft. Existing tests already passed; there was no existing failing server check to reproduce. Inspection identified implementation and coverage gaps.

Commands in `packages/yakka`, before changes:

```text
$ go test ./internal/serve/...
ok github.com/codyhamilton/yakka/packages/yakka/internal/serve (cached)
$ go test ./...
all 15 packages: ok (cached)
```

## Outcome evidence

`mcp_conformance_test.go` exercises the public handler with real remote tokens (two tenants, read/read_write each) and keyless loopback:

1. Protocol negotiation, scoped ordered instructions, capabilities, server identity, ping, notifications, compact replies, malformed JSON/UTF-8, arrays, unknown methods and 405/Allow.
2. Complete tool/declaration fields, scope filtering, v2 negotiation, independently computed hashes, declaration changes and immutable registration metadata.
3. Identical forged tenant claims return distinct tenant-specific hashes read from persisted artifact stores.
4. Missing/invalid credentials, cookie-only requests, Origin, tenant-query mismatch, insufficient scope and local all-scope authorization.
5. `_local` removal, revision before validation, validation before required-context errors, missing/failed/undeclared context, optional typed failures, carrier versions and no handler execution on rejected calls.
6. Exact default/derived body boundaries, conformance bulk capability, ceiling rejection and authentication before body reads.
7. Deadline cancellation and timeout wording; actual HTTP disconnect cancels the handler while concurrent ping remains available.
8. Duplicate names, unknown/version-incompatible readers, dependency order, invalid params, effects, timeout and bulk ceilings rejected at registration.
9. Captured logs contain method, tool, tenant, HTTP status and duration, excluding arguments, context and credentials.
10. Server and full Go suites pass with existing REST tests unchanged.
11. Remote-service API table describes the route as existing, with no client until Phase 4.

## After

```text
$ go test ./internal/serve/... -count=1
ok github.com/codyhamilton/yakka/packages/yakka/internal/serve 8.555s
$ go test ./... -count=1
ok github.com/codyhamilton/yakka/packages/yakka/cmd/yakka 62.775s
ok github.com/codyhamilton/yakka/packages/yakka/internal/archive 0.909s
ok github.com/codyhamilton/yakka/packages/yakka/internal/clientconfig 0.011s
ok github.com/codyhamilton/yakka/packages/yakka/internal/compact 1.015s
ok github.com/codyhamilton/yakka/packages/yakka/internal/drain 7.480s
ok github.com/codyhamilton/yakka/packages/yakka/internal/facts 1.176s
ok github.com/codyhamilton/yakka/packages/yakka/internal/ingest 0.240s
ok github.com/codyhamilton/yakka/packages/yakka/internal/keys 0.390s
ok github.com/codyhamilton/yakka/packages/yakka/internal/mcp 1.996s
ok github.com/codyhamilton/yakka/packages/yakka/internal/scorer 0.122s
ok github.com/codyhamilton/yakka/packages/yakka/internal/screen 0.087s
ok github.com/codyhamilton/yakka/packages/yakka/internal/secrets 1.098s
ok github.com/codyhamilton/yakka/packages/yakka/internal/serve 9.255s
ok github.com/codyhamilton/yakka/packages/yakka/internal/store 6.320s
ok github.com/codyhamilton/yakka/packages/yakka/internal/sync 1.350s
```

After aligning reader failure codes with the design, `go test ./internal/serve/...` passed in 8.162s. The final full-suite result is recorded below.

## Limits and deviations

Cancellation is cooperative: handlers must stop on context cancellation. Registration occurs at startup. Environment ceilings use bounded integer bytes/seconds, within 8 MiB/300 s; invalid configuration fails startup.

The known unrelated layout-test failure was not encountered, investigated or changed. No out-of-scope bug or design contradiction was found. Two test commands initially failed module discovery from the repository root; rerunning in `packages/yakka` corrected the invocation. No product tools, client changes, deployment, push or unrelated plan edits are included.

Final `go test ./...` on the completed implementation: all 15 packages passed; `cmd/yakka` 61.815s, `internal/compact` 0.456s, `internal/sync` 1.235s, remaining packages cached. `git diff --check` passed.
