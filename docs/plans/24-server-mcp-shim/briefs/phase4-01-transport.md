# Brief: phase4-01 — generic MCP transport

Consumer: the Phase 4 execution worker implementing the stdio-to-server relay.
Owned paths: `plugins/yakka/client/yakka.py`, `docs/plans/24-server-mcp-shim/reports/phase4-01-transport.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/24-server-mcp-shim/reports/phase4-01-transport.md` and include it in the commit.
Depends on: nothing.
Runs alongside: nothing.
Budget: 5 files to read, about 500 lines to change, 30 tool turns. Past the budget, stop and report over budget.

## Required reading, in order

1. `docs/plans/24-server-mcp-shim/DESIGN.md` — Phase 4 outcome, Domain: Shim, and the forwarding, requests-per-call, HTTP, own-errors and lifecycle contracts.
2. `docs/plans/24-server-mcp-shim/IMPLEMENTATION.md` — Phase 3 closure and carried items.
3. `plugins/yakka/client/yakka.py` — current `# --- mcp ---` section and its existing config, bearer, timeout and no-redirect helpers.

## Goal

Replace the client-owned MCP protocol and tools with a generic authenticated relay to `POST /v1/mcp`. The shim must not define tools, tool wording, schemas, validation, or results.

## Contract

Follow the Phase 4 outcome and `DESIGN.md` Domain: Shim. Every request is method-agnostic and forwarded; replies are relayed unchanged. Only the named protocol fields may be inspected: declaration metadata from `tools/list`, `-32010`, and HTTP status. Resolve the shared login for every request; never fall back locally or to another endpoint. Preserve the complete own-error set, redirect refusal, cancellation, concurrency, and stdin EOF behavior. The amendment's v2 action headers/negotiation and directive handling are owned by the next unit; leave a narrow internal seam for that unit, without adding tool-specific code here.

## Changes

Replace the existing MCP implementation in `yakka.py` with generic framing, concurrent request dispatch, bounded HTTP forwarding, declaration caching/refresh, context-free `_local` removal, response validation, and the closed transport/config error mapping. Keep request ids and server JSON-RPC bodies unchanged. A `-32010` permits one `tools/list` refresh and one retry only. Add no tool names, descriptions, schemas, instructions, or result text. Ensure the following unit can add declared context and the approved directive loop within the same section.

### Keep untouched

Keep `.mcp.json`, `.codex-mcp.json`, the login contract, and the no-redirect opener behavior. Do not change drain, hooks, spool, queue format, or REST clients.

## Done evidence

Identify or write focused transport checks before changing code and report their before/after output.

- `python3 -m unittest plugins.yakka.client.test_mcp` (or the repository's equivalent invocation) exercises method-agnostic relay, auth/config/HTTP errors, stale declaration retry, concurrency, cancellation and EOF.
- A static inspection of the replacement `# --- mcp ---` section finds no tool names, schemas, instructions, state logic or result wording.
- `git diff --check` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, check output before and after, deviations, and any contract contradiction. Keep the report free of credentials and local paths. Do not run the unrelated layout test.

A non-trivial bug outside this unit's evidence: report its symptom, location and root cause; do not fix it here.

Do not spawn agents beyond read-only research helpers.
