# Brief: phase1-07 — Plan identity/associated cost/events and conversation tool kinds

Consumer: the execute worker for phase1-07; the Phase 1 verifier reads plan-detail and session-lane evidence.
Owned paths: `packages/yakka/internal/store/plan_entities.go`, `packages/yakka/internal/store/conversation.go`, `packages/yakka/internal/serve/analytics_entities.go` (plan handlers only), `packages/yakka/internal/serve/analytics_conversation.go`, `packages/yakka/internal/store/plan_entities_association_test.go` (new), `packages/yakka/internal/serve/analytics_plan_conversation_parity_test.go` (new). Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase1-07-plan-conversation.md` (rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase1-06 (both change `analytics_entities.go`), phase1-01 (harness).
Runs alongside: phase1-04.
Budget: read about 9 files, change about 220 lines, 30 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md:95-96` — plan identity/associated cost/events and conversation `tool_kind`.
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md:45,48` — D15 and D18; `:79` — plan detail fixture observation.
3. `docs/design/09-analytics-workspace-contracts.md:11` — plan identity without raw repo/plan filtering; `:57-65` — version/session/plan joins and `plan → sessions`; `:88` — conversation timeline coverage.
4. `packages/yakka/internal/store/plan_entities.go:22-48` — `PlanAssociatedCost` clears only `Plans`; `:120-135` — `PlanEntitiesPage` usage filter; `:243-261` — `PlanSessionIDs`; `:303-355` — `PlanDetailCount`/`PlanDetailPage` event SQL with the extra outer `repo_id`.
5. `packages/yakka/internal/serve/analytics_entities.go:525-595` — plan identity params, `parseFilter`, and the detail/list calls; `packages/yakka/internal/serve/analytics.go:315-317` — `parseFilter` puts URL `repo_id`/`plan` into `f.Repos`/`f.Plans`.
6. `packages/yakka/internal/store/conversation.go:21-35` — event struct; `:170-200` — event SQL/scan; `packages/yakka/internal/store/toolkind.go:12-59` — the existing `toolKindExpr` taxonomy.
7. `packages/yakka/internal/serve/analytics_conversation.go:79-92` — event map with no `tool_kind`; `packages/yakka-analytics/web/js/panels/session-lanes.js:40-70` — groups on `tool_kind`.
8. `packages/yakka/internal/serve/analytics_plan_execution_test.go:13-51` — plan cost test; `:186-220` — event paging test; `analytics_conversation_test.go:73-138` — tool event fixture.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make a plan's associated cost and event collections follow the plan's associated sessions rather than raw repo/plan fact filters, and serialize the existing normalized `tool_kind` so session tool lanes work.

## Contract

- `DESIGN.md:96`: "Plan identity selects lifetime associated sessions; it is not an additional raw repo/plan filter on their usage or events. Associated cost includes those sessions' in-window usage with empty raw repo, and plan events include their hooks. Explicit genuine event filters still apply; keep page/count predicates identical and costs overlapping across plans."
- `DESIGN.md:95`: "Conversation detail supplies the existing normalized `tool_kind` taxonomy used by tool lanes. Do not invent another browser-only mapping."
- `09-analytics-workspace-contracts.md:64`: "`plan → sessions`: sessions with at least one artifact fact under that plan (many to many). `associated_cost_usd` is the sum of those sessions' in-window costs and is non-additive across plans."

## Changes

- **Plan cost/list** (`plan_entities.go`):
  - In `PlanAssociatedCost`, remove identity `Repos` and `Plans` from the usage filter (not only `Plans`); association stays the explicit `repo_id`/`plan` arguments joined to `conversation_id`. Genuine filters (`harness`, `model`, `kind`, window, etc.) remain.
  - In `PlanEntitiesPage`, apply the same identity clearing to the usage source used for associated cost/provenance, while the plan population still comes from in-window artifact facts under the requested repo/plan.
- **Plan detail events** (`PlanDetailCount`/`PlanDetailPage`):
  - Build one event filter with identity `Repos`/`Plans` cleared and use the same predicate in the count and the page.
  - Remove the extra outer `repo_id=?` restriction; select event facts by `conversation_id IN (SELECT DISTINCT conversation_id FROM facts a WHERE a.type='artifact_version' AND a.repo_id=? AND a.plan=?)`. Preserve genuine event filters and the existing keyset/order.
  - Keep artifact/session/execution collections as they are; only the event identity conflation is wrong.
- **Conversation tool kind**:
  - Add `ToolKind` to `store.ConversationEvent`, select `toolKindExpr` in the conversation SQL, and scan it.
  - Serialize `"tool_kind": e.ToolKind` in every event map. Keep the existing taxonomy values unchanged (including `other` for an unlisted non-empty tool and empty for no tool); never omit the key and never invent a browser mapping.
  - Do not change event caps, integrity/unavailable reasons or totals.

## Keep untouched

- Catalogue/score-series/scatter capability (phase1-06) and coverage (phase1-05).
- Store migrations, schemas and pricing tables.
- Client panels; session-lanes already groups on `tool_kind`.
- The Plan 28 trial and any deployed data.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

Test constraints: Go tests use generated fixtures and must not use `/tmp` for new harness data (use the worktree's ignored `.scratch/`). Browser observables wait on real end states, with no fixed sleeps or animation/timing assertions.

- `cd /home/codyh/workspace/yakka-build/29/packages/yakka && GOTOOLCHAIN=auto go test ./internal/store -run '^TestPlanAssociatedCostUsesAssociatedSessions$' -count=1` → pass. Fixture: plan-a's writer session has a $0.10 priced usage call with empty raw `repo_id`; `PlanAssociatedCost` returns 0.10 (not 0), and a `RepoID` filter on the plan list does not zero it. Before the fix it returns 0/nil because `usageFilter.Repos` survives.
- `… GOTOOLCHAIN=auto go test ./internal/serve -run '^TestPlanDetailEventIdentity$|^TestConversationToolKind$' -count=1` → pass. Plan detail count equals the paged total and includes both the artifact and the usage event; conversation rows for `Read`, `Bash` and an unknown non-empty tool carry `tool_kind` `read`, `shell`, `other` respectively, and a non-tool event carries `tool_kind:""` rather than no key. Before the fix the count/page omit the usage event and no `tool_kind` key exists.
- Regression: `… GOTOOLCHAIN=auto go test ./internal/store -run 'TestPlan|TestConversation' -count=1` and `… go test ./internal/serve -run 'TestAnalyticsPlan|TestAnalyticsConversation' -count=1` → pass.
- Browser observable via `phase1-01`: `plan29-a` plan detail shows associated cost `$0.10` and both its artifact and usage events; `sess-gamma`'s session lanes group `Read`/`Bash` under the taxonomy kinds. Before the fix the plan shows `$0.00`/artifact-only and lanes collapse to generic events.
- Production parity (verification-time read-only): read a plan detail and a conversation for trial tenant `test` with `/home/codyh/.config/yakka/trial.env` + `client.toml`. If unreachable, record `gate: production parity <reason>`.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
