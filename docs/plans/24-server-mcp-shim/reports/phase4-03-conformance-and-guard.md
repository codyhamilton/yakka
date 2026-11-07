# Phase 4-03 — parity suite and thin-shim guard

Status: done with concerns.

Replaced the legacy client-owned MCP behavior assertions with tests that drive the real Python relay against an authenticated HTTP fixture. The fixture replays both committed golden corpora: `initialize`, `tools/list`, and every Phase 2–3 call is forwarded with shim-generated context, then its exact response is compared with a direct authenticated POST using the identical forwarded request and id. Tests cover forged `_local` replacement/removal, reader failure codes, external symlink withholding, one stale-declaration refresh/retry, timeout and cancellation, and concurrent same-target enqueue serialization (one spool invocation; the second call sees coverage).

Added a guard that scans the shipped shim section for tool names, corpus descriptions, schemas, instructions, and result wording. Temporary planted tool-name, corpus-line, and schema fixtures are rejected. It also checks the two subprocess call sites and their fixed Git/spool entry points. `test_mcp.py` now only imports the focused relay suite and contains no legacy tool-wording assertions.

Checks:

- Before correction, `python3 -m unittest test_mcp test_mcp_guard` exposed a test harness mocking bug: the spool mock also intercepted Git reader subprocesses. The mock was narrowed to the fixed spool argv.
- `python3 -m unittest test_mcp test_mcp_guard` — `Ran 10 tests ... OK`.
- `go test ./internal/serve -run 'TestMCP' -count=1` from `packages/yakka` — `ok github.com/codyhamilton/yakka/packages/yakka/internal/serve 3.071s`.
- `python3 -m py_compile yakka.py test_mcp.py test_mcp_shim.py test_mcp_guard.py` — passed.
- `git diff --check` — passed.

Concern/limitation: the Python parity harness uses a local authenticated protocol fixture rather than starting the product server, so it proves relay-versus-direct wire equality and injected-request identity but not one live cross-process shim-to-product-server run. The Go MCP suite independently passes against the committed server fixtures. Claude Code, Codex, and Cursor sessions were unavailable, so `_meta` visibility and failed-initialize behavior were not observed. The unrelated pre-existing layout test was not run or investigated. No implementation contract contradiction or unrelated product bug was found.
