# Brief: phase2-01 — stateless MCP tools

Consumer: Codex, inline Phase 2 execution in `/home/codyh/workspace/yakka-build/24` on `feat/24-server-mcp-shim`.
Owned paths: `packages/yakka/internal/serve/`, `packages/yakka/internal/serve/testdata/mcp-golden/`, `docs/plans/24-server-mcp-shim/IMPLEMENTATION.md`, and `docs/plans/24-server-mcp-shim/reports/phase2-01-stateless-tools.md`. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Never push or merge; do not touch master or another branch, Plans 21/22/23, or `/home/codyh/workspace/yakka-wt/`. Never run fly/wrangler or touch secrets.
Report: before committing, write `docs/plans/24-server-mcp-shim/reports/phase2-01-stateless-tools.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: Phase 1 `8d7d185` and characterization corpus `8f91f4b`.
Runs alongside: nothing.
Budget: 8 files to read, about 350 lines to change, 12 tool turns. Past the budget, stop and record a handoff in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/24-server-mcp-shim/DESIGN.md` — Phase 2 outcome, surfaces, and server MCP registry/domain contracts.
2. `docs/plans/24-server-mcp-shim/IMPLEMENTATION.md` — Phase 1 outcome and Carried item.
3. `packages/yakka/internal/serve/testdata/mcp-golden/README.md` and `stateless-tools.json` — committed baseline, captured before implementation.
4. `packages/yakka/internal/serve/mcp.go`, `serve.go`, `reads.go`, and relevant store read APIs — current registry and tenant-scoped data access.

## Goal

Move `list_checks` and `search_artifacts` into the server MCP registry, preserving their MCP definitions and result behavior from the committed characterization corpus. Keep both tools context-free and read-only.

## Contract

- Phase 2 in `DESIGN.md`: direct authenticated `tools/list` returns the two tools with definitions equal to the old `_MCP_TOOL_LIST`; initialize instructions contain the existing sentence verbatim; corpus calls preserve `content[0].text` and `isError`; results use the same store functions as REST without an HTTP self-call; search remains tenant-scoped; `_local` has no effect and neither declaration requests context.
- Server MCP registry contract in `DESIGN.md` → Domain: MCP endpoint and registry: server owns schema, validation, state, and wording; handler receives authenticated tenant state; order is authentication, scope, `_rev`, validate, reader gate, handler.
- `stateless-tools.json` and its README are the baseline. Any client-side config/unreachable failure strings are recorded separately in the corpus README and are not server-tool wording.

## Changes

Register `list_checks` and `search_artifacts` with exact old descriptions, schemas, annotations, read scopes and instruction sentence. Implement argument validation and output formatting server-side, reading checks from loaded service options and search hits through the authenticated tenant store. Ensure registry declarations have empty context and ignore caller `_local` according to the registry contract. Add direct MCP conformance coverage that loads the corpus, checks metadata/instructions/results, compares MCP output to the corresponding REST response formatting without an HTTP self-call, and proves a second tenant cannot see another tenant's search hit.

### Keep untouched

Do not edit the Python client or `test_mcp.py`; they are the frozen reference for this phase. Do not migrate `artifact_feedback`; that is Phase 3. Do not add reader declarations, local actions, shim changes, REST changes, or unrelated behavior.

## Done evidence

Identify and run the focused failing checks before implementation, then report their output before and after.

- `go test ./internal/serve/... -run 'TestMCP(Stateless|.*Conformance)' -count=1` from `packages/yakka` → tool registration/corpus parity, REST formatting parity, tenant isolation and `_local` independence pass.
- `go test ./... -count=1` from `packages/yakka` → full Go suite passes, except the unrelated pre-existing layout test failure recorded in Phase 1, which must be named and not chased.
- `git diff --check` → clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. State changes, before/after checks, deviations, and contradictions. Include deferred work and known problems specifically enough for Phase 3 to act on.
