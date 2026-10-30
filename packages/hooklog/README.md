# hooklog

**Consumers** — copies under `plugins/yakka/script/` and the OpenCode plugin queue files.

**Build** — none (bash and Python stdlib).

**Test** — `python3 -m unittest discover -s packages/hooklog/tests`.

**Release** — ships as plugin files.

Local, advisory capture of hook payloads as a session happens. All command hooks exit 0;
OpenCode observers leave inputs and outputs unchanged. Captured events go to a queue directory,
`${YAKKA_QUEUE:-~/.local/share/yakka/queue}`; `plugins/yakka/bin/yakka drain` ships them to the
yakka service. Capture failures never deny or rewrite an action. Cursor receives the
permissive response required by its pre-action schema.

| Harness | Catalog requirement | Registration |
|---------|---------------------|--------------|
| Claude Code | 33 catalog keys; 31 active + 2 integration-only | [`plugins/yakka/hooks/hooks.json`](../../plugins/yakka/hooks/hooks.json), command handlers |
| Cursor | 22 claimed; 21 enumerated | [`plugins/yakka/hooks/cursor.json`](../../plugins/yakka/hooks/cursor.json), selected by `plugins/yakka/.cursor-plugin/plugin.json` |
| OpenCode | 18 Hooks + 28 bus types | [`packages/opencode-yakka-hooks`](../../packages/opencode-yakka-hooks), JS callbacks |
| Codex | 12 events | [`plugins/yakka/hooks/codex.json`](../../plugins/yakka/hooks/codex.json), selected by `plugins/yakka/.codex-plugin/plugin.json` |

