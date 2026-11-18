# Brief: phase4-03 — Metric-only evidence check

Consumer: a build worker adding the Plan 28 Phase 4 evidence-folder check, dispatched by `execute`.
Owned paths: `tools/shadow-review-trial/evidence_check.py`, `tools/shadow-review-trial/test_evidence_check.py`; report `docs/plans/28-review-token-only-gating/reports/phase4-03-evidence-check.md`. Touch nothing else.
Do not edit `cli.py`, `report.py`, `runner.py`, `manifest.py`, `README.md` or their tests — other Phase 4 units own them.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: nothing.
Runs alongside: `phase4-01-matching`, `phase4-02-leak-check`, `phase4-04-manifest-population` (disjoint paths).
Budget: 3 files to read, about 120 lines to add including tests, 30 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Data handling (line 63) and Phase 4 Outcome (line 269). Binding.
2. `docs/plans/28-review-token-only-gating/IMPLEMENTATION.md` — Phase 3 close (65-100), especially that the manifest is local and gitignored.
3. `tools/shadow-review-trial/.gitignore` and the repo `.gitignore` entries for `.trial-data/` — the files that must never reach a committed evidence folder.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make the trial CLI able to refuse a would-be committed evidence folder before commit when it contains a manifest or export file, so committed evidence stays aggregate and metric-only.

## Contract

Cited from DESIGN.md; these decisions are settled:

- "A pre-commit check in the trial CLI rejects an evidence folder that contains any manifest or export file."
- Phase 4 Outcome: "the metric-only evidence check refuses a folder containing a manifest or export file."
- "Anything committed to `yakka` is aggregate and metric-only: counts, rates, intervals, costs, hashes, tier labels and anonymised case ordinals."
- "Diffs, outcome text, review text and case lists exist only in locally held, gitignored files."

## Changes

Create `evidence_check.py`, pure and read-only over a directory:

- `check_folder(folder: pathlib.Path) -> dict` — inspect `folder.rglob("*")` in sorted order. A file is an offender when either:
  - its name matches `manifest*.json`, `*manifest*.json`, `*export*.json`, or `run-export*.json` (case-insensitive); or
  - it is a `.json` file whose parsed top level is an object containing both `manifest_sha256` and `cases` (a frozen manifest), or both `reviews` and `pages` (a saved export), or `manifest_hash` and `entries` (a run ledger).
  Unreadable/non-JSON files that match a name pattern are still offenders; unreadable files that do not match are ignored. Return `{"pass": bool, "folder": str, "files_checked": int, "offenders": [relative path strings...]}` with sorted offenders. `pass` is true only when `offenders` is empty.
- `require_metric_only(folder: pathlib.Path) -> dict` — call `check_folder`; when `pass` is false raise `ValueError("evidence folder contains local trial data: " + ", ".join(offenders))`; otherwise return the result. This is the function the CLI unit will call.

Return only relative filenames in `offenders`; never read or echo file contents. No network, no environment, no writes.

### Keep untouched

- Every other module. This unit is additive.
- `.gitignore`; this unit does not rely on ignore rules, it detects the files themselves.

## Done evidence

Identify or write the failing tests first; report their output before and after.

- `cd /home/codyh/workspace/yakka-build/28 && python3 -m unittest tools/shadow-review-trial/test_evidence_check.py` → all pass.
- `python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'` → all pass (91 + this unit's tests).
- Tests use `tempfile.TemporaryDirectory(dir=<repo tool folder>/test-fixtures)` as existing tests do, never `/tmp`, and assert:
  - an empty folder and a folder of aggregate JSON/Markdown (no manifest/export shape) pass with zero offenders;
  - `manifest-28.json`, `run-export.json` and a nested `sub/manifest.json` are each refused by name even with unparseable content;
  - a neutrally named `data.json` whose top level has `manifest_sha256` and `cases` is refused by shape, and one with `reviews` and `pages` is refused;
  - `require_metric_only` raises `ValueError` naming the offender for a refused folder and returns a passing result otherwise.
- `git diff --check` → clean. `git status --porcelain tools/shadow-review-trial` → only this unit's two files.
- No network, no provider call, no live server: state the commands you ran.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
