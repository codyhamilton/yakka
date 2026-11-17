# Brief: phase4-07 — Report output surface, CLI and README

Consumer: a build worker wiring the Plan 28 Phase 4 report's rendered summary, CLI options, evidence-check command, rehearsal fixture and README, dispatched by `execute`.
Owned paths: `tools/shadow-review-trial/summary.py`, `tools/shadow-review-trial/test_summary.py`, `tools/shadow-review-trial/cli.py`, `tools/shadow-review-trial/test_phase7.py`, `tools/shadow-review-trial/test_manifest.py`, `tools/shadow-review-trial/README.md`; report `docs/plans/28-review-token-only-gating/reports/phase4-07-output-surface.md`. Touch nothing else.
Do not edit `report.py`, `matching.py`, `leak_check.py`, `evidence_check.py`, `runner.py`, `manifest.py` or their other tests — earlier Phase 4 units own them. `test_manifest.py` is owned here only for the stale-label assertion.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: `phase4-03-evidence-check`, `phase4-04-manifest-population`, `phase4-05-comparisons`, `phase4-06-deltas-cost-validation`.
Runs alongside: nothing (last Phase 4 unit).
Budget: 8 files to read, about 400 lines to change including tests, 80 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Report (59-62), Data handling (63), Phase 4 Outcome (269), Phase 5 evidence folder (274-279). Binding.
2. `docs/plans/28-review-token-only-gating/IMPLEMENTATION.md` — Phase 3 close and `Carried:` (65-100); Phase 4 stub (102-106).
3. `tools/shadow-review-trial/cli.py` — `_json_file`/`_write_json` (19-28), `_parser` report (129-135), `main` report branch (168-177).
4. `tools/shadow-review-trial/report.py` — the committed `population`, `comparisons`, `validation`, `cost_latency`, `reproducibility` and `reconciliation` output keys.
5. `tools/shadow-review-trial/evidence_check.py` — `require_metric_only`.
6. `tools/shadow-review-trial/test_phase7.py` — `RehearsalHandler` (28-93) and the 3-case/3-effort rehearsal (185-325).
7. `tools/shadow-review-trial/README.md` — Report section (65-78), evidence format (88-98), comparator evidence (99-113).
8. `docs/plans/28-review-token-only-gating/IMPLEMENTATION.md` — the cosmetic carried item. The label fix already landed in `dbef5d8`: `cli.py manifest` now prints `"frozen"`, but `tools/shadow-review-trial/test_manifest.py:246` still asserts `'"eligible": 2'`, so the suite is red at HEAD. The repair is the stale assertion, not the label.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make `cli.py report` write the JSON and a deterministic rendered summary alongside it, print the report hash, add the metric-only evidence-check command, and update the rehearsal and README so the Phase 4 outcome is exercised end to end and documented.

## Contract

Cited from DESIGN.md; these decisions are settled:

- Report is "emitted as one JSON document plus a rendered summary".
- Phase 4 Outcome: "`cli.py report` writes the JSON and rendered summary with every population, comparison (a–g) and validation-control section defined above; recall figures appear next to their shuffled-comparator null; a request that contains outcome text makes the leak check fail the report; the same inputs produce a byte-identical report hash; every match carries a method tag; kappa is computed on the double-labelled sample; and the metric-only evidence check refuses a folder containing a manifest or export file."
- "A pre-commit check in the trial CLI rejects an evidence folder that contains any manifest or export file."
- Data handling: committed evidence is aggregate and metric-only; no diff, finding text, path list or credential.
- Leak-check scope (Phase 3 carried, settled in `phase4-02`): the request check fails on the case's own plan documents and on recorded outcome excerpts; changed files under another plan's `docs/plans/` folder are counted as `foreign_plan_document_captures`, not failed. State exactly this in the README.

Settled decisions:

- Summary path: a deterministic sibling of `--output`, `output.with_suffix(".md")` (e.g. `alignment-report.json` → `alignment-report.md`). No new required option; no timestamp, host or run-time content.
- `summary.render(report: dict) -> str` — pure, deterministic Markdown. Fixed section order: Population; Comparisons (a)–(g) including the null beside each recall and the paired deltas; Validation controls (matching/method counts, adjudication and kappa, shuffled null, leak check); Reproducibility; Reconciliation. Format numbers with fixed precision, sorted keys, no HTML, no ANSI, no trailing spaces. It must render any report produced by `report.build_report` and must not recompute metrics.
- `cli.py report`: keep `--manifest --records --ledger --adjudication --output [--comparators]` unchanged; after `build_report`, write `--output` JSON with `_write_json` and write the summary to `output.with_suffix(".md")`; print `{"report": ..., "summary": ..., "manifest_sha256": ..., "report_sha256": ..., "arms": ..., "usage": ...}`.
- `cli.py evidence-check --folder <path>`: call `evidence_check.require_metric_only`; on `ValueError` let `parser.error` exit non-zero with the offender names; on success print `{"evidence_check": "pass", "folder": ..., "files_checked": n}`. Add it to `_parser` and `main`.
- Cosmetic carried item (corrected after units 1, 3 and 4 reported it): `cli.py manifest` already prints `"frozen"` (`dbef5d8`); `test_manifest.py`'s `test_cli_freezes_fixture_repository` still asserts `"eligible": 2`. Fix the stale test assertion to the committed `"frozen"` summary key (no CLI or shape change), so the suite is green. Do not change the printed label back.

