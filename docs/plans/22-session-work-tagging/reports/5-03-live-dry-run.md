# Phase 5 live dry run — codyh-ubuntu four stores

Status: `dry run recorded; Phase 5 remains open`.

Scope: the Phase 5 back-fill tool run in dry-run mode over the four real session stores on codyh-ubuntu, authorised by Cody on 8 Nov 2026 (about 12:55 AM AEST) for label-only reads. Nothing was enqueued, drained, ingested, classified, or sent over the network. `~/.local/share/workflow/queue` was not read or moved. Counts and IDs only are recorded here; the label file holds scrubbed prompt snippets and stays outside the repository.

## Run

- Host `codyh-ubuntu`. Run recorded here: started 2026-11-08T01:04:14+10:00, finished 01:06:31+10:00, on the tool after the two fixes below.
- Command: `backfill.py --root claude=$HOME/.claude/projects --root codex=$HOME/.codex/sessions --root opencode=$HOME/.local/share/opencode/storage --root cursor=$HOME/.cursor/projects --queue-logs $HOME/workspace/.briefs/q --repo codyhamilton/yakka --labels <outside the worktree>`. No `--enqueue`, no `--queue-dir`.
- Exit 0; stderr empty. No errors in the run.
- An earlier run on the unfixed tool, 3,619 sessions, is superseded. It differs only by the drift noted below and the unreadable-file drop.
- Snapshot drift: the Claude store is still being written (this session writes to it), so Claude grew from 1,235 labelled sessions in the earlier run to 1,239 here. Codex (1,962), Cursor (409) and OpenCode (13) matched the earlier run.

## Counts per store (dry run)

| Store | Sessions | Complete | Partial | Unresolved | Excluded | Partial, subject and phase (0.65) | Partial, subject only (0.55) | Unresolved (0.0) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| claude | 1,239 | 0 | 1,156 | 83 | 0 | 840 | 316 | 83 |
| codex | 1,962 | 0 | 1,409 | 553 | 0 | 1,173 | 236 | 553 |
| cursor | 409 | 0 | 78 | 331 | 0 | 30 | 48 | 331 |
| opencode | 13 | 0 | 0 | 13 | 0 | 0 | 0 | 13 |
| **total** | **3,623** | **0** | **2,643** | **980** | **0** | **2,043** | **600** | **980** |

- Every discovered session has exactly one label row (3,623 rows).
- Method is `deterministic` throughout. No complete labels exist, so no row is eligible for enqueue, and none carries `typesafe`.
- Subjects: 2,321 plan subjects, 322 GitHub-issue subjects; 2,236 rows carry a phase; 893 carry a PR number.
- Unresolved rows that still carry a phase but no subject: 10 Claude, 148 Codex, 35 Cursor.
- Unresolved for identity: 1 Codex rollout with no usable `session_meta` ID (`session_id` empty, cannot enqueue).
- Unreadable: 1 Claude transcript, zero bytes. The unfixed tool dropped it silently; it is now an unresolved row (`unreadable: 1`).
- Coverage: complete 0, incomplete 3,623.

## Gold set and server overlap — not measured

- Gold: 0 labelled, agreement 0/0. The 95% bar cannot be assessed here.
- Queue logs: 1,158 `par-*.log` files; 806 names match the parser's pattern (the other 352 do not). Only 9 logs contain session-ID-like text. Eight of those are code text, not data. The one real ID is OpenCode-shaped (`ses_…`, in `par-94-p6-opencode-1.log`) and has no match by name or content in the OpenCode store. The logs carry no usable join to transcripts, so no queue-log truth reached any session.
- Server overlap: not measured. It needs a `GET /v1/actions` snapshot, which is outside this step's no-egress scope, and the tool takes it only as an offline `--server-action-ids` file. With zero complete labels there are no labelled sessions to check. The 2,643 partial labels have not been checked against the server.

## Scope questions for Cody (not changed)

1. **Flash exclusion.** The tool excludes Flash analysis runs only in the OpenCode store, which holds none, so `excluded` is 0 everywhere. The same predicate (`flash` plus `analysis|rating|classification`) matches 224 Claude, 824 Codex and 10 Cursor sessions, 1,058 in total. These are labelled as ordinary work. The design's figure is 890. The two do not reconcile, and neither the store gate nor the predicate was changed.
2. **Gold join.** A queue-log-to-session association has to be chosen and approved (the design's Phase 5 gold-set requirement). The current logs cannot supply it.
3. **Subagent transcripts.** Claude discovery includes subagent transcripts (about 361 files), labelled under their own file-stem IDs. Cursor discovery excludes its subagent transcripts (619 files). The two stores treat them differently, and the design's subagent question is still open.
4. **Inventory.** The design estimated about 6,463 sessions. The four roots yield 3,623 pass-1 sessions under the current rules.

## Mechanical fixes made from this run (with tests)

1. **Unreadable transcripts were dropped silently.** Any Claude, Cursor or OpenCode transcript with a read error, or no parseable record, returned no session and so produced no row. That broke "every in-scope session appears in the output". These now yield an `unresolved` row, evidence "transcript unreadable or has no parseable records", counted in a new `unreadable` summary field. The OpenCode session-metadata path had the same silent skip and is fixed the same way.
2. **Duplicate conversation IDs could each enqueue a fact.** Ten conversation IDs appear in two transcript files each: nine Cursor chats filed under two project directories, and one Codex rollout whose `session_meta` ID matches another rollout (a resumed session). `enqueue` now emits at most one fact per conversation ID, and the summary reports `duplicate_conversation_ids` (10 here). No label is complete, so the fix does not change any count in this run.

Tests: `python3 -m unittest discover -s tools/session_backfill/tests` passes 12 tests, two new. Both new tests fail against the previous `backfill.py` (checked in a scratch copy). `cd plugins/yakka/client && python3 -m unittest test_facts` passes 15. `py_compile` and `git diff --check` pass.

## Not done

- No enqueue, drain, ingest, classification, or network call. Real enqueue and drain remain gated on Cody.
- The Phase 5 outcome is not met: gold agreement is unmeasured, server overlap is unmeasured, and the Flash-exclusion count differs from the design. Phase 5 is not closed.
- The unrelated layout-test failure documented in the design was not run in this step and was not chased.
