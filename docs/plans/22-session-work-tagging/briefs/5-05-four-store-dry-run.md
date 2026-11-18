# Brief: 5-05 — four-store dry run count report

Consumer: the Phase 7 follow-up review with Cody, and the Plan 22 orchestrator closing Phase 5.
Owned paths: `docs/plans/22-session-work-tagging/reports/5-05-four-store-dry-run.md`. Touch nothing else; this unit changes no code and does not edit this brief, `DESIGN.md` or `IMPLEMENTATION.md`.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/22-session-work-tagging/reports/5-05-four-store-dry-run.md` (this unit's deliverable and the phase's count report; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: `5-04-signal-rule-rebuild.md` (the rebuilt tool and count report).
Runs alongside: nothing; it runs after 5-04.
Budget: 6 files to read, 0 lines of code to change, 12 tool turns. Past the budget, stop: report `over budget` in this report (do not edit `IMPLEMENTATION.md`), commit what you have, and say what is unfinished.

## Required reading, in order

1. `docs/plans/22-session-work-tagging/DESIGN.md` — Domain "Back-fill", especially "The count report" and "Subagents fold into the parent" (129-163), and Phase 5's Outcome (649-670). Read these ranges only.
2. `docs/plans/22-session-work-tagging/IMPLEMENTATION.md` — the 19 Nov 2026 amendment "Phase 5: what is kept, what changes on rebuild" (19-38) and "Phase 5 live dry run: evidence behind the amendment" (48-60).
3. `docs/plans/22-session-work-tagging/reports/5-03-live-dry-run.md` — the prior run, its store totals and the caveats it recorded (1-57).
4. `tools/session_backfill/README.md` — the rebuilt invocation and the dry-run/enqueue boundary (Pass 1 section only).
5. `tools/session_backfill/backfill.py` — the `main` function and its report keys (start at `def main`); read it to know the output field names.
6. `docs/plans/22-session-work-tagging/briefs/5-04-signal-rule-rebuild.md` — the rule and the recon note this report must cite (Contract section).

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Run the rebuilt back-fill tool dry over the four local stores on codyh-ubuntu, print the count report the phase outcome names, prove the rows and discovery counts reconcile, and record the run under `reports/`. Nothing is enqueued or sent anywhere.

## Contract

The phase outcome is DESIGN Phase 5, quoted:

> On codyh-ubuntu, a dry run (no enqueue, no network) over the four local stores prints, per store (claude, codex, cursor, opencode) and in total, the count report of Domain "Back-fill": sessions; `labelled`; unlabelled split into `multi_signal`, `no_signal`, `no_subject` and `unreadable`; and `labelled` split by signal (planning, refining, executing, brief). Every discovered session is in exactly one row and the rows sum to the sessions; the skipped-subagent, skipped-child and duplicate-id counts are printed beside them and, with the sessions, reconcile with the transcripts discovered. The report is recorded under this plan's `reports/` and is what the follow-up review with Cody (Phase 7) reads.

The count report itself is DESIGN Domain "Back-fill", quoted:

> The dry run and the real run print, per store (claude, codex, cursor, opencode) and in total: sessions, `labelled` (a single signal and a subject; these are enqueued), and sessions left unlabelled, split by reason: `multi_signal` (more than one signal), `no_signal` (none), `no_subject` (one signal, no subject), `unreadable` (the existing unreadable-transcript and missing-identity rows). `labelled` is also split by signal (planning, refining, executing, brief), so a reader sees how much rests on each. Every discovered session appears in exactly one of those rows. Three counts sit beside the rows so the totals reconcile with discovery: Claude subagent transcripts skipped, transcripts skipped as another session's child in any other store, and duplicate conversation ids (a conversation id seen in two transcript files counts once and enqueues once).

The recon result the report records, from `5-04-signal-rule-rebuild.md`: Codex and OpenCode have no recoverable skill-load form (Codex: 2,862 parsed rollouts, no skill tool, `skills`/`host_skills` are settings/catalogue; OpenCode: 926 storage files, 120 tool calls, no skill tool and no slash command in user text), so both label by brief path only and their skill-based remainder appears as `no_signal`. Claude and Cursor have recognisers. The report says this; it does not hide it.

Safety and gates:

- This is the dry run only: no `--enqueue`, no `--queue-dir`, no drain, no live API, no network, no fly or wrangler, no deploy, no secrets, no tenant reset/delete, no Drizzle/DB migration.
- Real enqueue and drain are gated on Cody: `gate: Cody to authorise the real back-fill enqueue and drain; not run here.` Record it in the report; do not run it.
- Do not read or move `~/.local/share/workflow/queue`.
- Use `/var/tmp` for the label file, never `/tmp`, and remove it after the report is written. The label file carries scrubbed prompt snippets; never commit it and never print prompt or user content.
- No code, contract, route, kind, subject type, grain or env var change.

## Changes

No code. Run the rebuilt tool and write the report.

1. Run, from the repo root, exactly:

```sh
python3 tools/session_backfill/backfill.py \
  --root claude="$HOME/.claude/projects" \
  --root codex="$HOME/.codex/sessions" \
  --root opencode="$HOME/.local/share/opencode/storage" \
  --root cursor="$HOME/.cursor/projects" \
  --repo codyhamilton/yakka \
  --labels /var/tmp/p22p5-labels.jsonl
