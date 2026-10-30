# Changelog

## 3.3.0 — 2026-10-30 — fewer tool events

- Claude and Codex no longer register `PreToolUse`, and Claude no longer registers `PostToolBatch`. `PostToolUse` already carries the tool name, input and response, so each tool call is captured once and no hook process starts before it. Cursor's `preToolUse` is unchanged. The server also drops these events, so an older plugin that still sends them stores nothing.
- The OpenCode plugin drops `tool.execute.before`, the derived `PostToolBatch` marker, and the bus events `message.updated`, `message.part.updated`, `session.status`, `session.updated` and `session.diff`. `tool.execute.after` now carries `started_at`, and a call still open at `session.idle` is written as `tool.execute.incomplete` (normalised to `tool_fail`).
- `yakka sync` skips events the ingest policy removes.
- Store migration 9 deletes the `hook_event` facts of every event the ingest policy removes, when a tenant is opened, and rebuilds the hook, conversation and facet rollups. A local or hosted ledger is purged on the first start after this release, which can take a while on a large ledger. The archive keeps its lines. A migrated ledger is newer than older `yakka sync` binaries understand, so sync with this release or later. Later changes to the remove list need their own migration; a test enforces it.

## 3.2.0 — 2026-10-30 — login for sync

- `yakka login --sync` (and `start --sync`) runs the device flow but writes the token to `sync.toml` (`$YAKKA_SYNC_CONFIG`, else `~/.config/yakka/sync.toml`, mode 0600). `client.toml` and the running drain are left alone, so a migration can authenticate without redirecting the backlog. A sync login never reads `client.toml` for its endpoint; pass `--endpoint` for a non-default host.
- The `/yakka:login` skill documents the sync variant.

## 3.1.1 — 2026-10-30 — client User-Agent

- The client now sends `User-Agent: yakka-client/<version>` on every request. Cloudflare in front of `api.yakka.build` blocks urllib's default `Python-urllib` agent with a 403 (error 1010), which broke `yakka login` and the drain against the hosted service. **3.0.1 and 3.1.0 clients get that 403 until updated to 3.1.1 or later.**

## 3.1.0 — 2026-10-21 — device-code login

- Login is now a device-code flow. `yakka login start` prints a URL and code and exits; `yakka login wait` polls until you approve on the `/device` page and then writes `client.toml`. Bare `yakka login` runs both. The default endpoint is `https://api.yakka.build`.
- New `/yakka:login` skill (every harness) drives `start` and `wait` for an agent without exposing the token. `yakka status` prints `config: env (remote mode)` when `YAKKA_ENDPOINT` and `YAKKA_KEY` override `client.toml`.
- The loopback login route is removed from the server. **3.0.1 clients cannot log in until updated to 3.1.0**; their existing tokens keep working.
- The Go binary no longer has `yakka login` (it exits 1 and names the plugin wrapper). Binary version `0.3.0`.
- The registry no longer stores plaintext tokens for pending device codes.

## 3.0.0 — 2026-10-18 — rename to yakka

Major rename: the product, plugin, Go binary, MCP server, environment variables, and
on-disk state directories are **yakka**. Plugin manifests are `3.0.0`. There is no automatic
data migration — follow this section before relying on hooks, MCP, or `yakka serve`.

**Remove the old `workflow` install before installing `yakka`.** An enabled `workflow` plugin
plus `yakka` records every hook event twice. Unset any `WORKFLOW_*` variables you still export
(the binary and hooks read `YAKKA_*` only, except the quality-service vars noted below).

### Environment variables (`WORKFLOW_*` → `YAKKA_*`)

Every shipped identifier that started with `WORKFLOW_` now uses `YAKKA_` with the same suffix.
Update shell profiles, systemd units, and CI env blocks accordingly.

