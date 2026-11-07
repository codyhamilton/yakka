# MCP golden corpus

`stateless-tools.json` records the `list_checks` and `search_artifacts` contract
before those tools move from `plugins/yakka/client/yakka.py` to the Go server.
The tool definitions, instruction sentence, and populated call/error cases were
captured by running `yakka mcp` through the fixtures in
`plugins/yakka/client/test_mcp.py` on 2026-11-07.

The empty-result cases use those same MCP fixtures with the fixture response
changed to the service's existing empty states (`loaded: false` / no hits).
The file keeps client-side config and transport failure strings out of the Go
golden contract; they remain owned by the shim and are documented separately
when relevant.

Each call records only the observable tool result: `content[0].text` and
`isError`. Argument cases include every distinct validation branch for these
two tools. The definitions include only these two entries from the old
`_MCP_TOOL_LIST`; `instructions` is the exact old initialize sentence.
