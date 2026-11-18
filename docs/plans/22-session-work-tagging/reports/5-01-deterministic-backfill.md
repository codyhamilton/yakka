# Phase 5 report — deterministic back-fill

Status: `done with concerns`.

## What changed

- Added an offline deterministic back-fill tool for explicit Claude, Codex, OpenCode, and Cursor roots, nested queue logs, session labels, coverage summaries, masked gold scoring, Flash-analysis exclusion, and optional local queue enqueueing.
- Added OpenCode session/message/part joining and bounded transcript reads so the full-store scan does not retain transcript bodies in memory.
- Added `EnqueueSessionAction` to `yakka.py`. It writes tag-only `yakka.session_action` events with empty payloads, stable content-derived names, and optional `method`, `confidence`, and `evidence` carried through `Build` into the fact.
- Documented invocation and queue semantics in `tools/session_backfill/README.md` and `docs/design/02-edge-capture.md`.

## Evidence

- `python3 -m unittest discover -s tools/session_backfill/tests -v`: 6 passed. Synthetic coverage includes all four store shapes, nested queue logs, masked gold agreement (1/1), label categories, evidence scrubbing, exclusion, CLI output, and repeatable offline enqueue.
- `cd plugins/yakka/client && python3 -m unittest test_facts`: 15 passed, including exactly one parsed action fact and preserved deterministic provenance.
- `python3 -m py_compile tools/session_backfill/backfill.py plugins/yakka/client/yakka.py` and `git diff --check`: passed.
- The local read-only full-store dry run completed without enqueue or network access. It found 3,582 sessions: Claude 1,230 (1,148 partial, 82 unresolved), Codex 1,930 (1,378 partial, 552 unresolved), Cursor 409 (78 partial, 331 unresolved), and OpenCode 13 (13 unresolved). No complete labels were found; there were no matched gold sessions, so agreement was undefined (reported as 0/0), and no Flash analysis runs were identified. A separate metadata-only scan found 1,154 nested queue logs and no `session_id`, `sessionID`, or `conversation_id` fields in them. The planned inventory (~6,463 sessions and 890 Flash runs) does not match the stores available in this environment.
- No facts were enqueued, no drain or ingest was run, no classification or other egress call was made, and no human review was performed. The temporary label file was removed automatically.

## Departures and unfinished work

- The brief initially named a nonexistent `docs/design/02-client-and-hooks.md`; inspection found the existing contract at `docs/design/02-edge-capture.md`. The brief was amended and committed before implementation continued; its amended version passed `artifact_feedback`.
- Real queue-log/session association and the intended codyh-ubuntu inventory remain unverified. The observed log files do not carry session IDs, so the current local dry run cannot score gold or complete labels. Cody must reconcile the intended host's store roots and the deterministic queue-log-to-transcript join, then rerun the dry run.
- Real queue enqueue followed by drain/ingest verification remains gated on Cody because it sends facts out of the local queue.

## Known problems

- The current store inventory differs from the design's estimate and yields no complete labels or gold coverage. Do not rely on this run as evidence of the planned 95% agreement bar.
- The user-noted unrelated layout test failure remains unreproduced and uninvestigated; it was not chased.

## Contradictions

No implementation contract contradiction found. The local inventory and queue-log contents differ from the design's expected data and evidence linkage; this is recorded above rather than treated as a passing result.
