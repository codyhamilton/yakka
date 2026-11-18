# Brief: 3-01 — Cost by work query

Consumer: the Phase 3 implementation worker; its consumer is Phase 4's `work_cost` MCP tool and the analytics API callers.
Owned paths: `packages/yakka/internal/store/usage.go`, `packages/yakka/internal/store/usage_test.go`, `packages/yakka/internal/store/query.go`, `packages/yakka/internal/store/query_test.go`, `packages/yakka/internal/serve/analytics_query.go`, `packages/yakka/internal/serve/analytics_query_test.go`, `docs/design/03-remote-service.md`, `docs/plans/22-session-work-tagging/reports/3-01-cost-by-work-query.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/22-session-work-tagging/reports/3-01-cost-by-work-query.md` and include it in the commit.
Depends on: Phase 1 (`session_actions` rows and deterministic segment projection); Phase 2 (session-start capture).
Runs alongside: nothing.
Budget: 12 files to read, about 500 lines to change, 20 tool turns. Past the budget, stop and write a handoff in `IMPLEMENTATION.md` under Phase 3, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/22-session-work-tagging/DESIGN.md` — Domain: Cost by work; Phase 3 outcome; the Action and Record/projection contracts.
2. `docs/plans/22-session-work-tagging/IMPLEMENTATION.md` — Phase 1 and Phase 2 outcomes, verification, and Carried items.
3. `packages/yakka/internal/store/query.go` — usage measure definitions, dimension/filter handling, and query behavior.
4. `packages/yakka/internal/store/usage.go` and `packages/yakka/internal/serve/analytics_query.go` — existing usage aggregation and HTTP query constraints.
5. `packages/yakka/internal/store/actions.go` — projected action/segment read contracts.
6. Existing tests in the owned paths — fixture setup, seeded analytics conventions, and golden compatibility tests.
7. `docs/design/03-remote-service.md` — current analytics API documentation to update.

## Goal

Extend the existing usage query so cost-bearing usage calls are attributed to the projected action segment active at each call timestamp. Expose the Phase 3 action dimensions and filters through `/v1/analytics/query` while preserving queries that do not use them.

## Contract

The binding contract is `DESIGN.md`, Domain: Cost by work and Phase 3. In particular:

- Cost measures `cost_usd`, `tokens_*`, `model_calls`, `unpriced_calls`, and per-bucket distinct-conversation `sessions` gain `action_kind`, `action_plan`, `action_phase`, `action_subject`, `action_pr`, and `action_source` dimensions and filters.
- Join each priced usage call to the projected action segment containing its `ts`. Missing segments bucket as `(untagged)`; conversations with rejected actions and no accepted action bucket as `(rejected)`. Preserve these buckets through top-N folding. A tagged call missing a dimension value uses `(none)`. A rejected action does not end an accepted segment.
- Action filters exclude untagged and rejected calls. For other measures, an `action_*` dimension or filter is an error. Queries without action fields return byte-identical results to their prior behavior.
- Up to three dimensions may be combined when every dimension is `action_*`. Preserve the existing two-dimension limit when any requested dimension is non-action.
- Cost remains priced on read; `unpriced_calls` is visible by bucket. `sessions` counts distinct conversations in each bucket.

Phase 2 carried: runtime behavior for all harnesses remains unverified; do not claim runtime support. The unrelated layout-test failure recorded in Phase 1 is not to be chased unless it blocks this unit.

## Changes

- Implement the segment join in the in-memory usage aggregation using Phase 1's persisted `session_actions` representation and segment boundaries. Do not change action projection or infer tags from other facts.
- Add action query filters through the existing analytics filter path and validate the allowed measure × dimension combinations at the API and store boundaries.
- Allow up to three dimensions only when every requested dimension is `action_*`; preserve the existing two-dimension limit whenever a query includes a non-action dimension, and preserve the response shape otherwise.
- Keep `(untagged)` and `(rejected)` out of top-N folding. Ensure the same call contributes to exactly one action bucket per requested dimensions.
- Update the server analytics documentation to describe the query surface and buckets.
- Do not add client code or the Phase 4 `work_cost` tool.

### Keep untouched

- Preserve the usage-call deduplication and pricing behavior in `usage.go`.
- Preserve non-action measure definitions, legacy dimensions, filters, and response JSON byte-for-byte as exercised by existing golden tests.
- Keep queries using action fields on the in-memory usage aggregation; do not add SQL dimension-table columns or store cost values.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- A seeded tenant test with phases 1–3 and kinds build/review/fix, a two-action timestamp boundary, untagged and rejected-only conversations, and an unpriced harness proves the Phase 3 items 1–2: cost reconciliation to independently computed per-conversation totals, exact timestamp split, special-bucket survival and reconciliation, rejected-between-accepted behavior, unpriced calls, and distinct sessions.
- Tests prove an action field on a measure that lacks action support returns an error; the no-action golden query output is byte-identical.
- HTTP tests prove the three-action-dimension limit/validation and action filter behavior.
- `cd packages/yakka && go test ./internal/store ./internal/serve` → pass.
- `git diff --check` → clean.

### Gates

- **Real-data check (Cody):** Do not make live classification, egress, or real endpoint calls. Do not query private/live tenant data as part of this unit. Record the real-data Phase 3 item 4 as gated for Cody to run in an authorized environment; the report must state that message-time versus import-time timestamps, Phase 2 session cost, and subagent/Cursor counts remain unverified.
- **CHM launch check (Cody/CHM):** Do not run real `harness pick` launches. Record Phase 3 item 5 as gated until CHM's change has landed and Cody verifies one launch per harness and its resulting accepted action and cost query.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, before/after check output, any deviation and why, any contradiction with cited contracts, and the two gate states above. Do not call the phase fully issue-done while either gate remains open.
