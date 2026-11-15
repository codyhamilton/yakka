# Brief: phase1-anonymous-discovery-server — Anonymous MCP discovery gate

Consumer: worker on `packages/yakka/internal/serve`.
Owned paths: `mcp.go`, new `mcp_discovery_limits.go` + tests, `mcp_conformance_test.go` (minimal fixes), `docs/design/08-server-mcp-contract.md`, `docs/design/03-remote-service.md`.
Depends on: nothing.
Verification: `cd packages/yakka && go test ./internal/serve/ -count=1 -run 'TestMCP'`.

## Goal

Implement the Server discovery gate domain from `DESIGN.md` Phase 1: anonymous `initialize`, `ping`, `tools/list`, and notifications on non-local servers; strict bearer path unchanged; rate limit 120/min/IP via `deviceClientIP`.

## Contract

Follow `docs/plans/25-mcp-discovery-without-key/DESIGN.md` Domain: Server discovery gate and Phase 1 outcome verbatim.

## Done evidence

- Phase 1 verification command passes.
- New tests cover anonymous vs read bearer catalog parity, tools/call 401 with handler count 0, bad bearer body unread, Origin 403, rate limit 429 body unread, 256 KiB cap for anonymous.

## Report

`docs/plans/25-mcp-discovery-without-key/reports/phase1-anonymous-discovery-server.md`