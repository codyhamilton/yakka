# Implementation — feedback delivery

Tool: Codex
Run: `/home/codyh/workspace/yakka-build/21`, branch `feat/21-feedback-delivery`
Started: 2026-11-07T19:15:00+10:00

## Phase 1 — Remote-or-fail client configuration

### Brief `phase1-client-config.md`

Status: closed.

- Built remote-or-fail resolution in `plugins/yakka/client/yakka.py`: complete env credentials
  select remote, partial env and conflicting local mode fail, `YAKKA_MODE=local` and
  `mode = "local"` select keyless loopback, partial/invalid files fail, and absent config gives
  login/local setup instructions. `yakka status` now returns an error for invalid config and an
  unreachable configured endpoint.
- Updated the config and status conformance tests and config documentation in design docs 02 and 05.
- No departure from the brief. No local effect, enqueue behavior, MCP logic, Go code, production
  config or secret was changed.
- Inline execution (single unit; no worker dispatched).
- Evidence: `python3 -m unittest test_clientconfig test_status` from
  `plugins/yakka/client` — 17 tests passed; `git diff --check` passed. The test uses fake HTTP
  listeners and patched request behavior; no live endpoint was called.
- Verification: the phase's config outcomes are observable through `Load`, `ConfigSink` and
  `run_status`; incomplete and absent config stop before a request, unreachable remote uses only
  its configured endpoint, and explicit local mode posts an accepted fact to a fake loopback
  listener without Authorization.
- `artifact_feedback` was not called because that runner check would make an egress call. See the
  Cody gate in the result file.

### Carried

- The unrelated `tools/release/test_layout.py::test_repo_passes_layout_check` failure on ignored
  `packages/yakka-analytics/node_modules/**` is pre-existing (Plan 19 Phase 4 records it); it was
  not run or investigated in this phase.
- `packages/hooklog/README.md` still describes the old no-config loopback default. That file is
  outside Phase 1's named documentation surfaces; place any correction in a later scoped change.

## Phase 2 — Retire the legacy MCP and its launcher

### Brief `phase2-retire-legacy-mcp.md`

Status: closed.

- The preflight found no running `workflow-linux-amd64` process. The user-level
  `codex-usage-probe.service` was the active root launcher; its tmux command runs the Codex probe,
  whose MCP list already contained only enabled `yakka`.
- Restarted `codex-usage-probe.service` at 2026-11-07 21:00:45 AEST. After more than 60 seconds,
  the process search still found no `workflow-linux-amd64` process and no process launched from
  the retired paths. `env -u CODEX_HOME codex mcp list` continued to list only `yakka` as enabled.
- Archived the old plugin cache and binary at
  `/home/codyh/.local/share/yakka/retired/plan21-legacy-mcp/workflow-plugin/` and
  `/home/codyh/.local/share/yakka/retired/plan21-legacy-mcp/workflow-0.1.0/`. The probe unit
  remains enabled and active because it now launches the Yakka-only Codex probe.
- The Codex probe remained running after restart. Its screen displayed current usage readings
  (`5h 64% left · weekly 94% left`) both shortly after restart and after the 60-second check.
- The workflow queue contained 37,950 `*.evt` files before and after. No files under the queue
  were changed. The key-bearing backup and unrelated workflow units were left untouched.
- No departure from the brief. No application tests apply to this operational phase. Inline
  execution (single unit; no worker dispatched).
- `artifact_feedback` was not called for the brief or report because it would make a prohibited
  egress call; this gate is recorded in the result file.

### Verification

The design's process, MCP, usage-reading, archive and queue-count outcomes were observed after the
restart; the process and MCP checks were repeated more than 60 seconds afterward.
`codex-usage-probe.service` reports `ActiveState=active`, `SubState=exited` (its configured
oneshot state), with a new invocation ID. No remote service call was made.

### Carried

- `packages/hooklog/README.md` still describes the previous no-config local default; it remains
  outside the phase surfaces already closed.
- The unrelated `tools/release/test_layout.py::test_repo_passes_layout_check` failure on ignored
  `packages/yakka-analytics/node_modules/**` is documented by Plan 19 Phase 4; it was not run or
  chased.
