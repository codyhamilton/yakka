# Phase 3: `artifact_feedback` on the server

Status: done.

Implemented the Phase 3 brief and design outcome. The service now registers `artifact_feedback` in its production MCP registry with read scope, `readOnlyHint`, the declared v1 readers, and server-side path validation and result wording. The handler uses authenticated tenant-store artifact and baseline reads. It implements the recorded feedback states, screen and score lines, queue/rejection behavior, the bounded running-drain wait, and the D3 file-size rule. It does not start a drain, write to the queue, ingest, wake the worker, or use local claims as tenant identity. The characterization corpus was committed before implementation.

Evidence:

- `go test ./internal/serve/... -run 'TestMCP(ArtifactFeedback|Stateless|.*Conformance)' -count=1` passed. Direct authenticated MCP coverage checks the golden feedback corpus, declaration and read scope, argument errors, reader failure gates, queued/rejected/not-delivered/stale/delivered states, screen and score formatting, running-drain timeout behavior, tenant isolation, store immutability and log privacy.
- `go test ./... -count=1` passed all 16 Go packages, including `cmd/yakka` and `internal/serve`.
- `git diff --check` passed.

Departures: none from the Phase 3 brief. The 7 Nov v2 `enqueue_file_snapshot` amendment is outside this phase; the implementation retains read-only v1 semantics.

Unfinished work: Phase 4 still owns the Python shim, local readers and static guard. The server-side store has no way to produce a `baselines unavailable` read error in a deterministic fixture; the handler preserves that response path, while ordinary baseline formatting is verified against tenant data.

Known problems: the unrelated pre-existing layout test failure documented in the design and Phase 1 was not reproduced by this suite and was not investigated or changed.
