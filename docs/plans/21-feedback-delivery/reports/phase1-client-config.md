# Phase 1 report — remote-or-fail client configuration

## Outcome

Implemented explicit remote/local/error config resolution in the Python client. Missing config no
longer falls back to loopback. Partial remote settings and invalid local/remote combinations fail
with named errors; status reports invalid config and unreachable remote endpoints. Explicit local
mode remains keyless.

## Verification

- `python3 -m unittest test_clientconfig test_status` from `plugins/yakka/client`: 17 tests passed.
- `git diff --check`: passed.
- Fake request coverage verifies that missing config sends no request, an unreachable remote is
  contacted only at its configured endpoint, and explicit local mode posts to a fake loopback HTTP
  listener without an Authorization header.
- Repository reference scan found the Python local endpoint constant, server bind default, docs and
  tests, plus pre-existing Go-client references. Go client code was left untouched as the design
  directs.

## Deviations

None. This phase did not change MCP tool behavior; the design defers those clauses to Phase 3.

## Unfinished work and known problems

- The `artifact_feedback` runner check was not called because it would make an egress call. The
  result file records this as a Cody gate.
- The unrelated `tools/release/test_layout.py::test_repo_passes_layout_check` failure on ignored
  `packages/yakka-analytics/node_modules/**` is recorded by Plan 19 Phase 4. It was not run or
  chased.
- `packages/hooklog/README.md` retains the previous no-config local default statement and is outside
  the documentation surfaces named for this phase.