- `artifact_feedback` feedback checks for the Phase 2 brief and report remain for Cody because
  they require egress.

## Phase 4 — Delivered means screened and scored

Run (phase 4): tool Claude Code, model claude-haiku-5-5, session `4a06dd49-fc90-4b9d-9b9c-70efe21d24ab`, started 2026-11-08T01:44:36+10:00. Run for Plan 21 phase 4 only; no review, terminal review or close-out.

Approach: the design marks this phase `open` because its live closure depends on the live scorer state. Read as the invoker's instruction to refine it: the code outcome is settled against the code in `briefs/phase4-scoring-line.md`, built and tested against fakes, and the live closure is recorded as gated.

Single unit, so the brief is authored inline (`briefs/phase4-scoring-line.md`) and committed before the build. No worker is dispatched; the build is inline because the change is one server file, its tests, and the report.

### Brief `phase4-scoring-line.md`

Status: closed.

- Built the `scoring:` line on `state: delivered` in `packages/yakka/internal/serve/mcp_feedback.go`.
  The value is decided server-side by `feedbackScoring` from the server's `scoring()` state: `off`
  when no scorer or no checks are loaded, `pending` while the screen is unrecorded and the version
  is under 30 s old, otherwise `on`. When scoring is configured and unscreened, the call waits up
  to `feedbackScreenWait` (10 s) for the screen, polling every 100 ms.
- Surfaces touched: `artifact_feedback` delivered branch (`mcpArtifactFeedback`, `feedbackDelivered`)
  and its two call sites; new helpers `feedbackScoring`, `feedbackScreened`, `scoringConfigured`
  and `awaitScreen`. Tests are in the new file `internal/serve/mcp_feedback_scoring_test.go`.
- Deviations: the tests are in a new file rather than `mcp_feedback_test.go`; the server with
  neither scorer nor checks is decided by the same function and not tested on its own. No other
  departure from the brief.
- Inline execution (single unit; no worker dispatched). Per agent: none dispatched.
- Evidence: `go test ./internal/serve/ -count=1` ok (10.321 s); the four new tests pass; `go vet
  ./internal/serve/` and `gofmt -l` are clean. All tests use fakes (`DisableWorker: true`, `Promote`
  from the test as the screen worker); no live call was made.
- The report is `reports/phase4-scoring-line.md`.

### Verification

The outcome's entry point is the in-process MCP `artifact_feedback` handler; the action is an
ingest plus a call with a fake screen worker, and the result is the `scoring:` line for each of
off, on after a screen recorded 200 ms later, and pending when no screen arrives inside the
shortened wait. This is observed through the real handler, not through the report. It was run
inline and not by a separate cheap-tier agent. The live closure is gated and was not run.

### Carried

- `on` does not mean a screen ran. With scoring configured, a version still unscreened after 30 s
  reads `scoring: on` next to `screen: awaiting screen`. The brief's rule gives this; a new state
  would need a brief amendment.
- `handleAdminRescore` in `internal/serve/admin.go` gates on the scorer alone, while `scoring()`
  also needs checks. A server with a key and no `YAKKA_CHECKS_DIR` can rescore while delivered
  answers read `scoring: off`. `admin.go` was outside this phase and is unchanged.
- Phases 1 and 2 close with `Workflow-Phase` trailers only, the legacy form. This phase's closing
  commit carries both `Yakka-Phase: 21-feedback-delivery:4` and `Workflow-Phase: 21-feedback-delivery:4`.
- The unrelated `tools/release/test_layout.py::test_repo_passes_layout_check` failure on ignored
  `packages/yakka-analytics/node_modules/**` is documented by Plan 19 Phase 4; it was not run or
  chased.
- Gates for Cody (egress or production): the live `scoring:` line on the deployed service; turning
  scoring on (scorer key and `YAKKA_CHECKS_DIR`, ledger 28); the admin rescore of the budget file
  (admin browser session, ledger 21); a live agent session showing `delivered` with the line.

