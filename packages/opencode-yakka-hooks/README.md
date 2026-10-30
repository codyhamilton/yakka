# @codyhamilton/opencode-yakka-hooks

**Consumers** — OpenCode `file://` plugin registration.

**Build** — none (OpenCode loads the TypeScript).

**Test** — `node --test packages/opencode-yakka-hooks/tests/test_hooks.mjs` and `python3 -m unittest discover -s packages/opencode-yakka-hooks/tests`.

**Release** — ships as plugin files (see also `packages/hooklog` for queue capture).

OpenCode plugin that captures **18 named Hooks callbacks + all 28 catalog bus types** into
`~/.local/share/yakka-plugin/hooklog/opencode/<session>.jsonl` and **approximates** Claude
`PostToolBatch` soft signals:

1. Buffer each `tool.execute.after` per session.
2. Flush one batch per model step on `message.updated` or `session.idle`.
3. Spawn `python/batch_flush_cli.py` → shared `gate_thresholds` / `post_tool_batch_signal` → append `${XDG_STATE_HOME:-~/.local/state}/yakka/jev-signal-log.jsonl` (or `YAKKA_JEV_SIGNAL_LOG`).
4. Optional analytics dual-write when `YAKKA_ANALYTICS_URL` is set (`host_kind: opencode` when `YAKKA_INSTALL_MODE=opencode`).

**Advisory only** — never blocks tools or changes exit codes. Does not call `assert_phase --deterministic` or enforce Flash review guidance.

Every hook and bus event except twelve is written as one file in the queue (`YAKKA_QUEUE`), named and wrapped
as `packages/hooklog/spool.sh --harness opencode` does; an event with no session ID is dropped. After a
write the plugin kicks `python3 plugins/yakka/client/yakka.py drain` (detached, at most once per 10 s)
when `YAKKA_BIN` is unset. Capture never waits on the drain or the network, and
failures never reach OpenCode.

Not forwarded: `experimental.chat.system.transform`, `chat.params`, `chat.headers`, `shell.env`,
`message.part.delta`, `message.part.updated`, `message.updated`, `session.status`, `session.updated`,
`session.diff`, `tool.execute.before` and `PostToolBatch` (by event name, so hook and bus forms alike). The first carries redundant prompt
bodies; the next three carry secrets (API keys, auth headers, environment); the rest repeat state
that other events already record (finished text is `experimental.text.complete`, tool calls are
`tool.execute.after`, patches are artifact versions and commits). Their hooks stay registered and
write nothing. `tool.execute.before` only records the call's start: `tool.execute.after` carries it
as `started_at`, and a call still open at `session.idle` is written as `tool.execute.incomplete`
(`incomplete: true`). The list is declared once in `src/index.ts`
between `remove-list` markers, and a test asserts the Go ingest policy carries an equal list.

Threshold constants for documentation: `yakka-signals.json` (source of truth remains `gate_thresholds.py` in the yakka lab).

## Install (yakka checkout)

From a clone of [yakka](https://github.com/codyhamilton/yakka):

```bash
# Skills (separate from this plugin)
./install.sh --opencode-skills
```

Register the plugin in **project** or **global** `opencode.json` (restart OpenCode after edits):

```json
{
  "plugin": [
    "file:///absolute/path/to/yakka/packages/opencode-yakka-hooks/src/index.ts"
  ]
}
```

Relative `file://` from repo root (when OpenCode cwd is the checkout):

```json
{
  "plugin": [
    "file://packages/opencode-yakka-hooks/src/index.ts"
  ]
}
```

See [`opencode.json.example`](opencode.json.example).

### codyh-ubuntu (Coding Harness Manager)

```bash
cd ~/workspace/yakka   # or your clone path
git pull origin master
./install.sh --opencode-skills

# ~/.config/opencode/opencode.json (or project opencode.json)
# Add plugin entry with absolute file:// URL to packages/opencode-yakka-hooks/src/index.ts
```

## Environment

| Variable | Default | Role |
|----------|---------|------|
| `YAKKA_HOOKLOG` | on | Set `off` / `0` / `false` to disable capture |
| `YAKKA_QUEUE` | `~/.local/share/yakka/queue` | Queue directory; one `<session>-<ts>-<pid>-<rand>.evt` file per event, as `packages/hooklog/spool.sh` writes it |
| `YAKKA_BIN` | unset: `python3 plugins/yakka/client/yakka.py drain` | When set and executable, the program the plugin kicks as `drain` after a write |
| `YAKKA_HOOKLOG_KICK` | on | Set `0` to disable the drain kick (at most one per 10 s) |
| `YAKKA_OPENCODE_SIGNALS` | on | Set `0` to disable soft signals (hooklog remains independent) |
| `YAKKA_REPO_ROOT` | auto (package → repo root) | Python gate imports |
| `YAKKA_JEV_SIGNAL_LOG` | `~/.local/state/yakka/jev-signal-log.jsonl` | Signal JSONL path (`$XDG_STATE_HOME/yakka/...` when set) |
| `YAKKA_INSTALL_MODE` | `opencode` (set by plugin spawn) | Analytics `host_kind` |
| `YAKKA_ANALYTICS_URL` | unset | Remote dual-write when set |
| `YAKKA_ANALYTICS_TOKEN` | unset | Bearer token for analytics POST |
| `YAKKA_BATCH_FLUSH_CLI` | package `python/batch_flush_cli.py` | Override flush helper |
| `PYTHON` / `YAKKA_PYTHON` | `python3` | Interpreter for flush |

## Tests

```bash
# Callback/bus smoke, including unchanged permission/args/headers/compaction outputs (Node 22.18+)
node --experimental-strip-types --test packages/opencode-yakka-hooks/tests/test_hooks.mjs

# Package unit tests
python3 -m unittest discover -s packages/opencode-yakka-hooks/tests -v

# Lab proofs (shim to this package)
./docs/lab/RESEARCH/2026-09-30-opencode-hooks-plugin/proofs/run_proofs.sh
```

## npm link (optional)

```bash
cd packages/opencode-yakka-hooks
npm link
# In opencode.json: "@codyhamilton/opencode-yakka-hooks@0.2.0"
```

Publishing to npm is optional; `file://` from the monorepo checkout is the supported path for Coding Harness Manager.

Hooklog keeps native names and `source: hook|bus|derived`; the catch-all `event` callback
also captures future bus types. Session IDs are resolved from nested message/part/session envelopes;
load/teardown and other events without a session use `unknown.jsonl`. Bus tool events remain
observations so they do not duplicate dedicated tool callbacks in turn counting. Existing
The Stop marker remains a derived row; `PostToolBatch` is no longer emitted. Config, prompts, headers, permissions, args,
environment, tool definitions and experimental outputs are observed without mutation.
`dispose` and `experimental.provider.small_model` may be absent in older plugin runtimes.
