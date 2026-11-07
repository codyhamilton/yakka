Status: done with concerns

Built the generic MCP transport in the client section. Requests are forwarded to the fixed MCP endpoint with the resolved login on each network request; response bodies are validated and relayed unchanged. Added declaration metadata caching, one refresh/retry for `-32010`, bounded concurrent dispatch, cancellation and EOF abort, redirect refusal, response-size limits, and the closed transport/config error mapping. Left `_mcp_prepare_context` as the narrow seam for the next unit. Removed the client-side protocol, tool definitions, validation, and result construction.

Checks before change:

- `python3 -m unittest test_mcp` from the client directory: 2 legacy tests passed.
- A temporary focused relay probe failed: the old implementation synthesized a local `ping` response instead of relaying the server body.

Checks after change:

- Focused temporary transport probe: 5 tests passed for method-agnostic body relay/auth, unauthorized mapping, one stale refresh and retry, concurrent completion order, cancellation, and EOF.
- `python3 -m py_compile plugins/yakka/client/yakka.py`: passed.
- Static inspection of the replacement MCP section found no tool names, schemas, instructions, or tool result wording.
- `git diff --check`: passed.
- `python3 -m unittest test_mcp` is not compatible with this transport unit: the existing suite asserts local parsing and synthesized tool responses; it emitted errors and blocked waiting for a local parse-error response, so the run was interrupted. The test file is outside this unit's owned paths. The focused transport probe covers the replacement behavior.

Deviation: no test file changes, as required by the owned-path boundary. No contract contradiction found. The documented unrelated layout test was not run or investigated.
