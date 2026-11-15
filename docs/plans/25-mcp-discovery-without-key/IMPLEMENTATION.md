# Implementation — MCP discovery without a key (plan 25)

- Tool: Cursor Cloud Agent — https://cursor.com/agents/be9c
- Start: 2026-11-15 (Australia/Brisbane, UTC+10)
- Branch: `cursor/mcp-discovery-execute-be9c`

## Phase 1 — Anonymous discovery on the server

Brief: `briefs/phase1-anonymous-discovery-server.md`

**Closed** commit `ed9fd70`. Server anonymous gate, rate limit, tests, design 8/3 updates. Verification: `go test ./internal/serve/ -run 'TestMCP'` pass. Report: `reports/phase1-anonymous-discovery-server.md`.

**Carried:** None

## Phase 2 — Shim default and the strict drain

Brief: `briefs/phase2-shim-default-strict-drain.md`

**Closed** commit pending push. `LoadMCP`, status `mcp:` line, tests, design 2/4/5. Verification: client unittests pass. Report: `reports/phase2-shim-default-strict-drain.md`.

**Carried:** None