## Changes

### `summary.py`

Implement `render(report: dict) -> str` as described. Include a table or bullet per effort for each comparison, showing `null` counts/rates beside the observed value; show `kappa` and `double_labelled`; show `leak_check.pass` and its aggregate counts and `scope`; show `report_sha256` and the other hashes. Never print a path, SHA, diff line, outcome excerpt, finding title or case list beyond the anonymised case ids the report already contains.

### `test_summary.py`

- `render` on a fixture report containing every section returns a string with the fixed section headings in order and the recall/null numbers.
- Two renders of the same report are byte-identical; no timestamp-like or absolute path content appears.
- A report from `report.build_report` on the Phase 3-shaped fixture renders without error.

### `cli.py`

- Import `summary` and `evidence_check`.
- Report branch: write JSON and sibling summary, print `report_sha256` and summary path.
- Add `evidence-check` subcommand and handler.
- Fix the stale `test_manifest.py` assertion: the CLI label is already `frozen`; update the test expectation (and any other stale expectation for that summary key) to match the committed output. Do not change `cli.py`'s summary key.

### `test_phase7.py`

- Make `RehearsalHandler` return a non-empty `payload.findings` finding per review with `id`, `severity`, `path`, `line_start`, `line_end`, `title` and `evidence` tied to the fixture case, so matching and severity comparisons have input.
- Write an adjudication file that includes a review-finding decision (matching the fixture finding id/effort/source `review`) with a `second_label` and both `labeler_model` fields, so kappa is non-null.
- Extend the rehearsal assertions: the report JSON has `population`, `comparisons` (all a–g keys), `validation`, `cost_latency`, `reproducibility` and `reconciliation`; every recall figure has a `null`; every match has a method tag; `validation.adjudication.kappa` is not None; `validation.leak_check.pass` is true; running `cli.main report` twice to two output paths yields byte-identical JSON files, equal `report_sha256`, and a summary file at each `with_suffix(".md")` that is byte-identical.
- Add an evidence-check assertion: a temp folder containing the saved export is refused by `cli.main(["evidence-check", "--folder", str(folder)])` (non-zero/`SystemExit`), and a folder with only the aggregate summary/report JSON passes.
- Keep the existing dry-run/execute/cost/preflight assertions and the forbidden-string checks.

### `README.md` Report section

- Document the summary sibling, `report_sha256`, the population/comparison (a–g)/validation/reproducibility/reconciliation sections, the adjudication version 1 extension (`second_label`, `labeler_model`, `second_labeler_model`, `valid`/`invalid`/`unknown` review categories), and the `evidence-check --folder` command.
- State the leak-check scope verbatim: the request check covers the case's own plan documents and every recorded outcome excerpt; changed files under another plan's `docs/plans/` folder are counted as `foreign_plan_document_captures`, not failed, because Phase 3 strips only the case's own plan folder.
- Keep the existing certified-export, cost and no-spend statements true.

### Keep untouched

- `report.py`, `matching.py`, `leak_check.py`, `evidence_check.py`, `runner.py`, `manifest.py` and their tests.
- The `run`, `manifest`, `smoke` and `compare` command surfaces, except the `manifest` label fix.
- The rehearsal's dry-run refusal, identity-check and cost assertions.

## Done evidence

Identify or write the failing tests first; report their output before and after.

- `cd /home/codyh/workspace/yakka-build/28 && python3 -m unittest tools/shadow-review-trial/test_summary.py tools/shadow-review-trial/test_phase7.py` → all pass.
- `python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'` → all pass (91 + all Phase 4 unit tests).
- Running `cli.py report` twice in the rehearsal yields byte-identical JSON and summary files and an equal printed `report_sha256`; `cli.py evidence-check` refuses a folder with the export and passes a metric-only folder.
- `grep -nE 'population|comparisons|validation|cost_latency|reproducibility|reconciliation|report_sha256' tools/shadow-review-trial/README.md` → all documented.
- `git diff --check` → clean. `git status --porcelain tools/shadow-review-trial` → only this unit's five files.
- No network, no provider call, no live server, no `.trial-data/` content committed: state the commands you ran.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