The supplied 2026-10-03 catalog's Cursor subtotal says 19 agent hooks but lists 18.
The [official plugin reference](https://cursor.com/docs/reference/plugins#available-hook-events)
also lists those 18, plus 2 Tab hooks and workspaceOpen: **21 distinct names**. Every named
catalog event is registered. The 22nd name needs a catalog correction; it is not fabricated.

## Capture path: queue, then drain

Hooks run `spool.sh` (bash): it writes a small envelope (`ts` = when the hook fired, harness, event)
plus the raw payload to `<queue>/<conversation>-<ts>-<pid>-<rand>.evt` via tmp-then-rename, then
exits. No python, no network, no waiting. Payloads with no conversation id are dropped. Cursor hooks
get their permissive reply (`{"permission":"allow"}` etc.); capture can never block or fail the agent.
The OpenCode plugin writes the same files itself.

After spooling, the plugin `script/spool.sh` starts one detached drain (a lock keeps it to one;
`YAKKA_HOOKLOG_KICK=0` disables it). `YAKKA_BIN` set and executable is that program with `drain`;
otherwise the kick is `python3 plugins/yakka/client/yakka.py drain`. The drain posts the queued files
to the endpoint and deletes them; files the service refuses move to `rejected/`. Endpoint and bearer
follow the same resolution as design 2: both `YAKKA_ENDPOINT` and `YAKKA_KEY` override
`client.toml`; exactly one of them set is a hard error; otherwise the file, else local
`http://127.0.0.1:8770` with no key. While the endpoint is unreachable the files wait. A running
`yakka serve` on the same machine hosts the Go drain itself, behind the same lock. `yakka status` reports the queue
and the mode.

`plugins/yakka/bin/yakka` execs `python3` on `plugins/yakka/client/yakka.py` for `drain`, `mcp`,
`login`, `status`, and `version`. It does not cache, download, or build a client. There is no
SessionStart prefetch. Shipped hooks run `plugins/yakka/script/spool.sh`.

## Setup

There is no install step. For local mode, run the Go collector `yakka serve` from `packages/yakka` however suits the machine (a
terminal, a systemd user unit, launchd). Loopback serve is keyless, binds `127.0.0.1:8770`
(`YAKKA_SERVE_ADDR` may name another loopback address, never a public one), and stores data under
`YAKKA_SERVE_DATA` (default `~/.local/share/yakka/serve`), tenant `local`. To turn on
screening, set `TYPESAFE_API_KEY` in serve's environment; it never goes in a hook config or
`client.toml`.

Remote mode is `client.toml` (mode 0600, `endpoint` and `key`), written by **`yakka login`**, or
the same pair via **`YAKKA_ENDPOINT`** and **`YAKKA_KEY`** when the agent has no file (for
example a cloud worker). `YAKKA_CLIENT_CONFIG` overrides only the file path.

## MCP

The advisory shim is the stdio command `python3 plugins/yakka/client/yakka.py mcp`. Claude Code picks it up from the
repo's [`plugins/yakka/.mcp.json`](../../plugins/yakka/.mcp.json). For Cursor, merge
[`cursor-mcp.example.json`](cursor-mcp.example.json) into `~/.cursor/mcp.json`; for Codex, merge
[`codex-mcp.example.toml`](codex-mcp.example.toml) into `~/.codex/config.toml`. Replace
`/ABS/PATH/yakka` with the checkout path.

## Claude Code

Load the checkout as a plugin (`claude --plugin-dir /absolute/path/yakka`), or use
the marketplace plugin. `hooks/hooks.json` records with `--harness claude` and resolves its
script from `${CLAUDE_PLUGIN_ROOT}` (with `$PLUGIN_ROOT` fallback).

**Worktree integration caveat:** [Claude's WorktreeCreate contract](https://code.claude.com/docs/en/hooks#worktreecreate)
replaces built-in creation and requires a directory path on stdout. WorktreeRemove also
replaces cleanup. A standalone logger cannot observe these two events without taking over
those operations. Both keys therefore have **empty registration arrays** in the shipped config, preserving the
host's built-in worktree behavior. To capture them, call the logger **inside an existing
worktree handler** with its input JSON, preserving that handler's creation/removal and stdout
path contract. Do not add a standalone logger as a replacement worktree handler. For example,
from a handler that already has the payload in `$payload`:

```sh
printf '%s\n' "$payload" | bash "$CLAUDE_PLUGIN_ROOT/packages/hooklog/spool.sh" --harness claude --event WorktreeCreate
# The existing handler then performs its original operation and returns its original output.
```

The logger supports both event names; **automatic capture of these two cannot meet the
observe-only contract** on this host. This is an explicit exception to all-33 active registration.

## Cursor

The plugin manifest selects `./hooks/cursor.json`, so native events are first-class and
Claude-name import mapping is no longer needed. This replaces default `hooks/hooks.json`
discovery for Cursor. Commands resolve `${CURSOR_PLUGIN_ROOT}` and pass the registration's
`--event`, ensuring an allow response even if input is malformed or logging is disabled.

For a standalone user/project install, merge [`cursor-hooks.example.json`](cursor-hooks.example.json)
into `~/.cursor/hooks.json` or `<project>/.cursor/hooks.json`, replacing `/ABS/PATH/yakka`
with the checkout path. Preserve unrelated existing hooks. Use one registration path to avoid
capturing each event twice.

Agent names: sessionStart, sessionEnd, preToolUse, postToolUse, postToolUseFailure,
subagentStart, subagentStop, beforeShellExecution, afterShellExecution, beforeMCPExecution,
afterMCPExecution, beforeReadFile, afterFileEdit, beforeSubmitPrompt, preCompact, stop,
afterAgentResponse, afterAgentThought. Tab: beforeTabFileRead, afterTabFileEdit. App: workspaceOpen.

Cloud agents omit sessionStart/sessionEnd, beforeMCPExecution/afterMCPExecution, both Tab hooks,
and workspaceOpen according to the supplied catalog. Registration cannot create events the
host omits. Headless `agent -p` can also omit beforeSubmitPrompt and stop (observed in the
2.6.0 smoke); interactive coverage needs a host run. workspaceOpen has no session and is dropped by the spooler.

Permission hooks print `{"permission":"allow"}`; beforeSubmitPrompt prints `{"continue":true}`;
other Cursor capture hooks print `{}`.

## OpenCode

Register the package's `src/index.ts` in project/global `opencode.json`; see the
[package README](../../packages/opencode-yakka-hooks/README.md). All 18 capture callbacks are
present, including config, dispose, permission.ask, chat parameters/headers, tool definitions,
shell environment and experimental transforms/compaction/model selection. `event` captures
all 28 catalog bus names, plus future types. Older runtimes may not invoke newer callbacks.

Rows preserve native hook names and `source: hook|bus|derived`. Bus tool/shell events are
observations; dedicated tool callbacks provide completed tool calls. Derived Stop rows retain
the turn marker; PostToolBatch is no longer captured, so turns fall back to the tool-gap heuristic. Nested session/message/part envelopes resolve to the
owning session; callbacks with no session are dropped.

`YAKKA_OPENCODE_SIGNALS=0` disables soft signals independently of hooklog. Writes are ordered
and teardown awaits capture; logger errors are swallowed. Callbacks never change permissions,
arguments, prompts, headers, config, environment, tool definitions or experimental outputs.

## Codex

The plugin registers Codex hooks itself: `plugins/yakka/.codex-plugin/plugin.json` points Codex at
[`plugins/yakka/hooks/codex.json`](../../plugins/yakka/hooks/codex.json), whose commands use `$PLUGIN_ROOT`. Without that
manifest Codex falls back to `hooks/hooks.json` and records every Codex event as `claude`. Do not
also register these hooks in `~/.codex/hooks.json` or `<project>/.codex/hooks.json`: Codex runs
every source, so each event would be captured twice. Plugin hooks need the host's trust review in
`/hooks` before they run, and again whenever the file changes. See
[official OpenAI documentation](https://developers.openai.com/codex/hooks).

All 11 names use `spool.sh --harness codex`: SessionStart, SessionEnd, SubagentStart,
SubagentStop, PermissionRequest, PostToolUse, PreCompact, PostCompact,
UserPromptSubmit, Stop, Interrupt. Codex is **not N/A**. Every Codex timeout is at most 3 s.
Hosted tools such as WebSearch skip PostToolUse, so their absence is a host gap.
Codex capture hooks emit no stdout or control decision.

## Rows and turns

Inspect with `python3 packages/hooklog/hooklog.py ls` and `show <file>`.
The v1 schema keeps `{v, ts, harness, session_id, hook_event, kind, cwd}` and adds bounded,
redacted native payload details in `data`. Existing prompt/tool/step fields remain compatible.
New pre-tool rows use `tool_pre`; lifecycle and unknown named events use `event`. Events with
no name or malformed JSON are ignored. Subagent IDs are preserved as `agent_id`.

`events.load_hooklog` counts one model response per turn:

- Cursor: afterAgentThought (`step`) marks each response; following tools belong to it.
- Claude: logs captured before 3.3.0 carry PostToolBatch (`batch_end`), which closes a tool turn; Stop closes the final reply.
- OpenCode: session.idle derives Stop; step-finish no longer derives PostToolBatch.
- Codex and logs without step/batch markers use the existing 1.5 s tool-gap heuristic.

Lifecycle/pre-tool/bus observations do not advance turns. SessionEnd is a lifecycle observation,
so it cannot repeat Stop's final turn. Specific Cursor shell/MCP/edit observations remain in
JSONL but are ignored by the loader when canonical postToolUse events are present. Tab edits
are excluded from agent turns. Subagent rows are excluded from main-session analysis.

## Tests and smoke notes (2.7.0)

```sh
python3 -m unittest discover -s packages/hooklog/tests -v
python3 -m unittest discover -s tools/jev-variants/tests -v
python3 -m unittest discover -s packages/opencode-yakka-hooks/tests -v
node --experimental-strip-types --test packages/opencode-yakka-hooks/tests/test_hooks.mjs
```

The command smoke executes every active shipped registration against a temporary queue, plus
manual logger payloads for both integration-only worktree names, including all
12 Codex names. OpenCode's callback smoke invokes all 18 keys and 28 bus types, verifies
unchanged permission/args/headers/compaction outputs, nested session IDs, redaction, boundary
markers and unavailable-logger tolerance. These prove adapter behavior, not live host delivery
of every event. Live Claude and Cursor sessions were not run for this change per invoker's
harness restriction. The prior 2.6.0 live turn-count observations remain reference evidence.

An OpenCode 1.18.33 startup smoke loaded the local plugin using `OPENCODE_CONFIG_CONTENT`
and an intentionally unavailable model (no inference). It captured config/dispose, session
created/updated/status/error/idle, chat.message/params/headers/system transform, and nested
message/part events into the expected session file. The host exited 1 for the unavailable
model; this is a plugin-load/error-path smoke, not a successful tool run.