## Phase 5 — Codex calls feedback

Run (phase 5): tool Claude Code, model claude-haiku-5-5, session `d8c704b9-3979-404e-832b-9859a89ad6f1`, started 2026-11-08T01:55:28+10:00. Run for Plan 21 phase 5 only; no review, terminal review or close-out.

Approach: the design marks this phase `open`, and the invoker's brief sets it as one unit. Read as the invoker's instruction to refine it: the code outcome is settled against the code in `briefs/phase5-codex-feedback.md`, built and tested against fakes, and the live Codex call and the live harness environment check are gated.

Single unit, so the brief is authored inline (`briefs/phase5-codex-feedback.md`) and committed before the build. No worker is dispatched; the build is inline because the change is one server declaration, one handler branch, their tests, one shim test, and the docs.

### Brief `phase5-codex-feedback.md`

Status: closed.

- Declaration: `artifact_feedback` now declares `cwd`, `project_dir` (optional), then `resolved_path` with `bases: ["project_dir"]`, then `file`, `git`, `queue`, `drain`. Surface: `packages/yakka/internal/serve/mcp_stateless.go` (`RegisterFeedbackMCPTool`).
- Relative path with no project directory: the handler returns a tool error through `feedbackRelativeError` (`mcp_feedback.go`), naming the missing or unreadable project directory and, only when `cwd` was injected, the shim's working directory as not the project. Nothing resolves under the plugin directory.
- Instruction: `feedbackMCPInstruction` is the tool's `Instruction` and the last sentence of its `Description`; `initialize` joins it after the base sentence.
- Shim: `plugins/yakka/client/test_mcp_shim.py` gained `test_relative_path_resolves_only_under_project_dir` (project directory absent gives `{path: null}`; `CODEX_PROJECT_DIR` set resolves under it).
- Docs: `CHANGELOG.md` Codex step 2 names `python3 ./client/yakka.py mcp`; `packages/hooklog/codex-mcp.example.toml` removed (`git rm`); `packages/hooklog/README.md` Codex paragraph points at `plugins/yakka/.codex-mcp.json`.
- Unchanged, as briefed: `plugins/yakka/.codex-mcp.json`, the `yakka.py` reader code, `internal/mcp`, `admin.go`, and all design docs.
- Deviations: none from the brief's outcomes. The golden corpus carries the `cwd`-injected relative case and the Go test `TestMCPArtifactFeedbackRelativePathNeedsProjectDir` carries the cases without `cwd`.
- Inline execution (single unit; no worker dispatched). Per agent: none dispatched.
- Evidence: `go test ./internal/serve/ -count=1` ok (10.358 s); `go test ./... -count=1` ok for every package; `go vet ./internal/serve/`, `gofmt -l` clean; `python3 -m unittest test_mcp_shim test_mcp test_mcp_guard` ran 25 tests, OK; `git diff --check` clean. All tests use fakes and the in-process handler; no live call was made.
- The report is `reports/phase5-codex-feedback.md`.

### Verification

The outcome's entry point is the in-process MCP `artifact_feedback` handler with the real declaration. The action is a relative-path call with the project directory absent and with `cwd` injected or not, and the shim's `project_dir`/`resolved_path` readers with the harness variables removed and with `CODEX_PROJECT_DIR` set. The result is the named tool error with the expected frame in each case, and a relative path resolving under the project directory only when one is supplied. This was observed through the real handler and reader, not through the report. It was run inline and not by a separate cheap-tier agent. The live closure (a Codex session, the live harness environment check, and deployment) is gated and was not run.

### Carried

