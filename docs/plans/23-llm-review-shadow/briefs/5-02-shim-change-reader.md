# Brief: 5-02 — Shim `change` capture reader

Consumer: the server declaration and `review_change` tool built by Phase 5 units 5-01 and 5-03.
Owned paths: `plugins/yakka/client/yakka.py`, `plugins/yakka/client/test_mcp_shim.py`, and `plugins/yakka/client/test_capture.py` only if shared capture fixtures must be extended. Touch nothing else.
Repository: `/home/codyh/workspace/yakka-build/23`; branch: `feat/23-llm-review-shadow`.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/5-02-shim-change-reader.md` (rubric: `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing; implement against the declared `change` reader contract in DESIGN.md and 5-01 brief.
Runs alongside: 5-01.
Budget: 9 files to read, about 800 lines to change, 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Domain: Local change capture; Architectural Implications (a); Phase 5 Outcome.
2. `docs/plans/23-llm-review-shadow/briefs/1-01-local-change-capture.md` and its report — landed capture API and safety decisions.
3. `docs/design/08-server-mcp-contract.md` — declaration, `_local`, and bounded reader contract.
4. `plugins/yakka/client/yakka.py` and `test_mcp_shim.py` — fixed reader table and typed declaration validation.

## Goal

Register the existing safe local `CaptureChange` mechanism as the shim's declared `change` reader and validate the typed policy constants supplied by the server.

## Contract

Binding design text:

> “The server declares content-bearing reader `change` in `review_change`'s context list with server-supplied parameters (the policy values above), a content-bearing reader entry, `bulk:true`, `params.budget_bytes=2097152` and `required:false` so the handler can translate unsupported capture failures. Collection is still mandatory for a review; optional at the registry gate does not mean an empty capture is accepted.” (DESIGN.md, Domain: Local change capture)

> “The shim holds only mechanisms for reading safely” and “every policy value is the server's and arrives in the declaration” (DESIGN.md, Domain: Local change capture)

The policy keys and validation shapes are defined in the design's `Declared reader` contract and `internal/review/policy.json`. Preserve `CaptureChange` behavior, overwrite any agent-supplied `_local`, and return typed reader failure facts rather than inventing an empty successful capture. No tool name, description, schema, prompt or policy default belongs in the shim.

## Changes

- Add reader version 1 to the fixed shim reader table and parse only the `change` declaration's approved typed constants. Unknown fields, wrong types, unsafe values and unsupported versions fail as explicit reader/declaration errors.
- Call `CaptureChange` using server-declared policy and the call's `mode`, `view`, `include_untracked`, `base`, `head`, `merge_base` arguments. Keep the reserved `_local` overwrite and existing timeout/budget behavior.
- Add fixtures for legal declaration and reader output, each capture mode, malformed policy declarations, unsupported reader/version, failed capture propagation, and spoofed `_local` overwrite. Reuse capture tests instead of duplicating its safety suite.

### Keep untouched

Do not add a tool definition or review logic to the client. Do not change capture policy defaults, secret-pattern handling, git operation safety, request routing, stage skills or plugin version; those are outside this unit.

## Done evidence

- `cd plugins/yakka/client && python3 -m unittest test_mcp_shim test_capture` passes.
- A fixture `tools/call` injects the captured `_local.change` value using server policy; agent-supplied `_local` is overwritten, and unsupported or failed capture is not represented as a successful empty capture.
- Existing shim reader fixtures pass unchanged, and malformed typed policy declarations fail closed.
- `git diff --check` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include exact check commands and outputs, deviations, contradictions and known problems.

A non-trivial bug outside your done evidence: report symptom, location and root cause. Do not fix it here.
