# Phase 5 four-store dry run — count report

Status: `done` — dry run only; Phase 5 closing evidence.

Scope: the rebuilt `tools/session_backfill/backfill.py` run dry over the four real local stores on
codyh-ubuntu. No `--enqueue`, no `--queue-dir`, no drain, no live API, no network call, no queue-log
read. `~/.local/share/workflow/queue` was not read or moved. `~/.local/share/yakka/queue` was
untouched: it held 0 `session-action-*.evt` files before and after. Counts only are recorded here;
the label file carried scrubbed snippets, stayed outside the repository, and was removed after this
report was written.

## Run

- Host: `codyh-ubuntu`.
- Started: 2026-11-19T01:20:04+10:00. Finished: 2026-11-19T01:21:38+10:00.
- Exit status: 0; stderr empty.
- Command (exactly, from the repo root):

```sh
python3 tools/session_backfill/backfill.py \
  --root claude="$HOME/.claude/projects" \
  --root codex="$HOME/.codex/sessions" \
  --root opencode="$HOME/.local/share/opencode/storage" \
  --root cursor="$HOME/.cursor/projects" \
  --repo codyhamilton/yakka \
  --labels /var/tmp/p22p5-labels.jsonl
```

The run printed the JSON count report. It has no `emitted` key: nothing was enqueued.

## Per-store counts

| Store | sessions | labelled | multi_signal | no_signal | no_subject | unreadable | planning | refining | executing | brief |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| claude | 1,098 | 369 | 13 | 715 | 0 | 1 | 127 | 21 | 61 | 160 |
| codex | 2,870 | 0 | 0 | 2,869 | 0 | 1 | 0 | 0 | 0 | 0 |
| cursor | 568 | 70 | 0 | 498 | 0 | 0 | 0 | 0 | 0 | 70 |
| opencode | 13 | 0 | 0 | 13 | 0 | 0 | 0 | 0 | 0 | 0 |
| **total** | **4,549** | **439** | **13** | **4,095** | **0** | **2** | **127** | **21** | **61** | **230** |

`planning`, `refining`, `executing` and `brief` are the `labelled_by_signal` split of `labelled`.

## Discovery counts beside the rows

| Store | transcripts_discovered | skipped_subagent | skipped_child | duplicate_ids | duplicate_transcripts |
|---|---:|---:|---:|---:|---:|
| claude | 1,474 | 376 | 0 | 0 | 0 |
| codex | 2,871 | 0 | 0 | 1 | 1 |
| cursor | 1,208 | 0 | 631 | 9 | 9 |
| opencode | 13 | 0 | 0 | 0 | 0 |
| **total** | **5,566** | **376** | **631** | **10** | **10** |

`duplicate_ids` counts conversation ids seen in more than one transcript file; `duplicate_transcripts`
counts the extra files. They coincide here (10).

## Reconciliation

Each identity below holds for every store and for the total; no exception.

- `sessions == labelled + multi_signal + no_signal + no_subject + unreadable`
  - claude: 1,098 == 369 + 13 + 715 + 0 + 1
  - codex: 2,870 == 0 + 0 + 2,869 + 0 + 1
  - cursor: 568 == 70 + 0 + 498 + 0 + 0
  - opencode: 13 == 0 + 0 + 13 + 0 + 0
  - total: 4,549 == 439 + 13 + 4,095 + 0 + 2
- `labelled == sum(labelled_by_signal.values())`
  - claude: 369 == 127 + 21 + 61 + 160
  - codex: 0 == 0
  - cursor: 70 == 70
  - opencode: 0 == 0
  - total: 439 == 127 + 21 + 61 + 230
- `transcripts_discovered == sessions + skipped_subagent + skipped_child + duplicate_transcripts`
  - claude: 1,474 == 1,098 + 376 + 0 + 0
  - codex: 2,871 == 2,870 + 0 + 0 + 1
  - cursor: 1,208 == 568 + 0 + 631 + 9
  - opencode: 13 == 13 + 0 + 0 + 0
  - total: 5,566 == 4,549 + 376 + 631 + 10

## Recon statement

Codex and OpenCode skill loads are unsupported: read-only recon found no recoverable skill-load
form in either store (Codex: 2,862 of 2,863 `rollout-*.jsonl` parsed, no skill tool call; OpenCode:
926 storage files and 120 tool calls, no skill tool and no slash command in user text). Both label
by brief path only, so their skill-based remainder appears as `no_signal` — Codex 2,869 and
OpenCode 13 here. Claude and Cursor use their skill-load recognisers.

## Comparison with the prior run

The prior live dry run (`reports/5-03-live-dry-run.md`, 8 Nov 2026) found **3,623 sessions**. This
run finds **4,549**. The stores have drifted since then and the rule changed:

- codex: 1,962 → 2,870 (+908)
- cursor: 409 → 568 (+159)
- claude: 1,239 → 1,098 (−141); the prior count included about 361 Claude `subagents/` transcripts,
  which discovery now skips (376 skipped here), so this is a rule change as well as drift.
- opencode: 13 → 13 (unchanged)

The prior run reported completeness under the old queue-truth rule (0 of 3,623 complete); this run
reports the new signal-based count report and is not directly comparable on `labelled`.

## Gates and statements

- `gate: Cody to authorise the real back-fill enqueue and drain; not run here.`
- The dry run made no enqueue or network call and wrote no queue file. The label file was written to
  `/var/tmp`, never `/tmp`, was not committed, held only scrubbed snippets, and was removed after
  this report.
- No product code, test, README, `DESIGN.md`, `IMPLEMENTATION.md` or brief was changed. No DB
  migration, no secrets, no tenant reset/delete, no fly or wrangler.
- The unrelated pre-existing layout test was not run or chased.

## Unfinished / deferred

- Real enqueue and drain: gated on Cody (see gate line); not run.
- The `multi_signal` (13, all Claude), `no_signal` (4,095) and `no_subject` (0) remainder is for the
  Phase 7 follow-up review with Cody, not this unit.
