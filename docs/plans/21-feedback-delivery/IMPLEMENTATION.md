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
