# Brief: phase3-01 — Server artifact_feedback declaration v2 and handler

Consumer: one build worker owning the server feedback surface.
Owned paths: `packages/yakka/internal/serve/mcp_stateless.go`, `packages/yakka/internal/serve/mcp_feedback.go`, `packages/yakka/internal/serve/mcp_feedback_test.go`, `packages/yakka/internal/serve/mcp_feedback_scoring_test.go`, `packages/yakka/internal/serve/mcp_feedback_local_action_test.go` (new), `packages/yakka/internal/serve/testdata/mcp-golden/artifact-feedback.json`. Touch nothing else.
Commits: leave changes in the working tree. The orchestrator builds and closes Phase 3.
Report: write `docs/plans/21-feedback-delivery/reports/phase3-01-server-feedback-v2.md` before finishing, using the `execution-report` rubric.
Depends on: nothing. Plan 24 E1's registry, capability advertisement, `-32011` directive and continuation are already built on this branch at `7be8aa3` (merged master); `TestMCPLocalAction*` passes at HEAD `f0cbec9`.
Runs alongside: `phase3-02-snapshot-sweep-drain.md` (disjoint paths).
Budget: 6 files to read, about 300 lines changed, about 35 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), and report `over budget`.

## Required reading, in order

1. `docs/plans/21-feedback-delivery/DESIGN.md:114-158` — the Feedback tool domain: argument, declared context, states, the six differences from Plan 24, `delivered`, annotations, approved E1 behaviour.
2. `docs/plans/21-feedback-delivery/DESIGN.md:83-106` — the MCP boundary domain, especially "Plan 21 adds no generic shim/registry mechanism", E1's ownership split, and the read-only service contract.
3. `docs/plans/21-feedback-delivery/DESIGN.md:311-344` — Assumptions 16, 17, 20, 25 (scan in the drain only; no shim kick; row hash and `ts`; covering-entry and 300 s rules).
4. `docs/design/08-server-mcp-contract.md:392-545` — the binding v2 declaration, queue reader v2, one directive round, result facts, retries, bounded primitive and authorization.
5. `packages/yakka/internal/serve/mcp_feedback.go:1-344` — the handler you are changing.
6. `packages/yakka/internal/serve/mcp_stateless.go:66-98` — `RegisterFeedbackMCPTool`, the declaration you are changing.
7. `packages/yakka/internal/serve/mcp.go:64-108, 203-410, 670-897` — read-only recon of the already-built registry, `DeclarationVersion`, `LocalActions`, `MCPLocalActionRequest`, `LocalContext.Action/Effects`, the `-32011` reply and continuation gates. Do not change this file.
8. `packages/yakka/internal/serve/mcp_feedback_test.go`, `mcp_feedback_scoring_test.go`, `mcp_local_action_test.go`, and `testdata/mcp-golden/artifact-feedback.json` — tests and fixtures that must move to v2.

Read ranges and grep; do not read a whole file to find one section, and truncate long tool output.

## Goal

Make the product `artifact_feedback` tool declare Plan 24's v2 `enqueue_file_snapshot` action and make its handler use the Phase 3 state order, covering/age rules and final wording, including the one server-requested enqueue and its refreshed-context result. This is Part 2 A's server half; the sweep, drain and Python matcher are the other unit.

## Contract

Binding, quoted from the design and design 08; do not restate them as new scope.

