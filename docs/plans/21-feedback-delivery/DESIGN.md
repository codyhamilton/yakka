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

1. **The final write is invisible to capture.** The client learns a file changed only from a PostToolUse event whose `tool_name` is in a fixed write-tool set (Write, Edit, MultiEdit, apply_patch and a few aliases; `_write_tools` in `plugins/yakka/client/yakka.py`, and the Go twin). The budget session `c70d3e4f` wrote `docs/plans/01-local-finance/DESIGN.md` three times with Edit (02:03:58-02:04:00Z), then a last time with a Bash `python3 - <<'E' ... open(p,'w')` heredoc at 02:04:06Z, the 1 s gap in the issue. The remote's hash received at 02:04:05Z is the Edit-era content. The Bash call produced a hook event but no `artifact_version`, because a shell command names no path the client can attribute. Nothing else rescued it: the commit catch-up (design 01) sends the committed blob only from a captured `git commit` tool call, and the transcript has none (commit 52435db appears between sessions), and the Stop hook at 02:04:15Z carries no paths. The remote never gets the final hash and `artifact_feedback` returns `stale`, whose message ("normally a write still in the batch window") tells the agent to wait for something that never arrives. This account is from the session transcript and is consistent with the code; the budget checkout itself was not read. The drain is sound: it reads content at batch time, has no per-write debounce, rescans after releasing its lock (no lost wake-up), and the server returns the latest version by `received_at`.
2. **Secret-scan withholding is silent unless the file is matched.** The client withholds an `artifact_version` whose content hits a pattern, for worktree writes and for the commit catch-up, and moves the queue file to `queue/rejected/` with a `.reason`. The live yakka queue holds five such files (`env_assignment` at line 40 of a brief and at line 775 of `docs/plans/91-landing-centered-dial/DESIGN.md`). A long design that trips the scanner is never delivered. This is a second way a version fails to reach the remote, with the same fix surface; the scanner's patterns are not changed here (open question 3).
3. **`delivered` does not say whether the file was scored, and the scorer state is not surfaced.** The server screens in a worker and scores only when a scorer and a checks directory are configured: no `TYPESAFE_API_KEY` yields "scorer none; verdicts are unscreened", and a key without `YAKKA_CHECKS_DIR` yields "scoring is off ... screening only" (`packages/yakka/cmd/yakka/main.go:86-110`). The client already prints `screen: unscreened (no scorer on the service)` and `screen: awaiting screen` (`internal/mcp/feedback.go:291-306`), but it cannot tell the agent whether "awaiting" means seconds or never, and content stored while the scorer was off stays unscreened until an admin rescore (#169). Whether the live remote has the scorer on could not be established from this checkout and cannot be changed in this run; the admin operations page reports it (`internal/serve/admin.go` `scoring()`), so the build reads it first.
4. **Codex never calls feedback, for two reasons.** The Yakka MCP is loaded in Codex (`codex mcp list` shows `yakka`, enabled, `python3 ./client/yakka.py mcp`), so loading is not the gap (the issue's "may not be loaded" is answered). First, the instruction to call feedback lives only in the design, refine and execute skills; no Codex session after the switch from the old `workflow` plugin (about 2026-10-31 08:30) read a skill or made an MCP call. The issue says Codex AGENTS.md carries the instruction; the files inspected (no `~/.codex/AGENTS.md`; the budget and garcia-music project AGENTS.md) contain no Yakka or feedback text, so the instruction as shipped does not reach Codex. Second, `.codex-mcp.json` sets `"cwd": "."`, so the server runs in the plugin cache root; the nine historic Codex calls (all to the old `mcp__workflow__` tool) failed on relative paths resolved under `~/.codex/plugins/cache/...` and, with absolute paths, returned `not delivered`. The same relative-path trap applies to the Yakka server today. The MCP `instructions` string describes the tools and does not tell the agent when to call them.
5. **A local fallback exists in two places, and tests encode it.** `LocalEndpoint = "http://127.0.0.1:8770"` is substituted when no client config exists, in the Go twin (`internal/clientconfig`) and the Python client; `yakka status` prints "config: none (local mode)"; and the serve-hosted drain (`internal/serve/host.go`) relies on that default. There is no explicit local marker, so a client with remote intent but no file fails over silently. The Oct 30 `unreachable` results came from this path, because `client.toml` did not exist until 2026-10-30 23:37 AEST; that file now exists, so this machine is safe by accident. Half-set env is already an error and no code substitutes the local endpoint after a failed request; the gap is the file-absent and no-marker cases. Tests that assert the old behaviour (`TestMissingFile` in both suites, `drain_test.go`, `mcp_test.go`, `test_status.py`) will change. The Python `login` default (`https://api.yakka.build`) differs from the runtime default.
6. **A legacy process still runs, and a backlog is stranded.** pid 7649, `~/.cache/workflow/0.1.0/workflow-linux-amd64 mcp`, is the MCP child of a long-lived `codex` started by `~/.config/systemd/user/codex-usage-probe.service` (tmux server `codex-usage`, a `while :; do codex ...; sleep 15; done` loop). That codex predates the switch to the `yakka` plugin and loaded the old `workflow` plugin copy at `~/.codex/plugins/cache/workflow-plugin/workflow/2.9.2/`. `~/.config/workflow/client.toml.bak-pre-local` still holds a 127.0.0.1:8770 endpoint and a key. `~/.local/share/workflow/queue` holds 37,931 unsent `*.evt` files (167,853,844 bytes, 2026-10-23 to 2026-10-31; all Codex hook events) plus 38 rejected entries; nothing reads that directory. A successful drain deletes what it sends, so draining it in place is destructive and cannot be retried.

## Solution Shape

After this change, a client either talks to the remote it was configured for or stops with a message; every changed design, brief or report reaches the remote whichever process wrote it; `artifact_feedback` says exactly what the service did with the file (screened and scored, scoring off, or still pending); both harnesses tell the agent to ask for feedback and Codex resolves paths correctly. The legacy source is retired and the stranded history is uploaded once through the same pipeline.

### Domain: Client configuration (endpoint resolution)

- Owns: deciding remote, explicit local, or a named error from env and `client.toml`; the wording of config errors; the Go and Python implementations as one specified behaviour; the `yakka status` and serve-hosted-drain consumers of that decision.
- Contract: `Resolve` returns exactly one of `Remote{endpoint, key}`, `Local` (loopback endpoint `http://127.0.0.1:8770`, no bearer) or `Error{what, fix}`. First match wins:
  1. `YAKKA_ENDPOINT` and `YAKKA_KEY` both set: Remote with those values. `YAKKA_MODE=local` alongside either is an Error (conflicting).
  2. Exactly one of the two set: Error (`what`: which is missing; `fix`: set both or unset both). This already exists.
  3. `YAKKA_MODE=local`, neither set: Local. The env form overrides the file for processes that inherit it.
  4. `client.toml` (path `YAKKA_CLIENT_CONFIG`, else `~/.config/yakka/client.toml`) present: `mode = "local"` with no key is Local; `endpoint` and `key` both present is Remote; anything else (key without endpoint, endpoint without key, `mode = "local"` with a key, unreadable or unparseable file) is an Error naming the file and the field. The file is the primary marker because harness-spawned hook, shim and drain processes do not inherit a shell variable set only for `yakka serve`.
  5. Nothing set and no file: Error "yakka is not logged in", fix "run /yakka:login, or set YAKKA_ENDPOINT and YAKKA_KEY, or set `mode = "local"` in client.toml for a local server".
  A resolved Remote is used as configured for every request in the process; no path substitutes another endpoint on failure, partial config or absence. `127.0.0.1:8770` appears only as the Local endpoint and as the `yakka serve` bind default.
- Failure contract: a failed remote request reports what failed (network, auth, server status) against the configured endpoint with userinfo stripped, says whether events stay queued for retry, and gives the fix (`yakka status`, `/yakka:login`, network). Hooks still spool with no network and never fail the agent. A drain whose config is an Error leaves queued files untouched and logs the error once. A loopback `yakka serve` with an Error config logs "not hosting the drain" with the same fix line.
- Non-goals: the server's own `Config.Local()` (server-side local mode), the sync credential of plan 18 (it already refuses loopback), the login OAuth flow.

### Domain: Artifact capture (worktree to remote)

- Owns: which file versions are sent and when; client-side secret withholding; reconciliation of local content against the remote.
- Contract: a new spool entry kind, `artifact_snapshot {path, cwd}`, which the drain turns into an `artifact_version` (source `worktree`) built from the file's current content with the existing scan, hash and conversation-ID rules; a snapshot from a process that has no session ID uses the conversation ID `feedback-<repo_id>`. It travels through the queue, so secret scanning, content-hash validation and the tenant and auth path are unchanged. Two triggers: (a) `artifact_feedback`: if the file is a scored kind in a git work tree and its hash differs from the service's latest for that path, the call writes a snapshot, waits up to 5 s for the drain to deliver it, then re-reads the service; (b) the Stop hook (and SessionEnd where the harness has one) writes a snapshot for each scored-kind file that git reports modified or untracked in the session's working repo. No client-side "last sent" memory exists: repeated snapshots of unchanged content are answered `duplicate` by the service's row-hash dedupe. Content withheld by the scan is reported by `artifact_feedback` as `rejected` with the pattern and line and the fix line.
- Non-goals: parsing shell commands to guess written paths; a repo-wide sweep; changing scanner patterns.

### Domain: Feedback state (what `artifact_feedback` tells the agent)

- Owns: the state set and wording in Go and Python; the service's report of scoring state.
- Contract: states `queued`, `rejected`, `not delivered`, `unreachable`, `stale`, `delivered`, `bad config`. `stale` means the local hash still differs from the service's after the snapshot in this call was accepted (or could not be built); the message names both short hashes. `delivered` prints the existing `screen:` line (`pass`, `flagged: <reason>`, `unscreened`, `awaiting screen`) plus a `scoring:` line whose value `on`, `off` or `pending` comes from a field the service reports (`/v1/artifacts` response or the admin scoring state), never inferred by the client. `pending` means received under 30 s ago; the call waits up to 10 s for it before answering and says to call again. `off` says scoring is not configured on the service and that stored content will be scored by an admin rescore once it is. Where scores exist, the existing baseline comparison lines are unchanged.
- Non-goals: new state names for scoring detail.

### Domain: Harness adapters (Claude and Codex)

- Owns: how each harness starts the MCP server and what the agent is told at session start.
- Contract: the MCP server `instructions` and the `artifact_feedback` description say, one sentence each, "after writing or changing a design, brief or report, call artifact_feedback with the file's absolute path, then fix a flagged check or record the pass". The same string is served by the Go and Python servers. A relative path resolves against the session's project directory when the harness supplies one; otherwise the call returns an error naming the cwd it saw and telling the agent to pass an absolute path. A relative path is never resolved against the plugin directory. The tool's read-only annotation is replaced for `artifact_feedback` only: it reads the named file and writes one snapshot to the spool, nothing else.
- Non-goals: Cursor and OpenCode; the Claude hook set.

### Domain: Retirement and backfill (one-time operations)

- Owns: stopping the legacy MCP and its launcher; the single upload of the old queue; their evidence reports.
- Contract: see phases 2 and 6. The build runs both; a design run never does, and neither changes production config.
- Non-goals: rotating exposed credentials.

## Architectural Implications

- Stable docs that change: `docs/design/02-edge-capture.md` ("Config" step 4, "Neither set, and no file: local mode"), `docs/design/05-distribution.md:54`, `docs/design/04-advisory-surface.md` (the resolution order, and "Every tool is read-only" at line 20, now false for `artifact_feedback`), and `docs/design/01-event-model-and-ingest.md` (the commit catch-up is no longer the only recovery for a missed write). The rule "no file means local" in design 02 is the drift this design corrects. `docs/design/03-remote-service.md:53/58/66` (server bind default) is correct and stays. `docs/OVERVIEW.md` and `docs/ARCHITECTURE.md` need no change beyond a note that Codex uses the same MCP server.
- Stale docs fixed with their phase: `CHANGELOG.md:148-151` (Codex "`bin/yakka mcp`") and `packages/hooklog/codex-mcp.example.toml`, a manual Codex route that conflicts with the plugin route.
- The Go and Python clients duplicate config, drain, facts and MCP behaviour. This design changes both and adds one conformance table (scenario in, outcome out) that both suites run.
- The agents run the installed cached plugin, so a fix reaches a session only after a plugin release and a new session. Each phase's outcome is shown against the released artifact, not a checkout.
- Users with a local-only setup and no `client.toml` must add `mode = "local"`; the error text tells them. A local `yakka serve` documents this.

## Decisions

- No config means an error, not local. The issue and Cody both require that nothing defaults to 8770; `mode = "local"` keeps the local workflow available.
- Final-write recovery reconciles content instead of detecting shell writes. Any shell heuristic misses some writer (formatters, editors, subprocesses); comparing current content to the service has no blind spot at the points where it is checked.
- `artifact_feedback` snapshots the file itself, through the queue. It is the point where the agent is waiting, so it closes the loop even when capture missed the write; routing through the queue keeps every server-side guarantee. Rejected alternative: a direct POST from the shim, which would bypass the drain's scan and dedupe.
- The Stop sweep is bounded to files git reports modified or untracked in the working repo, with no local "last sent" store (the service dedupes). Rejected alternative: a repo-wide mtime sweep.
- The Codex instruction goes in the MCP `instructions` and tool description, not in AGENTS.md; both load at session start without a per-project file. This assumes Codex shows server instructions (ledger 5).
- The backlog is uploaded from a staged copy, never by draining the original in place, and sends hook events only: the events are 3 to 11 days old, and building artifact versions from them would attach today's file content to old events.
- Order: config contract first, legacy retirement next (so the old queue is quiescent), final-write fix before the backlog (Cody's order), the Codex and scoring work before the end-to-end acceptance.

## Assumption Ledger

### Assumption 1

- Question: Is the remote scorer configured (`TYPESAFE_API_KEY`, `YAKKA_CHECKS_DIR`)?
- Answer chosen: Partly known. Live feedback on this design returned `screen: pass by jev-1.13.0` about 25 s after delivery, so a screener runs, but it printed no score lines, so scoring (checks directory or scorer key) is probably off or its scores are not returned. Phase 4 begins by reading the admin operations page and a live `artifact_feedback` and fixes the deployment if scoring is off.
- Rationale: this run may not read or change Fly settings.
- If wrong: if scoring needs a key Cody has not provisioned, the build asks Cody for it, ships the client half (honest `scoring:` lines) and leaves the done-when open; after the scorer is on, an admin rescore scores content stored while it was off.

### Assumption 2

- Question: Which writer dropped the final write, and who made commit 52435db?
- Answer chosen: A Bash heredoc, from the budget transcript. The commit's author is unknown.
- Rationale: the last Edit was at 02:04:00Z and a Bash `open(p,'w')` at 02:04:06Z with no captured `git commit`; reconciliation does not depend on the writer.
- If wrong: any other uncaptured writer is covered by the same feedback snapshot; a commit-only flow with no feedback call and no dirty file is covered by neither, and the build adds commit-time reconciliation if it finds one.

### Assumption 3

- Question: Where does an explicit local setup live, and does the serve-hosted drain keep working?
- Answer chosen: `mode = "local"` in `client.toml` (primary) or `YAKKA_MODE=local` (override). The serve-hosted drain hosts when the resolved config is Local and points at the bound address; with an Error config it logs the fix line.
- Rationale: the smallest addition that cannot be reached by accident; the file reaches every harness-spawned process.
- If wrong: existing local users without a file must add one; the error message states how.

### Assumption 4

- Question: Do relative paths in Codex resolve against the project directory?
- Answer chosen: Unknown; default is that they do not. The contract refuses a relative path whose resolution would land under the plugin directory and asks for an absolute path.
- Rationale: recon found the failure (`cwd: "."`) but did not test removing the key or reading roots.
- If wrong: if Codex supplies the project directory (roots or inherited cwd), phase 5 uses it and the refusal stays only as a guard.

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

- Question: Wait ceilings (5 s snapshot delivery, 10 s pending screen, 30 s "recent").
- Answer chosen: As stated.
- Rationale: the worker polls every 3 s and the drain's window is 1.5 s; larger waits slow the agent.
- If wrong: raise the ceiling or return `pending` sooner; the line already says to call again.

### Assumption 10

- Question: May the codex-usage probe be restarted, and should it keep the Yakka plugin?
- Answer chosen: Yes to the restart if its readings resume within one loop cycle; it keeps the default Codex config (Yakka plugin on), its hook events being distinguishable by the probe's working directory.
- Rationale: it is a usage measurement loop; the user's default config already enables `yakka@yakka`.
- If wrong: if it feeds a plan-calibration measurement in progress, the build waits for a gap or asks Cody; if Cody wants the probe out of analytics, disable the plugin in its config as a follow-up.

## Open Questions

1. Does Codex expose the session's project directory to a stdio MCP server (roots capability, environment variable, or inherited cwd when `cwd` is omitted)? Blocks the exact path-resolution rule in phase 5 only.
2. Should the scanner's `env_assignment` pattern stop firing on long design and brief prose? Out of scope; it causes the five local rejections and is why phase 3 reports rejections instead of hiding them.
3. Are the 3.0.1 `yakka mcp` (pid 4174101) and the Cursor-spawned `yakka mcp` worth retiring? Not decided by Cody; recorded only.
4. Should the Stop sweep also run for Codex? It depends on the Codex hook set; phase 3 covers the harnesses that have a Stop event and records the rest.

## Phases

### Phase 1 — Remote-or-fail client configuration

- Outcome: With no env and no `client.toml`, `artifact_feedback` returns `bad config` ("yakka is not logged in" plus the fix) and `yakka status` prints the same instead of "config: none (local mode)", while a listener on 127.0.0.1:8770 records no connection. With a `client.toml` holding only a key, only an endpoint, or `mode = "local"` plus a key, each returns a `bad config` naming the file and the missing field, with no connection to 8770. With a client config holding a key and an endpoint and the remote unreachable, the result is `unreachable` naming the configured host and the fix, again with no connection to 8770. With `mode = "local"` and no key (or `YAKKA_MODE=local`), the same calls use 127.0.0.1:8770, and a loopback `yakka serve` still hosts the drain; with an Error config it logs the fix line. The conformance table passes in both the Go and Python suites, and a repository check finds `127.0.0.1:8770` only in the Local constant, the serve bind default, docs and tests.
- Surfaces: `artifact_feedback`, `yakka status`, `yakka drain`, `yakka login` (default endpoint), `yakka serve` and its hosted drain (`serve/host.go`), the Go and Python clients, design docs 01, 02, 04 and 05.
- Approach: known
- Depends on: nothing

### Phase 2 — Retire the legacy MCP and its launcher

- Outcome: After the build restarts the codex-usage probe through its unit (`systemctl --user restart codex-usage-probe.service`), no process whose command line contains `workflow-linux-amd64` exists 60 seconds later, `codex mcp list` inside the probe's environment shows only `yakka`, and the probe still produces its usage readings. The old plugin copy `~/.codex/plugins/cache/workflow-plugin/`, the binary `~/.cache/workflow/0.1.0/`, and `~/.config/workflow/client.toml.bak-pre-local` (it holds a key for a local endpoint) are archived or removed, the `workflow-serve.service` and `workflow-quality.service` units are removed, and `ps` shows nothing launched from them. Nothing under `~/.local/share/workflow/queue` is touched by this phase, and the build records that the queue's file count is unchanged afterwards.
- Surfaces: `systemctl --user`, `ps`, `codex mcp list`, the probe's tmux session, the files named above.
- Approach: known (stop at the root launcher; killing pid 7649 alone is undone by the 15 s loop or by codex restarting the child)
- Depends on: nothing

### Phase 3 — Every written file reaches the remote

- Outcome: In a scratch repo with the Yakka plugin and a test remote, an agent writes `docs/plans/x/DESIGN.md` with Edit, rewrites it with a Bash heredoc, and ends the turn: the remote's latest version for that path has the hash of the file on disk once the drain empties (Stop snapshot), and `artifact_feedback` called straight after the heredoc and before any Stop returns `delivered` for the new hash (feedback snapshot). A scored file whose content the scan withholds returns `rejected` with the pattern and line, never `stale`. For the issue's own case, `artifact_feedback` on the budget repo's `docs/plans/01-local-finance/DESIGN.md` from a session there returns `delivered` and the remote hash equals the file's current hash. A second call on unchanged content writes no new remote row (the service answers `duplicate`).
- Surfaces: `artifact_feedback` (Claude), the Stop and SessionEnd hooks, the spool and drain, the remote `/v1/artifacts` result, design docs 01 and 04.
- Approach: open (how the drain handles the snapshot kind and how the Stop hook finds the working repo are the build's to refine against the code)
- Depends on: 1

### Phase 4 — Delivered means screened and scored

- Outcome: With the live remote and a design written by an agent, `artifact_feedback` returns `delivered` with `screen: pass` or `screen: flagged: ...` and one score line per check within 10 s of the hash arriving. If the admin operations page reports scoring off, the call returns `delivered` with `scoring: off` and the reason; with the hash under 30 s old and no screen yet it returns `scoring: pending` and says to call again. The budget file stored while scoring was off is rescored from the admin page and then returns scores. Any deployment change that turns scoring on is made by the build, and the build records the before and after state without printing keys.
- Surfaces: `artifact_feedback`, the service's screen and score worker and startup log, `/v1/artifacts` and `/v1/baselines`, the admin operations page and its rescore.
- Approach: open (depends on the live scorer state)
- Depends on: nothing

### Phase 5 — Codex calls feedback

- Outcome: In a fresh Codex session (`codex exec`) in a scratch repo with the Yakka plugin enabled, a prompt to write a design file produces an `mcp__yakka__artifact_feedback` call in the transcript whose path resolves to the written file and whose result is `delivered` with the `screen:` and `scoring:` lines. A call with a relative path and the server's cwd set to the plugin root returns the project file's state or the instructed error, never a path under the plugin directory. The MCP `instructions` and tool description carry the instruction sentence, identically in the Go and Python servers, and `CHANGELOG.md` and the hooklog example no longer describe a conflicting Codex route.
- Surfaces: `codex exec` and an interactive Codex session, the Codex plugin manifest and `.codex-mcp.json`, the MCP `instructions` and tool descriptions, `artifact_feedback`.
- Approach: open (depends on open question 1 and ledger 4 and 5)
- Depends on: 1, 4

### Phase 6 — Upload the legacy backlog once

- Outcome: A manifest records the file count (37,931 at recon), total bytes, the expected stored count and the policy-dropped count for `~/.local/share/workflow/queue`. The build uploads a staged copy (the original is not moved or deleted) to the configured remote under the phase 1 contract, tenant of the configured key, and writes a counts-only report outside the queue: files sent, results by status, facts by type (every sent fact is a `hook_event`; zero `artifact_version` and zero `commit`), rejected itemised by reason. The upload is verified when accepted plus duplicate plus rejected equals the manifest's fact count, accepted equals the expected count (or the report explains the difference), and an independent server-side count of the tenant's stored hook events rose by the accepted count minus policy-dropped. Running the same command a second time reports accepted 0, duplicate equal to the first run's accepted plus duplicates, and exits 0. Only after verification may the original queue be archived or deleted, by a separate decision from Cody.
- Surfaces: a `YAKKA_QUEUE`-scoped drain of the staged copy, the remote ingest response, the admin operations page or a read-only store query for the independent count, the report file.
- Approach: open (staging method, a dry-run count and the hook-events-only mode are the build's to settle against the code)
- Depends on: 1, 2, 3

### Phase 7 — Agents act on feedback

- Outcome: In one fresh Claude session and one fresh Codex session, each in a scratch repo and asked to design a small feature, the transcript shows a `delivered` result with `screen:` and `scoring:` lines for the agent's design. It then shows either an edit to the file addressing a named flagged check followed by a second feedback call, or, when the screen is `pass`, a final message that states the pass with the score lines. The flagged line carries the fix instruction ("rewrite the file; the new write is the repair"). The issue's done-when is met by these two transcripts.
- Surfaces: Claude and Codex sessions, the `yakka:design` skill's feedback step, `artifact_feedback`.
- Approach: known
- Depends on: 3, 4, 5

## Provenance Notes

- The dropped-write cause rests on one transcript (`c70d3e4f`, tool names and timestamps only); the budget checkout was not opened. If a second case turns up with a captured write tool and a missing hash, the reconciliation design still covers it, but the root cause would need a fresh look at the drain.
- Rejected: shell-command parsing to find written paths (always incomplete); a direct HTTP push from the MCP shim (skips the scan and dedupe); a repo-wide mtime sweep (unbounded cost for a bounded problem); draining the backlog in place (destructive and not retryable); keeping "no file means local" and warning (the silent default is the failure).
- The cause was reproduced live while writing this design: after this file was last changed by a Bash heredoc and `sed`, `artifact_feedback` returned `stale` (service held an earlier hash) and stayed `stale` after the batch window, until a write-tool edit fired a hook.
- The issue's belief that Codex AGENTS.md already carries the instruction was not borne out by the files inspected; the design does not rely on AGENTS.md.
- The scorer state and the commit author for 52435db are unknown from this run and sit in the ledger with the chosen default. Downstream review challenges the ledger.
