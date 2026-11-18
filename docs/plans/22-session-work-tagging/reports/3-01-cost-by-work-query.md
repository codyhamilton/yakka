status: done with concerns
reason: Fake-backed query behavior and targeted tests pass; the real-data and CHM launch checks remain gated for Cody.

# Phase 3 unit — Cost by work query

Extended the in-memory usage aggregation to join each deduplicated usage call to its effective projected action segment by conversation and timestamp. Cost and token measures, `model_calls`, `unpriced_calls`, and the new distinct-conversation `sessions` measure expose the six `action_*` dimensions and filters. Missing segments use `(untagged)`; rejected-only conversations use `(rejected)`; accepted actions with absent values use `(none)`. Rejected actions do not close accepted segments. Action filters select accepted tagged calls only. Special buckets survive top-N folding. The HTTP query allows up to three all-action dimensions and retains the two-dimension limit when a legacy dimension is included. Updated `docs/design/03-remote-service.md`.

## Checks

- Before changes, `cd packages/yakka && go test ./internal/store ./internal/serve` passed (both packages; cached).
- Added a pre-change regression check for an action dimension on `cost_usd`; it failed as expected with `unsupported dimension action_kind for cost_usd`.
- After changes, `cd packages/yakka && go test ./internal/store ./internal/serve` passed (`store` and `serve`). Seeded tests cover the exact action timestamp boundary, a rejected action between accepted segments, untagged/rejected reconciliation and top-N survival, a GitHub subject's `(none)` plan/phase, unpriced calls, distinct sessions, action-filter exclusion, unsupported measure/filter combinations, and the three-dimension HTTP contract.
- A no-action usage HTTP golden confirms byte-identical JSON: `{"bucket":"none","dims":[],"measure":"cost_usd","rows":[{"k":[],"v":0.0004}]}`.
- `git diff --check` passed.

## Gates and unfinished verification

- **Real-data Phase 3 item 4 — gated for Cody.** No live classification, egress, private tenant, or real endpoint call was made. Message-time versus import-time timestamps remain unverified for all harnesses; Phase 2 session cost remains unverified; subagent and Cursor counts remain unverified. The local seeded tests do not establish runtime support.
- **CHM Phase 3 item 5 — gated for Cody/CHM.** No real `harness pick` launch was run. Await CHM's change, then verify one launch per harness and its accepted action and cost query.

No contract contradiction or implementation deviation was found. No unrelated layout test was chased. The two gates above are the remaining verification; this unit is not reported issue-done.
