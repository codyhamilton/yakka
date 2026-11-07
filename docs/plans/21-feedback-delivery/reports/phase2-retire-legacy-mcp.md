# Phase 2 report — retire the legacy MCP and its launcher

## Outcome

Restarted the probe's systemd user unit and retired the confirmed old plugin and binary copies. The
legacy MCP process was absent before restart and remained absent afterward; the restarted probe
lists only Yakka and continues displaying usage readings.

## Verification

- At preflight, `ps` showed no `workflow-linux-amd64` process. `env -u CODEX_HOME codex mcp list`
  from the probe directory showed only `yakka` enabled.
- Restarted `codex-usage-probe.service` at 2026-11-07 21:00:45 AEST. Its new invocation ID is
  `320b0af3eaa946e0bd9c8c349ed2e258`; it reports `ActiveState=active`, `SubState=exited` as
  configured for this oneshot unit.
- More than 60 seconds later, a process search found no `workflow-linux-amd64` process and no
  process launched from the retired archive paths. A repeated `codex mcp list` still showed only
  `yakka` enabled.
- The tmux probe remained running; its Codex screen displayed usage readings shortly after restart
  and at the final check (`5h 64% left · weekly 94% left`).
- Archived `~/.codex/plugins/cache/workflow-plugin/` to
  `~/.local/share/yakka/retired/plan21-legacy-mcp/workflow-plugin/`, and
  `~/.cache/workflow/0.1.0/` to
  `~/.local/share/yakka/retired/plan21-legacy-mcp/workflow-0.1.0/`.
- `~/.local/share/workflow/queue` contained 37,950 `*.evt` files before and after. The queue was
  not modified. The key-bearing backup and unrelated workflow units were not touched.
- The brief was committed before execution as `d1c2d96`.

## Deviations

None. The active probe unit was retained because it launches the Yakka-only probe, not the legacy
MCP.

## Unfinished work and known problems

- The `artifact_feedback` checks for the brief and report were not called because they would make
  an egress call. Cody gate: run those checks when egress is authorized.
- The unrelated layout test failure on ignored `packages/yakka-analytics/node_modules/**` is
  documented by Plan 19 Phase 4; this phase did not run or investigate it.