- "Plan 21 changes Plan 24's `artifact_feedback` handler by exactly the differences listed under the states below (all in phase 3 except (6), phase 5), and its declaration by the one edit in phase 5." (DESIGN.md:116)
- The six differences (DESIGN.md:138): "(1) `delivered` takes precedence over a pending or rejected entry when the hashes match …; (2) a covering entry is one at or after the file's mtime, and an older one does not count as pending; (3) the 300 s bound turns a dead-drain `queued` into `not delivered` or `stale`; (4) the 1.5 s wait for the store while a drain runs (Plan 24 D1) is dropped, `queued` is answered at once, and the only wait left is the pending-screen wait below; (5) `not delivered` and `stale` carry the fix text above; (6) the relative-path error names `cwd` and asks for an absolute path (base edit, phase 5)." Difference (6) is Phase 5 and is already built; leave it as it stands.
- States and order (DESIGN.md:137): `not tracked`, `delivered`, `rejected`, `queued`, `not delivered`, `stale`; "The tool never answers `queued` for something it did not find on the queue. The shim's own errors are not states of this tool."
- Approved E1 (DESIGN.md:141-155): "when the service lacks the hash, nothing covering is pending or rejected, and no effect result has been supplied, send the one bound directive. After the continuation, re-evaluate current hash, rejection, coverage and age before wording the answer. A successful `enqueued` or `covered` fact is not proof of delivery; `queued` requires refreshed covering queue evidence. If the drain has already taken the pointer but the service lacks the hash, answer `not delivered` or `stale` with enqueue acknowledged/delivery unconfirmed and the repeat-read fix. An effect failure (`capture_off`, `spool_dropped`, `yakka_bin_set`, `unsupported`, `path_changed`, `queue_unavailable`, `queue_rejected`, `stale_declaration`, `effect_unknown`) is visible with its fix, never a false queued/delivered answer."
- Declaration and negotiation (design 08:411-427): v2 adds `local_actions` `[{"action":"enqueue_file_snapshot","v":1,"path_from":"resolved_path"}]`, `rev` covers it, and "The action requires the declared `resolved_path`, `file`, `git`, `queue` (v2) and `drain` readers."
- Queue v2 (design 08:435-444): `coverage: {complete, pending_covering, rejected_covering, oldest_covering_age_s}`; "Counts and the oldest age are computed over the complete matching set … and not over the truncated sample." An incomplete scan must remain a required-reader failure, never a clean state.
- Read-only contract (DESIGN.md:116, 140): the handler "reads the store and answers, never calls `ingest.Ingest`, never writes locally, and needs read scope only"; `readOnlyHint` and `idempotentHint` true; scope `read`; no worker wake. Do not add a scope check to the handler; the registry already enforces the declared scope.

## Changes

### Declaration (`mcp_stateless.go`)

- Keep `cwd` and `project_dir` optional, then `resolved_path` (bases `["project_dir"]`), `file`, `git`, `queue`, `drain`, in that order.
- Set `DeclarationVersion: 2` and `LocalActions: []MCPLocalAction{{Action: mcpEnqueueAction, Version: mcpEnqueueActionVersion, PathFrom: mcpEnqueuePathFrom}}`.
- Change the queue reader to `{Reader: "queue", Version: 2, Params: map[string]any{"of": "git", "path": "resolved_path"}}`. Keep it required.
- Keep the description, input schema, annotations, validation and handler wiring as they are, except that the declaration now passes Plan 24's v2 registration.
- Do not add any new generic action, action version, reader parameter or registry behaviour; `mcp.go` stays untouched.

Known mismatches to record in the report, not resolve here:

- Design 08:429-432 says an old shim gets a v1 read-only variant with `not delivered`/`stale` plus `enqueue unsupported`; Plan 24's `mcpList` filters out a tool whose `DeclarationVersion` exceeds `Yakka-Context`, and the registry allows one declaration per tool name, so declaring v2 makes the tool absent for a v1 shim. That is a Plan 24 compatibility gap, not a reason to add a second declaration here.
- Plan 24's built shim spools an E1 pointer as a `PostToolUse`/`Write` entry with the call token as the conversation ID (`yakka.py:2891-2959`), while the Phase 3 A1 wording says `artifact_snapshot` and `feedback-<repo_id>`. Leave the shim and the wording alone; report the mismatch.

### Handler (`mcp_feedback.go`)

Keep argument/not-tracked handling and the existing Phase 4 scoring/score lines. Replace the state decision and wording with the following order and helpers.

