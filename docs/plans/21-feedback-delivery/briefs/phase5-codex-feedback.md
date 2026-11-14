# Phase 5 brief — Codex calls feedback

## Context

Plan 21 Phase 5, `Codex calls feedback`, in `docs/plans/21-feedback-delivery/DESIGN.md`. Work in `/home/codyh/workspace/yakka-build/21` on branch `feat/21-feedback-delivery`. The phase is single-unit, so this brief is authored inline and committed before the build. Its dependencies are Phase 1 (closed), Phase 4 (closed) and Plan 24's shim with its readers, which is already on this branch (`plugins/yakka/client/yakka.py`, `_mcp_readers`; `packages/yakka/internal/serve/mcp_stateless.go`).

The tool lives on the server: `packages/yakka/internal/serve/mcp_stateless.go` (`RegisterFeedbackMCPTool`) and `packages/yakka/internal/serve/mcp_feedback.go` (`mcpArtifactFeedback`). The Go client copy in `packages/yakka/internal/mcp/` is legacy and is left untouched.

Open question 1 (does the harness expose the project directory to the stdio shim?) is not answered by this brief. The design's default (Assumption 4) applies: the resolution base becomes `project_dir`, so a relative path with no project directory is an error that names `cwd`, and nothing resolves under the plugin directory. Static evidence gathered by the orchestrator: the Codex CLI binary (0.163.0) contains no `CODEX_PROJECT_DIR` string, while the shim's `project_dir` reader reads `CLAUDE_PROJECT_DIR`, `CODEX_PROJECT_DIR` or `CURSOR_PROJECT_DIR`. The Claude binary does contain `CLAUDE_PROJECT_DIR`. Whether either harness sets that variable for an MCP child process is a live check and is a gate.

## Outcome

1. **Declaration.** `artifact_feedback` declares, in order, `cwd` (optional), `project_dir` (optional, `{path}` or `{path: null}`), `resolved_path` with `bases: ["project_dir"]`, then `file`, `git`, `queue`, `drain` as today. `project_dir` is declared with `Required: false`. The `resolved_path` base is no longer `cwd`.
2. **Relative path with no project directory.** When `resolved_path.path` is null for a relative argument, the handler returns a tool error (not a state) that says the path is relative, says no project directory was supplied (or could not be read, when the `project_dir` reader failed), names the working directory the shim ran in when `cwd` is injected (and says it is not the project), and asks for the absolute path. It never resolves the path under the plugin directory. The existing absolute-path behaviour is unchanged.
3. **Instruction sentence, defined once.** A single Go constant `feedbackMCPInstruction` holds the sentence "After writing or changing a design, brief or report, call artifact_feedback with the file's absolute path, then fix a flagged check or record the pass." It is the `artifact_feedback` tool's `Instruction` (so `initialize` `instructions` becomes the base sentence followed by this one) and the final sentence of the tool's `Description`. The shim relays it unchanged; no client copy exists.
4. **Path description.** The `path` property description says the path is absolute, or relative to the project directory the harness supplies. The golden corpus `artifact-feedback.json` is updated to the new description, input schema, `project_dir` base, and the relative-path case.
5. **Shim test.** A Python test shows that with a project directory in the environment a relative path resolves under it, and with none in the environment (the three harness variables removed for the test) `resolved_path.path` is null and `project_dir` is `{path: null}`. A relative path never resolves under the `cwd` the shim reports.
6. **Plugin config.** `plugins/yakka/.codex-mcp.json` keeps `"cwd": "."`. The launch uses `./client/yakka.py`, which is relative to that cwd, and resolution no longer reads `cwd`. Recorded, not changed.
7. **Stale docs.** `CHANGELOG.md` Codex install step names the launch the file actually runs (`python3 ./client/yakka.py mcp`, not `./bin/yakka mcp`). `packages/hooklog/codex-mcp.example.toml` is a manual `[mcp_servers.yakka]` route that conflicts with the plugin route, so it is removed, and the Codex paragraph of `packages/hooklog/README.md` says the plugin's `.codex-mcp.json` is the route.

## Work

- `mcp_stateless.go`: add the constant; add `project_dir` reader; change `resolved_path` bases; set `Instruction` and the description sentence; update the path property description.
- `mcp_feedback.go`: replace the `cannot resolve the working directory` branch with a helper `feedbackRelativeError(arg, local)` that follows Outcome 2. Keep `fmt` and `strings` imports as needed.
- `mcp_feedback_test.go`: update the reader order and base assertions (`project_dir` at index 1, `resolved_path` at index 2, bases `["project_dir"]`); update the exact `initialize` instruction to include the new sentence; add a test that a relative path with `project_dir` null gets the named error and that `cwd` is named only when injected.
- `testdata/mcp-golden/artifact-feedback.json`: update the description, the `path` property description, and the path call's `local` (`project_dir`, `resolved_path.base`).
- `plugins/yakka/client/test_mcp_shim.py`: add the Outcome 5 test.
- `CHANGELOG.md` (Codex install step), `packages/hooklog/codex-mcp.example.toml` (remove), `packages/hooklog/README.md` (Codex paragraph).
- Leave `plugins/yakka/.codex-mcp.json`, `yakka.py` reader code and `internal/mcp` untouched.

## Verification

- `cd packages/yakka && go test ./internal/serve/ -count=1`, `go vet ./internal/serve/`, `gofmt -l internal/serve`.
- `cd plugins/yakka/client && python3 -m unittest test_mcp_shim test_mcp test_mcp_guard`.
- Record any failure that predates this change, with its output, and do not chase it.

## Boundaries

- Do not push, merge, change branches, touch master, Plans 22/23/24 or `/home/codyh/workspace/yakka-wt/`.
- Do not run fly or wrangler, touch secrets, production configuration, Cloudflare or Fly settings.
- Do not call the live remote, `artifact_feedback` on a live service, `codex exec` or any Claude or Codex model session, or any classification or egress call. Build and test against fakes and static reads only.
- Do not implement local effects, `enqueue_file_snapshot`, queue writes, or change the queue. The queue stays pointer-only and the drain is unchanged.
- Do not change `yakka.py`'s readers, `internal/mcp`, `internal/serve/admin.go`, or any design doc.
- Do not run the unrelated layout test (`tools/release/test_layout.py::test_repo_passes_layout_check`); it is documented as pre-existing (Plan 19 Phase 4).

## Evidence

- Test output for `internal/serve` (the feedback, stateless and conformance tests) and the Python shim test run.
- `go vet` and `gofmt` results.
- `git diff --stat` for the phase commit.

## Gates (live, Cody)

- A fresh `codex exec` session in a scratch repo with the Yakka plugin, prompted to write a design, producing an `mcp__yakka__artifact_feedback` call whose path resolves to the file (egress and a model session; design Phase 5 outcome).
- Whether Codex or Claude sets `CODEX_PROJECT_DIR` or `CLAUDE_PROJECT_DIR` for the MCP child (open question 1): a live check in each harness, with the relative-path result recorded.
- Deploying the server declaration change to the live service (ledger 28).
- `artifact_feedback` checks on this brief and the phase report (egress).

## Reporting

Write `docs/plans/21-feedback-delivery/reports/phase5-codex-feedback.md` before the phase-closing commit, using the `execution-report` rubric. The phase-closing commit carries `Yakka-Phase: 21-feedback-delivery:5` and `Workflow-Phase: 21-feedback-delivery:5`, as Phase 4 did. Both appear on that commit only.
