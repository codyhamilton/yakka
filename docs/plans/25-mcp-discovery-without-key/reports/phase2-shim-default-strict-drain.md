# Report: phase2-shim-default-strict-drain

Status: done

## What changed

- Added `LoadMCP()` resolver in `yakka.py`; `_McpRelay._post` and `_mcp_readers` scrub use it.
- `run_status` prints `mcp:` line via `_print_mcp_status`; HTTP 429 maps to unreachable.
- Tests: `TestLoadMCP`, `DiscoveryRelayTests`, status assertions.
- Updated design docs 02, 04, 05.

## Verification

`python3 -m unittest test_clientconfig test_mcp_shim test_status test_drain test_mcp_guard` — OK (61 tests).

## Deviations

None.