- Open question 1 is still open: whether Codex or Claude sets `CODEX_PROJECT_DIR` or `CLAUDE_PROJECT_DIR` for the stdio MCP child. Static evidence only (the Codex 0.163.0 binary has no `CODEX_PROJECT_DIR`; Claude 2.1.316 has `CLAUDE_PROJECT_DIR`). Until a live check runs, a relative call on Codex errors with the named message, and on Claude it depends on the variable reaching the child. This may be a regression on Claude relative paths, which previously resolved against the inherited working directory.
- `docs/design/08-server-mcp-contract.md:165-168` and `:491` still describe `bases:["cwd"]` as today's behaviour. The brief says not to edit design docs; a later design pass should update them.
- `packages/yakka/internal/mcp/mcp.go` (line 212-213) and `internal/mcp/feedback.go` (line 160) still carry the old description and the `cannot resolve the working directory` message. This is the legacy Go client, which the brief leaves untouched.
- The unrelated `tools/release/test_layout.py::test_repo_passes_layout_check` failure on ignored `packages/yakka-analytics/node_modules/**` is documented by Plan 19 Phase 4; it was not run or chased.
- Gates for Cody (egress, model session, or deployment): a fresh `codex exec` session in a scratch repo producing an `mcp__yakka__artifact_feedback` call whose relative path resolves; the live `CODEX_PROJECT_DIR` / `CLAUDE_PROJECT_DIR` check in each harness; deploying the declaration change to the live service (ledger 28); `artifact_feedback` checks on this brief and this report.

## Phase 3 — A write that names no file still reaches the service

Run (phase 3): tool opencode, model deepseek-v4.1-flash, started 2026-11-19T02:19:03+10:00. Logs: `/home/codyh/workspace/.briefs/q/21-p3-refine.log`, `21-p3-u1.log`, `21-p3-u2.log`, `21-p3-verify.log`. Run for Plan 21 phase 3 only; no review, terminal review or close-out.

Approach: the design marks this phase `open`. The invoker instructed a refine first. Refine commit `55b0c7f` split it into two units against the code as it stood and added the Phase 3 Units list. Plan 24 E1's server side is built at `7be8aa3`, merged into the branch at `f0cbec9`; `TestMCPLocalAction` passed at that SHA before the build. The Plan 24 addendum governs the E1 mechanism, and no Plan 24 code was changed.

### Briefs `phase3-01-server-feedback-v2.md`, `phase3-02-snapshot-sweep-drain.md`

Status: closed.

- Unit 1 (`packages/yakka/internal/serve`): `artifact_feedback` declares v2 with the one `enqueue_file_snapshot/1` action from `resolved_path`, keeps the base v1 facts and v1 scope/annotations, and declares queue reader v2. The handler answers from refreshed facts in the design order: facts/coverage, service hash, rejected before pending, `delivered`, 300 s bound, then the single directive and its continuation effects. No ingest, local write, drain start, content scan or second directive.
- Unit 2 (`plugins/yakka/client/yakka.py` and design docs 01/04): the drain accepts an `artifact_snapshot` pointer entry, reads the file at batch time, emits one `artifact_version` with `source: worktree`, `session_id` conversation, `ts` = file mtime and no `hook_event`, and rejects no-version entries with `unreadable`, `not_in_repo` or `not_scored_kind`. Fresh `Stop`/`SessionEnd` events sweep modified/untracked scored-kind files from `git status --porcelain --untracked-files=all` into the same pointer form, bounded to events at most 1 h old. `_write_paths` matches the new kind for Plan 24's queue reader.
- Workers: two `hlaunch.sh build` runs in parallel, one per brief, leaving changes uncommitted. Per agent: unit 1 opencode/deepseek-v4.1-flash; unit 2 opencode/deepseek-v4.1-flash. The orchestrator ran the combined tests, the read-only verification, and the two wording/coverage fixes below.
- Reports: `reports/phase3-01-server-feedback-v2.md` (done-with-concerns) and `reports/phase3-02-snapshot-sweep-drain.md` (done).

### Verification

The phase's entry points are the real `artifact_feedback` handler with the product declaration and the real drain `Build`/`_Runner`. An independent read-only verification run at `55b0c7f` plus the working tree found two defects, both fixed inline and covered by tests: `feedbackCoverage` now requires `coverage.complete == true`, so incomplete or missing coverage is `local context unavailable: queue (invalid_context)` rather than evidence of absence; and the 300 s branch compares the raw `oldest_covering_age_s > 300`, so 300.4 s is not `queued` (the visible age is rounded up, 301s). A new incomplete-coverage case and the 300.4 s case are in `mcp_feedback_test.go` and `mcp_feedback_local_action_test.go`.

