# Implementation: Server-defined MCP shim

## Current Run — Phase 4

- Tool: Codex (GPT-6)
- Session: API run; session URL/ID unavailable
- Start: 2026-11-07T13:14:20Z
- Branch: feat/24-server-mcp-shim
- Invocation: build Phase 4 only; stop before review, terminal review, and close-out.

## Run

- Tool: Codex (GPT-6)
- Session: API run; session URL/ID unavailable
- Start: 2026-11-07T12:13:05Z
- Branch: feat/24-server-mcp-shim
- Invocation: build Phase 1 only; stop before review, terminal review, and close-out.

## Phase 1 — Server MCP endpoint and tool registry

Status: closed, 2026-11-07 (closing commit carries `Workflow-Phase: 24-server-mcp-shim:1`).

Phase has one cohesive server contract, so one inline brief was authored: `briefs/phase1-server-mcp-endpoint.md` (prepared at `2d7f9d3`). Artifact feedback initially returned `not delivered` because no version was present; at closure, both brief and report returned delivered, screen pass.

### Unit `phase1-server-mcp-endpoint`

The first worker pass was incomplete and left an uncommitted draft. Per execute retry policy, a fresh worker on the next model tier completed the unit and committed `dba4dd9`. Its report is `reports/phase1-server-mcp-endpoint.md`.

- Built: stateless authenticated `POST /v1/mcp`; bearer-only auth shared with REST; scope-aware MCP tool registry and declaration revisions; reader capability validation and typed local context; validation/context ordering; body budgets, deadlines and cancellation; privacy-safe structured call logs; conformance-only tests and the API docs update. No product tools or Python client changes.
- Surfaces: `packages/yakka/internal/serve/` and `docs/design/03-remote-service.md`, plus the report.
- Deviations: no departures from the brief or Phase 1 contract were reported. Cancellation is cooperative and registration occurs at startup; bounded configuration ceilings are documented in the report.
- Agent: first pass incomplete; retry worker completed. Harness did not expose per-agent turn/context counts.

### Verification (Phase 1)

- Entry point: authenticated and keyless test servers exercise `POST /v1/mcp` from request through JSON-RPC reply and tenant-scoped store observation. Conformance tests cover the eleven outcome clauses, including protocol handling, scoped registry listing, context validation, body limits, cancellation and log privacy.
- Independent runner check: from `packages/yakka`, `go test ./internal/serve/... -run TestMCP -count=1` passed (1.134s); `go test -count=1 ./...` passed all 15 packages, with `internal/serve` passing in 9.866s; `git diff --check` passed.
- Result: the Phase 1 outcome holds for the registered test tools. The server endpoint is implemented and the API table now describes it as existing; clients remain for Phase 4.

### Phase 1 — Carried

1. The unrelated pre-existing layout test failure identified by the user was not encountered or investigated, and was not changed. Keep it out of Phase 1 follow-up unless independently in scope.

## Phase 2 — `list_checks` and `search_artifacts` on the server

Status: closed, 2026-11-07 (closing commit carries `Workflow-Phase: 24-server-mcp-shim:2`).

The characterization corpus was committed first at `8f91f4b`; the single-unit brief is `briefs/phase2-01-stateless-tools.md` (prepared at `62930d1`, startup seam clarified at `ef635ed`). Brief artifact feedback returned delivered, screen pass. Report artifact feedback returned `not delivered` because the service had no version and nothing was queued; no report rating was available.

### Unit `phase2-01-stateless-tools`

- Built: registered server-owned `list_checks` and `search_artifacts` definitions, argument validation and result formatting. Both have empty context declarations and use the tenant-resolved check configuration/store directly. The service command registers these tools explicitly, leaving Phase 1 conformance registries product-tool-free.
- Surfaces: `packages/yakka/internal/serve/mcp_stateless.go`, `mcp_stateless_test.go`, `cmd/yakka/main.go`, and `testdata/mcp-golden/`.
- Deviations: the legacy populated search fixture hard-codes rank `-1.5`; that stub value cannot be an expected rank for the Go store. The test compares populated MCP text with the REST result generated from the same tenant store, and the corpus README records this limitation. No Python client or `test_mcp.py` changes.
- Agent: inline implementation; harness did not expose turn/context counts.

### Verification (Phase 2)

