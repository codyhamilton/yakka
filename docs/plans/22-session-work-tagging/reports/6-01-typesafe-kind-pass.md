# Report: 6-01 — back-fill pass 2, TypeSafe kind classification

Status: done with concerns. The code, fake-only tests and documentation are complete. The real
classification run, the threshold on real gold data and the drain check are gated (see below).

## What was built

- `tools/session_backfill/typesafe_kind.py`: the eleven-label `work_kind` choice question (ten kinds
  plus `unclear`, criteria as a map); the prompt prefix (first non-empty line, scrubbed through the
  pass-1 `_scrub_evidence` with a 1000-character limit, so scrub runs before the cut); the request
  `{"model", "state": {"prompt"}, "questions"}` checked by `validate_systemone_request` before any
  transport call; answer parsing; `classify_prompt`, which never raises for a bad answer or a failed
  call; `live_transport`, the only path to `jev_client.post_systemone`.
- `tools/session_backfill/kind_pass.py`: target and gold collection (pass-1 partial labels; queue-log
  sessions with a known kind); the threshold rule; accuracy (overall, per kind, confusion matrix);
  routing into completed `method=typesafe` labels or the review JSONL; enqueue with one fact per
  conversation ID; the CLI.
- `tools/session_backfill/tests/test_kind_pass.py`: 22 fake-only tests (see evidence).
- `tools/session_backfill/README.md`: a Pass 2 section (invocation, dry run versus live, threshold,
  routing, gates).

## Verification (synthetic fixtures and fake transports only)

Commands, run from the worktree root:

- `python3 -m unittest discover -s tools/session_backfill/tests`: 34 tests, OK. Before this unit it
  was 12 OK. The 22 new tests cover the scrub across the cut, the assignment and token shapes, the
  request state containing only the prompt, the eleven-label criteria map, the answer outcomes, the
  transport error and `SystemExit` isolation, the empty prompt making no call, the threshold rule,
  the accuracy and confusion rows, the routing outcomes, the dry run with `post_systemone` patched to
  fail, the live routing with per-item error isolation, the enqueue writing one `typesafe` fact and
  being idempotent, the no-gold case, and the CLI refusals (`--enqueue` without `--live`; `--live`
  without `--confirm-egress`; both exit 2 before any transport).
- `python3 -m unittest discover -s plugins/yakka/client -p test_facts.py`: 15 tests, OK.
- `python3 -m unittest discover -s tools/transcript/tests`: 11 tests, OK.
- `python3 -m py_compile` on the three new Python files: OK.
- `git diff --check`: clean.

## Departures from the brief, and why

- Added the reason `empty_prompt`. An empty prefix makes no call and goes to review. The brief did
  not name this case.
- The transport catch includes `SystemExit`. `post_systemone` exits on HTTP and URL errors instead
  of raising, so catching only `Exception` would not isolate a failed item.
- The report's overall and per-kind accuracy count `unclear` and unusable answers as misses. The
  threshold excludes them, as the brief requires. The brief did not say which way accuracy counts
  them, so I chose the stricter reading.
- The prompt prefix scrubs the whole first non-empty line and then cuts at 1000 characters. Pass 1
  cut the line at 2048 first. Scrubbing the full line means a secret cannot be left half-cut at the
  2048 limit.
- A dry run writes nothing. The review file is written only with `--live`. The brief allowed either
  reading.
- The CLI checks `TYPESAFE_API_KEY` before `--live` runs. The brief named the key but not the check.
- Reuse: `kind_pass` and `typesafe_kind` import the private `_scrub_evidence` from `backfill`. This
  keeps the scrub order identical to pass 1. It is a cross-module private import, which a later
  refactor should make public.

## Unfinished, and what would settle it

- The threshold cannot be computed on real data. The gold set on codyh-ubuntu is 0/0 (Phase 5). The
  threshold is `null` until the queue-log join yields gold items.
- The live response shape is assumed. `answers["work_kind"]["choice"]` and `["confidence"]` match the
  `tools/jev-variants/runner.py` choice answer, but no real TypeSafe response for this question has
  been seen. The first live run should inspect one raw response before the parse is trusted.
- The drain and analytics check (`GET /v1/actions?source=backfill&max_confidence=<T>` against the
  report count; `dims=[action_kind, action_source]`) has not run. It needs the live enqueue and a
  drain, both gated.

## Gates (Cody)

- gate: Cody to authorise the live TypeSafe run and prompt egress (scrubbed 1000-character prefixes of partial and gold sessions), per Assumption 19 and Open Questions.
- gate: Cody to choose the queue-log-to-session join so the gold set is non-empty; until then the threshold is unset and no label completes.
- gate: Cody to confirm the accuracy bars (the 0.90 threshold bar and the per-kind bar).
- gate: Cody to authorise the real enqueue and the drain and analytics check.
- `artifact_feedback` was not called on this report or the brief. It sends the report to a remote
  screen, which is egress, so it is gated under the no-egress rule for this phase.

## Carried

- Layout-test failure: the failure recorded in `IMPLEMENTATION.md` (Phase 5 record) is unrelated and
  was not run or chased in this phase. The suites above do not include it.
- The `typesafe_kind` to `backfill` private import (see departures).