- Go: `go test ./... -count=1` passed for every package (serve 11.4 s, cmd/yakka 61.5 s); focused feedback/local-action/scoring suite passed; `go vet ./internal/serve/` clean; every owned file gofmt-clean.
- Python: `python3 -m unittest test_facts test_drain test_mcp test_mcp_shim` ran 101 tests, OK; `py_compile yakka.py` clean.
- No live call, deployment or network request was made; all evidence is fakes and temp repos.

### Carried

- **Plan 24 v1 compatibility gap (recorded, not resolved).** Design 08 promises an old shim a v1 read-only variant with `enqueue unsupported`; Plan 24's `mcpList` instead omits a tool whose `DeclarationVersion` exceeds `Yakka-Context`, so a v1 shim sees no `artifact_feedback`. This needs a Plan 24 change.
- **Shim pointer form mismatch (recorded, not resolved).** Plan 24's built shim spools an E1 pointer as a `PostToolUse`/`Write` entry with the call token as conversation ID, while Phase 3 A1's wording says `artifact_snapshot` and `feedback-<repo_id>`. The shim was left alone per the addendum; the drain accepts both the shim's pointer and its own sweep entries.
- The 300.4 s boundary now reads 301s; ages between 300 and 300.5 therefore display one second above the raw value.
- The sweep's `_Runner.swept` guard means a retried Stop/SessionEnd event does not sweep again; files missed in that window are recovered by a later turn or commit catch-up.
- The pre-existing `tools/release/test_layout.py::test_repo_passes_layout_check` failure on ignored `packages/yakka-analytics/node_modules/**` was not run or chased. `gofmt -l internal/serve` still lists pre-existing `mcp_discovery_limits.go`, which this phase did not own.
- Gates for Cody (egress, deployment or live observation): a live scratch-repo turn showing the drain deliver a heredoc-written file's current hash; a live `artifact_feedback` `queued` then `delivered` call through the E1 enqueue after deploying the v2 declaration (ledger 28); the issue's budget-repo case; `artifact_feedback` checks on these briefs and reports.

## Phase 6 — Upload the legacy backlog once

Run (phase 6): tool opencode, model deepseek-v4.1-flash for refine and build, started
2026-11-19T03:38:29+10:00; independent verification by codex gpt-6-luna at 03:55 and 04:02.
Logs: `/home/codyh/workspace/.briefs/q/21-p6-refine.log`, `21-p6-u1.log`, `21-p6-verify.log`,
`21-p6-reverify.log`. Run for Plan 21 phase 6 only; no review, terminal review or close-out.

Approach: the design marks this phase `open`. Refine ran first against the code as it stood and
committed `804dffc2`, splitting the phase into one unit. The build worker left changes
uncommitted; the orchestrator amended the brief for the no-`/tmp` and gated-upload constraints
(`850020aa`), verified, fixed one defect and committed the phase.

### Brief `phase6-01-backlog-upload.md`

Status: closed.

- `Options` gained `EventsOnly` and `OnResult`, both default off/None. `Build(ctx, files,
  hook_events_only=False)` emits exactly one `hook_event` per parsed file in events-only mode:
  no ref-collection, no `_read_file`, no `_write_paths`, no `_build_commits`, and (after the fix
  below) no `_snapshot_fact`; the live path is unchanged when `EventsOnly` is false.
  `_Runner.batch` skips the Stop/SessionEnd sweep in that mode and `_Runner.apply` reports each
  result through `OnResult`.
- A one-time `backlog stage|manifest|upload` command was added to `yakka.py` (`bin/yakka` and the
  hooks untouched). `stage` copies only top-level non-dot `.evt` files out of a source, refuses a
  stage inside the source or a non-empty stage queue, and proves the source count/bytes did not
  move. `manifest` computes files, bytes, facts, facts by type, local rejections, distinct row
  hashes, policy-dropped and expected-stored counts. `upload` runs the existing `Run` over the
  staged queue with `EventsOnly=True` and the phase-1 `ConfigSink`, writes a counts-only
  `report.json`, and verifies first-run or rerun arithmetic.
