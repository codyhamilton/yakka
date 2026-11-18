# 5-04 — signal rule rebuild: report

Status: `done`.

## What changed

Rebuilt `tools/session_backfill/backfill.py` to the DESIGN Domain "Back-fill" simple rule; no HTTP
route, kind, subject type, grain, dependency, env var or contract change. Dry run is still the
default, and the enqueue writer and `Build` are unchanged.

- `Session` now carries the store's real `first_prompt` and its `signals` (`Signal`: class, kind,
  signal text, source, id). `read_session` builds both from the store's own records, not the
  concatenated text. Bounded reads (`1 << 20`, JSONL head/tail), `cwd`, `branch`, `files` and
  `unreadable` are kept.
- One table, `SKILL_SIGNAL_TABLE`: `design`/`plan`/`planning` → planning/`design`; `refine` →
  refining/`refine`; `execute`/`plan-execution` → executing/`build`, matched after the last `:`.
  Claude `Skill` calls and `<command-name>`/`<command-args>` lines and Cursor
  `<manually_attached_skills>` `Skill name` lines all use it. A separate `BRIEF_RE` reads
  `docs/plans/<plan>/briefs/<file>.md` from the first user prompt only.
- Signals collapse by class; >1 class is `multi_signal`; none is `no_signal`; one class with no
  subject is `no_subject`. Only `labelled` carries an action and enqueues.
- Subject: plan/phase/issue from the signal's own text at confidence 1.0; the existing
  `PLAN_RE`/`PHASE_RE`/issue/PR fallback over transcript, cwd, branch and files fills only at 0.65.
  `--repo` stays required; PR alone is not a subject. Evidence names the signal and subject source,
  scrubbed, ≤300 chars.
- Discovery skips Claude `subagents/` (`skipped_subagent`) and Cursor `subagents/`
  (`skipped_child`), dedupes conversation ids per store into one row and reports `duplicate_ids` and
  `duplicate_transcripts`. `discover` fills a stats dict; `main` prints per-store and `total` rows
  with `sessions`, the five statuses, `labelled_by_signal`, the skip/duplicate counts and
  `transcripts_discovered`.
- Removed `QUEUE_FILE_RE`, `parse_queue_logs`, `--queue-logs`, queue truth, `score_gold` and gold
  fields, `FLASH_RE`, `is_flash_analysis` and the `excluded` status, and the 0.55 tier. Deleted
  `typesafe_kind.py`, `kind_pass.py`, `tests/test_kind_pass.py` and the README Pass 2 section.
- README rewritten to the simple rule, per-harness shapes and recon counts, first-prompt brief
  path, statuses/confidence, count report, skips and the dry-run/enqueue boundary.
- Tests: 24 synthetic fixtures across the four stores replace the queue-log/gold/Flash tests,
  including one per rule bullet, the Cursor subagent skip, duplicate ids, report reconciliation and
  a dry-run/no-enqueue test.

## Check output

Before (new tests against the old tool, captured before any code change):

```
Ran 24 tests in 0.038s
FAILED (failures=31, errors=9)
```

Representative failures: `'partial' != 'multi_signal'`, `'unresolved' != 'no_subject'`,
`'unresolved' != 'unreadable'`, and `KeyError`/missing `total` from the old CLI shape. The old tool
has no signal rule, so the rule fixtures cannot pass against it.

After:

```
python3 -m unittest discover -s tools/session_backfill/tests -p 'test_backfill.py' -v  → Ran 24 tests, OK
python3 -m unittest discover -s tools/session_backfill/tests -v                        → Ran 24 tests, OK
cd plugins/yakka/client && python3 -m unittest test_facts                              → Ran 15 tests, OK
python3 -m py_compile tools/session_backfill/backfill.py                               → exit 0
git diff --check                                                                       → clean
grep -rn "parse_queue_logs|score_gold|FLASH_RE|is_flash_analysis|QUEUE_FILE_RE|--queue-logs|typesafe_kind|kind_pass" tools/session_backfill → no matches
grep -rn "review export|review import" tools/session_backfill                          → no matches
```

Synthetic CLI dry run (the brief's `/var/tmp` fixture, no `--enqueue`/`--queue-dir`): exit 0, one
`labelled` brief-path `build` label with phase 5 and confidence 1.0 per store (4 total), the count
report keys present, no `emitted` key, and no queue files written. Scratch root removed
(`/var/tmp/p22p5-synthetic`); `/tmp` not used.

## Deviations from the brief

- None on scope, rule, statuses, confidence, enqueue boundary or deletions.
- Minor: `--queue-dir` and `--enqueue` remain as CLI options (the brief keeps the enqueue writer and
  the dry-run default; tests use an isolated queue dir). No done-evidence run used either.
- Minor: OpenCode has no recorded message order outside ids, so `_opencode_first_prompt` orders the
  first user message's `text` parts by part id. The brief says "in order"; ids are the only order
  the store carries here.
- Minor: Cursor `<manually_attached_skills>` carries no arguments, so a Cursor executing/refining
  signal takes its subject from the fallback at 0.65 unless a plan path is elsewhere in the
  transcript. DESIGN says arguments come from "where the transcript carries them"; the block does
  not carry them, so this follows the contract.

## Contradictions between brief and contracts

- None found. The brief's accepted ids include `planning`, matching the DESIGN table; dedupe is
  per store, matching DESIGN's "not de-duplicated across stores"; a Cursor block has no args, which
  the DESIGN identity clause already anticipates.

## Unfinished / deferred

- 5-05 (next unit): the real four-store dry run and the recorded count report. No real-store counts
  were produced here.
- Real enqueue and drain: not run. `gate: Cody to authorise the real back-fill enqueue and drain; not run here.`
- Phase 4 remains held on Plan 24; Phase 6 is dropped; Phase 7 is the follow-up review.

## Known problems

- A first prompt that quotes a brief path (for example a Flash analysis) is labelled `brief`; DESIGN
  Assumptions 43/46 accept this and the report's `labelled_by_signal` shows the inflation.
- `ISSUE_RE` over skill arguments inherits the existing extraction and can read a `#N` in problem
  text as a GitHub issue.
- Cursor sessions without a plan path in the transcript become `no_subject` (hence unlabelled);
  expected from the rule, but it will suppress many Cursor rows in the 5-05 counts.
- No real-store run was done, so the post-rebuild labelled/no-signal balance is unknown until 5-05.
