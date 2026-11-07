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