- `_POLICY_REMOVE` mirrors `packages/yakka/internal/ingest/policy.go:27-43`; a test parses that
  table and asserts parity.
- New `plugins/yakka/client/test_backlog.py` (10 tests after the fix) uses only in-process fake
  HTTP, a workspace scratch root, and no `/tmp`.
- Report: `reports/phase6-01-backlog-upload.md`.

### Runner fix

The first independent verification (`21-p6-verify.log`) found one high defect: an
`artifact_snapshot` entry was handled by `_snapshot_fact` before the events-only branch, so
events-only mode could read the file and emit an `artifact_version`. The orchestrator fixed
`Build` to answer `not_hook_event: artifact_snapshot` with no read and no fact in that mode, and
added `test_events_only_skips_snapshot_without_reading`. Re-verification (`21-p6-reverify.log`)
reported RESOLVED with no remaining high or medium defect. The worker report's "never takes the
snapshot read path" claim was made true by this fix; its test count (9) predates the added test.

### Verification

The outcome's entry point is `python3 yakka.py backlog stage|manifest`, then the upload code with
a fake sink. Independent read-only runs reproduced:

- Real staged copy at `~/workspace/yakka-backlog-stage/plan21-recon` (outside the repo and outside
  the original): 37,931 files, 167,853,844 bytes; manifest `facts=37931`,
  `facts_by_type={"hook_event":37931}`, `policy_dropped=18306`, `expected_stored=19625`,
  `distinct_row_hashes=37931`, `duplicate_facts=0`, `rejected_dir={evt:19, reason:19}`.
- Original `~/.local/share/workflow/queue`: 37,931 top-level `.evt`, 167,853,844 bytes, max mtime
  `1793399032.5220295980`, unchanged before and after staging; no file newer than the stage.
- `python3 -m unittest test_backlog -v`: 10 tests OK. Regression suite `test_clientconfig
  test_status test_keys test_facts test_drain test_http test_mcp test_mcp_guard test_mcp_shim
  test_secrets`: 149 tests OK. `python3 -m py_compile yakka.py` and `git diff --check` clean.
- The upload path was exercised only against the in-process fake: run 1 verified with
  `stored=expected`, run 2 on a fresh stage exited 0 with `stored=0`, `zero_new_rows=true`, and
  the fake's stored set unchanged. No live endpoint or egress was used.

The live upload, the independent server-side stored-row count, and a second live run remain
unrun, as the invoker prohibits egress in this run; the phase's live acceptance is therefore
gated, not claimed.

### Carried

- Gate: the live upload of the staged copy to the configured remote (phase-1 config, tenant of the
  configured key) and the resulting `report.json` with `run_kind: "first"` and `verified: true`.
- Gate: an independent server-side count of the tenant's stored hook events before and after the
  upload, risen by the report's `stored` (19,625 for the measured queue); the tool writes
  `server_side_count: "gate"` and never queries it.
- Gate: a second live run on a fresh staged copy of the same original, exiting 0 with every
  storable fact `duplicate` and zero new rows.
- Gate: `artifact_feedback` checks on the Phase 6 brief and report (egress; not run).
- The design's "38 rejected entries" is 19 `.evt` + 19 `.reason`; none is staged or uploaded.
- A distinct server rejection of a kept fact produces `verified: false`, `run_kind: "unverified"`,
  exit 2 with an itemised difference; the brief now records this as the "report explains the
  difference" operator path rather than relaxing the rule. The test fixture exercises rejection
  reporting with a within-copy duplicate so the clean-run arithmetic stays covered.
- Archiving or deleting the original queue is not authorised and was not done; the staged copy at
  `~/workspace/yakka-backlog-stage/plan21-recon` is left for the gated upload.
- The pre-existing `tools/release/test_layout.py::test_repo_passes_layout_check` failure on
  ignored `packages/yakka-analytics/node_modules/**` was not run or chased.