- Entry point: direct authenticated `tools/list`, `initialize` and `tools/call` requests against registered server tools. The corpus tests assert exact definitions, instruction sentence, list-check results, empty search, and all distinct argument-error results; a forged `_local` has no effect. Populated search uses a real indexed tenant store, verifies a second tenant sees no cross-tenant result, and compares MCP formatting with `/v1/search` formatting from the same store.
- `go test ./internal/serve/... -run 'TestMCP(Stateless|.*Conformance)' -count=1` passed.
- `go test ./... -count=1` passed all 16 packages; `git diff --check` passed.
- Result: Phase 2 server definitions, results, context-free declarations, REST formatting parity and tenant isolation hold. The previously documented unrelated layout test failure did not occur in this suite and was not investigated.

### Phase 2 — Carried

1. The committed populated-search corpus sample carries the Python fixture's hard-coded rank `-1.5`; use same-store REST parity for future real-rank evidence, as recorded in `testdata/mcp-golden/README.md`.
2. The unrelated pre-existing layout test failure remains uninvestigated and unchanged; do not chase it in this plan.

## Phase 3 — `artifact_feedback` on the server

Run identity: Codex (GPT-6), API session (ID unavailable), started 2026-11-07T12:51:07Z; branch `feat/24-server-mcp-shim`. Invoked for Phase 3 only; stop before review, terminal review and close-out.

Status: closed, 2026-11-07 (closing commit carries `Workflow-Phase: 24-server-mcp-shim:3`). The one-unit brief `briefs/phase3-01-artifact-feedback.md` and the reference corpus `testdata/mcp-golden/artifact-feedback.json` were committed before implementation. Artifact feedback on the brief returned delivered, screen pass. Feedback on the report returned not delivered because the service has no version of this file; no report rating was available.

### Unit `phase3-01-artifact-feedback`

- Built: registered server-owned `artifact_feedback` in the production MCP service with read scope, `readOnlyHint`, path validation, and the v1 `cwd`, `resolved_path`, `file`, `git`, `queue`, and `drain` declaration. The handler now reads the authenticated tenant's artifact and baseline data directly and formats the feedback states, screen and score lines, queue/rejection details, and D1 running-drain wait. No queue effect, drain kick, ingest, store write or worker wake was added. The 7 Nov v2 enqueue amendment remains outside this phase.
- Surfaces: `packages/yakka/internal/serve/mcp_stateless.go`, new `mcp_feedback.go` and `mcp_feedback_test.go`, `testdata/mcp-golden/artifact-feedback.json`, and `packages/yakka/cmd/yakka/main.go`.
- Deviations: none from the Phase 3 brief. The Python reference and hooks/drain were not changed.
- Agent: inline implementation; harness did not expose turn/context counts.

### Verification (Phase 3)

- Entry point: direct authenticated `POST /v1/mcp` `tools/list` and `tools/call artifact_feedback` requests exercise the declaration, validation, context reader gates, and response states. Tests prove tenant B cannot see tenant A's artifact, the handler leaves the store unchanged, and server logs omit injected paths and hashes. Running-drain cases verify both matching-hash delivery and the bounded queued response without starting a drain.
- `go test ./internal/serve/... -run 'TestMCP(ArtifactFeedback|Stateless|.*Conformance)' -count=1` passed (1.985s).
- `go test ./... -count=1` passed all 16 packages, including `cmd/yakka` and `internal/serve`; `git diff --check` passed.
- Result: the Phase 3 outcome holds for the characterized feedback cases, direct store-backed delivery/screen/score behavior, required-reader failures, read-scope access and tenant isolation. The unrelated pre-existing layout test failure was not encountered, investigated or changed.

### Phase 3 — Carried

1. Phase 4 refinement must include the design addendum's v2 `enqueue_file_snapshot` compatibility and directive deltas; Phase 3 retains read-only v1 behavior.
2. The store's normal path does not provide a deterministic `LatestScores` failure fixture. The `baselines unavailable` fallback is implemented, while ordinary baseline formatting is covered.
3. The unrelated pre-existing layout test failure remains uninvestigated and unchanged; do not chase it in this plan.

## Phase 4 — The thin shim, its readers, and the guard

### Unit `phase4-01-transport`

Status: done with concerns; committed as `eba14b3`. Report artifact feedback returned delivered, screen pass. The amended Phase 4 brief was committed before dispatch.

