# Brief: phase2-shim-default-strict-drain

Consumer: worker on `plugins/yakka/client`.
Owned paths: `yakka.py` (LoadMCP, `_McpRelay._post`, `_mcp_readers` scrub, `run_status`), tests, design 2/4/5.
Depends on: Phase 1.
Verification: `python3 -m unittest test_clientconfig test_mcp_shim test_status test_drain` and `test_mcp_guard`.

## Goal

Shim resolves `DefaultEndpoint` with optional empty key; `Load()` unchanged; status prints `mcp:` line.

## Report

`docs/plans/25-mcp-discovery-without-key/reports/phase2-shim-default-strict-drain.md`