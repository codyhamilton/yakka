# Brief: 1-01 — Action record path

Consumer: the Plan 22 execute runner and the next phase's implementer.
Owned paths: `packages/yakka/internal/actions/`, `packages/yakka/internal/ingest/`, `packages/yakka/internal/store/`, `packages/yakka/internal/serve/`, `packages/yakka-analytics/src/lib/api.ts`, `docs/design/01-event-model-and-ingest.md`, `docs/design/03-remote-service.md`.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/22-session-work-tagging/reports/1-01-action-record-path.md` and include it in the commit.
Depends on: nothing.
Runs alongside: nothing.
Budget: Read the Phase 1 contracts and the relevant server paths; change the Phase 1 surfaces only. If the design requires substantial unplanned scope, stop with a specific handoff.

## Required reading, in order

1. `docs/plans/22-session-work-tagging/DESIGN.md` — Domain: Action contract; Domain: Record and projection (server); Phase 1 — Action record path; Assumptions 24, 25 and 29.
2. `packages/yakka/internal/ingest/ingest.go`, `policy.go`, `packages/yakka/internal/store/store.go`, `packages/yakka/internal/serve/serve.go`, `admin.go` — current ingest, tenant store and worker boundaries.
3. `packages/yakka/catalogue/checks/execution-report.json` — required report rubric.

## Goal

Implement the server action record path: accept structurally valid `session_action` facts into ingest, validate/project action values asynchronously into persistent action rows, and expose the Phase 1 action and admin reads while keeping current analytics behavior unchanged.

## Contract

The binding contracts are the design's **Domain: Action contract**, **Domain: Record and projection (server)** and **Phase 1 — Action record path**. `session_action` ingest validates only fact structure and `conversation_id`; action value errors are stored as rejected projected rows, not returned as 4xx. Projection is independent of screening/scoring retries. Segments are recomputed from all rows for a conversation and are arrival-order independent. `session_action` facts do not affect existing conversation, `hook_events` or facet counts. `GET /v1/actions` is bearer read scoped; admin status gains the specified action counts.

The action vocabulary, normalisation, raw values, reason codes, precedence, source/method fields, projection cadence/retry behavior and fixture table are specified in the cited design sections. Do not create client-side validation, a write endpoint, MCP work, or Phase 2 capture.

## Changes

- Add `internal/actions` as the server contract/validation and projection logic, including the fixture table and contract tests.
- Extend ingest to accept `session_action` without changing its structural validation or secret-scan behavior for existing fact types.
- Add the action table and exact projection state to the store, with a migration and queries needed by projection, actions read and status.
- Run bounded action projection independently from screening/scoring backoff; failed action projections must not stall other tenant work.
- Add `GET /v1/actions` and action counts to `/v1/admin/status`, including the typed API surface.
- Update only the Phase 1 server design docs needed to keep their current contracts accurate.

### Keep untouched

Do not edit client code, hooks, OpenCode, `internal/mcp`, the analytics cost query (Phase 3), MCP tools (Phase 4), backfill tools (Phases 5–7), or other plan/worktree/branch files. Preserve existing ingest secret scanning and current conversation, hook-event and facet query results. Do not make real classification or egress calls; Phase 1 verification uses local fixtures/fakes only.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `cd packages/yakka && go test ./...` → pass, covering all eight Phase 1 outcome items; do not chase the unrelated pre-existing layout test failure documented in DESIGN.md.
- Local fake-backed verification exercises scoring enabled, scoring disabled and scorer unreachable without any real classification or egress call.
- The phase outcome's API entry points demonstrate accepted and rejected projection, duplicate ingest, order-independent segments, precedence, isolated failed projection, stable legacy analytics counts and action admin status.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. State changes, exact checks and outputs, departures and reasons, unfinished work, known problems, and any contradiction between this brief and its contracts. Include a `gate: <what needs Cody>` line if any step requires live calls or human confirmation; use fakes rather than making the call.
