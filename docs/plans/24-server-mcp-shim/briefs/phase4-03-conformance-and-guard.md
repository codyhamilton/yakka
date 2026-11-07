# Brief: phase4-03 — parity suite and thin-shim guard

Consumer: the Phase 4 execution worker proving the shipped shim against the server and its local safety contracts.
Owned paths: `plugins/yakka/client/test_mcp.py`, `plugins/yakka/client/test_mcp_shim.py`, `plugins/yakka/client/test_mcp_guard.py`, `docs/plans/24-server-mcp-shim/reports/phase4-03-conformance-and-guard.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/24-server-mcp-shim/reports/phase4-03-conformance-and-guard.md` and include it in the commit.
Depends on: `phase4-02-readers-and-enqueue`.
Runs alongside: `phase4-04-docs-and-release`.
Budget: 8 files to read, about 900 lines to change, 40 tool turns. Past the budget, stop and report over budget.

## Required reading, in order

1. `docs/plans/24-server-mcp-shim/DESIGN.md` — all Phase 4 outcome clauses, especially parity, reader safety, seam proof, guard and v2 amendment.
2. `docs/plans/24-server-mcp-shim/IMPLEMENTATION.md` — Phase 2/3 evidence and carried items.
3. `plugins/yakka/client/test_mcp.py` — existing legacy behavior tests, fixtures and helpers to retain where they still apply.
4. `plugins/yakka/client/yakka.py`, `packages/yakka/internal/serve/mcp*test.go`, and `packages/yakka/internal/serve/testdata/mcp-golden/` — actual client/server seams and committed corpora.

## Goal

Prove end-to-end parity through the real shim and direct authenticated server calls, reader/action safety, and that the shipped client contains no server-owned tool surface.

## Contract

Implement the Phase 4 outcome as observable tests. For `initialize`, `tools/list`, and every Phase 2–3 corpus call, compare the shim reply with direct `POST /v1/mcp` using identical injected context, preserving exact server replies and ids. Build the Phase 3 local situations on disk and compare every `same` row with the recorded legacy wording. The v2 amendment's action cases must prove one bound directive and one continuation. Tests must not weaken a design outcome to accommodate the implementation.

## Changes

Keep or move tests that still characterize the server-owned tools into appropriate Go corpus/server tests only if already in the owned paths; otherwise leave server tests untouched and exercise their committed corpus through the shim harness. Remove obsolete client-side tool wording/schema/state tests from `test_mcp.py`. Add isolated tests for transport, local readers, action directives, parity, and reader-seam bulk limits. Add a static guard that fails if tool names, corpus lines, schemas, instructions, or result strings are planted in the shim section; demonstrate it against planted fixtures without committing the planted text. Assert that every subprocess is from the fixed argv table and hooks/spool/drain are unchanged. Keep harness-specific `_meta` visibility and failed-initialize observations non-gating and record them as observed or unavailable in the unit report.

### Keep untouched

Do not edit production code, design contracts, reader tables, plugin manifests, or stable docs. Do not run the unrelated layout test.

## Done evidence

Report focused check output before and after.

- Python unit suite passes and covers the Phase 4 clauses assigned above.
- Go checks needed to validate the shared server reader fixture pass; do not broaden into unrelated suite work.
- The static guard passes on the shipped `yakka.py`, fails each planted tool name/corpus/schema fixture, and `test_mcp.py` has no tool-wording behavior tests.
- `git diff --check` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. State exact check commands and output, observations or unavailable harnesses, deviations, and any contract contradiction.

A non-trivial bug outside this unit's evidence: report its symptom, location and root cause; do not fix it here.

Do not spawn agents beyond read-only research helpers.
