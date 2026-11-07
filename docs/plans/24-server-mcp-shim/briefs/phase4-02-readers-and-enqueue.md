# Brief: phase4-02 — local readers and bounded enqueue

Consumer: the Phase 4 execution worker implementing declared local context and the approved v2 action.
Owned paths: `plugins/yakka/client/yakka.py`, `packages/yakka/internal/serve/testdata/mcp-readers.json`, `docs/plans/24-server-mcp-shim/reports/phase4-02-readers-and-enqueue.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/24-server-mcp-shim/reports/phase4-02-readers-and-enqueue.md` and include it in the commit.
Depends on: `phase4-01-transport`.
Runs alongside: nothing.
Budget: 7 files to read, about 650 lines to change, 35 tool turns. Past the budget, stop and report over budget.

## Required reading, in order

1. `docs/plans/24-server-mcp-shim/DESIGN.md` — Authorized amendment: declaration and capability negotiation, one directive round and result facts, bounded local primitive and pointer freshness; Domain: Shim and Domain: Local context readers; Phase 4 outcome.
2. `docs/plans/24-server-mcp-shim/IMPLEMENTATION.md` — Phase 3 closure and carried items.
3. `plugins/yakka/client/yakka.py` — readers' source helpers (`Load`, `RepoID`, `RepoPath`, queue paths, secret scan), plus the transport seam from unit 1.
4. `packages/yakka/internal/serve/testdata/mcp-readers.json` and `plugins/yakka/client/spool.sh` — current reader/server fixture and fixed queue writer contract.

## Goal

Inject only server-declared local facts, and implement the one separately authorized, call-bound `enqueue_file_snapshot/1` primitive while preserving the read-only v1 declarations for callers that do not negotiate v2.

## Contract

The v2 addendum is binding and takes precedence over the original v1 auth/context-only rule only for the explicitly approved action. Implement the exact declarations, capability advertisement/header agreement, one directive round, same-call continuation, outcome facts, cancellation/deadline/retry semantics, queue v2 complete coverage, and path/generation guards in `DESIGN.md`. The shim never owns tool wording or state. An enqueue acknowledgment alone never means queued or delivered. Unknown, stale, malformed, changed-path, incomplete-coverage, and unsupported cases follow the fixed codes in the addendum; they must not execute or claim success. The queue writer is the installed fixed `spool.sh` with fixed arguments and pointer metadata on stdin; never shell-evaluate server data.

## Changes

Implement the declared reader table and strict parameter/dependency/version checks, `_local` construction and key-leak scan. Add queue reader v2's coverage facts while preserving its v1 samples. Implement the bounded primitive and immediate revalidation; serialize same-target check-and-append; honor spool acknowledgment, hooklog and `YAKKA_BIN` rules. Update the shared reader conformance JSON for queue v2. No generic effect framework, additional actions, arbitrary process/network access, file-content upload, or persistent retry ledger.

### Keep untouched

Do not change Go handler/state behavior from Phases 1–3, the spool/drain/hooks, queue packet format, REST, or harness launch files. No MCP direct ingest, worker wake, content scan, or shim-owned drain launcher.

## Done evidence

Identify or write focused failing checks before the change and report before/after output.

- Reader tests cover every foundation reader, boundaries, failures, fixed subprocess argv, secret removal, content/path containment, queue v1/v2 and complete-set coverage.
- Directive tests prove matching capability/declaration/call/path binding; exactly one enqueue and continuation; all failure codes; no repeated effect after transport retry/restart; and queue packet pointer metadata with no file bytes.
- Cancellation/deadline and concurrent same-target tests demonstrate the stated limits and serialization.
- The shared reader JSON is accepted by the Go registry conformance check and by the Python reader tests.
- `git diff --check` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. State exact evidence and output, deviations, and any open contract issue. Record clearly if an effect may have happened after an interrupted acknowledgment; never expose credentials, payloads, effect arguments, or absolute paths.

A non-trivial bug outside this unit's evidence: report its symptom, location and root cause; do not fix it here. Do not run the unrelated layout test.

Do not spawn agents beyond read-only research helpers.
