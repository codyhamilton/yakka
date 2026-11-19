# Feedback delivery

This plan made `artifact_feedback` tell an agent the truth about a written design, brief or report: whether the service holds the file's current version, whether it was screened, and whether it was scored. It closed the traced causes of a permanent `stale` or `delivered`-without-verdict answer, removed the silent local fallback, retired the legacy MCP launcher, uploaded the stranded legacy backlog's hook events from a staged copy, and made both Claude and Codex call feedback. The code outcomes were built and proved against fakes, temp repos and a local server; the deployed-service checks remain operator gates (listed under Residual Risks and Follow-ups).

## Intent

User request, verbatim:

> Work only inside /home/codyh/workspace/yakka-wt/21-feedback-delivery (branch docs/21-feedback-delivery, off origin/master). Do not read, edit or run git in any other checkout or worktree. Do not commit, push or open a PR.
>
> Task: design a fix for GitHub issue #174 (read it with `gh issue view 174 -R codyhamilton/yakka --json title,body`). Plan number 21: docs/plans/21-feedback-delivery/.
> Cover expected items 1-3 (artifact_feedback returns `delivered` with verdict and scores once the batch window closes; a file's final write reaches the remote and never stays `stale`; Codex sessions load the Yakka MCP and call feedback like Claude), plus making sure no config, code path or fallback defaults to 127.0.0.1:8770. Find the root cause of each from the code and live evidence before designing.
>
> Decided by Cody (2 Nov 1:55 PM AEST), design these in, each as its own phase or step:
> - Stop the legacy `workflow-linux-amd64 mcp` process (pid 7649) and retire whatever launches it.
> - Upload the 37,931-event backlog in ~/.local/share/workflow/queue to the remote exactly once. Order it after the fix for dropped final writes. It must be idempotent (safe to run twice) and be verified by an accepted count.
> - When the client has auth and is configured for the remote, it must never fall back to local (127.0.0.1:8770). It fails with a clear message saying what failed and how to fix it. Local fallback only applies to an explicitly local setup. Make this a testable phase outcome.
> The build does the stop and the upload. You must not: do not kill pid 7649 and do not upload, move or delete anything in ~/.local/share/workflow/queue during this run. Do not change production config, secrets, Cloudflare or Fly settings.
>
> Follow the Yakka design skill (yakka:design, ~/.claude/plugins/cache/yakka/yakka/3.4.0/skills/design/SKILL.md), headless: no human sign-off step; record open questions and defaults chosen in an assumption ledger.

The issue's expected items 4 and 5 were the "nothing points at 127.0.0.1:8770" and the backlog decisions above. A 7 Nov 2026 bounded approval ("Allow the bounded queue action") added Plan 24's versioned `enqueue_file_snapshot` action, so the pre-Stop shell-written file could be queued without a direct upload.

## Why This Existed

Issue #174: agents never received a `delivered` answer they could act on. The design traced seven causes, none of them a single bug:

- A final write made by a shell heredoc named no path the hook could attribute, and nothing swept it, so the remote kept an older hash and feedback stayed `stale`.
- A secret-scan rejection was silent unless the queue entry was matched.
- `delivered` did not say whether scoring ran, and the scorer state was not surfaced.
- Codex loaded the MCP but was never told to call feedback, and relative paths resolved under the plugin cache.
- A missing client config silently became loopback `127.0.0.1:8770`; tests encoded that default.
- A legacy `workflow-linux-amd64` MCP and its launcher were still running, and 37,931 events sat in an unread legacy queue.
- Tool logic lived in the local client; Plan 24 moved it to the server's MCP registry, which this plan builds against.

## What Was Built

**Changed:** `plugins/yakka/client/yakka.py` (config resolution, drain snapshot and backlog modes, backlog command), its tests, `packages/yakka/internal/serve/mcp_feedback.go`, `mcp_stateless.go` and their tests and golden corpus, `plugins/yakka/skills/design/SKILL.md`, the plugin hook usage, and design docs 01, 02, 04 and 05. Plan 24's registry and shim code was not changed.

### Phase 1 — Remote-or-fail client configuration

`Load()` now returns a remote, an explicit loopback local mode, or an error naming what is missing and the fix. Absent config is "yakka is not logged in", not local mode; partial env is an error; `mode = "local"` conflicts with a key or endpoint. `yakka status` prints the config error and exits non-zero. The drain treats a bad config as a startup error and leaves the queue untouched (issue #187). The repository no longer has a local default outside the Local constant and the serve bind default.

### Phase 2 — Retire the legacy MCP and its launcher

The codex-usage probe was restarted, no `workflow-linux-amd64` process remained after 60 seconds, `codex mcp list` showed only `yakka`, and the probe kept producing usage readings. The old plugin cache and binary were archived under `~/.local/share/yakka/retired/plan21-legacy-mcp/`. The legacy queue's file count was unchanged.

### Phase 3 — Every written file reaches the remote

The server's `artifact_feedback` declares version 2 with the one bounded `enqueue_file_snapshot` action and the queue v2 reader, and decides states in design order: facts and complete queue coverage first, then service hash, rejection before pending, delivered, the 300 s bound, then the single directive and its refreshed continuation. The drain accepts `artifact_snapshot` pointer entries, reads the file at batch time, emits one `artifact_version` with the file's mtime and no `hook_event`, and rejects an entry it cannot turn into a version with a named reason. Fresh Stop and SessionEnd events sweep modified/untracked scored-kind files into the same pointer form. The drain's `_write_paths` recognises both the sweep entry and Plan 24's spool pointer.

### Phase 4 — Delivered means screened and scored

A delivered answer now carries a `scoring:` line decided server-side from the scorer and checks state: `off` when either is missing, `pending` while the version is under 30 seconds old and unscreened, otherwise `on`. When scoring is configured and the screen is unrecorded, the call waits up to 10 seconds before answering.

### Phase 5 — Codex calls feedback

`artifact_feedback` resolves a relative path against the harness-supplied project directory, not the shim's working directory, and returns a named error asking for an absolute path when no project directory is available. The instruction sentence lives once on the server's MCP surface and is joined into `initialize`; the Codex launch docs point at the plugin's `.codex-mcp.json`, and the conflicting manual TOML example was removed.

### Phase 6 — Upload the legacy backlog once

A one-time `yakka backlog stage|manifest|upload` command stages a copy of the legacy queue without touching the original, writes a counts-only manifest, uploads hook events only through the ordinary drain with a counts-only report, and verifies accepted plus duplicate plus rejected against the manifest. A second upload of a fresh staged copy is expected to store zero new rows. The real queue was measured read-only (37,931 files, 167,853,844 bytes, 18,306 policy-dropped, 19,625 expected stored) and left in place; the live upload was not run.

### Phase 7 — Agents act on feedback

The design skill's feedback step now names `not tracked`, `not delivered` and `stale`, and says a `queued` answer means call once more after a few seconds. A local `yakka serve` built from this branch, with a fresh Claude session and a fresh Codex session, produced `queued` then `delivered` with `screen:` and `scoring:` lines for each design, and each final message stated the pass and quoted the scores.

## Deviations

- Phase 4 keeps its scoring tests in a new file, and `on` is reported for a version still unscreened after 30 seconds; the brief allowed it and issue #201 records the concern. `handleAdminRescore` still gates on the scorer alone while `scoring()` needs checks (issue #200).
- Phase 5 did not update the MCP contract doc, which still describes the tool as effect-free with `bases:["cwd"]` (issue #277). The live harness project-directory check was not run (issue #203).
- Plan 24's built shim spools its pointer as a `PostToolUse` write entry rather than an `artifact_snapshot` entry; the drain accepts both. Plan 24's v1 shims do not see the v2 tool at all (issue #268), where the design wanted a v1 read-only variant.
- The drain records swept Stop/SessionEnd event names so a retry does not sweep twice; files missed in that window are recovered by a later turn or commit catch-up. The 300 s boundary displays 301 s for ages between 300 and 300.5.
- Phase 6 keeps a strict exit-0 verification rather than the design's "the report explains the difference" escape for a genuine server rejection of a distinct kept fact; the report still itemises the difference and exits 2.
- Phase 7's early closure trailer on `f9d4d42f` was left in history (rewriting is prohibited); the later local-server proof is the closure record. The live `api.yakka.build` check was not run.

## Review

The terminal review against all seven phase outcomes returned PASS: no critical or high finding. It filed one new low finding, the stale MCP contract doc (issue #277), and confirmed the carried medium/low findings already tracked as #200, #201, #202, #203, #272 and #273. The pre-existing Plan 24 gaps are tracked by #268. The earlier review touch-ups fixed the drain's bad-config handling, the stale edge-capture wording and the Phase 2 report trailer (#187, #188, #189).

## QA

- Python: `python3 -m unittest test_clientconfig test_status test_facts test_drain test_http test_mcp test_mcp_guard test_mcp_shim test_secrets test_backlog` — 154 tests, OK. `py_compile` and `git diff --check` clean.
- Go: `go test ./internal/serve/ -run 'TestMCPArtifactFeedback|TestMCPLocalAction|TestFeedbackScoring' -count=1` — ok; `go test ./internal/serve/ -count=1` — ok; `go vet ./internal/serve/` and gofmt on the owned files clean. A full `go test ./...` run showed two timing-sensitive failures under parallel load (`TestAnalyticsOutcome/summary` and `TestMigrationFast100k`); both packages are untouched by this plan and both tests pass in isolation.
- No live service, deploy, production data or credentials were used. All Plan 21 evidence is fakes, temp repos, and one local `yakka serve` on `127.0.0.1:8770`.
- The pre-existing `tools/release/test_layout.py::test_repo_passes_layout_check` failure on ignored `packages/yakka-analytics/node_modules/**` is unrelated and was not chased.

## Residual Risks

- The deployed `api.yakka.build` behaviour is unproven: the `scoring:` line, relative-path resolution, the delivery transcripts and the backlog upload all need the branch merged and deployed.
- `LoadMCP()` ignores `YAKKA_MODE=local`, so a session that sets only that variable drains locally while the shim still targets the configured remote. This is an open product gap, not fixed here.
- Removing the silent local fallback is intentional breakage for local users without `client.toml`; they must add `mode = "local"` (the error text says so).
- A relative harness project-directory variable can still resolve a relative feedback path under the plugin directory (issue #202), and Claude relative paths depend on `CLAUDE_PROJECT_DIR` reaching the child (issue #203).
- Phase 6's upload is destructive to its staged copy by design; only a fresh stage permits a rerun, and the original queue must not be archived or deleted without a separate Cody decision.

## Follow-ups

- #200 — rescore allowed when `scoring:` reads off, so stored scores can sit beside a `scoring: off` line.
- #201 — `scoring: on` reported for a version still unscreened after 30 seconds.
- #202 — the shim accepts a relative `*_PROJECT_DIR` and can resolve a feedback path under the plugin directory.
- #203 — Claude relative paths fail unless `CLAUDE_PROJECT_DIR` reaches the MCP child; needs the live harness check.
- #268 — Plan 24's registry hides v2 tools from v1 shims instead of serving the v1 read-only variant.
- #272 — the shim's enqueue hardcodes `--harness codex` for Claude and Cursor calls.
- #273 — the Phase 7 brief's budget handoff contradicts its owned-path list.
- #277 — design 08 still describes `artifact_feedback` with `bases:["cwd"]` and no local action.
- Operator gates, not issues: deploy and re-run the live delivery/scoring checks; turn scoring on and rescore stored content; the live backlog upload plus an independent server-side stored-row count and a second zero-new-row run; the budget-repo feedback case.

## Decisions Worth Keeping

- No config is an error, not local mode. Explicit `mode = "local"` keeps the local workflow; nothing falls back to `127.0.0.1:8770`.
- Recovery reconciles content through the queue rather than guessing shell commands or posting directly; the feedback tool remains read-only on the service, and the one queue effect is separately versioned and path-bound.
- The Stop/SessionEnd sweep is bounded to files git reports modified or untracked, with no local last-sent store; the service dedupes and the fact carries the file's mtime.
- The legacy backlog is uploaded from a staged copy, hook events only, never drained in place; the original is untouched.
- Tool definitions, state order and wording live on the server; the local client only relays and supplies declared read-only context.
