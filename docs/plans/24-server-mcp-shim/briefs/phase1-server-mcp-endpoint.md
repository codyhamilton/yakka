# Brief: phase1-server-mcp-endpoint — Server MCP endpoint and tool registry

Consumer: implementation worker.
Owned paths: `packages/yakka/internal/serve/` (MCP implementation, tests, and reader declaration fixture), `docs/design/03-remote-service.md`, and this plan's `reports/phase1-server-mcp-endpoint.md`. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not push.
Report: before committing, write the report path above and include it in the commit.
Depends on: nothing.
Runs alongside: nothing.
Budget: up to 20 files to read, about 1,500 lines to change, 40 tool turns. Past the budget, record a handoff in `IMPLEMENTATION.md`, commit, and report over budget.

## Required reading, in order

1. `docs/plans/24-server-mcp-shim/DESIGN.md` — Solution Shape (MCP endpoint and registry; auth and tenancy; declaration, budgets, lifecycle, logging) and Phase 1 outcome. This contract is binding.
2. `packages/yakka/internal/serve/serve.go` — route setup and body handling.
3. `packages/yakka/internal/serve/session.go` — `authorizeRequest`, token scope, tenant and REST error behavior.
4. `packages/yakka/internal/serve/serve_test.go` — `newServer`, `remoteIssueToken`, and `do` test helpers.
5. `docs/design/03-remote-service.md` — API table's proposed `/v1/mcp` note.

## Goal

Implement the stateless authenticated `POST /v1/mcp` endpoint and server-owned, scope-aware tool registry specified by the Phase 1 outcome. Register no product tools; test-only conformance tools prove the registry seam, context contract and tenant isolation.

## Contract

Follow the complete Phase 1 outcome and the server registry contracts in `docs/plans/24-server-mcp-shim/DESIGN.md`. In particular: only bearer authentication on this route (or the existing keyless loopback local mode); tenant and scope come from auth only; `Origin` is refused; registry declarations own schemas, validation, instruction text, scope, context readers, budgets and timeouts; `_local` is untrusted and stripped before handlers; invalid or unavailable required context cannot become clean feedback; registration rejects invalid declarations and local actions; logs exclude secrets, arguments and local context.

## Changes

- Add `POST /v1/mcp` with exactly the JSON-RPC methods, status codes, body limits, cancellation and relay behavior required by Phase 1.
- Factor or add bearer-only authorization without changing REST behavior; preserve local-mode parity and REST-shaped authentication failures.
- Implement registry registration and declaration validation, reader-table loading, scope filtering/enforcement, declaration revision, context checks, budgets, timeouts, and structured privacy-safe call logging.
- Add conformance-only tests for every numbered clause (1)–(11) of the Phase 1 outcome, including two keyed tenants, read/read_write scopes, and keyless loopback.
- Rewrite the API table entry in `docs/design/03-remote-service.md` to describe the endpoint as existing and unused by clients until Phase 4.
- Do not add product tools or touch Python/plugin code, production configuration, Plans 21/22/23, or the Go client slated for #178.

### Keep untouched

All existing REST routes and behavior, storage schemas, drain/spool/hooks, plugin MCP launch configuration, and files outside the owned paths. Do not run `fly` or `wrangler`, access secrets, push, merge, switch branches, or modify another plan/worktree.

## Done evidence

Identify and run the existing relevant failing check before implementation, then report before/after output. The user has identified an unrelated pre-existing layout test failure: record it as pre-existing and do not investigate or fix it.

- `cd packages/yakka && go test ./internal/serve/...` — Phase 1 server tests pass.
- `cd packages/yakka && go test ./...` — existing Go suite passes, REST remains unchanged.
- Endpoint tests exercise all eleven clauses in the Phase 1 outcome, including the real handler entry point to result and tenant-scoped observable state.
- `docs/design/03-remote-service.md` describes `/v1/mcp` as existing; no client is introduced.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. State what changed, test output before and after, deviations and why, and any contradiction between this brief and its cited contracts. Record the unrelated layout test failure without chasing it. Report non-trivial out-of-scope bugs without fixing them.
