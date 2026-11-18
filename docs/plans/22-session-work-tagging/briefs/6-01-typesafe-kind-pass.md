# Brief: 6-01 — back-fill pass 2, TypeSafe kind classification

Consumer: Plan 22 Phase 7 review tool maintainers (the review file and the report are its input).
Owned paths: `tools/session_backfill/` (new `typesafe_kind.py`, new `kind_pass.py`, new tests, `README.md`). Touch nothing else except this plan's brief, report, and implementation record.
Commits: one commit on the current branch when the done evidence passes, with a plain-summary title. The phase-closing commit is written by the runner, not by this brief.
Report: before committing, write `docs/plans/22-session-work-tagging/reports/6-01-typesafe-kind-pass.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: Phases 3 and 5 (both closed by their trailers). Runs alongside: nothing.
Budget: 12 files to read, about 600 lines to change, 30 tool turns.

## Required reading, in order

1. `docs/plans/22-session-work-tagging/DESIGN.md` — Phase 6 outcome, Back-fill domain (Pass 2), Assumptions 17 and 19, Open Questions (accuracy bars, prompt egress).
2. `docs/plans/22-session-work-tagging/IMPLEMENTATION.md` — Phase 5 outcome and carried items (gold set is 0/0 on codyh-ubuntu).
3. `tools/session_backfill/backfill.py` — discovery, `label_session`, `_scrub_evidence`, `score_gold`, `enqueue`.
4. `tools/transcript/lib/jev_client.py` — `build_questions`, `validate_systemone_request`, `post_systemone`, the `choice` question shape (`criteria` is a map).
5. `tools/jev-variants/runner.py` lines 40–60 — the `choice` answer carries `choice` and `confidence`.

## Goal

Add the TypeSafe kind pass: a new schema (ten kinds plus `unclear`, with confidence) separate from the existing session-kind labels, a client in the style of `jev_client.py` with an injectable transport, the secret scrub and fixed-prefix truncation applied before any request is built, gold-set accuracy and threshold computation, routing of results into complete `method=typesafe` facts or a review file, and a dry run that makes no call.

## Contract

- **Schema.** One `choice` question, id `work_kind`. Criteria map (a dict) for exactly eleven labels: `design, refine, build, review, fix, close-out, sync, escalation, triage, research, unclear`. The question text says `unclear` only when no kind dominates. The request is `{"model": JEV_MODEL, "state": {"prompt": <prefix>}, "questions": {"work_kind": …}}` and nothing else: no cwd, branch, file list, store name or session id leaves the machine. Preflight with `validate_systemone_request` before any transport call.
- **Prompt.** The prompt is the first non-empty line of the bounded session text, as Pass 1 defines it. Order is fixed: secret scrub first (`SECRET_ASSIGN_RE`, then `yakka.Redact`, then whitespace collapse), then truncation to `PROMPT_PREFIX_CHARS = 1000`. A secret straddling the cut is redacted in full before the cut, so no partial secret reaches the request.
- **Answer.** `answers["work_kind"]["choice"]` must be one of the eleven labels and `["confidence"]` a number in [0, 1]. Anything else (missing answer, unknown label, non-numeric or out-of-range confidence, transport exception) yields `unclear` with `reason` set (`invalid_answer` or `transport_error`), never a completed label.
- **Threshold.** Over gold items (queue-log sessions with a known kind, classified through the same transport), `unclear` answers are excluded. The threshold is the lowest confidence `c` among the gold answers at which the accuracy of the non-unclear answers with confidence ≥ `c` is at least 0.90. If no `c` qualifies, or the gold set is empty, the threshold is `None` and every result is routed to review.
- **Routing.** A result completes its label iff the threshold is not `None`, the kind is not `unclear`, and confidence ≥ threshold. A completed label becomes `status=complete` with `kind` added to the partial action, and is enqueued through `yakka.EnqueueSessionAction` with `source="backfill", method="typesafe", confidence=<model confidence>`, evidence built from the scrubbed prefix (≤300 characters). Everything else goes to the review file (JSONL: session id, store, subject fields, predicted kind, confidence, reason, scrubbed prompt prefix) and enqueues nothing. One complete action per conversation id per run, as Pass 1 does.
- **Scope.** Targets are partial labels from Pass 1 (subject, no kind), recomputed from the same explicit roots. Flash analysis sessions are skipped as in Pass 1. Sessions with no subject are not targets.
- **Report.** JSON with: targets, gold count, per-kind and overall gold accuracy, confusion matrix (gold kind × predicted label including `unclear`), threshold (or `null` with reason), completed and review counts by reason, enqueued count. Dry run prints the same shape with the classification fields null and no network activity.

## Changes

- `tools/session_backfill/typesafe_kind.py`: schema constants, scrub and truncation, request build with preflight, answer parse, default transport (`lib.jev_client.post_systemone`, imported lazily and never called unless `--live`).
- `tools/session_backfill/kind_pass.py`: gold accuracy, confusion matrix, threshold, routing, review rows, enqueue, the pipeline entry point `run_pass(..., transport=None)` and a CLI.
- CLI: default is dry run. `--live` requires `--confirm-egress` and `TYPESAFE_API_KEY`. `--enqueue` requires `--live`. Without `--live` no transport is touched.
- `tools/session_backfill/tests/test_kind_pass.py`: tests as listed below.
- `tools/session_backfill/README.md`: a short Pass 2 section (invocation, dry run versus live, review file, the gates).

## Keep untouched

Do not read `~/.local/share/workflow/queue`, the production transcript stores, or any codyh-ubuntu data root. Do not call `post_systemone` or any network path. Do not modify `tools/transcript/lib/jev_client.py`, the server packages, or `yakka.py`. Do not add a credential to any client config. Do not add client-side copies of the server action vocabulary beyond the eleven classifier labels, which are the TypeSafe question's labels and not the action contract.

## Done evidence

Identify the targeted checks before implementation; run them against synthetic fixtures and fake transports only.

- Scrub before truncation: a secret placed across the 1000-character cut is absent from the prefix; `api_key=…`, a GitHub-token-shaped value and an AWS-key-shaped value are all removed; prefix length ≤ 1000.
- Request contents: the built request's `state` has exactly the key `prompt`; `validate_systemone_request` accepts it; the question's criteria map has the eleven labels.
- Answer parse: valid answer; unknown label; out-of-range and non-numeric confidence; missing answer; each becomes the documented outcome.
- Threshold: the lowest qualifying `c` on a hand-built gold set; `unclear` excluded; no qualifying `c` gives `None`; empty gold gives `None`.
- Accuracy: per-kind accuracy and confusion matrix on a hand-built set; rows sum to the gold count.
- Routing: complete at or above threshold and enqueued with `method=typesafe` (the queue file parses to one `session_action` fact via the existing builder); below threshold, `unclear`, invalid and transport-error results go to the review file and enqueue nothing; threshold `None` enqueues nothing.
- Idempotence: a second run with the same fake answers creates no new queue files.
- Dry run: `main([...])` with no `--live` never calls `post_systemone` (patched to fail the test), writes no queue file, prints the report shape with null classification fields.
- Refusals: `--enqueue` without `--live`, and `--live` without `--confirm-egress`, exit non-zero before any read of a transport.
- Failure isolation: a transport exception on one item routes that item to review with `transport_error` and the others still complete.
- `python3 -m unittest discover -s tools/session_backfill/tests` passes (the 12 existing tests plus the new ones); `python3 -m unittest discover -s plugins/yakka/client -p test_facts.py` still passes; `python3 -m py_compile` on the new files; `git diff --check` clean.

## Gates

Record these in the report and the result file, verbatim:

- `gate: Cody to authorise the live TypeSafe run and prompt egress (scrubbed 1000-character prefixes of partial and gold sessions), per Assumption 19 and Open Questions.`
- `gate: Cody to choose the queue-log-to-session join so the gold set is non-empty; until then the threshold is unset and no label completes.`

No live call, no network, no classification and no drain happens in this brief.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. State the live run and the gold-set threshold as gates. Do not report any result from real data.
