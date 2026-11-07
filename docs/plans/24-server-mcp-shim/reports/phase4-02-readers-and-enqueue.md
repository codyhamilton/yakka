# Phase 4-02 — readers and bounded enqueue

Status: done with concerns.

Implemented the fixed declaration reader table, `_local` overwrite and secret-key scan, queue reader v2 complete coverage, and the declared `enqueue_file_snapshot/1` directive flow. The action binds to the original call token, revision and resolved path, revalidates file identity and hash, serializes queue check-and-append, and invokes only the installed spool entry point with pointer metadata. The spool acknowledgment is opt-in; ordinary hook stdout remains unchanged. The conformance fixture now permits queue v2 and its file dependency.

### Evidence

- `python3 -m py_compile plugins/yakka/client/yakka.py` — passed.
- `git diff --check` — passed.
- `go test ./internal/serve -run 'TestMCP.*Conformance' -count=1` — passed.
- Focused reader smoke — passed foundation readers, in-worktree hashing/containment, 50-entry diagnostic samples, and coverage counting all 51 matching entries.
- Fake-server directive round trip — passed capability check, call/path binding, one valid pointer enqueue with no file bytes, and final continuation.
- Focused failing checks were not added before this unit; the owned paths do not include the Python test module. The existing `python3 -m unittest test_mcp` run from the client directory failed with 11 failures and 3 errors: it still calls the removed `_mcp_handle` and expects legacy local MCP behavior against GET-only stubs. The module does not exercise the new declared readers or directive loop.

### Concerns and limits

The available Python suite does not cover reader boundaries, failure codes, cancellation/deadline behavior, restart retry behavior, or concurrent same-target enqueue. The focused smoke checks cover the successful paths only; Phase 4-03 owns conformance tests and static guards. The unrelated pre-existing layout test was not run or investigated. No effect was interrupted during these checks.

Deviations: none from the amended brief. No Go handler/state, drain behavior, hook configuration, queue packet format, REST, harness launch, or other plan files were changed. The fixed spool writer changed only to add the authorized opt-in acknowledgment.
