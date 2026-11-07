# Phase 4 brief — delivered means screened and scored

## Context

Plan 21 Phase 4, `Delivered means screened and scored`, in `docs/plans/21-feedback-delivery/DESIGN.md`. Work in `/home/codyh/workspace/yakka-build/21` on branch `feat/21-feedback-delivery`. The design marks this phase `approach: open` because its live closure depends on the live scorer state. This brief settles the code outcome against the code as it stands on this branch (Plan 24's server `artifact_feedback` is already on it at `b2094eb`). The live closure is a gate, not part of this brief.

The tool lives on the server: `packages/yakka/internal/serve/mcp_feedback.go` (`mcpArtifactFeedback`, `feedbackDelivered`). The Go client copy in `packages/yakka/internal/mcp/feedback.go` is legacy and is left untouched.

## Outcome

For a version the service holds with a matching hash (`state: delivered`):

1. A `scoring:` line follows the `screen:` line, with a value the server takes from its own scoring state, never from the client:
   - `scoring: off` when the server has no scorer or no checks loaded (`scoring()` in `admin.go` returns either false). The line also says scoring is not configured on the service and that stored content is scored by an admin rescore once it is.
   - `scoring: on` when the scorer and checks are loaded and the screen has been recorded (a `Screen` on the latest version, or a screen-stage rejection). Score lines and the baseline lines are unchanged.
   - `scoring: pending` when the scorer and checks are loaded, no screen has been recorded yet, and the latest version's `ReceivedAt` is under 30 s before the answer. The line says to call again.
   - `on` also applies when the screen has not been recorded and the version is 30 s old or more (the existing `screen: awaiting screen` line says so). Nothing in this brief names a new state.
2. When scoring is configured, no screen is recorded yet, and the version is under 30 s old, the call waits up to `feedbackScreenWait` (a package variable, default 10 s) for the screen, polling the store every 100 ms. It stops early when the screen is recorded or when the latest hash for the path is no longer this file's hash. With scoring off there is no wait.
3. Argument errors, `stale`, `queued`, `rejected`, `not tracked` and `not delivered` are unchanged. The golden corpus has no `delivered` case, so it is not edited.

## Work

- In `mcp_feedback.go`, pass the repo and relative path into `feedbackDelivered` (both call sites have them). Add the screen wait and the `scoring:` line. Put the value decision in a pure function (configured, screened, received time, now) so it can be unit-tested with times.
- Declare `var feedbackScreenWait = 10 * time.Second` and the 30 s pending window as a constant in the same file.
- Add tests in `packages/yakka/internal/serve` with fakes only (`feedbackServer`, `DisableWorker: true`, `Promote` from the test to play the screen worker):
  - the pure value function across off, on, pending and after-30 s;
  - `scoring: off` with the reason for a server without a scorer;
  - configured, screen recorded after about 200 ms by a goroutine: the call returns in under `feedbackScreenWait`, `scoring: on`, `screen: pass by ...` and a score line;
  - configured, no screen, `feedbackScreenWait` shortened in the test: the call returns `scoring: pending` with the call-again wording.
- Run `go test ./internal/serve/ -count=1` and `go vet ./internal/serve/`. Record any failure that predates this change, with its output, and do not chase it.

## Boundaries

- Do not push, merge, change branches, touch master, Plans 22/23/24 or `/home/codyh/workspace/yakka-wt/`.
- Do not run fly or wrangler, touch secrets, production configuration, Cloudflare or Fly settings, or the scorer key or checks directory.
- Do not call the live remote, `artifact_feedback` on a live service, or any classification or egress call. Build and test against fakes only.
- Do not change `internal/mcp` (Go client, legacy), `yakka.py`, `internal/serve/admin.go` (the rescore gate and `rescorable` stay as they are), or any design doc.
- Do not implement local effects, `enqueue_file_snapshot`, or queue writes. The queue stays pointer-only and the drain path is unchanged.
- Do not run the unrelated layout test (`tools/release/test_layout.py::test_repo_passes_layout_check`); it is documented as pre-existing.

## Evidence

- The test output for the new and existing `MCPArtifactFeedback` and `MCPStateless` tests, and for the whole `internal/serve` package.
- The `go vet` result.
- A `git diff --stat` for the phase commit.

## Gates (live, Cody)

- Reading the live `scoring:` line of an `artifact_feedback` call on the deployed service (egress; ledger 28).
- Turning scoring on: scorer key and `YAKKA_CHECKS_DIR` (production setting; ledger 28).
- The admin rescore of the budget file stored while scoring was off (needs an admin browser session; ledger 21).
- An agent-written design through a live session showing `delivered` with the `scoring:` line (egress).

## Reporting

Write `docs/plans/21-feedback-delivery/reports/phase4-scoring-line.md` before the phase-closing commit, using the `execution-report` rubric. Record what was built, the tests, every deviation, the gates above, the unfinished live work and known problems. The phase-closing commit carries the trailer `Yakka-Phase: 21-feedback-delivery:4`, and also `Workflow-Phase: 21-feedback-delivery:4`, which the run's invoker asked for by name. Both appear on that commit only.
