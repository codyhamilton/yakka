# Brief: phase3-01 — server `artifact_feedback`

Consumer: Codex, inline Phase 3 execution in `/home/codyh/workspace/yakka-build/24` on `feat/24-server-mcp-shim`.
Owned paths: `packages/yakka/internal/serve/`, its `testdata/mcp-golden/` fixtures, `docs/plans/24-server-mcp-shim/IMPLEMENTATION.md`, and `docs/plans/24-server-mcp-shim/reports/phase3-01-artifact-feedback.md`. Touch nothing else.
Commits: commit to the current branch when the phase outcome verifies, with a plain-summary title. Never push or merge; do not touch master or another branch, Plans 21/22/23, or `/home/codyh/workspace/yakka-wt/`. Never run fly/wrangler or touch secrets.
Report: before the closing commit, write `docs/plans/24-server-mcp-shim/reports/phase3-01-artifact-feedback.md` as a handoff using `packages/yakka/catalogue/checks/execution-report.json`; include it in the closing commit.
Depends on: Phase 1 registry and Phase 2 characterization corpus.
Runs alongside: nothing.

## Goal

Move `artifact_feedback` from the Python reference into the authenticated Go MCP registry. Preserve the Phase 3 parity table in `DESIGN.md`, using only v1 read-only context and no local action, queue write, ingest, worker wake or drain kick. V2 enqueue behavior in the design addendum remains out of this phase.

## Contract

- Register `artifact_feedback` with the existing name, description, schema, read scope, `readOnlyHint`, base instruction and the exact declaration in the design: optional `cwd`; required `resolved_path{path_arg:"path",bases:["cwd"]}`, `file{of:"resolved_path"}`, `git{of:"resolved_path"}`, `queue{of:"git",path:"resolved_path"}`, and `drain`.
- Validate the path argument before context access. Implement the exact parity table in the design for context-backed feedback, including D1 queued behavior, D2 transport/config exclusion from tool answers, D3 withheld/out-of-tree and oversized files, no-commit wording, all delivered screen/score lines, and error behavior for missing/failed required readers.
- Read artifact state and scoring baselines directly from the authenticated tenant store. Do not self-call REST. Make no writes and never treat client context as tenant identity. Do not log paths or hashes from `_local`.
- Add an `artifact-feedback.json` characterization fixture before implementation, based on `plugins/yakka/client/test_mcp.py`'s current behavior. Add direct authenticated MCP tests for fixture parity, registry declaration, read scope, failure gates, tenant isolation, no writes and log privacy.
- Keep the Python reference, hooks, drain and all files outside owned paths untouched.

## Done evidence

- Focused MCP feedback/corpus tests pass, including each Phase 3 outcome clause.
- `go test ./... -count=1` from `packages/yakka` passes; the unrelated pre-existing layout test failure documented in `IMPLEMENTATION.md` is recorded but not chased.
- `git diff --check` is clean.

## Report back

Under 1,500 tokens. Include changes, evidence, deviations, deferred work and known problems specifically enough for Phase 4 to act on.
