# Plan 27 — Consolidate the yakka client

Yakka-Plan: docs/plans/27-yakka-client-consolidation/

## Intent

User request, verbatim (headless design brief, with Cody's relayed request and two dated quotes):

> Headless design for the yakka repo (codyhamilton/yakka) Plan 27: consolidate the yakka client. Worktree: ~/workspace/yakka-wt/27-yakka-client-consolidation, branch design/27-yakka-client-consolidation, based on origin/master. There's no next branch, so land into master. Read any CLAUDE.md, AGENTS.md or contributing docs and follow their landing rules. Use the workflow `design` skill headless: keep an assumption ledger and include no human sign-off step. Recon, exploration and inventory subagents use model: haiku. Use a Sonnet subagent only for adversarial review. Write docs/plans/27-yakka-client-consolidation/DESIGN.md.
>
> Cody's request (relayed): today the plugin ships client code split across scripts. plugins/yakka/client/yakka.py is about 3,800 lines and covers drain, mcp shim, login, status and hook spooling. There may be a second script acting as the MCP server; find every client entry point, for example tools/driver/mcp_server.py and packages/opencode-yakka-hooks/python/*, and settle which of them are the yakka client and which aren't. He wants:
> - One client entry point with subcommands covering everything the client scripts do. Where it's invoked (Cody, 16 Nov 12:01 AM AEST): `yakka` goes on PATH only in Cursor cloud, where scripts/cloud-install.sh installs it in user mode (a thin bash wrapper or shim is fine). Local installs and the Claude and Codex plugins keep referencing it the way they do now, by plugin-relative path from hooks.json and the MCP configs. Don't add any other PATH install locally. Claude Code (v2.1.91+) puts an enabled plugin's `bin/` folder on its Bash tool's PATH. See https://code.claude.com/docs/en/plugins/manifest-reference, which says executables there run as bare commands; it needs the executable bit, and claude.ai or Cowork won't install a plugin that has `bin/`. Cody wants the entry point to live in plugins/yakka/bin/yakka. Note that plugins/yakka/bin/ already holds a `yakka` file plus VERSION, RELEASE_URL and SHA256SUMS. Find out what that existing file is and reconcile it with the new entry point. Claude agents then get bare `yakka`, and hooks and MCP configs reference that same file by plugin path. Check whether Codex, Cursor or OpenCode have an equivalent, and record the answer either way. Cloud-install.sh's shim points at the same bin/yakka.
> - The implementation split into focused library modules, each unit tested. The existing test_*.py files move or split with them.
> - Lazy loading, so each subcommand imports only what it needs. Hooks fire on every event, so the hook path must stay fast. Measure startup and hook latency before and after, and make the target a provable phase outcome.
> - Every caller points at the one entry point: the Claude, Cursor, Codex and OpenCode plugin manifests (plugins/yakka/.claude-plugin, .cursor-plugin, .codex-plugin), hooks/hooks.json, mcp.json, claude-mcp.json, .codex-mcp.json, the OpenCode hooks package, and scripts/cloud-install.sh with its PATH shim. That script is now a full user-level install for Cursor cloud agents after PR #243 merged; build on it.
> - NO backward compatibility (Cody, 16 Nov 12:01 AM AEST: "No need for backward compat on the yakka refactor, since an update also updates the callers"). Don't keep old script paths or shims. Every caller switches in the same release. Version-bump the plugin as the repo does.
>
> Wider-context rule: inventory every place that invokes the client, including docs, skills that call `yakka ...` or the script path, tests, CI and install scripts. State which are covered, and give a reason for each one excluded. Each phase closes on a provable outcome: unit tests per module, a hook-latency measurement, and an end-to-end check that each harness's hooks and MCP config resolve to the single entry point, by plugin path locally and by `yakka` on PATH in a cloud install.
>
> Commit the design (docs only) and push it. Open a PR into master titled "docs: Plan 27 — yakka client consolidation" and mark it ready for review, not draft. Write ~/workspace/yakka-design-logs/27-client/done.md giving the PR number, the phases and the open questions.
>
> Layout (Cody, 16 Nov 12:16 AM AEST, verbatim): "in `bin` we will have the bash script wrapper, while `scripts/` has the python entry points and libraries for the merged mcp/drain. Possibly simple and clean to have `mcp.py` and `drain.py` under commands/, with the bash script using the first arg to route to the right command handler. then `libs/` can have all the functional code/shared libs. so commands orchestrate, libs functional (for the python)"
> That gives this shape: plugins/yakka/bin/yakka is the bash wrapper and routes on its first argument. plugins/yakka/scripts/commands/ holds one orchestrating handler per subcommand (mcp.py, drain.py, login, status, hook spooling and so on); handlers orchestrate only. plugins/yakka/scripts/libs/ holds the functional code and shared libraries, unit tested. The wrapper's routing is what gives lazy loading: each command imports only the libs it needs. Settle where the existing hook scripts (for example plugins/yakka/script/spool.sh) and the current contents of bin/ go. Treat this layout as given, and record any deviation as an assumption with its reason.

## Problem

The client is three things that grew separately: a 3,775-line Python file (`plugins/yakka/client/yakka.py`: drain, MCP shim, login, status, version, plus capture, facts, keys and secrets code), a bash hook capture script (`plugins/yakka/script/spool.sh`), and a bash dispatcher (`plugins/yakka/bin/yakka`) that forwards to the Python file. Callers reach them by four different spellings: `python3 <root>/client/yakka.py mcp` (three MCP configs, cloud-install's `~/.cursor/mcp.json`), `<root>/script/spool.sh` (three hook configs, the MCP shim, cloud-install's hooks), `bin/yakka <cmd>` (the OpenCode package, the hooklog spool, the PATH shim) and bare `yakka login`/`yakka status` (the login skill). Five measured costs and hazards follow:

- Every Python invocation recompiles the whole 143 KB file (`__main__` is never bytecode-cached, ~31 ms) and imports every stdlib module any subcommand needs (~60 ms: `http.client`/`ssl`, `concurrent.futures`/`logging`/`traceback`, `argparse`, `dataclasses`/`inspect`). `yakka version` costs 147 ms against a 15 ms interpreter floor. `_user_agent()` reads a file at import time.
- The hook path is bash and cheap (25 ms), except that with the default dedupe window it spawns `python3` to read a file mtime, costing 44 ms on every repeated event. Hooks fire on every tool call.
- `plugins/yakka/bin/` holds an unrelated release leftover: `VERSION` (`0.3.0`, the retired Go collector's version, yet the Python client reads it for `yakka version` and the User-Agent, so it reports `0.3.0` while the plugin is `3.4.12`), `RELEASE_URL` (no reader), `SHA256SUMS` (written by `tools/release/build.sh`, verified by one test). Nothing downloads anything.
- `.cursor/environment.json` exports `YAKKA_BIN` pointing at the wrapper itself, and the wrapper execs `$YAKKA_BIN` when set; `YAKKA_BIN` was the dev override for the Go binary. Likely a self-exec loop (inferred from the code, not run).
- Two non-identical `spool.sh` copies exist (`plugins/yakka/script/` and `packages/hooklog/`), and the OpenCode plugin re-implements spooling in TypeScript without dedupe.

Cody wants one entry point, `plugins/yakka/bin/yakka`, with focused libraries behind it, loaded lazily, and every caller switched in one release with no compatibility layer.

## Solution Shape

After this change the whole client is `plugins/yakka/bin/yakka <command> [args]`: a bash wrapper that routes on its first argument and does nothing else. `spool` (hook capture) stays pure bash and never starts Python. `drain`, `mcp`, `login`, `status` and `version` each `exec python3 scripts/commands/<name>.py`, a thin orchestrating handler that imports only the `scripts/libs/` modules it needs. `scripts/libs/` holds all functional code as small modules with a one-way dependency direction and no import-time I/O, each with a unit test module. `client/yakka.py`, `script/`, and the release leftovers in `bin/` are gone. Every caller (three hook configs, three MCP configs, manifests, the cloud installer and its shim, the OpenCode package, the hooklog package, skills, docs) references that single file: by plugin path locally, by bare `yakka` on PATH in a Cursor cloud install, and by bare `yakka` for Claude agents through Claude Code's plugin `bin/` PATH support. Startup and hook latency are measured by a committed harness before and after, and the targets are phase outcomes.

```
plugins/yakka/
  bin/yakka                      bash router (only file in bin/)
  scripts/
    commands/
      spool.sh                   hook capture (bash, no Python)
      drain.py mcp.py login.py status.py version.py     orchestrate only
    libs/                        functional code, one-way deps, lazy per command
    tests/{libs,commands}/       one test module per lib; command tests
  hooks/{hooks,cursor,codex}.json   -> bin/yakka spool ...
  mcp.json  claude-mcp.json  .codex-mcp.json   -> bin/yakka mcp
```

### Domain: Entry point (`plugins/yakka/bin/yakka`)

- Owns: the routing table from first argument to handler; the usage text; plugin-root discovery (from its own path, no `YAKKA_ROOT`); the rule that `spool` never starts Python.
- Contract:
  - `yakka spool [--harness H] [--event E]` → `exec bash scripts/commands/spool.sh "$@"`. Hook payload on stdin; always exit 0; same queue-file format and kick semantics as today's `spool.sh`; no Python process on any path including dedupe.
  - `yakka drain|mcp|login|status|version [args]` → `exec python3 scripts/commands/<name>.py "$@"`. `--version` is accepted as `version`. Exit codes as today (0 ok, 1 runtime error, 2 usage).
  - Any other first argument, or none: usage on stderr, exit 2. No `serve`, no `ledger` (Go-only, never reachable), no `YAKKA_BIN` override.
  - Plugin root is derived from `$0` with bash builtins only (no `dirname`/`cd` subshell on the spool path), including the no-slash case (`cd bin && bash yakka …` gives `$0=yakka`); the file works when invoked directly, via `bash <path>`, or exec'd by a shim; bash 3.2 compatible; executable bit set in git. Its comments must not mention `tools/` or `.claude/` (`tools/release/test_layout.py` scans executed plugin files for them).
  - Until a command's handler exists (phases 1–2), the router sends that command to `client/yakka.py`; the table above is the end state.
  - The usage line (pinned by `tools/release/test_release.py`) is updated to the new command list.
- Non-goals: argument parsing beyond the first argument; any logic; any dependency on the Go binary.

### Domain: Commands (`plugins/yakka/scripts/commands/`)

- Owns: argv parsing, env/config resolution by calling libs, calling libs in order, printing, exit codes. One file per subcommand: `spool.sh`, `drain.py`, `mcp.py`, `login.py`, `status.py`, `version.py`.
- Contract: each Python handler exposes `main(argv: list[str]) -> int` and ends with `if __name__ == "__main__": sys.exit(main(sys.argv[1:]))`. A handler makes its `scripts/` directory importable (a single `sys.path` insertion, first thing) and imports libs inside `main` or at its own top, never any module outside its declared closure. A handler holds no domain logic: anything with a branch worth a unit test lives in a lib. Handlers never import each other.
- Contract (closures, upper bounds that a test asserts against `sys.modules`; module names are indicative and settled by `refine`): `version` imports no network or archive libs and no `ssl`/`http.client`; `status` imports config, http, queue and none of capture/facts/secrets/keys/login/mcp; `login` imports config, http, login and none of queue/drain/capture/facts/keys/secrets/mcp; `drain` imports config, http, queue, drain, facts, keys, secrets and not capture/mcp/login; `mcp` imports config, http, queue, capture, secrets (capture needs it), facts, keys and its mcp modules and not login/drain-runner. Only `scripts/` is put on `sys.path` (never `scripts/libs/` itself), so lib names such as `http`, `queue` and `secrets` stay namespaced (`libs.http`) and cannot shadow stdlib modules; `scripts/tests` carries the `__init__.py` files that discovery with `-t plugins/yakka/scripts` needs.
- Non-goals: shared helper accumulation in `commands/` (a helper used by two handlers is a lib).

### Domain: Libs (`plugins/yakka/scripts/libs/`)

- Owns: all functional behaviour of the client, moved from `yakka.py` without behavioural change.
- Contract:
  - Indicative module map from the section structure of `yakka.py` (`refine` settles names and exact membership): `config` (clientconfig: Config, Load, LoadMCP, Path, SyncPath), `http` (bearer header, request base, endpoint checks, redirect-refusing opener, lazy User-Agent), `keys`, `secrets`, `facts`, `capture`, `queue` (QueueDir, locks, Running, QueueStatus), `drain` (sinks, runner), `mcp_*` (protocol, relay, readers, enqueue), `login` (device flow), `version`/`paths` (plugin root and version from the manifest).
  - Dependency rules: libs never import `commands`; imports form a DAG (the current `clientconfig` ⇄ `http` cycle through `_request_base`/`ConfigSink` is broken by moving the base helpers into the lower layer and `ConfigSink` into drain); no module does file, env, network or process work at import time (`_user_agent()` becomes lazy); heavy stdlib imports (`http.client`, `concurrent.futures`, `argparse`, `calendar`, `subprocess`, `dataclasses` where avoidable) are imported by the libs that use them, not by shared code.
  - Plugin root is a single lib function; no lib computes `__file__/../..` itself. The MCP enqueue path runs `bash <root>/bin/yakka spool` (no dependence on the executable bit), not a script path. The `yakka_bin_set` failure code and its guard are removed with `YAKKA_BIN`.
  - `yakka version` reports the plugin version read from `.claude-plugin/plugin.json` (the three manifests are asserted equal by a layout test), and the User-Agent uses the same value.
  - Every `libs/<name>.py` has `tests/libs/test_<name>.py`, enforced by a test that enumerates `libs/`.
- Non-goals: behaviour change; consolidating the duplicated endpoint/repo-identity/git-wrapper logic (recorded as follow-ups); Windows support (`fcntl` stays POSIX-only, but now imported only by commands that need it); the Go binary.

### Domain: Hook path (spool)

- Owns: capture of hook payloads into the queue; dedupe; detached drain kick.
- Contract: `bin/yakka spool` is the only hook entry in every harness config. Same queue-file contract (envelope line, raw payload, `<id>-<ts>-<pid>-<rand>.evt`, `tmp/` then rename), same env switches (`YAKKA_QUEUE`, `YAKKA_HOOKLOG`, `YAKKA_HOOKLOG_KICK`, `YAKKA_SPOOL_DEDUPE_SECS`, `YAKKA_SPOOL_PRINT`, `YAKKA_SPOOL_NOFLOCK`) and the same Cursor stdout replies. Dedupe freshness is computed with `date +%s` and `stat` (GNU `stat -c %Y` first, then BSD `stat -f %m`; the form is probed, not assumed, because Homebrew coreutils changes `stat -f` on macOS), never `python3`; the payload digest falls back to `cksum` where no sha tool exists, never `python3`. The kick starts `bash <root>/bin/yakka drain` detached (same one-drain-at-a-time locking); `YAKKA_BIN` is not read. An optional `YAKKA_SPOOL_TS` (decimal seconds) overrides the envelope and file-name timestamp, so a caller that must keep `ts` strictly increasing across concurrent spawns (OpenCode) can supply its own; hooks never set it.
- Non-goals: moving parsing into Python; any new network call on the hook path.

### Domain: Callers and wiring

- Owns: every file that names the client. Detailed inventory below.
- Contract (per harness; resolution = what the harness runs):
  - Claude hooks: `bash "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/bin/yakka" spool --harness claude --event <E>`. Claude MCP: `{"command":"bash","args":["${CLAUDE_PLUGIN_ROOT}/bin/yakka","mcp"]}`. Claude agents' Bash tool: bare `yakka` (Claude Code ≥ 2.1.91, `bin/` on PATH).
  - Codex hooks: `bash "${PLUGIN_ROOT}/bin/yakka" spool --harness codex --event <E>`. Codex MCP keeps today's relative form: `{"command":"bash","args":["./bin/yakka","mcp"],"cwd":"."}`.
  - Cursor hooks: `./bin/yakka spool --harness cursor --event <E>` (relative, as `./script/spool.sh` is today; `tools/release/test_layout.py` rule updated from the `./script/` prefix to `./bin/yakka `). Cursor MCP: `{"command":"bash","args":["${CURSOR_PLUGIN_ROOT}/bin/yakka","mcp"]}`, still no `cwd` or `env` block.
  - Cursor cloud (`scripts/cloud-install.sh`): installs the whole plugin tree under `~/.local/share/yakka/install`, and a shim `~/.local/bin/yakka` that is `exec bash "<install>/bin/yakka" "$@"` and nothing else (no `YAKKA_ROOT`, no `YAKKA_BIN`). The merged `~/.cursor/mcp.json` entry is `{"command":"yakka","args":["mcp"]}` and `~/.cursor/hooks.json` entries are `yakka spool --harness cursor --event <E>`. The installer purges legacy and current yakka hook entries (old absolute `script/spool.sh` form and the new `yakka spool` form) before merging, so a re-run over a previously installed environment leaves no dead entries, and its `verify_install` executes the entries it wrote. `yakka` is installed on PATH nowhere else.
  - OpenCode: the TypeScript plugin keeps its event filter (`REMOVE_EVENTS`) and its strictly increasing timestamp clock, then spawns `bash <repoRoot>/plugins/yakka/bin/yakka spool --harness opencode` (payload on stdin, `YAKKA_SPOOL_TS` set; fire-and-forget) for capture and `... drain` for the kick; it no longer writes queue files, names `client/yakka.py` or reads `YAKKA_BIN`. Its tests observe the spawn through a seam that is not `YAKKA_BIN` (for example a PATH-stub `bash`).
  - Skills: the `login` skill keeps bare `yakka …` and states the fallback `<skill base dir>/../../bin/yakka …` for harnesses without plugin `bin/` on PATH.
- Non-goals: any local PATH install; changing the Go server; changing server-side behaviour.

### Domain: Measurement (`tools/release/bench_client.py`, maintainer-side)

- Owns: the latency harness and its recorded results.
- Contract: `bench_client.py --plugin-root <dir> --layout old|new [--runs N]` runs each scenario in an isolated `HOME`/`YAKKA_QUEUE` with no endpoint or key, `N=30` by default, and prints min/median/p95 ms per scenario as a table and as JSON. Scenarios: `hook` (spool with default dedupe on, repeated identical payload, kick disabled), `hook-nodedupe`, `hook-kick-stub`, `version`, `status` (endpoint pointed at a closed loopback port), `drain` (empty queue), `login --help`, `mcp` (stdin EOF), and floor references (`python3 -c pass`, `bash -c :`). `--layout old` resolves the pre-change entry points (`python3 client/yakka.py`, `script/spool.sh`) so the same harness measures before and after; the "before" run is taken from a checkout of `5c92cd7`. A second mode runs the hook scenario through the cloud shim (`yakka spool`) to price the extra hop.
- Non-goals: CI integration (the repo has none); statistical significance testing beyond median/p95 over N runs on the same machine in the same session.

### Baseline (measured before this design, Linux, 12 cores, Python 3.14.4, bash 5.3, N=30, ms)

| Scenario | min | median | p95 |
|---|---|---|---|
| hook: spool.sh, dedupe off, kick off | 23.0 | 25.2 | 27.5 |
| hook: spool.sh, default dedupe on, kick off (repeat payload; spawns python3) | 30.6 | 43.9 | 47.6 |
| hook: dedupe off, kick → stub drain | 23.5 | 25.2 | 25.8 |
| hook: dedupe off, kick → real python drain (detached) | 24.3 | 26.6 | 35.2 |
| `python3 client/yakka.py version` | 139.7 | 146.8 | 159.0 |
| `... login --help` | 140.3 | 145.3 | 158.1 |
| `... mcp` (stdin EOF) | 139.3 | 146.2 | 153.7 |
| `bash bin/yakka version` | 144.0 | 152.3 | 197.7 |
| floor: `python3 -c pass` / `-S -E` / `bash -c :` | 14.7 / 8.6 / 1.3 | 15.5 / 9.1 / 1.35 | 17.0 / 10.3 / 1.5 |

Decomposition of a ~147 ms invocation: ~15 ms interpreter, ~31 ms compiling `yakka.py`, ~60 ms stdlib imports, ~30 ms module bodies (by subtraction). `status` and `drain` were not measured (status reaches the default endpoint; drain creates queue dirs); the harness measures them in phase 1.
Baseline test suite (`unittest discover` in `plugins/yakka/client`, at `5c92cd7`): 151 tests run (128 distinct: `test_mcp.py` re-exports `test_mcp_shim` and doubles its 23), 3 errors (no `go` toolchain on this machine: the Go parity and bridge tests), 1 skipped; `script/test_kick.py` 6 tests OK.

## Which scripts are the yakka client

| Script | Verdict | Reason |
|---|---|---|
| `plugins/yakka/client/yakka.py` | **client** (dissolved into commands + libs) | The only Python client: drain, MCP shim, login, status, version. |
| `plugins/yakka/script/spool.sh` | **client** (becomes `commands/spool.sh`) | Hook capture and drain kick; the MCP shim also shells out to it. |
| `plugins/yakka/bin/yakka` | **client entry point** (rewritten) | Today a dispatcher to `yakka.py` and `$YAKKA_BIN`; becomes the router. |
| `scripts/cloud-install.sh` shim `~/.local/bin/yakka` | **client wiring** | A second dispatcher by construction; reduced to an exec of `bin/yakka`. |
| `packages/opencode-yakka-hooks/src/index.ts` | **client caller** | Re-implements spooling (`recordHooklog`) and picks drain targets; switched to `bin/yakka spool|drain`. |
| `packages/hooklog/spool.sh` | **duplicate client script, deleted** | Diverged copy of the plugin's `spool.sh` (kicks the wrapper, lacks `YAKKA_SPOOL_PRINT`); tests repointed at `bin/yakka spool`; `hooklog.py record` deleted. |
| `packages/hooklog/hooklog.py` | **not the client** | Normalisation/scrub/archive reader library and CLI; no drain, MCP or login. Stays, minus its `record` subcommand, which is a self-described "compatibility shim for older registrations" that execs `spool.sh`: deleted with its tests (no compat shims). |
| `packages/opencode-yakka-hooks/python/*` | **not the client** | `batch_aggregator.py`/`batch_flush_cli.py` flush PostToolBatch soft signals to a lab JSONL; no queue, drain, scrub or facts logic. |
| `tools/driver/mcp_server.py` | **not the client** | The phase driver's stdio status/trigger server, unrelated to the yakka server shim; shares only JSON-RPC framing. |
| `tools/quality/*` (`server.py`, `artifact_submit.py`, `backfill_hooklog.py`) | **not the client** | Legacy workflow-quality service. `artifact_submit.py` copies the write-tool/patch-regex logic from `yakka.py` (follow-up, not here). |
| `packages/yakka/cmd/yakka` (Go) | **not the client** | Server-only per issue #178 (open: delete the Go client code); its client subcommands are slated for removal there, and the plugin no longer reaches it (`YAKKA_BIN` removed here). |

## Architectural Implications

- `docs/design/05-distribution.md` is the normative spec for the wrapper, layout and per-harness table; it must be rewritten for the new layout and the `bin/` reconciliation (it also wrongly says `bin/VERSION` is unused). `docs/design/02-edge-capture.md`, `03-remote-service.md` (client CLI table), `04-advisory-surface.md`, `08-server-mcp-contract.md` (spool entry, `YAKKA_BIN`) and `docs/ARCHITECTURE.md` (component map omits `client/`) name the old paths.
- The stable docs do not yet reflect: the Go client's retirement (issue #178), the cloud user-level install (PRs #243/#244), or the removal of `YAKKA_BIN` as a plugin surface. The design widens scope to those documents only where they name the client.
- Claude Code's `bin/` PATH support is documented only for the Bash tool; hooks and MCP servers do not get `bin/` on PATH, so they reference the file by plugin path. A plugin with a top-level `bin/` is not installable through claude.ai or Cowork; `plugins/yakka/bin/yakka` already exists, so this plan introduces no new restriction, but it entrenches one (Open Question 1).
- Harness answers (no `bin/` on PATH found for any non-Claude harness):

| Harness | Plugin `bin/` on PATH | Plugin root for hooks | Plugin root for MCP | Evidence | Confidence |
|---|---|---|---|---|---|
| Claude Code | **Yes**, Bash tool (and PowerShell outside the sandbox), v2.1.91+, appended after user PATH; needs `chmod +x` | `${CLAUDE_PLUGIN_ROOT}` | `${CLAUDE_PLUGIN_ROOT}` in command/args/env | code.claude.com/docs/en/plugins/manifest-reference, `/plugins/components` (Executables), `/whats-new/2026-w14` | High; docs silent on hooks/MCP getting `bin/` |
| Codex | Not found | `PLUGIN_ROOT`, `PLUGIN_DATA` (also `CLAUDE_PLUGIN_ROOT` for compat) | Not documented; repo uses relative path + `cwd` | developers.openai.com/plugins/build/plugins.md | Medium |
| Cursor | Not found (local or cloud); cloud agents reset `$PATH` at environment start per Cursor forum staff | Repo uses relative `./…` (docs unclear; forum says cwd is inconsistent) | `${CURSOR_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_ROOT}` expand; `${PLUGIN_ROOT}` does not | cursor.com/docs/reference/plugins; forum.cursor.com thread 158563 | High (MCP), Low (hooks, cloud PATH) |
| OpenCode | Not found | Not found (repo derives root from the package's own location) | n/a | opencode.ai/docs/plugins (a third-party mention of a `shell.env` hook is unverified) | Medium (absence) |

- Sequencing: the hook-path phase flips all hook configs first because it carries the latency risk and is independent of the Python split; the MCP configs flip in the phase that deletes `client/yakka.py`, because they cannot outlive it.
- Ownership change: spooling stops having a second implementation (hooklog copy deleted, OpenCode in-process writer deleted); the Python client has one home; the `bin/` directory contains only the entry point; collector release metadata (`VERSION`, `RELEASE_URL`, `SHA256SUMS`) moves to `tools/release/` with the Go build that owns it.
- The repo has no CI, lint, CONTRIBUTING or release doc, and master's ruleset requires one approving review and linear history with no required status checks. "Landing rules" therefore reduce to: plan folder + PR body marker `Yakka-Plan: docs/plans/27-yakka-client-consolidation/` as first line; version bump in the same change as a plugin change (`05-distribution.md`); close-out after merge on the default branch; nothing here merges. Every phase's checks are therefore committed, runnable commands rather than CI jobs.

## Wider-context inventory

Every place that names or invokes the client, with the decision. "Covered" means a phase changes it; the phase number is in brackets.

| Place | Reference | Decision |
|---|---|---|
| `plugins/yakka/hooks/hooks.json` (29), `codex.json` (11), `cursor.json` (21) | `script/spool.sh` | Covered [1] |
| `plugins/yakka/claude-mcp.json`, `mcp.json`, `.codex-mcp.json` | `client/yakka.py mcp` | Covered [3] |
| `plugins/yakka/.claude-plugin`, `.cursor-plugin`, `.codex-plugin` `plugin.json` | point at the MCP/hook files by name; carry the version | Covered [4]: version bump only; file names unchanged, so no path edits |
| `.claude-plugin/marketplace.json`, `.cursor-plugin/marketplace.json` | `source`/`path: plugins/yakka` | Excluded: plugin root does not move; no version field |
| `plugins/yakka/bin/yakka` | dispatcher | Covered [1] |
| `plugins/yakka/bin/{VERSION,RELEASE_URL,SHA256SUMS}` | Go collector release metadata | Covered [1]: move to `tools/release/` |
| `plugins/yakka/client/yakka.py` and `client/test_*.py` (12 files) | the client and its tests | Covered [2][3]: split into libs/commands, tests move |
| `plugins/yakka/script/spool.sh`, `test_kick.py` | hook capture | Covered [1] |
| `plugins/yakka/skills/login/SKILL.md` | bare `yakka login/status` | Covered [4]: add path fallback |
| other `plugins/yakka/skills/*`, `.claude/skills/*` | no client invocation (design/refine call the `artifact_feedback` MCP tool by name) | Excluded: tool name is server-defined; path-independent. `.claude/skills/jev-variants/SKILL.md:79` names `hooks/hooks.json` without the `plugins/yakka/` prefix: pre-existing, unrelated |
| `scripts/cloud-install.sh` (shim, `cp -a`, chmod list, MCP merge, hooks merge, `verify_install`) | all four spellings | Covered [1] (spool path, chmod, hook rewrite, verify) [3] (client path in MCP merge and verify) [4] (bare-`yakka` entries, shim reduction, legacy purge) |
| `.cursor/environment.json`, `tools/cloud-env/README.md`, `environment.json.example` | exports `YAKKA_BIN`; documents install paths | Covered [4] |
| `install.sh` (spool and hooks checks at 370-379) | `script/spool.sh` | Covered [1] (path check) |
| `packages/opencode-yakka-hooks` (`src/index.ts`, README, `opencode.json.example`, `tests/test_hooks.mjs`) | `client/yakka.py`, `bin/yakka`, in-process spooling, `YAKKA_BIN` | Covered [4]; package version bumped (independent versioning) |
| `packages/opencode-yakka-hooks/python/*` | not a client | Excluded: see client table |
| `packages/hooklog/spool.sh` | duplicate | Covered [1]: deleted |
| `packages/hooklog/hooklog.py` (`record` subcommand), README, `cursor-hooks.example.json`, `cursor-mcp.example.json`, `codex-mcp.example.toml`, `tests/*` (`test_surfaces.py` also has `is_prefetch` matching `bin/yakka` and a hard-coded `script/spool.sh`) | spool/client paths | Covered [1][3][4] by surface; `record` deleted [1] |
| `packages/yakka` Go: `cmd/yakka/{drain_test,capture_test,advisory_outcome_test}.go` and `spool_testhelper_test.go` run `packages/hooklog/spool.sh` and set `YAKKA_BIN` (a Go-drain wrapper, or `/bin/true` to suppress a kick); `mcp_feedback.go` + golden file say "plugin's bin/yakka drain"; `login_test.go` asserts `plugins/yakka/bin/yakka` | spool and `YAKKA_BIN` | Covered [1], mechanically: tests that only need a spooled file use the existing `writeSpool` helper with `YAKKA_HOOKLOG_KICK=0` (replacing `YAKKA_BIN=/bin/true`); tests that exist to run the Go drain through the spool kick are the Go client's and are deleted by #178, not repointed. User-facing strings excluded: `bin/yakka drain` stays valid |
| `tools/release/test_release.py`, `test_layout.py`, `scan_residual_names.py`, `phase5_outcome.py`, `build.sh` | wrapper, `./script/` rule, `bin/VERSION`, `bin/SHA256SUMS` | Covered [1][3][4]; `phase5_outcome.py` is stale (names tests that do not exist): update or retire the paths it pops (`YAKKA_BIN`) |
| `tools/shadow-review-trial/manifest.py` | `sys.path` + `import yakka` (`CaptureChange`, `CaptureError`) | Covered [3] |
| `tools/driver/tests/test_install_route.py` (asserts `script/spool.sh` exists and appears in `hooks.json`/`codex.json`) | old spool path | Covered [1] |
| `tools/driver/*` otherwise (including `mcp_server.py`) | unrelated driver | Excluded: not the client; no other reference to client paths |
| `tools/quality/*`, `tools/jev-variants/*` (use `hooklog.scrub`) | legacy service / lab | Excluded: not clients; `hooklog.py` stays where it is |
| `.dockerignore` (`bin/SHA256SUMS` pattern) | the moved file | Covered [1] |
| `Dockerfile`, `fly.toml`, `packages/yakka-analytics` (`YAKKA_BIN` there is the Go release binary, a name collision) | server build | Excluded: no client reference (the Dockerfile installs a Go `yakka` into the server image only, never onto agent machines) |
| `docs/design/{02,03,04,05,08}` (08 names `yakka_bin_set` at lines 468, 522, 552), `docs/ARCHITECTURE.md`, `README.md`, `packages/*/README.md`, `CHANGELOG.md` | paths and CLI description | Covered [4]; `CHANGELOG.md` gets a new entry, history is not rewritten |
| `docs/plans/**`, `docs/lab/**`, `docs/analysis/**`, `evals/` | historical records / research / no references | Excluded: records of past decisions are not rewritten; the plan record for this change is its close-out |
| CI | none exists (`.github` absent in every commit; only Cloudflare/Fly deploy integrations) | Excluded: nothing to change; this plan adds no CI (non-goal) |

## Decisions

Scope-shaping decisions are in the Assumption Ledger (headless; no human answered).

## Assumption Ledger

### Assumption 1
- Question: Which scripts are "the yakka client"?
- Answer chosen: `yakka.py`, `spool.sh` and `bin/yakka` (plus the cloud shim and OpenCode TS plugin as callers). Not the client: `tools/driver/mcp_server.py`, `packages/opencode-yakka-hooks/python/*`, `packages/hooklog/hooklog.py`, `tools/quality/*`, the Go binary. `packages/hooklog/spool.sh` is a duplicate client script and is deleted.
- Rationale: by behaviour read in the code (see the client table). The Go client is already slated for deletion (issue #178, "the Python client is the only client").
- If wrong: if the Go client survives, a second entry point remains; phase 4 would have to add it to the router or keep it off the plugin surface (it is already off).

### Assumption 2
- Question: Is `YAKKA_BIN` (override to exec a Go binary) kept?
- Answer chosen: removed from `bin/yakka`, `spool.sh`, the MCP shim (so the `yakka_bin_set` failure code and its documentation go too), the OpenCode plugin, the Go tests' spool seam and `.cursor/environment.json`.
- Rationale: one entry point means no override to a different client; the Go client is going away (#178); the override is the cause of the probable self-exec loop. Cody: no backward compatibility.
- If wrong: add one explicit test seam (e.g. `YAKKA_DRAIN_CMD`) for the spool kick; tests that currently stub `YAKKA_BIN` (`test_kick.py`, `test_hooks.mjs`, hooklog tests) use it instead.

### Assumption 3
- Question: What happens to `bin/VERSION`, `RELEASE_URL`, `SHA256SUMS`?
- Answer chosen: they are Go collector release metadata (plan 09; no code downloads anything; `RELEASE_URL` has no reader; `VERSION` is read only by `build.sh`, one test, and — wrongly — the Python client's `version`/User-Agent). They move to `tools/release/` with `build.sh` (`SUMS_FILE` and `VERSION` paths updated); `bin/` holds only `yakka`. `yakka version` and the User-Agent use the plugin manifest version.
- Rationale: `bin/` is on the agent's PATH in Claude Code; only executables belong there. Moving the files, not deleting, keeps the Go release build intact (decision on whether server binaries ship is #178's).
- If wrong: if collector binaries should no longer be built at all, delete the three files and `build.sh`'s sums step instead of moving them.

### Assumption 4
- Question: Layout deviations from the given shape.
- Answer chosen: (a) `script/` (singular) is removed; its contents go to `scripts/commands/spool.sh` and the tests move under `scripts/tests/`. (b) `spool` is a bash handler (`commands/spool.sh`), not Python, so the hook path never starts an interpreter. (c) The Python package under `scripts/` is named `libs`, handlers add `scripts/` to `sys.path`. (d) Tests live in `scripts/tests/{libs,commands}/`, mirroring the tree. (e) `version.py` is a handler like the others.
- Rationale: (a) the given layout uses `scripts/`; two sibling dirs would be confusing. (b) measured: 25 ms bash versus ≥ 15 ms interpreter floor plus imports. (c)/(d) keep to Cody's names; imported (non-`__main__`) modules get `__pycache__`, removing the 31 ms compile.
- If wrong: (d) tests can sit beside modules with no other change. (c) renaming the package is mechanical.

### Assumption 5
- Question: Does the hook path route through the wrapper, and how is dedupe made Python-free?
- Answer chosen: hooks call `bin/yakka spool`; the wrapper derives its root with builtins and `exec`s `bash commands/spool.sh`; dedupe freshness uses `stat -c %Y`/`stat -f %m` with `date +%s` (or equivalent builtins); no Python on any hook path.
- Rationale: "Hooks must stay fast"; the only Python on today's hook path is the dedupe mtime check (+19 ms). The wrapper hop costs one bash exec (~1.3 ms floor).
- If wrong: if the hop exceeds the +3 ms allowance, the hook configs may call `bash scripts/commands/spool.sh` directly. That bypasses the single entry point, so it would be recorded as a deviation, not done silently.

### Assumption 6
- Question: How do configs invoke the entry point locally?
- Answer chosen: `bash <plugin-root>/bin/yakka …` for Claude/Codex hooks and the Claude, Cursor and Codex MCP configs; `./bin/yakka …` for Cursor hooks; Codex MCP keeps relative path + `cwd`.
- Rationale: matches the current per-harness resolution (the repo already pins Cursor hooks to relative `./script/…`, forbids `${CURSOR_PLUGIN_ROOT}` there, and Cursor MCP to no `cwd`/`env`); `bash` prefix does not depend on the executable bit surviving plugin cache copies. The executable bit is still required for Claude's bare `yakka`.
- If wrong: if a harness strips the exec bit, only the bare-`yakka` Claude path breaks; the login skill's path fallback covers it.

### Assumption 7
- Question: Cursor cloud: how do hooks/MCP reach `yakka`, and what about PATH visibility?
- Answer chosen: per Cody, `yakka` on PATH via the existing user-mode shim; cloud MCP/hook configs use bare `yakka`. The shim is exactly `exec bash <install>/bin/yakka "$@"`.
- Rationale: Cody's 12:01 AM instruction. #244 verified `yakka` on the agent shell PATH at install time, but not that processes Cursor spawns for hooks/MCP inherit `~/.local/bin`; Cursor staff say cloud agents reset PATH at environment start.
- If wrong: phase 4's live check (Open Question 2) fails → cloud configs use the absolute installed `bin/yakka` path (the installer holds the command prefix in one variable, so this is a one-line change); still the single entry point, and the shim stays for agents' shells. CHANGELOG 3.4.7/3.4.8 record earlier Cursor cloud spawn failures from unexpanded or unresolvable commands, which is why the installer's `verify_install` executes the entries it wrote.

### Assumption 8
- Question: OpenCode capture: keep the in-process TypeScript writer or call the entry point?
- Answer chosen: spawn `bash bin/yakka spool` (payload on stdin, not awaited) with `YAKKA_SPOOL_TS` carrying the plugin's own strictly increasing timestamp; keep the TS event filter; kick via `bin/yakka drain`.
- Rationale: removes the second spool implementation (and its missing dedupe). `index.ts` documents that `ts` must stay strictly increasing because the drain orders and turn-counts by it; a bare spawn would stamp `ts` at process start and concurrent spawns could reorder, hence the override. A detached spawn does not block the event loop.
- If wrong: keep the writer, add a conformance test that its output matches `spool`'s envelope and file name form, and still repoint the kick.

### Assumption 9
- Question: Latency targets.
- Answer chosen (same machine, same session, harness N=30; absolute figures are this machine's baseline, the gates are relative to the same run's floor so another machine can re-prove them): 
  - hook, dedupe miss (`hook-nodedupe`, via `bash bin/yakka spool`) median ≤ baseline `spool.sh` same scenario + 1.5 ms (25.2 → ≤ 26.7);
  - hook, dedupe hit (default dedupe, repeated payload) median ≤ baseline dedupe-miss + 5 ms (≤ 30.2) and strictly below the old dedupe-hit baseline (43.9);
  - zero `python3` executions on any `spool` path (a recording PATH stub, run with and without a sha tool on PATH);
  - cloud shim adds ≤ 3 ms to the hook median;
  - `yakka version` median ≤ `python3 -c pass` floor + 25 ms (≈ 40 ms here);
  - `status`, `login --help`, `drain`, `mcp` (stdin EOF) medians ≤ floor + 85 ms (≈ 100 ms here) and each ≤ its own baseline from the same session;
  - the lazy-loading proof is the per-command `sys.modules` closure test (Commands contract), not the millisecond figures, which are a regression guard.
- Rationale: from the importtime decomposition (interpreter floor + required imports; compile and unused imports removed). They are hypotheses from numbers measured on the old code. The `status`/`drain` baselines are measured first in phase 1. A dedupe hit adds `stat`, `date` and the wrapper hop to a path that skips the rename and touch, so it gets its own bound.
- If wrong: the phase does not close silently; execution records measured values and either fixes the import closure or re-states the target with evidence in IMPLEMENTATION.md. `python3 -S` (≈ 6 ms cheaper in the floor measurement) is held in reserve, not adopted (`-E` would also ignore the user's `PYTHON*` settings).

### Assumption 10
- Question: Do the phases land as one release, and may `yakka.py` coexist transiently?
- Answer chosen: all four phases land on one implementation branch/PR and ship as one plugin version; between phases 2 and 3 `yakka.py` may import the new libs it has already lost (an internal transitional state, deleted in phase 3; not a caller-facing shim).
- Rationale: "every caller switches in the same release"; no compatibility layer means no published release in which both spellings work.
- If wrong: if phases must ship separately, phase 2 would have to keep `client/yakka.py` as a public entry, contradicting Cody.

### Assumption 11
- Question: Behaviour-preserving move or clean-up?
- Answer chosen: behaviour-preserving. Duplicated rules in `yakka.py` (endpoint validation ×4, repo identity ×3, git wrappers ×4, `_patterns` compiled twice, `_MCP_*_TIMEOUT_S` defined twice, unused `queue` import) are noted; only the duplicate constants and dead import are removed incidentally. The `clientconfig`⇄`http` cycle is broken because layering requires it.
- Rationale: a 3,775-line move with 128 tests is risky enough; consolidating rules changes behaviour and needs its own evidence.
- If wrong: add the consolidation as a fifth phase after this one lands.

### Assumption 12
- Question: Version bump.
- Answer chosen: plugin 3.4.12 → 3.5.0 in all three manifests and a `CHANGELOG.md` entry; `packages/opencode-yakka-hooks` 0.2.1 → 0.3.0 (independent versioning); no marketplace/`package.json` edits elsewhere. `bin/VERSION` is no longer a version of anything the plugin ships.
- Rationale: no rule is written; history shows minor for user-visible/behavioural change and removal of an env surface (3.1.0, 3.3.0), patch for fixes. Removing `YAKKA_BIN` and every old path is breaking by definition, so minor. Master may bump 3.4.x before this lands; the implementer takes the next minor.
- If wrong: a patch bump is a one-line change.

### Assumption 13
- Question: Where does `yakka version` get the version, and how do three manifests stay in step?
- Answer chosen: `.claude-plugin/plugin.json`. The equality of the three manifest versions is already asserted by `packages/hooklog/tests/test_surfaces.py::test_manifest_versions_match` (it stays green); no new check is added.
- Rationale: one lookup with no new file to bump.
- If wrong: a single `VERSION` file at the plugin root read by the client and checked against all three.

### Assumption 14
- Question: Is there a test command, given no CI?
- Answer chosen: `python3 -m unittest discover -s plugins/yakka/scripts/tests -t plugins/yakka/scripts -p 'test_*.py'` from the repo root, plus the existing `tools/release`, `packages/hooklog`, `packages/opencode-yakka-hooks` commands (README-documented). Tests that need the Go toolchain (parity/bridge, `packages/yakka` tests) are not part of any phase gate: they run where `go` exists and are reported, and the Go-side changes this plan makes are also checked statically (no Go test names `packages/hooklog/spool.sh` or sets `YAKKA_BIN`). The baseline machine has no `go`.
- Rationale: matches the repo's practice (READMEs only). Baseline has 3 Go-dependent errors on a machine without `go`.
- If wrong: a runner script (`tools/release/run_client_checks.sh`) wrapping the commands.

### Assumption 15
- Question: PR title.
- Answer chosen: "docs: Plan 27 — yakka client consolidation" as instructed, even though master's design PRs use "Design: … (plan NN)". Body's first line is the `Yakka-Plan:` marker.
- Rationale: the invoker's instruction wins; the marker is the mechanical locator.
- If wrong: rename the PR.

### Assumption 16
- Question: Rebase base.
- Answer chosen: the worktree was rebased onto `origin/master` `5c92cd7` (PR #244 landed after the worktree was created at `db02b05`); inventory and cloud-install analysis are against `5c92cd7`.
- Rationale: the brief says "based on origin/master"; #244 rewrote `cloud-install.sh`.
- If wrong: re-inventory `cloud-install.sh`.

### Assumption 17
- Question: Login skill on harnesses without plugin `bin/` PATH.
- Answer chosen: the skill uses bare `yakka` and falls back to `<skill base dir>/../../bin/yakka`.
- Rationale: only Claude Code ≥ 2.1.91 puts `bin/` on PATH; Cody forbids other local PATH installs; the skill's base directory is known at invocation.
- If wrong: restrict the skill to Claude and Cursor cloud and state that. Known sharp edge: Claude appends plugin `bin/` after the user's PATH, so a different `yakka` earlier on PATH (the server image's Go binary) would win; the skill's explicit-path form is the unambiguous one and `yakka version` output is how an agent tells them apart.

## Open Questions

1. claude.ai / Cowork cannot install a plugin that has a top-level `bin/` (plugin already has one, so nothing regresses). Is claude.ai or Cowork org distribution planned? If so `bin/` cannot be the answer there and the manifest-reference's own guidance ("keep executables out of the top-level `bin/` directory") applies. Blocks nothing in this plan.
2. In a real Cursor cloud agent, do processes Cursor spawns for hooks and MCP inherit `~/.local/bin` on PATH? Blocks only the live verification of phase 4's cloud outcome; the fallback is the absolute installed path (Assumption 7).
3. Cursor local hooks: Cursor forum reports an inconsistent hook working directory; the repo already relies on `./script/…` working. If `./bin/yakka` fails to resolve in some Cursor versions the hook config needs another form. Blocks nothing; existing behaviour is the baseline.
4. Does the Go client deletion (#178) land first? This plan edits three Go tests that run the deleted `packages/hooklog/spool.sh`; if #178 deletes them first they drop out of scope. Blocks nothing.
5. Latency thresholds (Assumption 9) are hypotheses; actuals on macOS and older Pythons are unknown (the suite last documented 3.10 and 3.12).

## Phases

All four phases land on one branch and ship as one plugin version (Assumption 10). Each phase's checks are committed commands; "N=30, same machine, same session" applies to every latency figure.

### Phase 1 — Entry point and fast hook path

- Outcome:
  - Entry point → action → result: `bash plugins/yakka/bin/yakka spool --harness claude --event PostToolUse < payload` in an isolated `HOME`/`YAKKA_QUEUE` writes exactly one `.evt` file whose bytes match what `script/spool.sh` wrote at `5c92cd7` for the same payload (envelope aside from `ts`), exits 0, and with the default dedupe window a repeat within the window writes none.
  - Latency: via `tools/release/bench_client.py`, the Assumption 9 hook gates hold (dedupe miss ≤ 26.7 ms, dedupe hit ≤ 30.2 ms and below 43.9, p95 reported), a recording `python3` PATH stub is never invoked on any `spool` path (dedupe hit included; with and without a sha tool), and the cloud-shim variant adds ≤ 3 ms; the harness's "before" JSON (taken from a `5c92cd7` checkout, including `status` and `drain` baselines) is recorded in `IMPLEMENTATION.md`.
  - Configs: every command in `hooks.json` (29), `codex.json` (11) and `cursor.json` (21), with the harness's plugin-root variable substituted (or cwd = plugin root for Cursor), resolves to `realpath(plugins/yakka/bin/yakka)`, and executing each against a sample payload spools or no-ops as its harness expects (Cursor stdout replies unchanged).
  - `plugins/yakka/bin/` contains only `yakka` (executable bit set); `VERSION`, `RELEASE_URL`, `SHA256SUMS` live in `tools/release/`, `build.sh`'s `VERSION`/`SUMS_FILE` paths and `.dockerignore` follow (checked statically; `test_release.py`'s Wrapper tests pass, its Go/npm build tests are not part of the gate); `yakka.py`'s version string and User-Agent come from the manifest version; `bin/yakka` with no argument or an unknown command prints usage and exits 2 and never reads `YAKKA_BIN`.
  - `packages/hooklog/spool.sh` and `hooklog.py record` are gone; `packages/hooklog/tests` (with `test_surfaces.py`'s `is_prefetch` and hard-coded `script/spool.sh` fixed, and its existing hook-execution and manifest-version checks green) and `tools/driver/tests/test_install_route.py` pass; a grep shows no Go test or non-doc file names `packages/hooklog/spool.sh` or sets `YAKKA_BIN` for the spool.
  - `scripts/cloud-install.sh` still completes under `set -e` into a temp `HOME` (its spool path, chmod, hook rewrite and verify steps point at `bin/yakka spool`; `cloud-install` is never red between phases).
- Surfaces: `plugins/yakka/bin/yakka` (spool route; other commands still route to `client/yakka.py`); `plugins/yakka/script/{spool.sh,test_kick.py}` → `plugins/yakka/scripts/commands/spool.sh` and `scripts/tests/commands/`; `plugins/yakka/hooks/{hooks,codex,cursor}.json`; `plugins/yakka/bin/{VERSION,RELEASE_URL,SHA256SUMS}` → `tools/release/`; `tools/release/{build.sh,test_release.py,test_layout.py,scan_residual_names.py,bench_client.py}`; `plugins/yakka/client/yakka.py` (`_plugin_version_text`, the spool path at ~2910, no other change); `install.sh` (spool/hooks checks); `scripts/cloud-install.sh` (spool-path edits only); `.dockerignore`; `tools/driver/tests/test_install_route.py`; `packages/hooklog/{spool.sh,hooklog.py,README.md,cursor-hooks.example.json,tests/*}`; `packages/yakka/cmd/yakka/{drain_test,capture_test,advisory_outcome_test,spool_testhelper_test}.go`.
- Approach: known
- Depends on: nothing

### Phase 2 — Libs foundation and the leaf commands (`version`, `status`, `login`)

- Outcome:
  - Entry point → action → result: `bash plugins/yakka/bin/yakka version|status|login …` runs `scripts/commands/{version,status,login}.py`, with the same output, flags and exit codes as `python3 client/yakka.py` at `5c92cd7` for the same inputs (the moved `test_status`, `test_login`, `test_http`, `test_clientconfig`, `test_keys` cases pass unchanged in intent).
  - Unit tests: each lib created in this phase (`config`, `http`, `queue` status/lock read side, `login`, `paths`/`version`, plus any it pulls in) has `tests/libs/test_<name>.py`; a test enumerates `scripts/libs/*.py` and fails if any lacks a test module; no lib imports `commands`; the lib import graph is acyclic (the `clientconfig`⇄`http` cycle is gone).
  - Lazy loading, as measured: `version` median within the Assumption 9 gate with neither `ssl` nor `http.client` in `sys.modules`; `status` and `login --help` medians within the Assumption 9 gate; `sys.modules` after `login` contains none of the capture/facts/secrets/keys/drain/mcp libs; no lib does I/O at import (a test imports every lib with a monkeypatched `open`/`os.environ`/`socket` that fails the test).
  - `client/yakka.py` still exists for `drain` and `mcp` only and imports the new libs for what it lost; it has no `version`, `status` or `login` code.
- Surfaces: new `plugins/yakka/scripts/libs/*`, `scripts/commands/{version,status,login}.py`, `scripts/tests/libs/*`, `scripts/tests/commands/*`; `plugins/yakka/bin/yakka` (route table); `plugins/yakka/client/yakka.py` and `client/test_{status,login,http,clientconfig,keys}.py` (moved/split); `tools/release/bench_client.py` (`--layout new` scenarios).
- Approach: known
- Depends on: Phase 1

### Phase 3 — Drain and MCP, `client/yakka.py` deleted

- Outcome:
  - Entry point → action → result: `bash plugins/yakka/bin/yakka drain` on a seeded queue posts the same facts to a local test server as `python3 client/yakka.py drain` did at `5c92cd7` (moved `test_drain`, `test_facts`, `test_secrets` pass), and `bash plugins/yakka/bin/yakka mcp` answers `initialize`, `tools/list` and an `artifact_feedback` call on stdio exactly as before (moved `test_mcp_shim`, `test_capture` pass; the MCP enqueue spools through `bin/yakka spool`).
  - Unit tests: every `libs/*.py` has a test module (enumeration test green); the duplicate `test_mcp.py` re-export is gone; the distinct test count is ≥ 128 less the cases for `YAKKA_BIN`/`yakka_bin_set` and `hooklog record` (each removal named in `IMPLEMENTATION.md`; nothing else dropped); `test_mcp_guard`'s source-text marker split is replaced by an AST import-graph assertion (the login libs do not import mcp libs and vice versa).
  - Lazy loading, as measured: `drain` and `mcp` (stdin EOF) startup medians within the Assumption 9 gate and each below its baseline; `sys.modules` closures per the Commands contract (e.g. `drain` loads no capture/mcp/login, `mcp` loads no login/drain-runner), asserted by a test that runs each handler in a subprocess and dumps `sys.modules`.
  - `plugins/yakka/client/` does not exist; `claude-mcp.json`, `mcp.json` and `.codex-mcp.json` reference only `bin/yakka mcp` in the forms in the Callers contract, and `tools/release/test_layout.py`, `packages/hooklog/tests/test_surfaces.py` and `tools/shadow-review-trial/manifest.py` pass against the new layout.
- Surfaces: `plugins/yakka/client/*` (deleted), new `scripts/libs/{facts,capture,secrets,keys,drain,mcp_*}.py`, `scripts/commands/{drain,mcp}.py`, `scripts/tests/*`; `plugins/yakka/{claude-mcp,mcp,.codex-mcp}.json`; `tools/shadow-review-trial/manifest.py`; `tools/release/{test_release.py,test_layout.py,phase5_outcome.py}`; `scripts/cloud-install.sh` (client path in the MCP merge and verify); `packages/hooklog/{tests/test_surfaces.py,cursor-mcp.example.json,codex-mcp.example.toml}`.
- Approach: known
- Depends on: Phase 2

### Phase 4 — Remaining callers, cloud, docs, version, end-to-end proof

- Outcome:
  - End-to-end, local (by plugin path): `packages/hooklog/tests/test_surfaces.py` (extended; it already executes each shipped hook command per harness) loads each harness's committed hook and MCP config, substitutes that harness's plugin-root variable (Claude `CLAUDE_PLUGIN_ROOT`, Codex `PLUGIN_ROOT`, Cursor `CURSOR_PLUGIN_ROOT`/cwd), and asserts every command resolves to `realpath(plugins/yakka/bin/yakka)` and nothing else; it then executes each MCP command against `initialize`+`tools/list` and one hook per harness against a sample payload in an isolated `HOME`; any config that names `client/`, `script/`, `YAKKA_BIN` or `python3 …yakka.py` fails the test. A new `tools/release/test_cloud_install.py` covers the cloud half below.
  - End-to-end, cloud (by `yakka` on PATH): running `scripts/cloud-install.sh` into a temp `HOME` (using the repo checkout as source, no network) produces `~/.local/bin/yakka` whose only content is an `exec bash` of `<install>/bin/yakka`; `~/.cursor/mcp.json` has `command: yakka, args: [mcp]`; every `~/.cursor/hooks.json` yakka entry is `yakka spool --harness cursor --event <E>`; with `PATH=$HOME/.local/bin:/usr/bin:/bin`, `command -v yakka` resolves to the shim, `yakka version` prints the manifest version, `yakka mcp` answers `tools/list`, and a hook command spools a payload — all with `YAKKA_BIN` unset and no `YAKKA_ROOT` set; re-running the installer over a seeded `~/.cursor/hooks.json` holding the old absolute `script/spool.sh` entries leaves exactly one current entry per event and no legacy one; `yakka` is placed on PATH by no other script (grep-checked across `install.sh`, `tools/cloud-env`, `.cursor/environment.json`).
  - OpenCode: `packages/opencode-yakka-hooks` tests (node and python) pass with capture spawned through `bin/yakka spool` (events still filtered by `REMOVE_EVENTS`, timestamps still strictly increasing across a burst of concurrent events, asserted on the resulting queue files) and the kick through `bin/yakka drain`; the package source contains no `client/yakka.py`, no `YAKKA_BIN`, no queue-file writing.
  - Hook-latency re-measurement through the final tree: the Phase 1 scenarios re-run, hook median still within the Phase 1 target and all Phase 2–3 startup targets still met; before/after table recorded in `IMPLEMENTATION.md` and summarised in `CHANGELOG.md`.
  - Docs and metadata: a grep for `client/yakka.py`, `script/spool.sh`, `YAKKA_BIN` (plugin meaning) and `packages/hooklog/spool.sh` across non-`docs/plans/` files returns no hits (each remaining hit has a named reason); plugin manifests read 3.5.0 (equal, test-enforced), `opencode-yakka-hooks` 0.3.0, `CHANGELOG.md` has the entry; the login skill carries the `<skill base dir>/../../bin/yakka` fallback; `docs/design/05-distribution.md` describes the new layout and `bin/` contents.
- Surfaces: `scripts/cloud-install.sh` (final forms, legacy purge), `.cursor/environment.json`, `tools/cloud-env/{README.md,environment.json.example}`; `packages/opencode-yakka-hooks/{src/index.ts,README.md,opencode.json.example,tests/*,package.json}`; `plugins/yakka/skills/login/SKILL.md`; `plugins/yakka/.{claude,codex,cursor}-plugin/plugin.json`; `CHANGELOG.md`; `docs/design/{02,03,04,05,08}*.md`, `docs/ARCHITECTURE.md`, `README.md`, `packages/*/README.md`; `packages/hooklog/tests/test_surfaces.py`, `tools/release/{test_cloud_install.py,test_layout.py}`, `docs/design/08-server-mcp-contract.md` (`yakka_bin_set`).
- Approach: known
- Depends on: Phase 3

## Provenance Notes

- Why `bin/` is only the router: Claude Code appends the plugin's `bin/` to the Bash tool's PATH, so every file there becomes a bare command in agents' shells; the old `VERSION`/`RELEASE_URL`/`SHA256SUMS` would have been dead weight on PATH. A plugin with a top-level `bin/` is not installable through claude.ai/Cowork (the plugin already had one).
- Why hooks keep a bash path: the baseline shows the spool costs ~25 ms in pure bash against a ≥ 15 ms interpreter floor plus imports for any Python rendering of it; hooks fire on every event, and lazy loading cannot beat not loading. The only Python on today's hook path (dedupe's mtime check) is removed by the plan.
- Review: an independent Sonnet pass found nine items that changed this design (missed caller `tools/driver/tests/test_install_route.py`; `hooklog record` as a compat shim; a vacuous Go-test gate; a false "nothing enforces manifest versions" claim; a hook target that measured the wrong path; `mcp` closure missing `secrets`; cloud-install red between phases; no legacy purge in the installer; OpenCode `ts` ordering) and several nits; all applied above.
- Why `yakka.py` is compiled every run today: scripts executed as `__main__` are never written to `__pycache__`, so splitting into imported modules brings bytecode caching for free (the install must therefore be writable, or the first run pays compile; read-only plugin caches pay it each run, still smaller than today).
- Rejected: keeping `client/yakka.py` as a re-export shim (Cody: no backward compat); keeping `YAKKA_BIN` as a Go override (the Go client is going, and the override is the self-exec hazard); a symlinked cloud shim (needs symlink-resolving root discovery in the wrapper, and Cody described a thin wrapper); calling `scripts/commands/spool.sh` directly from hooks (bypasses the single entry point; held as the recorded fallback if the hop misses its latency allowance); one `libs` module per old section without layering (leaves the `clientconfig`⇄`http` cycle).
- Follow-ups found and not done here: consolidate the duplicated endpoint-validation, repo-identity and git-wrapper code in `yakka.py`; `tools/quality/artifact_submit.py` copies the write-tool/patch logic; `hooklog.py`'s scrubber differs from the client's `[REDACTED:<name>]` patterns; `phase5_outcome.py` names tests that do not exist; `docs/design/01-event-model-and-ingest.md:258` names a missing test file; `.claude/skills/jev-variants/SKILL.md:79` has a path missing its `plugins/yakka/` prefix; packages/yakka's README still says the Go binary is not the client.
