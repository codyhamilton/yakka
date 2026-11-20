# Implementation — Dense analytics UI and evidence-led data repairs (plan 29)

- Tool: OpenCode `opencode run` — model `opencode-go/deepseek-v4.1-flash`; Phase 1 retry orchestrated in worktree `/home/codyh/workspace/yakka-build/29`
- Start: 2026-11-21 00:06 AEST (Australia/Brisbane, UTC+10)
- Branch: `feat/29-analytics-ui-rework`
- Design baseline: `e5052a43` (design PR #280); design artifacts `DESIGN.md`, `EVIDENCE.md`, `REVIEW.md`

## Phase 1 — Every read represents the selected question

Units and waves: see `DESIGN.md` § Phase 1 Units.

| Unit | Brief | Wave | Depends on |
| --- | --- | --- | --- |
| phase1-01 | `briefs/phase1-01-real-go-two-tenant-harness.md` | 1 | — |
| phase1-02 | `briefs/phase1-02-read-context.md` | 1 | 01 (browser evidence) |
| phase1-05 | `briefs/phase1-05-coverage.md` | 1 | — |
| phase1-03 | `briefs/phase1-03-schema-adapter.md` | 2 | 01, 02 |
| phase1-06 | `briefs/phase1-06-capability-parity.md` | 2 | — |
| phase1-04 | `briefs/phase1-04-field-validity.md` | 3 | 01, 03, 06 |
| phase1-07 | `briefs/phase1-07-plan-conversation.md` | 3 | 01, 06 |

Refinement feedback: `artifact_feedback` returned `local context unavailable: queue (invalid_context)` for all seven briefs. Recorded as queued, not scored; refine continued.

First-refinement coarse check: Phase 2 and Phase 3 surfaces, contracts and outcomes are locatable in `DESIGN.md`/`EVIDENCE.md`, and their dependency on Phase 1 is real; no briefs were written for them.

Phase 1 status: not started; the orchestrator builds and closes it.

