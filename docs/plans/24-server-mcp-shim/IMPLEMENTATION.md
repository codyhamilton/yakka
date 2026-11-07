# Implementation: Server-defined MCP shim

## Run

- Tool: Codex (GPT-6)
- Session: API run; session URL/ID unavailable
- Start: 2026-11-07T12:13:05Z
- Branch: feat/24-server-mcp-shim
- Invocation: build Phase 1 only; stop before review, terminal review, and close-out.

## Phase 1 — Server MCP endpoint and tool registry

Status: closed, 2026-11-07 (closing commit carries `Workflow-Phase: 24-server-mcp-shim:1`).

Phase has one cohesive server contract, so one inline brief was authored: `briefs/phase1-server-mcp-endpoint.md` (prepared at `2d7f9d3`). Artifact feedback initially returned `not delivered` because no version was present; at closure, both brief and report returned delivered, screen pass.

### Unit `phase1-server-mcp-endpoint`

The first worker pass was incomplete and left an uncommitted draft. Per execute retry policy, a fresh worker on the next model tier completed the unit and committed `dba4dd9`. Its report is `reports/phase1-server-mcp-endpoint.md`.

- Built: stateless authenticated `POST /v1/mcp`; bearer-only auth shared with REST; scope-aware MCP tool registry and declaration revisions; reader capability validation and typed local context; validation/context ordering; body budgets, deadlines and cancellation; privacy-safe structured call logs; conformance-only tests and the API docs update. No product tools or Python client changes.
- Surfaces: `packages/yakka/internal/serve/` and `docs/design/03-remote-service.md`, plus the report.
- Deviations: no departures from the brief or Phase 1 contract were reported. Cancellation is cooperative and registration occurs at startup; bounded configuration ceilings are documented in the report.
- Agent: first pass incomplete; retry worker completed. Harness did not expose per-agent turn/context counts.

### Verification (Phase 1)

- Entry point: authenticated and keyless test servers exercise `POST /v1/mcp` from request through JSON-RPC reply and tenant-scoped store observation. Conformance tests cover the eleven outcome clauses, including protocol handling, scoped registry listing, context validation, body limits, cancellation and log privacy.
- Independent runner check: from `packages/yakka`, `go test ./internal/serve/... -run TestMCP -count=1` passed (1.134s); `go test -count=1 ./...` passed all 15 packages, with `internal/serve` passing in 9.866s; `git diff --check` passed.
- Result: the Phase 1 outcome holds for the registered test tools. The server endpoint is implemented and the API table now describes it as existing; clients remain for Phase 4.

### Phase 1 — Carried

1. The unrelated pre-existing layout test failure identified by the user was not encountered or investigated, and was not changed. Keep it out of Phase 1 follow-up unless independently in scope.
