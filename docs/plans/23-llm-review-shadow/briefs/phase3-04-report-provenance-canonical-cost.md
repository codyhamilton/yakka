# Brief: phase3-04 — Report provenance, completeness and canonical-cost isolation

Consumer: a Python worker who knows `tools/shadow-review-trial/report.py`, its CLI report path and the Phase 1 review record shape.
Repo: `/home/codyh/workspace/yakka-build/23b`.
Branch: `feat/23b-review-controls-trial`.
Owned paths: `tools/shadow-review-trial/report.py`, `tools/shadow-review-trial/cli.py` (only the `report` command parser/handler and imports), `tools/shadow-review-trial/test_report.py`, `tools/shadow-review-trial/test_report_export.py` (new), `tools/shadow-review-trial/test_phase7.py` (only the saved-records/report section). Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase3-04-report-provenance-canonical-cost.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase3-01, phase3-02 and phase3-03. Read the 3-03 report and the export shape it leaves.
Runs alongside: nothing.
Budget: read 10 files, about 350 lines changed, 50 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — complete tenant-bound reads (121–129), trial resume/reporting (174–180), Decisions 21–24 (225–228), Phase 3 outcome and surfaces (291–296).
2. `tools/shadow-review-trial/report.py` — the whole file: `validate_inputs`, `_normalize_comparators`, `build_report`, usage/cost and completeness fields.
3. `tools/shadow-review-trial/test_report.py` — all current 50/49/asymmetric/usage/determinism fixtures.
4. `tools/shadow-review-trial/cli.py` — `report` parser (121–127) and handler (147–158).
5. `tools/shadow-review-trial/test_phase7.py` — the saved-records/report section (162–176) for the current input shape.
6. `docs/plans/23-llm-review-shadow/briefs/phase3-03-complete-paged-evidence.md` — the shared saved-export schema this unit consumes.
7. `docs/plans/23-llm-review-shadow/briefs/phase3-02-general-call-runner-tenant-check.md` — the canonical tag identity and ledger fields.
8. `docs/plans/23-llm-review-shadow/briefs/phase1-03-cached-duplicate-responses.md` and `phase1-04-ephemeral-usage-dry-run.md` — duplicate canonical evidence and usage facts.
9. `tools/shadow-review-trial/manifest.py` — the certified `history` evidence and manifest hash from 3-01.
10. `tools/shadow-review-trial/runner.py` — the ledger shape after 3-02/3-03; do not edit it here.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make the alignment report prove it consumed a complete, certified trial export and count only the frozen run's canonical reviews and usage, rejecting partial, looping, truncated, error or legacy inputs.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "Saved trial exports carry filters, high-water identity, exhausted-page evidence and counts; a legacy bare 500-row response cannot certify completeness."
- "Consumers verify protocol consistency and unique row identities; cycles, missing completion metadata, request failures, early interruption or an operator safety ceiling produce a nonzero/incomplete result, never a complete report."
- "Usage totals use only this trial's canonical attempts/usage, addressing the landed unrelated-record accounting risk rather than summing the tenant's entire history."
- "Duplicate replies already contain the canonical review, so no follow-up GET is needed to see findings. Reconcile original id exactly once; duplicate receipts do not add completed cases or cost."
- "Target: **at least 50 distinct completed valid Haiku reviewed changes per effort high/xhigh/max**, paired across levels when possible, common completed intersection separately reported; never pad or count failed/duplicate/mismatched-model reviews as new completions."
- "A dry-run-only or fixture-only run can never claim a completed live trial or deployed smoke."
- Phase 3 outcome: "Report/resume consume >500 records over complete full-detail cursor pages, isolate the exact frozen run/canonical cost, reject missing/looping/truncated/error pages and uncertified legacy exports, and cannot claim completeness from partial data."
- The 3-01 contract requires a certified full-history manifest; refuse an uncertified/shallow manifest.

## Changes

- Change `build_report` to accept the certified saved export produced by 3-03 (not a bare reviews list) plus the frozen manifest, the run ledger/journal and the existing comparator/adjudication/cap inputs. Validate before calculating:
  - `schema_version`, manifest hash, run id and tenant id match the manifest/ledger;
  - filters and `detail=full` are present and consistent;
  - the page evidence is continuous: nonterminal pages have a progressing cursor, the terminal page has `complete=true,next_cursor=null`, no cursor cycles, no duplicate row identities, page row counts and row-id digests agree, and no error/truncated page is present;
  - the export's terminal `complete` is true. Reject a bare `{"reviews":[...]}` array, a legacy 500-row response, a missing/unknown completion field, or any partial export with a clear error; never produce a report that claims completeness from it.
- Select trial records by the frozen canonical tags (`manifest:<sha>`, `case:<sha>`, `effort:<level>`, `trial:<run>`) and the ledger's canonical review ids; do not depend on `profile`/`manifest_hash`/`case_id` being present on new rows. Validate each canonical id appears exactly once and belongs to this run/tenant.
- Count only the canonical completed records' attempts for completion and usage/cost. Exclude duplicate receipts (a canonical original is counted once), unrelated tenant/run rows, wrong-model/duplicate/mismatched records and non-trial records from this run's cost. Keep the existing missing-usage-is-not-zero behaviour.
- Replace `record_limit_may_truncate` with explicit completeness evidence in the report output (page/terminal provenance and counts). Keep per-effort/paired counts, common intersection, honest shortfalls, adjudication/comparator semantics and deterministic output.
- In `cli.py`, add `--ledger` to the `report` command and pass the whole certified export object to `build_report`; a bare reviews array is refused. Keep `--manifest`, `--adjudication`, `--comparators`, `--output` and `--cap-usd`.
- Update `test_report.py` and add `test_report_export.py` for the new input shape: 50/49/asymmetric completion and shortfalls; >500-record certified export; partial/looping/truncated/missing-metadata/legacy bare export refusal; canonical cost isolation with unrelated tenant rows and duplicate receipts; deterministic output. Keep the existing adjudication/comparator fixtures working against certified exports. Update only the saved-records/report section of `test_phase7.py` to the certified-export input; 3-05 owns the final composed approval rehearsal.

### Keep untouched

The 3-03 paged reader, the 3-02 request/tenant/ledger writer, `approval.py`, docs, the shim/plugin and server code. Do not edit the paging/run sections of `test_phase7.py`. No live Yakka, provider, credential, deployment, Fly/Wrangler or paid execution.

## Done evidence

Write the failing checks first, then report before/after output.

- `cd /home/codyh/workspace/yakka-build/23b && mkdir -p /home/codyh/workspace/.briefs/yakka/23b-test-tmp && TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py tools/shadow-review-trial/test_phase7.py` → passes. (Pure-Python tests; no memory cap expected. Do not use `/tmp`.)
- New test: a certified >500-record full-detail export produces the complete report with page/terminal provenance and counts.
- New tests: a partial export, cursor loop, missing completion metadata, truncated/mismatched page, error page and a legacy bare 500-row response each refuse; none can certify completeness.
- New tests: only the frozen run/canonical records contribute completion and cost; unrelated tenant rows and duplicate receipts add no completed case or cost; 50/49/asymmetric and common-intersection counts remain honest.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
