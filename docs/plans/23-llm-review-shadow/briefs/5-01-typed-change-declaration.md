# Brief: 5-01 — Typed `change` reader declaration

Consumer: Plan 23 Phase 5 MCP integration unit 5-03; the shim in 5-02 consumes the same declared policy contract.
Owned paths: `packages/yakka/internal/serve/mcp.go`, `packages/yakka/internal/serve/mcp_conformance_test.go`, and `packages/yakka/internal/serve/testdata/mcp-readers.json`. Touch nothing else.
Repository: `/home/codyh/workspace/yakka-build/23`; branch: `feat/23-llm-review-shadow`.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/5-01-typed-change-declaration.md` (rubric: `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: 5-02.
Budget: 8 files to read, about 500 lines to change, 35 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Architectural Implications (a), Assumption 32, Phase 5 Outcome and Surfaces.
2. `docs/design/08-server-mcp-contract.md` — Declaration parameters and budgets.
3. `packages/yakka/internal/serve/mcp.go`, `mcp_conformance_test.go`, and `testdata/mcp-readers.json` — current typed validation and compatibility fixtures.

## Goal

Extend the existing server declaration validator narrowly enough to register the fixed `change` reader policy values, while retaining validation and compatibility for existing readers.

## Contract

Binding design text:

> “Plan 23 Phase 5 owns a bounded extension of the existing parameter schema/validators on both sides for those fixed policy types, plus the actual `change` reader, matching `mcp-readers.json` entry and declaration. No arbitrary commands/paths/URLs or general plugin runtime are added.” (DESIGN.md, Architectural Implications)

> “legal typed `change` policy declarations register while wrong types, unknown fields and unsafe values are rejected, and existing readers still conform” (DESIGN.md, Phase 5 Outcome)

The shared reader contract permits booleans, integers, enum strings and arrays of those. `change` needs numeric caps/context lines, boolean policy values and exclusion arrays. Keep `budget_bytes` behavior and body-cap derivation intact. The Phase 4 Carried item also binds Phase 5: “Keep the static no-network/environment guarantee scoped to `internal/review/build.go`; the provider transport intentionally uses HTTP, while packet construction remains offline.” Preserve that boundary in relevant conformance coverage; do not broaden the package check.

## Changes

- Add explicit type/range/allowed-value validation for only the fixed parameter shapes needed by `change`; reject wrong types, unknown keys, unsafe strings and invalid bounds at registration.
- Add the server conformance-table declaration, required parameter list and dependencies for reader `change`, including content/bulk declaration requirements and the 2 MiB serialized budget contract.
- Add legal and illegal declaration fixtures and prove pre-existing declarations still register. Keep runtime argument values separate from constant declaration policy.
- Report any discrepancy with stable doc 8 to unit 5-04, which owns the stable documentation update.

### Keep untouched

Do not register `review_change`, change route body-cap rules, add the client reader, or change MCP wire semantics. Do not create a general schema/plugin framework or expand static no-network checks beyond `internal/review/build.go`.

## Done evidence

- `cd packages/yakka && go test ./internal/serve` passes, including legal/illegal typed declaration fixtures and existing reader conformance.
- A registration fixture accepts the complete `change` policy declaration and rejects wrong boolean/numeric/array types, unknown fields, unsafe values, invalid ranges, missing required parameters and an oversized bulk declaration.
- Existing reader declarations and computed body caps retain their current behavior.
- `git diff --check` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include exact check commands and outputs, deviations, contradictions and known problems.

A non-trivial bug outside your done evidence: report symptom, location and root cause. Do not fix it here.