```

No other flags: no `--enqueue`, no `--queue-dir`, no `--queue-logs` (it no longer exists). Capture stdout and the exit status. Record the host, the start and finish time, the exact command and the exit status.

2. Write `reports/5-05-four-store-dry-run.md` with:
   - Status and scope: dry run only, no enqueue, no network, no drain, no queue-log read, `~/.local/share/workflow/queue` untouched.
   - The command, host, timestamp and exit status.
   - A per-store table and a total row with exactly: sessions, labelled, multi_signal, no_signal, no_subject, unreadable, and labelled-by-signal (planning, refining, executing, brief).
   - Beside the tables: skipped-subagent, skipped-child, duplicate-id and duplicate-transcript counts and transcripts discovered, per store and total.
   - The reconciliation identities: `sessions == labelled + multi_signal + no_signal + no_subject + unreadable`; `labelled == sum(labelled_by_signal.values())`; `transcripts_discovered == sessions + skipped_subagent + skipped_child + duplicate_transcripts`. Show each holds per store and in total, or name the exception.
   - The recon statement: Codex and OpenCode skill loads are unsupported; both label by brief path only, so their skill-based remainder is `no_signal`. Claude and Cursor use their recognisers.
   - The gate line for real enqueue and drain, and a statement that the dry run made no enqueue or network call and wrote no queue file.
   - The prior run's 3,623-session inventory as the comparison point, noting store drift if the counts differ.
   - The unrelated layout test was not run or chased.

3. Verify `git status --porcelain` shows only this report; remove `/var/tmp/p22p5-labels.jsonl`.

### Keep untouched

- No product code, tests, README, `DESIGN.md`, `IMPLEMENTATION.md`, `docs/design`, server or client files.
- No enqueue, no drain, no network, no secrets, no queue log, no workflow queue, no `/tmp`.
- The four real stores are read only; do not modify, move or delete a transcript.

## Done evidence

- The command above → exit 0, and stdout has the per-store and total count-report fields named in the contract; the output has no `emitted` key.
- Reconciliation → each identity in "Changes" holds per store and in total; report any exception with its counts.
- No enqueue → `--enqueue` and `--queue-dir` were not passed; if `$HOME/.local/share/yakka/queue` exists, the count of `session-action-*.evt` files there is the same before and after; no new file is written in the repo.
- `git status --porcelain` → only `docs/plans/22-session-work-tagging/reports/5-05-four-store-dry-run.md` is new or changed.
- `git diff --check` → clean.
- The report contains the command, the tables, the reconciliations, the recon statement, the gate line and the no-enqueue/no-network statement.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then the per-store and total counts, the reconciliation result, the check output, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

State the real enqueue and drain as a Cody gate. Do not include prompt or user content, secrets, session ids beyond aggregate counts, or any label-file content in the report or this reply.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so. Do not edit `IMPLEMENTATION.md`.
