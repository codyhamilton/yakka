# Feedback delivery

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

Issue #174, "Yakka feedback never returns a delivered verdict, so agents can't act on it", is the problem statement. Its expected items 4 and 5 are the "nothing points at 127.0.0.1:8770" and the backlog decisions above.

## Problem

An agent that writes a design and calls `artifact_feedback` has never received `delivered` with a verdict and scores, so it cannot act on a flagged check or record a pass. Each cause below was traced in the code and against live evidence; none is a single bug.

1. **The final write is invisible to capture.** The client learns a file changed only from a PostToolUse event whose `tool_name` is in a fixed write-tool set (Write, Edit, MultiEdit, apply_patch and a few aliases; `_write_tools` in `plugins/yakka/client/yakka.py`). The budget session `c70d3e4f` wrote `docs/plans/01-local-finance/DESIGN.md` three times with Edit (02:03:58-02:04:00Z), then a last time with a Bash `python3 - <<'E' ... open(p,'w')` heredoc at 02:04:06Z, the 1 s gap in the issue. The remote's hash received at 02:04:05Z is the Edit-era content. The Bash call produced a hook event but no `artifact_version`, because a shell command names no path the client can attribute. Nothing else rescued it: the commit catch-up (design 01) sends the committed blob only from a captured `git commit` tool call, and the transcript has none (commit 52435db appears between sessions), and the Stop hook at 02:04:15Z carries no paths. The remote never gets the final hash and `artifact_feedback` returns `stale`, whose message ("normally a write still in the batch window") tells the agent to wait for something that never arrives. This account is from the session transcript and is consistent with the code; the budget checkout itself was not read. The drain is sound: it reads content at batch time, has no per-write debounce, rescans after releasing its lock (no lost wake-up), and the server returns the latest version by `received_at`.
2. **Secret-scan withholding is silent unless the file is matched.** The client withholds an `artifact_version` whose content hits a pattern, for worktree writes and for the commit catch-up, and moves the queue file to `queue/rejected/` with a `.reason`. The live yakka queue holds five such files (`env_assignment` at line 40 of a brief and at line 775 of `docs/plans/91-landing-centered-dial/DESIGN.md`). A long design that trips the scanner is never delivered. This is a second way a version fails to reach the remote, with the same fix surface; the scanner's patterns are not changed here (open question 3).
3. **`delivered` does not say whether the file was scored, and the scorer state is not surfaced.** The server screens in a worker and scores only when a scorer and a checks directory are configured: no `TYPESAFE_API_KEY` yields "scorer none; verdicts are unscreened", and a key without `YAKKA_CHECKS_DIR` yields "scoring is off ... screening only" (`packages/yakka/cmd/yakka/main.go`, `runServe` startup via `screenStep`). Today the local feedback handler prints `screen: unscreened (no scorer on the service)` and `screen: awaiting screen` (`plugins/yakka/client/yakka.py`, `screen:` lines at 2129-2146), but it cannot tell the agent whether "awaiting" means seconds or never, and content stored while the scorer was off stays unscreened until an admin rescore (#169). Whether the live remote has the scorer on could not be established from this checkout and cannot be changed in this run; the service knows it (`scoring()` in `packages/yakka/internal/serve/admin.go:89-92`, today exposed only through `GET /v1/admin/status`), so the build reads it first.
4. **Codex never calls feedback, for two reasons.** The Yakka MCP is loaded in Codex (`codex mcp list` shows `yakka`, enabled, `python3 ./client/yakka.py mcp`), so loading is not the gap (the issue's "may not be loaded" is answered). First, the instruction to call feedback lives only in the design, refine and execute skills; no Codex session after the switch from the old `workflow` plugin (about 2026-10-31 08:30) read a skill or made an MCP call. The issue says Codex AGENTS.md carries the instruction; the files inspected (no `~/.codex/AGENTS.md`; the budget and garcia-music project AGENTS.md) contain no Yakka or feedback text, so the instruction as shipped does not reach Codex. Second, `.codex-mcp.json` sets `"cwd": "."`, so the server runs in the plugin cache root; the nine historic Codex calls (all to the old `mcp__workflow__` tool) failed on relative paths resolved under `~/.codex/plugins/cache/...` and, with absolute paths, returned `not delivered`. The same relative-path trap applies to the local Yakka MCP process today: it resolves a relative path against its own `os.getcwd()` and reads no harness project-directory variable or MCP roots (`yakka.py:1875-1880`, `1971-1977`). The MCP `instructions` string describes the tools and does not tell the agent when to call them.
5. **A local fallback exists in the client, and tests encode it.** `LocalEndpoint = "http://127.0.0.1:8770"` is substituted when no client config exists (`Load()` in `plugins/yakka/client/yakka.py`), and `yakka status` prints "config: none (local mode)". There is no explicit local marker, so a client with remote intent but no file fails over silently. The Oct 30 `unreachable` results came from this path, because `client.toml` did not exist until 2026-10-30 23:37 AEST; that file now exists, so this machine is safe by accident. Half-set env is already an error and no code substitutes the local endpoint after a failed request; the gap is the file-absent and no-marker cases. Python tests that assert the old behaviour (`TestMissingFile` in `test_clientconfig.py`, `test_status.py`, and any other that relies on the no-file default) will change. The Python `login` default (`https://api.yakka.build`) differs from the runtime default.
6. **A legacy process still runs, and a backlog is stranded.** pid 7649, `~/.cache/workflow/0.1.0/workflow-linux-amd64 mcp`, is the MCP child of a long-lived `codex` started by `~/.config/systemd/user/codex-usage-probe.service` (tmux server `codex-usage`, a `while :; do codex ...; sleep 15; done` loop). That codex predates the switch to the `yakka` plugin and loaded the old `workflow` plugin copy at `~/.codex/plugins/cache/workflow-plugin/workflow/2.9.2/`. `~/.config/workflow/client.toml.bak-pre-local` still holds a 127.0.0.1:8770 endpoint and a key. `~/.local/share/workflow/queue` holds 37,931 unsent `*.evt` files (167,853,844 bytes, 2026-10-23 to 2026-10-31; all Codex hook events) plus 38 rejected entries; nothing reads that directory. A successful drain deletes what it sends, so draining it in place is destructive and cannot be retried.
7. **All MCP tool logic is in the local client, and the server has no MCP endpoint.** The `# --- mcp ---` section of `yakka.py` (lines 1840-2514) holds the tool list, descriptions, schemas, `readOnlyHint` annotations, `_MCP_INSTRUCTIONS`, argument validation and every `artifact_feedback` state and wording; the Go server registers REST routes only (`internal/serve/serve.go:485-523`). Items 1, 3 and 4 each land in that section: the feedback wording, the `stale` and scoring states, the instruction text, relative-path resolution and the read-only annotation. `artifact_feedback` also reads cwd, stat and file bytes (hash), `git rev-parse --show-toplevel`, git remote or root commit (`repo_id`), a scan of the queue directory for unsent writes of the file, the drain lock, `Load()`, and starts the drain (`yakka.py:1967-2063`). A decision of 2 Nov 2026 makes the local MCP side a thin shim and puts all tool definitions and logic on the server; a separate Yakka issue, the MCP shim issue (#177), builds that, and this design depends on it.

## Solution Shape

After this change, a client either talks to the remote it was configured for or stops with a message; every changed design, brief or report reaches the remote whichever process wrote it; `artifact_feedback` says exactly what the service did with the file (screened and scored, scoring off, or still pending); both harnesses tell the agent to ask for feedback and Codex resolves paths correctly. The legacy source is retired and the stranded history is uploaded once through the same pipeline. Every MCP tool this plan adds or changes is defined and answered on the server; the local shim only forwards the call with auth and local context added.

### Domain: Client configuration (endpoint resolution)

- Owns: deciding remote, explicit local, or a named error from env and `client.toml`; the wording of config errors; the Python client (`plugins/yakka/client/yakka.py`) as the one implementation; the `yakka status`, Python drain and MCP shim consumers of that decision (the shim takes its endpoint and bearer from `Resolve`, the one login the drain also uses).
- Contract: `Resolve` returns exactly one of `Remote{endpoint, key}`, `Local` (loopback endpoint `http://127.0.0.1:8770`, no bearer) or `Error{what, fix}`. First match wins:
  1. `YAKKA_ENDPOINT` and `YAKKA_KEY` both set: Remote with those values. `YAKKA_MODE=local` alongside either is an Error (conflicting).
  2. Exactly one of the two set: Error (`what`: which is missing; `fix`: set both or unset both). This already exists.
  3. `YAKKA_MODE=local`, neither set: Local. The env form overrides the file for processes that inherit it.
  4. `client.toml` (path `YAKKA_CLIENT_CONFIG`, else `~/.config/yakka/client.toml`) present: `mode = "local"` with no key is Local; `endpoint` and `key` both present is Remote; anything else (key without endpoint, endpoint without key, `mode = "local"` with a key, unreadable or unparseable file) is an Error naming the file and the field. The file is the primary marker because harness-spawned hook, shim and drain processes do not inherit a shell variable set only for `yakka serve`.
  5. Nothing set and no file: Error "yakka is not logged in", fix "run /yakka:login, or set YAKKA_ENDPOINT and YAKKA_KEY, or set `mode = "local"` in client.toml for a local server".
  A resolved Remote is used as configured for every request in the process; no path substitutes another endpoint on failure, partial config or absence. `127.0.0.1:8770` appears only as the Local endpoint and as the `yakka serve` bind default. Local mode is the Python drain posting over HTTP to a loopback `yakka serve` (which ignores bearer tokens, so no key is sent); no part of it relies on `yakka serve` hosting the drain.
- Failure contract: a failed remote request reports what failed (network, auth, server status) against the configured endpoint with userinfo stripped, says whether events stay queued for retry, and gives the fix (`yakka status`, `/yakka:login`, network). Hooks still spool with no network and never fail the agent. A drain whose config is an Error leaves queued files untouched and logs the error once. The shim's failure is its own error, not a tool state: when `Resolve` is an Error, or the server cannot be reached, the shim answers the forwarded request with an error that begins `bad config` or `unreachable`, names what failed, says how many local writes stay queued, and gives the fix. Those two cases stay in the shim because they are how it reaches the server; no tool wording or state lives there.
- Non-goals: the server's own `Config.Local()` (server-side local mode), the sync credential of plan 18 (it already refuses loopback), the login OAuth flow.

### Domain: MCP boundary (local shim and server surface)

Owned by the MCP shim issue (#177), which builds the generic mechanism: the server's declaration of named context, the shim's forwarding and injection, the endpoint. This design relies on it. Plan 21 phase 3 owns the readers for the names the Feedback tool declares (`project_dir`, `cwd`, `file`, `git`, `queue`, `drain`, the base-list resolution for `resolved_path`) and the server tool that declares them; the shim reads only what a declaration names.

- Owns: the split between the local MCP shim in `yakka.py` and the MCP endpoint on the Go server.
- Contract: the shim does two things and nothing else. (a) It injects auth: the bearer key from `Resolve`, the one login the drain also uses (no bearer in explicit local mode). (b) It injects local context: values only readable on the agent's machine, added to the forwarded call as parameters. It forwards `initialize`, `tools/list` and `tools/call` to the server's MCP endpoint and relays the replies unchanged. It holds no tool list, descriptions, schemas, `instructions`, argument validation, state logic or wording. Which context each tool gets is declared by the server in its tool definition, never hard-coded per tool in the shim. Every tool definition and its logic live on the server.
- Stays local: config resolution (Client configuration domain), the no-local-fallback error, the shim's own `bad config` and `unreachable` errors (they are how the shim reaches the server), hooks, the spool and the drain. The drain stays a separate local piece.
- Non-goals: moving `list_checks` and `search_artifacts` or building the endpoint (the MCP shim issue); any tool logic in `yakka.py`.

### Domain: Artifact capture (worktree to remote)

- Owns: which file versions are sent and when; client-side secret withholding; reconciliation of local content against the remote.
- Contract: two triggers send a worktree `artifact_version` for a scored-kind file in a git work tree whose current content the service does not hold. (a) `artifact_feedback`, on the server: the tool compares the injected `file.content_hash` with the service's latest hash for `(git.repo_id, git.rel_path)`. If they differ and `file.content` was injected, the tool ingests one `artifact_version` (source `worktree`, `conversation_id` `feedback-<repo_id>`, `ts` the injected `file.mtime`) through `ingest.Ingest` under the caller's tenant, so hash validation, the server's own `Precheck` scan and row-hash dedupe apply, then re-reads the latest. If they are equal it ingests nothing. No spool entry, no drain wait and no write on the local side: the shim only supplied the file facts. (b) The Stop and SessionEnd events (the Claude and Codex hook files both have them), local and in Python: for each scored-kind file that `git status --porcelain --untracked-files=all` reports modified or untracked in the session's working repo (untracked directories are expanded to files), a new spool entry kind `artifact_snapshot {path, cwd}` is written. `spool.sh` stays as it is (bash builtins, no parsing, no network, no Python); the sweep runs in `yakka.py`, either on the Stop and SessionEnd hook events the drain reads from the queue or in a hook command the plugin adds, which the build settles. The Python drain turns the entry into an `artifact_version` (source `worktree`) from the file's current content with the existing scan, hash and conversation-ID rules (no session ID: `feedback-<repo_id>`), and sets `ts` to the file's mtime. No client-side "last sent" memory exists. The service's row hash covers `ts` and `conversation_id` but not content (`internal/keys/keys.go` `Canonical`), so a repeat of unchanged content from the same conversation and mtime is answered `duplicate`; a re-touched file with the same content stores one more row, which `versions` (distinct hashes) and "latest" ignore. Content the local scan withholds never leaves the machine: the drain moves a snapshot to `queue/rejected/` with a `.reason`, and for (a) the shim injects `file.scan` instead of `file.content` and the tool answers `rejected` with the pattern and line.
- Non-goals: parsing shell commands to guess written paths; a repo-wide sweep; changing scanner patterns; any spool write from the shim.

### Domain: Feedback tool (`artifact_feedback` on the server's MCP surface)

- Owns: the tool as the server defines it (Go, on the endpoint the MCP shim issue builds): description, annotations, argument validation, state set and wording, the declared context, and the report of scoring state (the source `scoring()` in `internal/serve/admin.go` reads). Nothing of this is in `yakka.py`.
- Contract, argument: `path` (string), absolute or relative to the session's project directory.
- Contract, declared context (names exact; the server declares them, the shim injects them, the agent cannot supply them):

  | Parameter | Value read on the agent's machine |
  |---|---|
  | `project_dir` | the harness-supplied project directory, absent if the harness gives none |
  | `cwd` | the shim's working directory, used only to name it in an error |
  | `resolved_path` | `path` resolved against the base list the declaration gives, `["project_dir"]`; absent when `path` is relative and no base exists. `cwd` is never a base, so a path is never resolved against the plugin directory |
  | `file` | `{exists, is_file, size, mtime, content_hash, content, read_error, scan}` (`read_error` is the OS error code) read at `resolved_path`. `content` is omitted when `scan` is set or `size` exceeds the declared `max_content_bytes` (below the service's 16 MiB request cap); both are mechanical, the server owns the limit and what an omission means. `scan` is `{pattern, line}` from the same scanner function the drain uses, a local fact like `content_hash` (see ledger 16) |
  | `git` | `{top, rel_path, repo_id, error}` from `git rev-parse --show-toplevel`, the path relative to it, and `repo_id` by the drain's rule (normalised remote, else root commit); `error` is a code (`no_repo` or `no_commit`), not wording |
  | `queue` | `{pending: [{age_s}], rejected: [{reason, mtime}]}`, local lookup, no decision: spool and `rejected/` entries whose normalised path (the drain's path function) equals `git.rel_path` |
  | `drain` | `{running}` from the `.drain.lock` probe |

- Contract, states, decided on the server from the argument, the context and the service's own data. Argument errors (relative path with no `resolved_path`: an error naming `cwd` and asking for an absolute path; `file.exists` false, `is_file` false or `read_error`: an error naming the path; a read-only key: the error `read-only key` with the fix, a write-scoped key) are tool errors, not states. States: `not tracked` (`git.error`, or `keys.Kind(git.rel_path)` is not design, brief or report); `rejected` (`file.scan` set, or a `queue.rejected` entry with `mtime` at or after `file.mtime`, or the call's ingest refused by `Precheck`; the line gives the pattern and line, never the match, and the fix: rewrite the file, the new write is the repair); `queued` (the service lacks the hash, the call could not send content, and `queue.pending` is non-empty; the line gives the count, oldest age and `drain.running`); `not delivered` (the service holds no version of the path and the call could not send one); `stale` (the service's latest hash still differs after the call's ingest, or content could not be sent and nothing is queued; the line names both short hashes); `delivered`. The shim's `bad config` and `unreachable` errors are not states of this tool.
- Contract, `delivered`: prints the existing `screen:` line (`pass`, `flagged: <reason>`, `unscreened`, `awaiting screen`) plus a `scoring:` line whose value `on`, `off` or `pending` the server takes from its own scoring state (scorer and checks loaded), never from the client. `pending` means received under 30 s ago; the tool waits up to 10 s for the screen before answering and says to call again. `off` says scoring is not configured on the service and that stored content will be scored by an admin rescore once it is. Where scores exist, the existing baseline comparison lines are unchanged.
- Contract, annotations: `artifact_feedback` is not read-only: `readOnlyHint` false, `destructiveHint` false, `idempotentHint` true, because the call may ingest one version. It needs write scope. That check exists only for `/v1/ingest` today (`serve.go:640`), so the MCP endpoint applies the same scope check to this tool, and the tool wakes the screen worker after its ingest as the ingest handler does (`serve.go:755-758`); otherwise the screen would wait for the next tick and the 10 s wait would not hold. `list_checks` and `search_artifacts` keep `readOnlyHint` true.
- Non-goals: new state names for scoring detail.

### Domain: Harness adapters (Claude and Codex)

- Owns: how each harness starts the shim (`.mcp.json`, `.codex-mcp.json`) and what the agent is told at session start, which the server supplies.
- Contract: the server's MCP `initialize` `instructions` and the `artifact_feedback` description say, one sentence each, "after writing or changing a design, brief or report, call artifact_feedback with the file's absolute path, then fix a flagged check or record the pass". The string lives in one place, the server's MCP surface; the shim relays it unchanged. The relative-path rule is the server's, applied to `project_dir`, `resolved_path` and `cwd` as in the Feedback tool domain. The plugin's MCP config decides only how the shim is launched (for Codex, whether `"cwd": "."` stays).
- Non-goals: Cursor and OpenCode; the Claude hook set.

### Domain: Retirement and backfill (one-time operations)

- Owns: stopping the legacy MCP and its launcher; the single upload of the old queue; their evidence reports.
- Contract: see phases 2 and 6. The build runs both; a design run never does, and neither changes production config.
- Non-goals: rotating exposed credentials.

## Architectural Implications

- Stable docs that change: `docs/design/02-edge-capture.md` ("Config" step 4, "Neither set, and no file: local mode"), `docs/design/05-distribution.md:54`, `docs/design/04-advisory-surface.md` (the resolution order; "Every tool is read-only" at line 20, now false for `artifact_feedback`; the `artifact_feedback` order of checks and the "Unreachable service" section, which have the shim answering from local state, replaced by the Feedback tool contract and the shim's own `bad config` and `unreachable` errors), and `docs/design/01-event-model-and-ingest.md` (the commit catch-up is no longer the only recovery for a missed write). The rule "no file means local" in design 02 is the drift this design corrects. `docs/design/03-remote-service.md:53/58/66` (server bind default) is correct and stays. The MCP shim issue (#177) rewrites the shape of design 04 and the "MCP shim" section of design 02 (the shim as a thin wrapper, tools on the server); because Plan 21 depends on it, it lands first and Plan 21 amends the contract sections above on top of it. The hosted-drain text (design 03 "Local serve hosts the drain", design 02 "Drain" lines 44-46) is left for the Go client deletion issue (#178) to amend. `docs/OVERVIEW.md` and `docs/ARCHITECTURE.md` need no change beyond a note that Codex uses the same MCP server.
- Stale docs fixed with their phase: `CHANGELOG.md:148-151` (Codex "`bin/yakka mcp`") and `packages/hooklog/codex-mcp.example.toml`, a manual Codex route that conflicts with the plugin route.
- Constraint (client and server split): the Go binary in `packages/yakka` is server-only; the Python client `plugins/yakka/client/yakka.py` is the only client. Client behaviour lands only in `yakka.py`, the plugin's hook and MCP config files and its hook script (`plugins/yakka/script/spool.sh`): config resolution and the fallback removal, the write-tool set, Stop reconciliation, the drain, the fact builder, and the shim's injection of auth and local context. MCP tool definitions and logic (descriptions, `instructions`, annotations, schemas, argument validation, state logic and wording) land only on the server's MCP surface, in Go. Other server-side pieces stay Go: the service's report of scoring state, ingest and serve.
- Constraint (depends on the MCP shim issue): Plan 21 depends on the MCP shim issue (#177). It builds the server's MCP endpoint (today the server has REST only), the thin shim in `yakka.py` (auth and declared local context in; `initialize`, `tools/list` and `tools/call` forwarded and relayed unchanged), the server-declared context mechanism, and moves the existing tools (`artifact_feedback`, `list_checks`, `search_artifacts`) to the server. Plan 21 puts no tool logic or validation in `yakka.py`; where a tool needs local data, the Feedback tool domain names the declared context parameters. Phases 1 and 2 can go ahead before the issue lands. Phase 3 is the first that needs it (the server's `artifact_feedback`, the declared context and the shim's injection); phases 4, 5 and 7 also close through the server's MCP surface; phase 6 follows phase 3 (Cody's order). None of phases 3 to 7 closes before it lands (the Stop-and-drain half of phase 3 can be built early). Hooks, the spool and the drain stay local.
- Constraint (does not depend on the Go client deletion issue): Plan 21 does not depend on the Go client deletion issue (#178), which removes the Go client code (`internal/drain`, `internal/mcp`, `internal/facts`, `internal/clientconfig`, the `drain`, `status` and `mcp` subcommands, and the serve-hosted drain in `internal/serve/host.go`). If that code still exists when Plan 21 is built, the build leaves it untouched: no fixes, no parity tests, no new work in `host.go`. Every phase outcome is therefore proved against the Python client and drain with `YAKKA_BIN` unset and a queue no `yakka serve` hosts, whether or not a hosted drain exists. Retiring legacy pid 7649 (an old build of the Go client) stays in Plan 21 (phase 2).
- One conformance table (scenario in, outcome out) pins the config resolution; it is a Python-client test.
- The agents run the installed cached plugin, so a plugin-side fix reaches a session only after a plugin release and a new session, and a server-side MCP change only after the service is deployed. Each phase's outcome is shown against the released plugin and the deployed service, not a checkout.
- Users with a local-only setup and no `client.toml` must add `mode = "local"`; the error text tells them. Design 02's Config section, once step 4 is rewritten, documents this.

## Decisions

- No config means an error, not local. The issue and Cody both require that nothing defaults to 8770; `mode = "local"` keeps the local workflow available.
- Final-write recovery reconciles content instead of detecting shell writes. Any shell heuristic misses some writer (formatters, editors, subprocesses); comparing current content to the service has no blind spot at the points where it is checked.
- `artifact_feedback` reconciles the file itself, on the server: the shim injects the file and the tool ingests it when the service lacks the hash. It is the point where the agent is waiting, so it closes the loop even when capture missed the write, with no drain wait; it goes through `ingest.Ingest`, so validation, the server's scan and dedupe apply. Rejected alternatives: a spool write from the shim (local state logic in the shim, and a wait on the drain); a direct POST from the shim (the shim only relays and injects).
- The Stop sweep is bounded to files git reports modified or untracked in the working repo, with no local "last sent" store (the service dedupes, with `ts` set to the file's mtime). Rejected alternative: a repo-wide mtime sweep.
- The Codex instruction goes in the server's MCP `instructions` and tool description, not in AGENTS.md; both load at session start without a per-project file. This assumes Codex shows server instructions (ledger 5).
- The backlog is uploaded from a staged copy, never by draining the original in place, and sends hook events only: the events are 3 to 11 days old, and building artifact versions from them would attach today's file content to old events.
- Order: config contract first, legacy retirement next (so the old queue is quiescent), final-write fix before the backlog (Cody's order), the Codex and scoring work before the end-to-end acceptance. The MCP shim issue lands before phase 3 starts; phases 1 and 2 do not wait for it.
- All MCP tool logic goes on the server. Rejected alternative: keep the state wording and relative-path rules in the local shim and mirror them on the server (two copies, and the local one is the pattern the shim issue removes).

## Assumption Ledger

### Assumption 1

- Question: Is the remote scorer configured (`TYPESAFE_API_KEY`, `YAKKA_CHECKS_DIR`)?
- Answer chosen: Partly known. Live feedback on this design returned `screen: pass by jev-1.13.0` about 25 s after delivery, so a screener runs, but it printed no score lines, so scoring (checks directory or scorer key) is probably off or its scores are not returned. Phase 4 begins by reading the `scoring:` line of a live `artifact_feedback` (the server's own state, needing no admin session) and fixes the deployment if scoring is off.
- Rationale: this run may not read or change Fly settings.
- If wrong: if scoring needs a key Cody has not provisioned, the build asks Cody for it, ships the client half (honest `scoring:` lines) and leaves the done-when open; after the scorer is on, an admin rescore scores content stored while it was off.

### Assumption 2

- Question: Which writer dropped the final write, and who made commit 52435db?
- Answer chosen: A Bash heredoc, from the budget transcript. The commit's author is unknown.
- Rationale: the last Edit was at 02:04:00Z and a Bash `open(p,'w')` at 02:04:06Z with no captured `git commit`; reconciliation does not depend on the writer.
- If wrong: any other uncaptured writer is covered by the same feedback snapshot; a commit-only flow with no feedback call and no dirty file is covered by neither, and the build adds commit-time reconciliation if it finds one.

### Assumption 3

- Question: Where does an explicit local setup live, and who drains in local mode?
- Answer chosen: `mode = "local"` in `client.toml` (primary) or `YAKKA_MODE=local` (override). In local mode the Python drain posts to the loopback `yakka serve` over HTTP. Plan 21 adds nothing to the serve-hosted drain (see ledger 11).
- Rationale: the smallest addition that cannot be reached by accident; the file reaches every harness-spawned process. The Python drain already sends no bearer for an empty key (`_bearer_header`), and a local serve ignores bearer tokens.
- If wrong: existing local users without a file must add one; the error message states how.

### Assumption 4

- Question: Do relative paths in Codex resolve against the project directory?
- Answer chosen: Unknown; default is that they do not. The server's declared resolution base is `project_dir` only, so a relative path with no project directory gets an error naming `cwd` and asking for an absolute path, and nothing resolves under the plugin directory.
- Rationale: recon found the failure (`cwd: "."`) but did not test removing the key or reading roots. Nothing in the client reads a harness project-directory variable today (`yakka.py:1875-1880`), so Claude's relative paths also resolve only through the MCP process's cwd; the shim's `project_dir` for Claude is likewise the build's to settle (open question 1).
- If wrong: if a harness supplies the project directory (roots, environment or inherited cwd), phase 5 has the shim inject it as `project_dir` and the error stays only as a guard.

### Assumption 5

- Question: Does Codex show MCP server `instructions` and tool descriptions to the model?
- Answer chosen: Yes, at least the tool descriptions.
- Rationale: Codex lists the tool (`mcp__yakka__artifact_feedback` is visible in a post-switch session).
- If wrong: phase 5 adds a Codex-visible instruction (a plugin-shipped skill or AGENTS snippet) and the phase outcome is unchanged.

### Assumption 6

- Question: Which tenant receives the backlog, and what is expected after upload?
- Answer chosen: The tenant of the key in `~/.config/yakka/client.toml`. The build recomputes the expected stored count from the staged copy as distinct row hashes among hook events minus events the server's policy drops (policy-removed events are answered `accepted` and not stored); recon saw 37,931 files, 37,931 distinct whole-file hashes and 37,928 distinct payloads.
- Rationale: the row hash excludes `id` and `content` and includes `ts`.
- If wrong: the report shows both numbers and the upload is not marked verified until an independent server-side count agrees.

### Assumption 7

- Question: Are the backlog's 38 `rejected/` entries uploaded?
- Answer chosen: No; they were rejected locally and stay in place.
- Rationale: uploading them defeats the secret scan.
- If wrong: a follow-up decides per reason.

### Assumption 8

- Question: Does the remote have headroom for ~168 MB of events (disk, per-tenant limits, retention that might expire 3 to 11 day old events)?
- Answer chosen: Check before the first batch on the admin page; batches follow the drain's limits (500 files or 8 MiB, 429 `Retry-After`).
- Rationale: those are the drain's contract.
- If wrong: the build pauses before the next batch and records the count reached; the staged copy makes a resume safe.

### Assumption 9

- Question: Wait ceilings (10 s pending screen, 30 s "recent"; the earlier 5 s wait for snapshot delivery no longer exists).
- Answer chosen: As stated. The 10 s wait happens inside the server's tool call, so the shim's forward timeout must exceed 10 s; the MCP shim issue owns that timeout.
- Rationale: the worker polls every 3 s; larger waits slow the agent.
- If wrong: raise the ceiling or return `pending` sooner; the line already says to call again.

### Assumption 10

- Question: May the codex-usage probe be restarted, and should it keep the Yakka plugin?
- Answer chosen: Yes to the restart if its readings resume within one loop cycle; it keeps the default Codex config (Yakka plugin on), its hook events being distinguishable by the probe's working directory.
- Rationale: it is a usage measurement loop; the user's default config already enables `yakka@yakka`.
- If wrong: if it feeds a plan-calibration measurement in progress, the build waits for a gap or asks Cody; if Cody wants the probe out of analytics, disable the plugin in its config as a follow-up.

### Assumption 11

- Question: Does Plan 21 touch the serve-hosted drain (`internal/serve/host.go`), which today reads the Go client config and hosts a drain in local mode?
- Answer chosen: No. It is client behaviour and the Go client deletion issue (#178) removes it. The build leaves `host.go` untouched whether or not it still exists. Phase 1's local-mode outcome is proved against the Python drain only, with a queue directory no serve instance hosts, so the result does not depend on a hosted drain running or being absent. If a hosted drain still runs against the user's default queue and holds `queue/.drain.lock`, the Python drain finds the lock held and starts nothing; that is today's behaviour and is not a Plan 21 outcome. The same holds for the new `artifact_snapshot` spool kind (phase 3): a surviving hosted drain would not know it, so snapshot delivery is proved against the Python drain on an unhosted queue, and local-mode snapshots under a surviving hosted drain are the deletion issue's concern.
- Rationale: Cody, 2 Nov 2026 10:45 PM AEST: "The go server is only server side now so anything else has to go."
- If wrong: if a surviving hosted drain misbehaves with a `mode = "local"` file (its config loader predates the marker), the fix is the deletion issue's, not an edit here.

### Assumption 12

- Question: Does the plan wait for the Go client deletion issue, or fix or test the Go client meanwhile?
- Answer chosen: Neither, as stated in the constraint under Architectural Implications. The one Go client still running (pid 7649) is retired in phase 2, not patched.
- Rationale: Cody's decision; the plugin wrapper already routes `drain`, `mcp`, `login`, `status` and `version` to `yakka.py`, so installed plugins use only the Python client, except when `YAKKA_BIN` is set (the wrapper and `spool.sh` then exec that binary); outcomes are proved with it unset.
- If wrong: if the Go client survives and someone runs it with no config, it still defaults to 8770; the deletion issue owns that.

### Assumption 13

- Question: Where did the Go-side client work in the previous design go (config resolution, state wording, MCP instructions in the Go client)?
- Answer chosen: Removed, with no replacement. Server-side Go stays: the service's own scoring state (`scoring()`), ingest and serve. The conformance table remains as a Python-client test only; phases, purposes and other outcomes are unchanged.
- Rationale: Cody's instruction to amend without redesigning.
- If wrong: a client behaviour that someone finds only implemented in Go is a gap for the deletion issue to name, not for this plan.

### Assumption 14

- Question: Does Plan 21 depend on the MCP shim issue, and which phases can go ahead before it lands?
- Answer chosen: Yes. Phases 1 and 2 can go ahead before it lands; phase 3 is the first that needs it; phases 4, 5 and 7 close through the server's MCP surface; phase 6 follows phase 3. Phase 1 leaves today's in-process `yakka mcp` alone; its `bad config` and `unreachable` clauses are proved against the shim, at phase 3's close if the shim was not there when phase 1 closed.
- Rationale: Cody, 2 Nov 2026 about 10:57 PM AEST: the local shim is a thin wrapper, all tool definitions and logic live on the server, and this plan depends on that. Today the server has no MCP endpoint (recon: REST routes only at `serve.go:485-523`).
- If wrong: if the shim issue slips, phases 1 and 2 still ship; phase 3's Stop-hook half (hook, spool and drain) can be built early but the phase does not close, and phase 6 stays blocked behind it. Splitting phase 3 to unblock the backlog would change the phase plan and is Cody's call.

### Assumption 15

- Question: Which phases put tool logic on the local MCP side in the earlier version of this design, and where did it go?
- Answer chosen: Flagged and moved to the server's MCP surface. Phase 1: `artifact_feedback` returning `bad config` as a tool state (now the shim's own error). Phase 3: the feedback snapshot written to the spool with a 5 s wait, and the `rejected` and `stale` states and wording (now the tool's ingest and states). Phase 4: the `scoring:` line, `pending` logic and 10 s wait, and the `screen:` wording. Phase 5: the MCP `instructions`, the tool description, relative-path resolution and the read-only annotation (`_MCP_INSTRUCTIONS`, `_MCP_TOOL_LIST`, `feedback()` in `yakka.py`). Phase 7: the flagged-line fix wording. Each now lives in the Feedback tool and Harness adapters domains; the shim keeps none of it.
- Rationale: Cody's rule that the shim holds no tool list, descriptions, schemas, instructions, validation, state logic or wording.
- If wrong: none expected; a piece found still local at build time is a bug against this design.

### Assumption 16

- Question: The secret scan reads file content and so is neither a read nor a tool decision. Where does it run for the feedback call?
- Answer chosen: In the shim, as a declared local fact: `file.scan {pattern, line}`, computed by the same function the drain uses, with `file.content` omitted on a hit. The server decides the `rejected` state and its wording from it. The server's `Precheck` also scans at ingest (verified, `internal/ingest/ingest.go:83-124`) as a second layer.
- Rationale: the existing guarantee is that withheld content never leaves the machine; running the scan only on the server would send a secret over the wire once before it was refused. This is the one place the shim computes a derived fact beyond reading (as it also computes `content_hash`); it makes no decision and holds no wording. It sits slightly outside Cody's list of injectable context, so it is flagged for him.
- If wrong: if Cody wants the shim to read only, drop `file.scan` and rely on `Precheck`; a secret then crosses to the user's own service once, and the service records only the pattern and line.

### Assumption 17

- Question: Does the shim still kick the drain and wait on the queue, as `feedback()` does today (`yakka.py:2024-2039`)?
- Answer chosen: No. The call ingests the current file itself, so it does not wait on the drain. `spool.sh` starts the drain after a spool unless `YAKKA_HOOKLOG` is off (`spool.sh:99-100`), and `queue` and `drain.running` are reported as facts only. A drain that is not running with writes queued shows in the `queued` line with the fix (`yakka status`).
- Rationale: starting a process and polling the queue are side effects and state logic, which the shim may not hold.
- If wrong: add a declared `drain` context option that asks the shim to ensure a drain is running before it reports the fact.

### Assumption 18

- Question: The `queued` state existed because delivery went through the drain. Does it stay?
- Answer chosen: Yes, narrowed: the service lacks the hash, the call could not send content (over the declared limit), and unsent writes are queued. The earlier 1.5 s wait and re-check are gone. `not tracked` (today's `untracked`, `yakka.py:2002-2008`) is listed in the state set, which the earlier text omitted.
- Rationale: when the call ingests the current content itself, a queued write no longer decides what the agent should do; the state set stays one-to-one with what the agent can act on.
- If wrong: if queued writes matter more than this, the server returns `queued` whenever `queue.pending` is non-empty and the hashes differ, before it ingests.

### Assumption 19

- Question: With the shim a pure forwarder and no tool list of its own, what does the agent see when config is an Error or the remote is down?
- Answer chosen: The shim answers the forwarded request with its own `bad config` or `unreachable` error naming what failed and the fix. If this happens at `initialize`, the session's harness shows the MCP server as failed with that message and the agent has no `artifact_feedback` tool; a failure mid-session returns the error to the agent. Whether the shim retries `initialize` is the MCP shim issue's call (open question 5). Phase 1's outcome is stated for this behaviour: the error text, not a tool result.
- Rationale: the shim cannot answer `tools/list` or word a tool state without holding tool logic.
- If wrong: if the shim must keep the tool visible while offline, the shim issue holds a cached definition it does not interpret; Plan 21's outcomes are unchanged.

### Assumption 20

- Question: The earlier design said repeated snapshots of unchanged content are answered `duplicate` by the row-hash dedupe. Is that true?
- Answer chosen: Not as written. The row hash covers `ts` and `conversation_id` and excludes only `id` and `content` (`internal/keys/keys.go` `Canonical`), so two snapshots with different `ts` are not duplicates. The design now sets the snapshot's `ts` to the file's mtime for the drain path, and for the feedback path the tool compares the hash with the service's latest and ingests nothing when equal.
- Rationale: verified against the code while rewriting the trigger; the phase 3 outcome ("a second call writes no new remote row") is unchanged and now holds by the tool's comparison.
- If wrong: if `ts` cannot be the mtime for a snapshot, the Stop path stores one extra row per Stop with an unchanged content hash, which `versions` and "latest" ignore.

### Assumption 21

- Question: The admin rescore and operations page are session-only and admin-only (`serve.go:512-513`), so a build running on a bearer key cannot call them. How does phase 4 proceed?
- Answer chosen: The checkable observable is the server's own `scoring:` line over MCP, which needs no admin session. The rescore of stored content is the one step that needs Cody's admin browser session; the build asks for it then, records it as the single manual step, and the phase closes on the tool returning scores after it.
- Rationale: the skill wants outcomes checkable without asking; only the rescore cannot be, and it is a one-time operation on content stored while scoring was off.
- If wrong: if an admin session is unavailable, the phase closes on `scoring:` honest for new content and the budget file's rescore stays an open step.

## Open Questions

1. Does Codex expose the session's project directory to a stdio MCP server (roots capability, environment variable, or inherited cwd when `cwd` is omitted)? Also decides what the shim injects as `project_dir` for Claude, which the client does not read today. Blocks the exact path-resolution rule in phase 5 only. Claude's `.mcp.json` sets no `cwd`, so today Claude's relative paths resolve through the process's inherited cwd; with `cwd` never a base they would regress unless `project_dir` is supplied, which phase 5 checks.
2. Should the scanner's `env_assignment` pattern stop firing on long design and brief prose? Out of scope; it causes the five local rejections and is why phase 3 reports rejections instead of hiding them.
3. Are the 3.0.1 `yakka mcp` (pid 4174101) and the Cursor-spawned `yakka mcp` worth retiring? Not decided by Cody; recorded only.
4. Does Codex fire `Stop` and `SessionEnd` in `codex exec` as well as interactively? Its hook file declares both (`plugins/yakka/hooks/codex.json:14,102`); phase 3 records which fire in each mode.
5. If the remote is unreachable or config is an Error when a session starts, does the shim fail `initialize` (no feedback tool for that session) or retry? The MCP shim issue decides; Plan 21 requires only the error that names what failed and the fix (ledger 19).

## Phases

### Phase 1 — Remote-or-fail client configuration

- Outcome: With no env and no `client.toml`, `yakka mcp` answers a request with a `bad config` error ("yakka is not logged in" plus the fix) and `yakka status` prints the same instead of "config: none (local mode)", while a listener on 127.0.0.1:8770 records no connection. With a `client.toml` holding only a key, only an endpoint, or `mode = "local"` plus a key, each gives a `bad config` error naming the file and the missing field, with no connection to 8770. With a client config holding a key and an endpoint and the remote unreachable, the result is an `unreachable` error naming the configured host and the fix, again with no connection to 8770. With `mode = "local"` and no key (or `YAKKA_MODE=local`), the same requests go to 127.0.0.1:8770, and the Python drain posts a queued fact to a loopback HTTP listener with no bearer header and gets it accepted. The `yakka mcp` clauses (the `bad config` and `unreachable` errors) are proved against the shim once the MCP shim issue has landed; the shim returns them as its own errors from `Resolve`. Before then this phase makes no change to today's in-process `yakka mcp` (its `feedback()` is tool logic the shim issue removes, and its `bad config` appears only as a state behind other checks), and those clauses are checked at phase 3's close instead. This phase adds no MCP tool logic to `yakka.py`. This is proved against the Python drain only; the build leaves `internal/serve/host.go` untouched. The conformance table passes in the Python suite, and a repository check finds `127.0.0.1:8770` only in the Python Local constant, the `yakka serve` bind default, docs and tests (Go client code, if it still exists, is exempt and left untouched).
- Surfaces: `plugins/yakka/client/yakka.py` (`Load()` and its consumers: `yakka status`, `yakka drain`, the MCP entry point's config error, `yakka login` default endpoint), its Python tests (`test_clientconfig.py`, `test_status.py`), design docs 01, 02, 04 and 05 (04's resolution-order text only; if the shim issue has already rewritten 04, the amendment is made on the rewritten doc).
- Approach: known
- Depends on: nothing. Can go ahead before the MCP shim issue (#177) lands.

### Phase 2 — Retire the legacy MCP and its launcher

- Outcome: After the build restarts the codex-usage probe through its unit (`systemctl --user restart codex-usage-probe.service`), no process whose command line contains `workflow-linux-amd64` exists 60 seconds later, `codex mcp list` inside the probe's environment shows only `yakka`, and the probe still produces its usage readings. The old plugin copy `~/.codex/plugins/cache/workflow-plugin/`, the binary `~/.cache/workflow/0.1.0/`, and `~/.config/workflow/client.toml.bak-pre-local` (it holds a key for a local endpoint) are archived or removed, the `workflow-serve.service` and `workflow-quality.service` units are removed, and `ps` shows nothing launched from them. Nothing under `~/.local/share/workflow/queue` is touched by this phase, and the build records that the queue's file count is unchanged afterwards.
- Surfaces: `systemctl --user`, `ps`, `codex mcp list`, the probe's tmux session, the files named above.
- Approach: known (stop at the root launcher; killing pid 7649 alone is undone by the 15 s loop or by codex restarting the child)
- Depends on: nothing. Can go ahead before the MCP shim issue (#177) lands.

### Phase 3 — Every written file reaches the remote

- Outcome: In a scratch repo with the Yakka plugin and a test remote, an agent writes `docs/plans/x/DESIGN.md` with Edit, rewrites it with a Bash heredoc, and ends the turn: the remote's latest version for that path has the hash of the file on disk once the drain empties (Stop snapshot), and `artifact_feedback` called straight after the heredoc and before any Stop returns `delivered` for the new hash (the server's tool ingests the file the shim injected). A scored file whose content the scan withholds returns `rejected` with the pattern and line, never `stale`. For the issue's own case, `artifact_feedback` on the budget repo's `docs/plans/01-local-finance/DESIGN.md` from a session there returns `delivered` and the remote hash equals the file's current hash. A second call on unchanged content writes no new remote row (the tool finds the hash already latest and ingests nothing). The `bad config` and `unreachable` shim errors of phase 1 are checked here against the shim. If the build has no access to the budget checkout, that case is run by Cody from a session there and the build records that it was.
- Surfaces: the server's `artifact_feedback` (its states, ingest through `ingest.Ingest`, the declared `file`, `git`, `queue` and `drain` context), the shim's injection of that context, the Stop and SessionEnd sweep in `yakka.py` and the hook config (`spool.sh` unchanged), the Python drain (`artifact_snapshot`), the remote `/v1/artifacts` result, design docs 01 and 04.
- Approach: open (how the drain handles the snapshot kind and how the Stop hook finds the working repo are the build's to refine against the code)
- Depends on: 1, and the MCP shim issue (#177), first needed here: the server's MCP endpoint, the shim's context injection and `artifact_feedback` moved to the server. The Stop-hook and drain half has no dependency on it, but the phase does not close until the server half is proved.

### Phase 4 — Delivered means screened and scored

- Outcome: With the live remote and a design written by an agent, `artifact_feedback` returns `delivered` with `screen: pass` or `screen: flagged: ...` and, when scoring is on, one score line per check once the worker has screened and scored the hash (the call waits up to 10 s and otherwise answers `scoring: pending`; a repeat call after the screen has run, about 25 s in the live evidence, returns the scores). If scoring is off, the call returns `delivered` with `scoring: off` and the reason; with the hash under 30 s old and no screen yet it returns `scoring: pending` and says to call again. The budget file stored while scoring was off is rescored (the admin rescore needs an admin browser session, ledger 21) and then returns scores. Any deployment change that turns scoring on is made by the build, and the build records the before and after state without printing keys.
- Surfaces: the server's `artifact_feedback` (the `screen:` and `scoring:` lines, `pending` and the 10 s wait), the service's scoring state (`scoring()` in `internal/serve/admin.go`), the screen and score worker and startup log, `/v1/baselines`, the admin operations page and its rescore.
- Approach: open (depends on the live scorer state)
- Depends on: the MCP shim issue (#177); the tool lines are on the server's MCP surface.

### Phase 5 — Codex calls feedback

- Outcome: In a fresh Codex session (`codex exec`) in a scratch repo with the Yakka plugin enabled, a prompt to write a design file produces an `mcp__yakka__artifact_feedback` call in the transcript whose path resolves to the written file and whose result is `delivered` with the `screen:` and `scoring:` lines. A call with a relative path and the shim's cwd set to the plugin root returns the project file's state when the harness supplies a project directory (the build records whether it does, open question 1) and otherwise the error naming `cwd`, never a path under the plugin directory. In a Claude session, a relative path from the project directory returns the same state as the absolute path (no regression from today). The MCP `instructions` and tool description carry the instruction sentence, defined once on the server's MCP surface and relayed unchanged by the shim, and `CHANGELOG.md` and the hooklog example no longer describe a conflicting Codex route.
- Surfaces: `codex exec` and an interactive Codex session, the Codex plugin manifest and `.codex-mcp.json` (launch only), the server's MCP `instructions`, `artifact_feedback` description, annotations and relative-path validation, the shim's `project_dir` and `cwd` injection.
- Approach: open (depends on open question 1 and ledger 4 and 5)
- Depends on: 1, 4, and the MCP shim issue (#177).

### Phase 6 — Upload the legacy backlog once

- Outcome: A manifest records the file count (37,931 at recon), total bytes, the expected stored count and the policy-dropped count for `~/.local/share/workflow/queue`. The build uploads a staged copy (the original is not moved or deleted) to the configured remote under the phase 1 contract, tenant of the configured key, and writes a counts-only report outside the queue: files sent, results by status, facts by type (every sent fact is a `hook_event`; zero `artifact_version` and zero `commit`), rejected itemised by reason. The upload is verified when accepted plus duplicate plus rejected equals the manifest's fact count, the stored count (accepted minus the policy-dropped count, which the server answers `accepted` and does not store) equals the manifest's expected stored count or the report explains the difference, and an independent server-side count of the tenant's stored hook events rose by that stored count. Running the same command a second time on a fresh staged copy of the same original (the drain deletes what it sends, so the first copy is spent) stores 0 new rows: every storable fact is `duplicate` (equal to the first run's stored count) and the policy-dropped facts are answered `accepted` again; it exits 0. Only after verification may the original queue be archived or deleted, by a separate decision from Cody.
- Surfaces: a `YAKKA_QUEUE`-scoped run of the Python drain on the staged copy, the remote ingest response, the admin operations page or a read-only store query for the independent count, the report file.
- Approach: open (staging method, a dry-run count and the hook-events-only mode are the build's to settle against the code)
- Depends on: 1, 2, 3 (so, through phase 3, on the MCP shim issue (#177); the order is Cody's)

### Phase 7 — Agents act on feedback

- Outcome: In one fresh Claude session and one fresh Codex session, each in a scratch repo and asked to design a small feature, the transcript shows a `delivered` result with `screen:` and `scoring:` lines for the agent's design. It then shows either an edit to the file addressing a named flagged check followed by a second feedback call, or, when the screen is `pass`, a final message that states the pass with the score lines. The flagged line carries the fix instruction ("rewrite the file; the new write is the repair"), worded by the server's tool. The issue's done-when is met by these two transcripts.
- Surfaces: Claude and Codex sessions, the `yakka:design` skill's feedback step (`plugins/yakka/skills/design/SKILL.md:18`, which names only rejection, flagged checks, `queued`, `unreachable` and `bad config`, and is updated to name `not tracked`, `not delivered`, `stale` and the read-only error), the server's `artifact_feedback`.
- Approach: known
- Depends on: 3, 4, 5

## Provenance Notes

- The dropped-write cause rests on one transcript (`c70d3e4f`, tool names and timestamps only); the budget checkout was not opened. If a second case turns up with a captured write tool and a missing hash, the reconciliation design still covers it, but the root cause would need a fresh look at the drain.
- Rejected: shell-command parsing to find written paths (always incomplete); a direct HTTP push from the MCP shim (the shim only relays and injects; the server's ingest does the validation, scan and dedupe); a spool write from the shim (local state logic); a repo-wide mtime sweep (unbounded cost for a bounded problem); draining the backlog in place (destructive and not retryable); keeping "no file means local" and warning (the silent default is the failure).
- The cause was reproduced live while writing this design: after this file was last changed by a Bash heredoc and `sed`, `artifact_feedback` returned `stale` (service held an earlier hash) and stayed `stale` after the batch window, until a write-tool edit fired a hook.
- The issue's belief that Codex AGENTS.md already carries the instruction was not borne out by the files inspected; the design does not rely on AGENTS.md.
- The scorer state and the commit author for 52435db are unknown from this run and sit in the ledger with the chosen default. Downstream review challenges the ledger.
