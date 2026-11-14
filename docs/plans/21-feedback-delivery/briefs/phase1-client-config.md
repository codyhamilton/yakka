# Phase 1 brief — remote-or-fail client configuration

## Context

Plan 21 Phase 1, `Remote-or-fail client configuration`, in `docs/plans/21-feedback-delivery/DESIGN.md`. Work in `/home/codyh/workspace/yakka-build/21` on branch `feat/21-feedback-delivery`. No other checkout, branch or plan is in scope.

## Outcome

The Python client resolves either a configured remote, an explicitly selected local endpoint, or a clear configuration error. Missing config must never select `127.0.0.1:8770`. Remote request failures must stay against the configured endpoint. `yakka status` reports missing/invalid config as an actionable error. Explicit local mode remains usable by the Python drain without an Authorization header.

## Work

- Update config resolution in `plugins/yakka/client/yakka.py`: environment pair precedence and partial-pair error; `YAKKA_MODE=local`; file `mode = "local"` with no key; remote endpoint/key pair; clear file-specific errors for incomplete or invalid config; missing config error with login/local setup instructions.
- Update status rendering and only the named login default/config consumers as needed; do not add MCP tool logic or alter the Go client/serve host.
- Update Python conformance tests for config resolution/status, using fake HTTP listeners only. Cover missing config, each partial file shape, conflicting/partial environment, unreachable configured remote with no loopback connection, and explicit local mode posting to a loopback fake without a bearer.
- Update stable config documentation in `docs/design/02-edge-capture.md` and `docs/design/05-distribution.md`, plus `docs/design/04-advisory-surface.md` if it contains resolution-order claims.
- Keep `127.0.0.1:8770` only as the Python local endpoint constant, `yakka serve` bind default, docs, and tests. Do not implement any local effect or `enqueue_file_snapshot` behavior.

## Boundaries

- Do not touch Plans 22/23/24 beyond design-named changes; Phase 1 does not depend on or modify Plan 24.
- Do not touch `/home/codyh/workspace/yakka-wt/`.
- Do not use live service calls, credentials, production config, Fly, Wrangler, or real local services. Any request behavior is against fakes.
- Do not push, merge, change branches, or touch master.
- Do not run the documented unrelated layout test; record it as pre-existing if encountered.

## Evidence

Run the Python config and status tests that prove this unit, plus a repository search for loopback endpoint references. Report exact commands and results in the phase report/implementation record.

## Reporting

Write `docs/plans/21-feedback-delivery/reports/phase1-client-config.md` before the closing commit. Record changes, verification, deviations, unfinished work, and known problems. Close the phase commit with `Workflow-Phase: 21-feedback-delivery:1`.