| Was | Becomes |
|---|---|
| `WORKFLOW_ALIGNMENT_CRITERIA` | `YAKKA_ALIGNMENT_CRITERIA` |
| `WORKFLOW_ALIGNMENT_INSTRUCTIONS` | `YAKKA_ALIGNMENT_INSTRUCTIONS` |
| `WORKFLOW_ANALYTICS_TOKEN` | `YAKKA_ANALYTICS_TOKEN` |
| `WORKFLOW_ANALYTICS_URL` | `YAKKA_ANALYTICS_URL` |
| `WORKFLOW_ARTIFACT_SUBMIT_CLI` | removed (retired-pattern token; no `YAKKA_` successor) |
| `WORKFLOW_BATCH_FLUSH_CLI` | `YAKKA_BATCH_FLUSH_CLI` |
| `WORKFLOW_BENCH_ALLOW_LIVE` | `YAKKA_BENCH_ALLOW_LIVE` |
| `WORKFLOW_BENCH_DIR` | `YAKKA_BENCH_DIR` |
| `WORKFLOW_BENCH_FILTER` | `YAKKA_BENCH_FILTER` |
| `WORKFLOW_BENCH_OUT` | `YAKKA_BENCH_OUT` |
| `WORKFLOW_BENCH_P95_MS` | `YAKKA_BENCH_P95_MS` |
| `WORKFLOW_BENCH_RUNS` | `YAKKA_BENCH_RUNS` |
| `WORKFLOW_BIN` | `YAKKA_BIN` |
| `WORKFLOW_CHECKS_DIR` | `YAKKA_CHECKS_DIR` |
| `WORKFLOW_CLIENT_CONFIG` | `YAKKA_CLIENT_CONFIG` |
| `WORKFLOW_DRAIN_BACKOFF_MAX` | `YAKKA_DRAIN_BACKOFF_MAX` |
| `WORKFLOW_DRAIN_GIVEUP` | `YAKKA_DRAIN_GIVEUP` |
| `WORKFLOW_DRAIN_LINGER` | `YAKKA_DRAIN_LINGER` |
| `WORKFLOW_DRAIN_WINDOW` | `YAKKA_DRAIN_WINDOW` |
| `WORKFLOW_HOOKLOG` | `YAKKA_HOOKLOG` |
| `WORKFLOW_HOOKLOG_DEBUG` | `YAKKA_HOOKLOG_DEBUG` |
| `WORKFLOW_HOOKLOG_DIR` | `YAKKA_HOOKLOG_DIR` |
| `WORKFLOW_HOOKLOG_KICK` | `YAKKA_HOOKLOG_KICK` |
| `WORKFLOW_HOOKLOG_SPOOL` | `YAKKA_HOOKLOG_SPOOL` |
| `WORKFLOW_INSTALL_BRANCH` | `YAKKA_INSTALL_BRANCH` |
| `WORKFLOW_INSTALL_LAB` | `YAKKA_INSTALL_LAB` (still accepted; ignored — lab skills are not installed) |
| `WORKFLOW_INSTALL_MODE` | `YAKKA_INSTALL_MODE` |
| `WORKFLOW_INSTALL_SH` | `YAKKA_INSTALL_SH` |
| `WORKFLOW_INSTALL_SKIP_REFRESH` | `YAKKA_INSTALL_SKIP_REFRESH` |
| `WORKFLOW_INSTALL_SRC` | `YAKKA_INSTALL_SRC` |
| `WORKFLOW_JEV_LIVE` | `YAKKA_JEV_LIVE` |
| `WORKFLOW_JEV_SIGNAL_LOG` | `YAKKA_JEV_SIGNAL_LOG` |
| `WORKFLOW_LEGACY` | `YAKKA_LEGACY` |
| `WORKFLOW_OPENCODE_SIGNALS` | `YAKKA_OPENCODE_SIGNALS` |
| `WORKFLOW_OPENCODE_SKILLS` | `YAKKA_OPENCODE_SKILLS` |
| `WORKFLOW_PAGESET_OUT` | `YAKKA_PAGESET_OUT` |
| `WORKFLOW_PLUGIN_CACHE` | `YAKKA_PLUGIN_CACHE` |
| `WORKFLOW_PYTHON` | `YAKKA_PYTHON` |
| `WORKFLOW_QUEUE` | `YAKKA_QUEUE` |
| `WORKFLOW_RELEASE_URL` | `YAKKA_RELEASE_URL` |
| `WORKFLOW_REPORT_FENCE` | `REPORT_FENCE` (no `YAKKA_` prefix; Python constant in `tools/driver/report.py`) |
| `WORKFLOW_REPO_ROOT` | `YAKKA_REPO_ROOT` |
| `WORKFLOW_REPO_URL` | `YAKKA_REPO_URL` |
| `WORKFLOW_ROOT` | `YAKKA_ROOT` |
| `WORKFLOW_SERVE_ADDR` | `YAKKA_SERVE_ADDR` |
| `WORKFLOW_SERVE_CORS_ORIGINS` | `YAKKA_SERVE_CORS_ORIGINS` |
| `WORKFLOW_SERVE_DATA` | `YAKKA_SERVE_DATA` |
| `WORKFLOW_SERVE_KEYS` | `YAKKA_SERVE_KEYS` |
| `WORKFLOW_SERVE_POLL` | `YAKKA_SERVE_POLL` |
| `WORKFLOW_SIGNAL_STATE_DIR` | removed (unused test assignments; no successor) |
| `WORKFLOW_SPOOL_NOFLOCK` | `YAKKA_SPOOL_NOFLOCK` |
| `WORKFLOW_VERIFY_DIR` | `YAKKA_VERIFY_DIR` |
| `WORKFLOW_VERIFY_PRE` | `YAKKA_VERIFY_PRE` |
| `WORKFLOW_WORKSPACE` | `YAKKA_WORKSPACE` |
| `WORKFLOW_WORKSPACE_SKILLS_NAME` | `YAKKA_WORKSPACE_SKILLS_NAME` |

