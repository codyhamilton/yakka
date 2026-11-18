# Report: phase1-anonymous-discovery-server

Status: done

## What changed

- Added anonymous MCP discovery auth gate in `mcp.go`: Origin 403; bearer or anonymous paths; `tools/call` with id returns 401 for anonymous; `read` catalog for initialize/list.
- Added `mcp_discovery_limits.go` with 120/min/IP rolling window via `deviceClientIP`.
- Added `mcp_discovery_test.go` covering remote parity, rate limit, keyed non-remote, local unchanged.
- Updated `mcp_conformance_test.go` rejected-bearer body unread spy.
- Updated `docs/design/08-server-mcp-contract.md` and `docs/design/03-remote-service.md`.

## Verification

`cd packages/yakka && go test ./internal/serve/ -count=1 -run 'TestMCP'` — pass.

## Deviations

None.