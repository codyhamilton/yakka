# Report — Phase 5 Codex calls feedback

## Done against the brief

- **Declaration (Outcome 1).** `artifact_feedback` declares `cwd` (optional), `project_dir` (optional, `Required: false`), then `resolved_path` with `bases: ["project_dir"]`, then `file`, `git`, `queue`, `drain`. The `resolved_path` base is no longer `cwd`. `packages/yakka/internal/serve/mcp_stateless.go`.
- **Relative path with no project directory (Outcome 2).** The handler returns a tool error through `feedbackRelativeError(path, local)` in `packages/yakka/internal/serve/mcp_feedback.go`. It says the path is relative, says no project directory was supplied (or that it could not be read, with the reader's code), names the shim's working directory only when `cwd` was injected and says it is not the project, and asks for the absolute path. Nothing resolves under the plugin directory. Absolute paths are unchanged.
- **Instruction sentence (Outcome 3).** One constant, `feedbackMCPInstruction`, is the tool's `Instruction` and the final sentence of its `Description`. `initialize` `instructions` is now `You are connected to yakka. <statelessMCPInstruction> <feedbackMCPInstruction>`.
- **Path description (Outcome 4).** The `path` property reads "absolute, or relative to the project directory the harness supplies". The golden corpus `testdata/mcp-golden/artifact-feedback.json` matches the new description, schema, and base, and gained two relative-path cases.
- **Shim test (Outcome 5).** `test_relative_path_resolves_only_under_project_dir` in `plugins/yakka/client/test_mcp_shim.py`. With the three harness variables removed, `project_dir` is `{path: null}` and `resolved_path` is `{path: null, base: null}`. With `CODEX_PROJECT_DIR` set, the relative path resolves under it and never under the reported `cwd`.
- **Plugin config (Outcome 6).** `plugins/yakka/.codex-mcp.json` is unchanged; `"cwd": "."` stays and is recorded as launch-only.
- **Stale docs (Outcome 7).** `CHANGELOG.md` Codex step 2 now reads `python3 ./client/yakka.py mcp`. `packages/hooklog/codex-mcp.example.toml` is removed (`git rm`). The Codex paragraph of `packages/hooklog/README.md` now points at `plugins/yakka/.codex-mcp.json`. The example file had no other references outside historical plan docs.

## Tests and checks

All run in this worktree at the phase's build state. No live service, model session, or egress call was made.

```
cd packages/yakka && gofmt -l internal/serve        # no output
cd packages/yakka && go vet ./internal/serve/       # no output
cd packages/yakka && go test ./internal/serve/ -count=1 -run 'MCP|Feedback|Stateless|Conformance'   # ok
cd packages/yakka && go test ./internal/serve/ -count=1   # ok 10.358s
cd packages/yakka && go test ./... -count=1               # every package ok (cmd/yakka 61.137s)
cd plugins/yakka/client && python3 -m unittest test_mcp_shim test_mcp test_mcp_guard   # Ran 25 tests, OK
git diff --check                                          # no output
```

- `TestMCPArtifactFeedbackRelativePathNeedsProjectDir` (new, `mcp_feedback_test.go`): four cases through the real handler. No project directory with `cwd` named; no project directory with `cwd` not injected (the phrase "shim ran in" must be absent); absent project directory with `cwd` named; unreadable project directory (`io_error`) with `cwd` named. Each is an error with the expected frame.
- `TestMCPArtifactFeedbackCorpus` (updated): reader order, the `project_dir` base, the optional flags, the exact `initialize` instruction, the golden tool description and schema, and the golden calls including the two new relative cases with exact text.
- `test_relative_path_resolves_only_under_project_dir` (new, `test_mcp_shim.py`): see Outcome 5 above.

`tools/release/test_layout.py::test_repo_passes_layout_check` was not run, per the brief.

## Deviations

- The brief said "keep `fmt` and `strings` imports as needed". `mcp_feedback.go` needed no new imports, since the helper uses only string concatenation and `mcpToolError`.
- The brief's Outcome 2 wording and the golden text are my wording within the brief's constraints. The brief did not fix exact text; the golden corpus and the new test pin it.
- The no-`cwd` case is covered by the new Go test rather than by the golden corpus; the corpus carries the `cwd`-injected form only.

## Unfinished

- **Open question 1 is unanswered.** Whether Codex or Claude sets `CODEX_PROJECT_DIR` or `CLAUDE_PROJECT_DIR` for the stdio MCP child is a live check. Static evidence only: the Codex 0.163.0 binary has no `CODEX_PROJECT_DIR` string; the Claude 2.1.316 binary has `CLAUDE_PROJECT_DIR`. Until the live check is run, a relative `artifact_feedback` call on Codex returns the named error, and on Claude it depends on the variable reaching the child. Gated; see the phase record.
- **Live Codex relative-path call.** A fresh `codex exec` session in a scratch repo, prompted to write a design and call `artifact_feedback`, has not run (egress and a model session). Gated.
- **Server deployment.** The declaration change reaches users only when the server is deployed (ledger 28). Gated.
- **Design doc 08 is stale.** `docs/design/08-server-mcp-contract.md:165-168` and `:491` still describe `bases:["cwd"]` as today's behaviour and `project_dir` as unanswered. The brief says not to edit design docs, so this is left for a later design pass.
- **`artifact_feedback` checks on this brief and this report** need egress, so they are not run here. Gated.

## Known problems

- **Possible regression on Claude relative paths.** Before this phase, a relative `path` resolved against the shim's inherited working directory. Now it resolves only against `project_dir`, which reads `CLAUDE_PROJECT_DIR`, `CODEX_PROJECT_DIR` or `CURSOR_PROJECT_DIR`. If Claude Code does not set the variable for the MCP child, relative calls on Claude now error where they used to resolve. This is the intended change under Assumption 4 for Codex, but it is unverified for Claude. Absolute paths are unaffected, and the instruction sentence tells callers to send absolute paths.
- **The instruction says "absolute path", while the `path` property accepts relative ones.** This is deliberate: the instruction gives the safe form, and the property describes what the server accepts.