**Exception:** `WORKFLOW_QUALITY_*` is unchanged (legacy local quality HTTP service in
`tools/quality/`). Do not rename `WORKFLOW_QUALITY_URL` or related quality-service vars.
`WORKFLOW_HOOKLOG_CLI` is removed; hooks spool to the queue directory only.

### State paths

| Was | Becomes |
|---|---|
| `~/.local/share/workflow/{queue,serve}` | `~/.local/share/yakka/{queue,serve}` |
| `~/.config/workflow/client.toml` | `~/.config/yakka/client.toml` |
| `~/.cache/workflow/` | `~/.cache/yakka/` |
| `~/.local/state/workflow/` | `~/.local/state/yakka/` |
| `~/.local/share/workflow-plugin/hooklog` | `~/.local/share/yakka/hooklog` |
| `~/.cache/workflow-plugin` (cloud-env checkout) | `~/.cache/yakka/src` |

Default Jev signal log: `${XDG_STATE_HOME:-~/.local/state}/yakka/jev-signal-log.jsonl`
(override with `YAKKA_JEV_SIGNAL_LOG`). Cached release binary:
`${XDG_CACHE_HOME:-~/.cache}/yakka/<bin/VERSION>/yakka-<os>-<arch>`.

### Per-harness remove, then install

1. **Claude Code**
   1. Remove the old marketplace plugin (`workflow` / `workflow@workflow` or any checkout still
      named `workflow`).
   2. Add marketplace `codyhamilton/yakka` if needed, then install: `/plugin install yakka@yakka`.
   3. Confirm MCP server `yakka` runs `${CLAUDE_PLUGIN_ROOT}/bin/yakka mcp` (see
      `plugins/yakka/.mcp.json`).
   4. Re-run `./install.sh` with `YAKKA_INSTALL_MODE=claude-code` (or let Claude hooks run it)
      so core skills land in `~/.claude/skills/`.

2. **Cursor**
   1. Remove `~/.cursor/plugins/local/workflow` (and any symlinked repo-root plugin left from
      older marketplace layouts).
   2. Run `./install.sh` from a `yakka` checkout (or curl the raw installer from
      `https://github.com/codyhamilton/yakka`). Interactive mode materializes
      `~/.cursor/plugins/local/yakka` from `plugins/yakka` (real directory tree, not a symlink).
   3. For Cursor Cloud Agents, point environment setup at
      `tools/cloud-env/bootstrap-yakka-skills.sh` (not `bootstrap-workflow-skills.sh`). It sets
      `YAKKA_INSTALL_MODE=cloud` and syncs skills to `<workspace>/.cursor/skills/yakka/`.
   4. Restart Cursor so hooks and skills reload.

3. **Codex**
   1. Remove the old `workflow` plugin registration and any user-level `[mcp_servers.workflow]`
      entry from `~/.codex/config.toml`.
   2. Trust the `yakka` plugin at install root `plugins/yakka` (marketplace install) with hooks
      `hooks/codex.json` and MCP via `plugins/yakka/.codex-mcp.json` → `./bin/yakka mcp`.
   3. Ensure hook commands resolve inside the plugin root (`bin/yakka`, `script/spool.sh`).

