# Phase 2: stateless MCP tools

Status: done with concerns.

Implemented against `briefs/phase2-01-stateless-tools.md`:

- Added exact server MCP definitions for `list_checks` and `search_artifacts`, including old descriptions, schemas, read-only annotations and instruction sentence.
- Added server argument checks and formatted results. Calls use the checks configured at startup and the authenticated tenant's store; both tools declare no local readers.
- Added an explicit startup registration call in `cmd/yakka/main.go`; Phase 1 conformance servers remain free to register only test tools.
- Added corpus assertions for tool metadata, initialize instructions, list checks, empty results, validation errors and `_local` independence. Populated search coverage verifies tenant isolation and compares the MCP formatting to the same tenant's REST search result.

Evidence:

- Corpus `testdata/mcp-golden/stateless-tools.json` was committed at `8f91f4b`, before implementation. The focused test command `go test ./internal/serve/... -run 'TestMCP(Stateless|.*Conformance)' -count=1` passed.
- Full suite `go test ./... -count=1` passed all 16 packages. `git diff --check` passed.
- The focused checks did not exist before implementation; there was no Phase 2 failing-test run to report before code changes.

Departure and limitation: the Python test fixture fixes the populated search rank at `-1.5`, while the Go store computes rank from indexed records. The test therefore checks the populated server result against the corresponding REST result from the same tenant store, rather than asserting the fixture's artificial rank. The corpus README records this exception and lists the client-generated failure strings excluded from server wording.

Unfinished work: none for Phase 2. Phase 3 still owns `artifact_feedback` migration. The unrelated pre-existing layout test failure was not reproduced in the full Go suite and was not investigated or changed.
