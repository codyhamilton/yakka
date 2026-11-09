# Brief: 5-04 — Advisory stage wiring and stable docs

Consumer: maintainers and the `execute`, `post-build`, and `comprehensive-review` stages that invoke the advisory review alongside existing review work.
Owned paths: `plugins/yakka/skills/execute/SKILL.md`, `plugins/yakka/skills/post-build/SKILL.md`, `plugins/yakka/skills/post-build/briefs/*.md` only where the stage call contract is specified, `plugins/yakka/skills/comprehensive-review/SKILL.md`, `plugins/yakka/.claude-plugin/plugin.json`, `docs/ARCHITECTURE.md`, `docs/OVERVIEW.md`, `docs/design/04-advisory-surface.md`, `docs/design/08-server-mcp-contract.md`, `docs/design/system-architecture.md`, and `tools/driver/check_skills.py` only if existing checks need a narrow update. Touch nothing else.
Repository: `/home/codyh/workspace/yakka-build/23`; branch: `feat/23-llm-review-shadow`.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/5-04-stage-wiring-docs.md` (rubric: `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 5-03; wait for the registered MCP tool and verified call shape.
Runs alongside: nothing.
Budget: 15 files to read, about 700 lines to change, 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Solution Shape; Domain: Tool surface and shadow invocation; Phase 5 Outcome; Architectural Implications (stable docs and plugin version).
2. `docs/design/04-advisory-surface.md`, `docs/design/08-server-mcp-contract.md`, and `docs/design/system-architecture.md` — existing tool ownership, declaration and product boundary.
3. The `execute`, `post-build`, and `comprehensive-review` skill files and current plugin manifest.
4. `tools/driver/check_skills.py` and the relevant fixture checks.
5. `docs/plans/23-llm-review-shadow/reports/5-03-mcp-review-integration.md` — verified call contract.

## Goal

Call the shadow review beside current phase-close and PR-head reviews as advisory evidence, and describe the server-owned tool and its boundaries in stable docs.

## Contract

Binding design text:

> “Stage skills call the tool beside the existing reviews, at each phase close and at the PR head; it is advisory and feeds no gate, verdict, commit or exit code.” (DESIGN.md, Solution Shape)

> “the `execute`, `post-build` and `comprehensive-review` skill texts each name one non-gating `range` call with `build_models` taken from the run record or `unknown` (a presence check, since the stages are agent prose)” (DESIGN.md, Phase 5 Outcome)

Use the exact registered tool schema and result handling verified by 5-03. Use an explicit git range and the existing plan/phase or PR criteria reference where available. Preserve `build_models` provenance; use `unknown` when unavailable. Do not invoke `trial`. The capability remains advisory even when absent, unavailable or failed.

## Changes

- Add one non-gating `review_change` range invocation to each named stage at phase close / PR head, with criteria reference and build models. State how to report its receipt/findings without converting it to a workflow decision.
- Update stable docs 4, 8, system architecture, Architecture and Overview to describe tool ownership, `read_write`/spend-and-record boundary, shim-only local capture, no provider key on machines, advisory behavior and no local actions.
- Bump the Claude plugin version in the same change as skill changes. Update skill checks only as required by existing architecture; do not weaken unrelated checks.

### Keep untouched

Do not wire review into gates, verdicts, commits, exit codes or reports as a required condition. Do not add a live provider call, trial invocation, configuration/provisioning instructions implying completion, or unrelated stale-doc fixes.

## Done evidence

- `python3 tools/driver/check_skills.py` passes.
- `git diff --check` passes.
- A text/fixture check finds exactly one non-gating `range` review call in each of the three named skill texts, obtains `build_models` from the run record or `unknown`, and confirms no `trial` argument is sent.
- The plugin manifest version increases and stable docs consistently identify the server as owner and review as advisory.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include exact check commands and outputs, deviations, contradictions and known problems.

A non-trivial bug outside your done evidence: report symptom, location and root cause. Do not fix it here.