4. **OpenCode**
   1. Remove OpenCode skill symlinks or copies that pointed at the old `workflow` checkout.
   2. Install the OpenCode package `packages/opencode-yakka-hooks` per its README (npm link or
      project config).
   3. Run `YAKKA_INSTALL_MODE=opencode ./install.sh` to symlink core skills into
      `${YAKKA_OPENCODE_SKILLS:-~/.config/opencode/skills}` (default skill directories:
      `design`, `refine`, `execute`, `comprehensive-review`, `close-out`, `post-build`).
   4. Export `YAKKA_*` queue/hook env vars as needed (see table above); defaults use
      `~/.local/share/yakka/queue`.

### `.gitignore` (consuming repos)

Replace `.cursor/skills/workflow/` with `.cursor/skills/yakka/` (or add the new path if you
track ignore rules for cloud-installed workspace skills).

### MCP and skill prefixes

- **MCP tools (Cursor):** `mcp__plugin_yakka_*` (server name `yakka` in `plugins/yakka/.mcp.json`).
- **Skills:** invoke by shipped directory name under `plugins/yakka/skills/` (`design`, `refine`,
  `execute`, `comprehensive-review`, `close-out`, `post-build`). Claude/Cursor skill discovery uses
  those names; there is no `/workflow:` prefix on 3.x.

Trailers and report fences: writers emit `Yakka-Phase:`, `Yakka-Plan:`, and `yakka-report`
fences; readers still accept legacy `Workflow-*` forms.

### Maintainer actions (outside this repo)

1. Rename the GitHub repository to `codyhamilton/yakka` and update remotes (`git remote set-url`).
2. Publish the `3.0.0` release (new `bin/VERSION`; assets are `yakka-<os>-<arch>`).
3. Move `yakka serve` data: `~/.local/share/workflow/serve` → `~/.local/share/yakka/serve`
   (and queue under `~/.local/share/yakka/queue` if you kept the old queue path).
4. Move `~/.config/workflow/client.toml` → `~/.config/yakka/client.toml` (or set
   `YAKKA_CLIENT_CONFIG`).
5. Reinstall every harness (Claude, Cursor, Codex, OpenCode) using the steps above.
6. Update Cursor Cloud `environment.json` install command to
   `bootstrap-yakka-skills.sh` and `YAKKA_WORKSPACE` / `~/.cache/yakka/src` paths.
7. (Optional) Rename the Cloudflare Pages project to `yakka-analytics`.
8. (Optional) Rename local checkout directories from `workflow-plugin` to `yakka`.

## 2.12.0 — 2026-10-17

- The workflow plugin install root is `plugins/yakka`. Marketplace entries list `source`:
  `plugins/yakka`. Cursor hook commands are plugin-root-relative `./script/...` (`spool.sh` and
  `prefetch-version.sh` under `plugins/yakka/script/`).

## 2.11.0 — 2026-10-17

- Move the Go binary module to `packages/workflow/`, hook capture to `packages/hooklog/`, and the
  Jev criteria plus check JSON to `packages/workflow/catalogue/`. Release builds, hooks, and
  tooling read those paths; `tools/quality/` remains the legacy HTTP service only.
- If your Cursor hooks (or another harness config) hard-code an absolute path to
  `.../tools/hooklog/spool.sh` from an older example, update it to `.../packages/hooklog/spool.sh`
  (or reinstall from the plugin). `spool.sh` exits 0 even when the path is wrong, so a stale path
  fails silently and events are not captured.

## 2.10.0 — 2026-10-17

- Remove the separate lab marketplace plugin. Six maintainer-only skills (`iterate`, `jev-variants`,
  `setup`, `transcript-parser`, `white-paper`, `workflow-tuning`) live as Claude Code project skills
  under `.claude/skills/` at the repo root. `install.sh` and cloud bootstrap install core skills only;
  `WORKFLOW_INSTALL_LAB=1` is ignored.

## 2.9.2 — 2026-10-05

- Codex gets its own MCP config, `.codex-mcp.json` (`./bin/workflow mcp`, `cwd` the plugin root). Codex does not expand
  `${CLAUDE_PLUGIN_ROOT}` in `.mcp.json`, so 2.9.1's workflow MCP server never started under Codex. Remove any
  user-level `[mcp_servers.workflow]` from `~/.codex/config.toml`; the plugin provides it.

