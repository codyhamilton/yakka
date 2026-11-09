# Brief: 5-03 — MCP review registration and transport proof

Consumer: Phase 5 unit 5-04 stage wiring; the Phase 6/7 trial continues to use the same Phase 4 REST handler.
Owned paths: new `packages/yakka/internal/serve/mcp_review.go`, `packages/yakka/internal/serve/mcp_review_test.go`, `packages/yakka/internal/serve/serve.go` (MCP tool registration only), and `packages/yakka/internal/serve/mcp_conformance_test.go` only if route-level conformance coverage must be extended there. Touch nothing else.
Repository: `/home/codyh/workspace/yakka-build/23`; branch: `feat/23-llm-review-shadow`.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/5-03-mcp-review-integration.md` (rubric: `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 5-01 and 5-02; wait for both.
Runs alongside: nothing.
Budget: 14 files to read, about 1,100 lines to change, 55 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Domain: Tool surface and shadow invocation; Domain: Local change capture; Domain: Review run; Architectural Implications; Phase 5 Outcome.
2. Phase 4 reports `reports/4-04-review-orchestration-rest.md` and `reports/4-03-provider-call-validation.md` — actual REST and fake endpoint seams.
3. `packages/yakka/internal/serve/mcp.go`, `mcp_stateless.go`, `serve.go`, `reviews_test.go`, and MCP route tests.
4. The 5-01 and 5-02 reports and implementation — landed reader declaration and shim behavior.

## Goal

Expose the Phase 4 review handler as the server-owned `review_change` MCP tool, retaining equivalent review behavior and receipts across MCP and REST.

## Contract

Binding design text:

> “`POST /v1/reviews` (bearer, `read_write`) takes the arguments and a capture in its body and runs the whole review; the MCP tool registers over the same handler. Both return the same receipt” (DESIGN.md, Domain: Tool surface and shadow invocation)

> “Declared scope `read_write`; declared MCP timeout 150 s (within Plan 24’s 300 s ceiling), above the review handler’s total 120 s wall-time cap including retry; the shim allows the declared timeout plus 5 s; no local actions (omit `local_actions` in v1).” (DESIGN.md, Domain: Tool surface and shadow invocation)

> “the tool's absence, unavailability or failure leaves the calling stage's gate, verdict, commit and report unchanged” (DESIGN.md, Phase 5 Outcome)

Arguments, schema, context order, optional `session_hint` rule, explicit high live effort, historical range-only override, absent-Plan-22 unbound behavior, receipt/full-detail behavior and `capture_unsupported` translation follow the complete Phase 5 Outcome and Domain contracts. Keep MCP as a thin entry to the existing orchestrator. Phase 4's carried constraint remains binding: “Keep the static no-network/environment guarantee scoped to `internal/review/build.go`; the provider transport intentionally uses HTTP, while packet construction remains offline.”

## Changes

- Register `review_change` from the server using 5-01's typed declaration and context order (`project_dir`, `cwd`, `git`, `change`; add `session_hint` only if its reader has shipped). Omit local actions and mark `change` optional at registry gate, but translate missing/unsupported capture to `capture_unsupported` before any record is created.
- Route validated arguments and captured facts into the same review orchestration used by REST. Enforce no-content receipt behavior, full-detail validated findings, route scope, and the existing deadline/body budgets.
- Exercise fake-endpoint calls through shim MCP and REST with the same inputs. Prove uncommitted and range captures, read-token refusal, `_local` spoofing, oversize body error, explicit high effort, trial override, missing reader and repository/plan immutability. Ensure stage-facing failures do not mutate stage outcomes.

### Keep untouched

Do not edit client reader implementation, REST review behavior, provider/prompt/persistence logic, stage skill text, docs, plugin version or trial tooling. Do not make live provider calls, access secrets, deploy, or use Fly/Wrangler.

## Done evidence

- `cd packages/yakka && go test ./internal/serve` passes with fake endpoint route coverage.
- `cd plugins/yakka/client && python3 -m unittest test_mcp_shim` passes with direct shim-to-server fixture coverage.
- A fixture repository completes both `uncommitted` and `range` MCP reviews and returns receipts; equivalent REST arguments/capture return the same receipt. `detail=full` returns validated findings, never captured input.
- The tests prove `read` is refused; spoofed `_local` is overwritten; unsupported reader gives `capture_unsupported`; default live request includes explicit `high`; oversized body is explicit; repo and plan bytes remain unchanged across calls and statuses.
- `git diff --check` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include exact check commands and outputs, deviations, contradictions and known problems. No secrets or live-call evidence.

A non-trivial bug outside your done evidence: report symptom, location and root cause. Do not fix it here.