- Built: replaced the client-owned MCP implementation with generic stdio-to-server transport, auth/config handling, response relay, declaration caching and one stale-revision refresh/retry, bounded concurrency, cancellation, EOF handling, redirect refusal and transport errors. Left a narrow context-preparation seam for the next unit.
- Surfaces: `plugins/yakka/client/yakka.py` and `reports/phase4-01-transport.md`.
- Deviations/concerns: the legacy `python3 -m unittest test_mcp` suite still asserts local parsing and synthesized tool results; it blocked awaiting a local parse-error answer and was interrupted. Test replacement is assigned to `phase4-03-conformance-and-guard`.
- Agent: harness did not expose turn/context counts.

- Checks: focused relay probe passed 5 cases; `py_compile`, static scan of the MCP section, and `git diff --check` passed. The test-suite incompatibility is carried to the conformance unit.

### Unit `phase4-02-readers-and-enqueue`

Status: done with concerns; committed as `b81e77f`. Report artifact feedback returned delivered, screen pass. The brief was amended and committed to authorize only the required opt-in spool acknowledgment at the installed path `plugins/yakka/script/spool.sh`; the repository's installed script path differed from the design's stale path.

- Built: added declared local readers, secret-key scrubbing, queue reader v2 complete-coverage facts, and the single capability/call/path-bound enqueue directive and continuation. The action revalidates identity and hash, serializes check-and-append, and uses the fixed spool entry point with pointer metadata. The spool acknowledgment is opt-in and leaves hook stdout unchanged by default.
- Surfaces: `plugins/yakka/client/yakka.py`, `plugins/yakka/script/spool.sh`, `packages/yakka/internal/serve/testdata/mcp-readers.json`, and `reports/phase4-02-readers-and-enqueue.md`.
- Deviations/concerns: focused smoke covered successful reads and directive flow, including >50-entry coverage, but did not cover reader failure boundaries, cancellation/deadline, restart retry or concurrent same-target behavior. The legacy `test_mcp` suite fails because it calls removed `_mcp_handle` and expects local MCP behavior; Phase 4-03 owns replacement conformance coverage.
- Agent: harness did not expose turn/context counts.

- Checks: `py_compile`, `bash -n plugins/yakka/script/spool.sh`, `git diff --check`, Go MCP registry conformance, reader smoke, and fake-server directive round-trip passed. No layout test was run or investigated.

### Unit `phase4-04-docs-and-release`

Status: done with concerns; committed as `eeb787b`. Report artifact feedback returned delivered, screen pass.

- Built: rewrote the stable docs to describe the server-owned MCP boundary, declared local context and the bounded pointer enqueue, updated the `/v1/mcp` client row, and bumped the three plugin manifests from `3.4.0` to `3.4.1`.
- Surfaces: `docs/design/02-edge-capture.md`, `docs/design/03-remote-service.md`, `docs/design/04-advisory-surface.md`, the Claude/Cursor/Codex plugin manifests, and `reports/phase4-04-docs-and-release.md`.
- Deviations/concerns: no owned-path deviations. Its global whitespace check saw a concurrent Phase 4-03 trailing blank line in `test_mcp.py`; its six-path scoped check passed. Rerun global `git diff --check` after Phase 4-03 settles.
- Agent: harness did not expose turn/context counts.

- Checks: stale-claim scan passed; all three manifests parsed at version `3.4.1` and their prior committed versions were `3.4.0`; scoped `git diff --check` passed. The unrelated layout test was not run or investigated.

### Unit `phase4-03-conformance-and-guard`

Status: done with concerns; committed as `41f672b`. Report artifact feedback returned delivered, screen pass.

- Built: replaced legacy client-owned tool wording tests with relay/corpus parity checks and added reader/action safety cases and a static thin-shim guard. The guard rejects planted tool names, corpus text and schema literals, and checks fixed subprocess entry points.
- Surfaces: `plugins/yakka/client/test_mcp.py`, new `test_mcp_shim.py` and `test_mcp_guard.py`, and `reports/phase4-03-conformance-and-guard.md`.
- Deviations/concerns: test relay parity uses a local authenticated HTTP fixture rather than a live Go server process; harness-specific Claude/Codex/Cursor observations were unavailable. The phase runner will perform a live local Go server check before closure.
- Agent: harness did not expose turn/context counts.

- Checks: `python3 -m unittest test_mcp test_mcp_guard` passed 10 tests; focused Go MCP tests passed; `py_compile` and `git diff --check` passed. The unrelated layout test was not run or investigated.