## 2.9.1 — 2026-10-05

- Codex hooks ship with the plugin. `.codex-plugin/plugin.json` selects `hooks/codex.json` (`spool.sh --harness codex`,
  `$PLUGIN_ROOT` paths) and declares the skills and `.mcp.json`. Before this, Codex fell back to `hooks/hooks.json`, so
  every Codex event was recorded twice when `~/.codex/hooks.json` was also set up, once mislabelled `claude`.
  `tools/hooklog/codex-hooks.example.json` is removed; delete its entries from `~/.codex/hooks.json` and re-trust the
  plugin hooks in `/hooks`.

## 2.9.0 — 2026-10-04

- Hooklog capture is now a bash spooler plus an async drain. Hooks run `tools/hooklog/spool.sh`, which writes the raw payload
  to a local spool directory and returns (no python or network on the hot path; Cursor permissive replies preserved).
  `tools/hooklog/drain.py` normalises and scrubs, posts batches to the quality service with the bearer token, archives to the
  per-session JSONL, and retries after downtime (idempotent; rows keep their original `ts`). `install-drain.sh` adds a
  systemd timer; session end also kicks a drain.
- All shipped registrations (Claude, Cursor, Codex examples) call `spool.sh`; Claude registrations now pass `--event`.
  `hooklog.py record` stays as a spooling shim for older installs; `post_to_service` is removed.
- OpenCode hooks package writes spool files directly (`WORKFLOW_HOOKLOG_CLI` removed; `WORKFLOW_HOOKLOG_SPOOL` added).

## 2.8.0 — 2026-10-03

- Add the quality service (`tools/quality`): a local HTTP MCP + REST server with a SQLite ledger, registered in
  `.mcp.json` on `127.0.0.1:8765` and installable as a systemd user unit (`install-service.sh`).
  Design, refine and execute post to it (`post_design`, `post_brief`, `start_execution`, `complete_execution`);
  design and refine write the returned id to frontmatter, and execute puts `[exec <id>]` in commit titles.
- Hooklog posts every row to the service (`WORKFLOW_QUALITY_URL`) and spools to the JSONL store when it is down;
  conversations bind to plans and executions from the hook stream.
- Store design and brief text (`bodies.db`, FTS5, scrubbed) with search and rescore; Jev checks are service-defined
  data (`define_checks`), including the acceptance-criterion provenance checks.
- Jev variants: per-session checkpoints and `hide_next_prompt` for labelled rounds. Lab method and mining notes
  under `docs/lab/`.
- Merged onto 2.7.0 (hooklog catalog coverage); the service posting is layered on its `normalize`/`record`.

## 2.7.0 — 2026-10-03

- Expand Claude hooklog to 33 catalog keys: 31 active commands and 2 integration-only worktree
  slots. WorktreeCreate/WorktreeRemove replace host operations, so leave their standalone
  registrations empty to preserve observe-only behavior; document existing-handler integration.
- Select native Cursor hooks through the plugin manifest and expand the standalone example
  to every named agent/Tab/workspace event. The catalog requires 22 but enumerates 21 (18 agent,
  2 Tab, 1 app); capture all named events and document that discrepancy and cloud gaps.
- Capture OpenCode's 18 Hooks callbacks and 28 catalog bus types (plus future bus types), with
  native event names and nested session routing. Leave all mutable hook outputs unchanged.
- Add command registration for all 12 Codex hooks in user/project hooks.json. Codex is not N/A;
  hosted tools such as WebSearch skip PreToolUse/PostToolUse.
- Preserve lifecycle and unknown named events as bounded, redacted observations in the same
  JSONL store. Add pre-tool observations and retain existing turn markers without counting
  SessionEnd or duplicate Cursor shell/MCP/edit events twice.
- Return schema-valid permissive Cursor pre-action responses even on capture failure or disable.
  Tighten credential/header redaction and add command, callback/bus and loader smoke coverage.
- Bump core Claude/Cursor manifests from 2.6.0 to 2.7.0; OpenCode's independently versioned
  package moves from 0.1.0 to 0.2.0.

## 2.6.0

- Introduce shared hooklog capture and hook-backed turn data for Claude Code, Cursor and OpenCode.