1. **Facts.** Read `resolved_path`, `file`, `git`, `queue`, `drain` as today. Require `queue.coverage` to be an object with `pending_covering`, `rejected_covering` and `oldest_covering_age_s`; if it is missing or malformed, return the tool error `local context unavailable: queue (invalid_context)`, never a state. Keep the existing `content_hash` missing guard.
2. **Service read first.** Read the tenant artifact for `(repo, rel)` before evaluating pending or rejected entries.
3. **`delivered`.** If the artifact exists and `Latest.ContentHash == content_hash`, return `feedbackDelivered` immediately, whatever the queue holds. Do not wait, and do not let a pending or rejected entry mask it. Keep the Phase 4 `screen:` and `scoring:` lines unchanged.
4. **`rejected`.** If `coverage.rejected_covering > 0`, return `rejected` even when a covering pending entry also exists. Use the matching `queue.rejected` diagnostic entries (mtime at or after `file.mtime`) for the reason lines, add `mcpFeedbackFix`, and never print the matched secret. If the covering rejection is outside the 50-entry sample, still return `rejected` and say the queue holds `<n>` rejected entries for this file at or after its mtime and to read `queue/rejected` for the reason; never fall back to `queued`.
5. **`queued` and the 300 s bound.** If `coverage.pending_covering > 0`, answer at once, with no store wait. Let `age = coverage.oldest_covering_age_s` (`0` when null).
   - If `age <= 300`, return `queued` with the count, oldest age and `drain.running`: "the version is on its way; call again in a few seconds". When no drain runs, add `mcpFeedbackNoDrainFix`.
   - If `age > 300`, return `not delivered` (no service version) or `stale` (older service version), naming the age, `drain.running` and `yakka status`. Do not say `queued`.
   Remove the old 1.5 s poll on `drain.running` entirely.
6. **Enqueue directive.** With no service hash match, `coverage.pending_covering == 0`, `coverage.rejected_covering == 0`, and no effect facts, if `local.Action()` returns the declared action return `MCPLocalActionRequest{Action: action.Action, Version: action.Version}` from the handler (the registry derives path, rev, call and action id). If no action is bound (old shim), do not return a directive; give `not delivered`/`stale` with the enqueue-unsupported line below.
7. **Continuation and effects.** When `local.Effects()` returns facts, do not return another directive. Re-evaluate with the refreshed facts in the order above. Then:
   - `enqueued` or `covered` with no matching hash and no covering pending/rejected: `not delivered`/`stale` saying the enqueue was acknowledged but delivery is unconfirmed, and to call again.
   - `failed`/`unknown`: keep the state that the current facts support, add a visible effect line with its fix from the table below, and never claim `queued`/`delivered`.
8. **No covering evidence.** `not delivered` and `stale` use the design's fix: save the file again with the Write tool or make a real Edit (a no-op edit may be refused and fires no event); otherwise the sweep delivers it at turn end, and a session killed before Stop/SessionEnd loses the write. `stale` also names both short hashes and the service timestamp, as today.
9. **Effect lines.** Use these exact fact/fix pairs (append to the state line):
   - `capture_off`: "local enqueue did not run: capture is off (YAKKA_HOOKLOG=off); nothing was queued. Fix: enable capture, then rewrite the file or call again."
   - `spool_dropped`: "local enqueue did not complete: the queue write failed; nothing may have been queued. Fix: check the queue directory and call again."
   - `yakka_bin_set`: "local enqueue is unavailable while YAKKA_BIN is set; nothing was queued. Fix: unset YAKKA_BIN for the plugin and call again."
   - `unsupported`: "local enqueue is not supported by this shim; nothing was queued. Fix: update the plugin and call again."
   - `path_changed`: "the file changed during the call, so nothing was queued for it. Fix: call again for the current file."
   - `queue_unavailable`: "the local queue could not be read or written; nothing was queued. Fix: check the queue directory and call again."
   - `queue_rejected`: "a covering rejection is already queued for this file, so nothing new was queued. Fix: rewrite the file; the new write is the repair."
   - `stale_declaration`: "the tool declaration changed during the call; nothing was queued. Fix: call again."
   - `effect_unknown`: "the local enqueue outcome is unknown; an entry may have been written. Fix: call artifact_feedback again to read current coverage and delivery."
   - old shim, no bound action: "local enqueue is unsupported by this shim; deliver the file with a Write-tool edit or the end-of-turn sweep."
10. **No new effects, no ingest, no writes, no worker wake, no scope check.** The handler never calls `ingest.Ingest`, never writes the store or queue, never starts a drain and never scans content.

### Tests and fixtures

