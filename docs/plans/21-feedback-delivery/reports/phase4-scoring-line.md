# Report — Phase 4 scoring line on delivered feedback

## Done against the brief

- **Scoring line.** A delivered answer from `artifact_feedback` now carries a `scoring:` line after the `screen:` line. Its value comes from the server's own state: `off` when no scorer or no checks are loaded (the line says scoring is not configured and that an admin rescore scores stored content), `pending` when the scorer and checks are loaded, no screen is recorded, and the version arrived under 30 s ago (the line says to call again), and `on` otherwise.
- **Bounded screen wait.** When scoring is configured and no screen is recorded yet, the call polls the store every 100 ms for up to `feedbackScreenWait` (10 s). It stops early when the screen is recorded or the latest hash for the path changes. With scoring off there is no wait.
- **Pure decision.** The value is decided by `feedbackScoring(configured, screened, received, now)`, which is unit-tested with times.
- **Unchanged.** Argument errors, `stale`, `queued`, `rejected`, `not tracked`, `not delivered`, the score and baseline lines, and the golden corpus are untouched. The queue stays pointer-only and the drain path is unchanged. No local effect and no `enqueue_file_snapshot` behaviour was added.

## Tests

All tests use fakes: the in-process MCP handler, `DisableWorker: true`, and `Promote` from the test as the screen worker. No live service was called.

- `TestFeedbackScoringValue`: the value function across off, pending under the window, on once screened, on after the window, and on at the window edge.
- `TestMCPArtifactFeedbackScoringOffWithoutScorer`: checks loaded and no scorer gives `scoring: off` with its reason.
- `TestMCPArtifactFeedbackScoringOnWaitsForScreen`: a goroutine records a pass screen and a score after 200 ms. The call returns in under `feedbackScreenWait` with `screen: pass by jev-1`, `scoring: on` and a score line.
- `TestMCPArtifactFeedbackScoringPendingAfterScreenWait`: no screen is ever recorded and `feedbackScreenWait` is shortened to 300 ms. The call returns `scoring: pending` with the call-again wording.

Results (run in `packages/yakka`):

```
go test ./internal/serve/ -run 'FeedbackScoring|MCPArtifactFeedbackScoring' -count=1 -v
--- PASS: TestFeedbackScoringValue
--- PASS: TestMCPArtifactFeedbackScoringOffWithoutScorer
--- PASS: TestMCPArtifactFeedbackScoringOnWaitsForScreen (0.31s)
--- PASS: TestMCPArtifactFeedbackScoringPendingAfterScreenWait (0.31s)
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve

go test ./internal/serve/ -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  10.321s

go vet ./internal/serve/   (no output)
gofmt -l internal/serve/   (no output)
```

The existing `MCPArtifactFeedback` and `MCPStateless` tests are part of the whole-package run above and pass.

## Deviations

- The new tests are in a new file, `internal/serve/mcp_feedback_scoring_test.go`, rather than in `mcp_feedback_test.go`. The brief left the placement open.
- The `scoring: off` test covers a server with checks loaded and no scorer. The server with neither is decided by the same function and is not tested separately.

## Unfinished

- Live closure is not done. Reading the `scoring:` line from the deployed service, turning scoring on there, the admin rescore of the budget file, and a live agent session showing `delivered` with the line are all gated for Cody (see the result file).
- `artifact_feedback` was not called on this phase's brief or this report. That call is egress and is gated.

## Known problems

- **`on` does not mean a screen ran.** With scoring configured, a version whose screen is still unrecorded after 30 s reads `scoring: on` next to `screen: awaiting screen`. This follows the brief's rule, but a reader can take `on` as "screened". Changing it needs a new state, which the brief did not name.
- **Rescore gate and scoring disagree.** `handleAdminRescore` in `internal/serve/admin.go` allows a rescore when a scorer is present, but `scoring()` also needs checks. A server with a key and no `YAKKA_CHECKS_DIR` (`main.go` logs "scoring is off ... screening only") can therefore rescore while every delivered answer reads `scoring: off`. `admin.go` was out of scope for this phase and is unchanged.
- The pre-existing failure of `tools/release/test_layout.py::test_repo_passes_layout_check`, on ignored `packages/yakka-analytics/node_modules/**`, is documented by Plan 19 Phase 4. It was not run or investigated here.