- Update every existing feedback test's local context to `_v: 2` and a queue fact with `coverage` (and diagnostic `pending`/`rejected` lists where used). Keep them as tests of the new contract:
  - `TestMCPArtifactFeedbackCorpus` and `testdata/mcp-golden/artifact-feedback.json`: update the declaration-derived local version, all `not delivered`/`stale`/`queued` expected text to the new wording, and assert the tool `_meta` declaration has `v: 2`, the one `local_actions` entry, and queue reader `v: 2`.
  - `TestMCPArtifactFeedbackDeliveredFormattingAndLogPrivacy`: update the stale expectation to the new fix text; the delivered/score lines stay.
  - `TestMCPArtifactFeedbackReaderFailuresAndTenantBoundary`: add a malformed/missing `coverage` case that must be `local context unavailable`, not a state; keep the no-write assertion.
  - `TestMCPArtifactFeedbackRunningDrainWaitsWithoutStartingOne` and `TestMCPArtifactFeedbackRunningDrainSeesDelivery`: replace the 1.5 s wait assertions with (a) a covering pending answer returning immediately (`queued`), and (b) `delivered` when the service hash matches before the call. Do not keep a wait-based test.
  - `mcp_feedback_scoring_test.go`: update its local context to `_v: 2` plus empty coverage; the Phase 4 scoring outcomes must not change.
- Add `mcp_feedback_local_action_test.go` with product-tool tests using the real registry and fake local facts:
  - first call with `Yakka-Context: 2`, `Yakka-Local-Actions: enqueue_file_snapshot/1`, `_v: 2`, `_call`, `_rev`, service lacking the hash, empty coverage -> JSON-RPC `-32011` with `action: enqueue_file_snapshot`, `action_v: 1`, the exact resolved path, the call token and rev; no store write.
  - continuation carrying one `effects` fact and refreshed covering coverage -> `queued`; refreshed matching store hash -> `delivered`; refreshed empty coverage after `enqueued` -> `not delivered`/`stale` with the acknowledgement/unconfirmed line; `capture_off` and `effect_unknown` -> the visible line and no false queued/delivered.
  - service already has the hash -> `delivered` and no directive; covering pending -> `queued` and no directive; covering rejected -> `rejected` and no directive.
  - 300 s bound: covering age 301 -> `not delivered`/`stale` with age and `yakka status`; age 300 -> `queued`.
  - registering `RegisterFeedbackMCPTool` succeeds only with queue reader v2; `tools/list` for `Yakka-Context: 1` omits the v2 tool (the registry's existing rule). Record this as a compatibility observation against design 08's "v1 read-only variant" sentence; do not add a second declaration or change the registry, which the task places outside P3.

### Keep untouched

- `packages/yakka/internal/serve/mcp.go` and Plan 24's generic registry/declaration/action machinery; `mcp_local_action_test.go` and `mcp_local_action_shim_test.go` stay as they are.
- `mcp_feedback.go`'s argument error texts, `feedbackRelativeError`, `keys.Kind`/`validKind` guards, `feedbackDelivered`'s screen/score/baseline formatting, and the `scoring:` value logic.
- `internal/mcp` (legacy Go client), Python client, all design docs, config, spool and queue.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `cd packages/yakka && go test ./internal/serve/ -run 'TestMCPArtifactFeedback|TestMCPLocalAction|TestFeedbackScoring' -count=1 -v` -> all pass; the new product directive/continuation and 300 s cases appear in the output.
- `cd packages/yakka && go test ./internal/serve/ -count=1` -> ok (no live service, no network).
- `cd packages/yakka && go vet ./internal/serve/ && test -z "$(gofmt -l internal/serve)"` -> clean.
- Observable in the test output: `tools/list` declaration has `v: 2`, one `local_actions` entry with `enqueue_file_snapshot`/`1`/`resolved_path`, and queue reader v2; the first empty-coverage call returns `-32011` and the continuation returns `queued`/`delivered` from refreshed facts; no test observes a 1.5 s wait.

## Boundaries

- Do not push, merge, change branches, touch master, Plans 22/23/24, PR #184 or `/home/codyh/workspace/yakka-wt/`.
- Do not run fly or wrangler, deploy, set/read/print secrets, touch production configuration, Cloudflare or Fly settings, or run tenant reset/delete.
- Do not call the live remote or `artifact_feedback` on a live service, and create no egress. Build and test against fakes only.
- Do not change Plan 24's shim form, `spool.sh`, the Python drain, the queue, or any design doc. Do not implement the sweep here.
- Do not run the unrelated layout test (`tools/release/test_layout.py::test_repo_passes_layout_check`).

## Gates (live, Cody)

- Deploying the feedback declaration/handler change to the live service (ledger 28) before any live `delivered`/`queued` observation.
- The issue's own budget-repo case and a live scratch-repo call showing `queued` then `delivered` (egress; run by Cody if the build has no access).
- `artifact_feedback` checks on this brief and the phase report (egress; not run here).
