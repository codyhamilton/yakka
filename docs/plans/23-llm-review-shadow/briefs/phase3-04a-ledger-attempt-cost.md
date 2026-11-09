# Brief: Phase 3 report cost correction — include failed billed attempts

Consumer: a Python worker who knows `tools/shadow-review-trial/report.py`, the frozen run ledger, and Phase 3-04's certified export contract.
Repo: `/home/codyh/workspace/yakka-build/23b`.
Branch: `feat/23b-review-controls-trial`.
Owned paths: `tools/shadow-review-trial/report.py`, `tools/shadow-review-trial/test_report_export.py`. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase3-04a-ledger-attempt-cost.md` and include it in the commit.
Depends on: Phase 3-04 report implementation at `14b943e`.
Runs alongside: nothing.

## Goal

Make the alignment report account for all actual provider cost attributable to this frozen run, including billed failures that produced no canonical completed review row, without charging duplicate/cache receipts or unrelated records. Preserve an explicit unknown state for started requests whose transport outcome is unknown.

## Contract

From `DESIGN.md`, Phase 3: report isolates "the exact frozen run/canonical cost"; "Usage totals use only this trial's canonical attempts/usage"; duplicate receipts add no cost. From `reports/phase3-04-report-provenance-canonical-cost.md`, known limitation: "a hypothetical canonical failed row with usage would not contribute." `runner.py` stores each actual review request under the bound ledger entry as `{kind:"run", receipt:...}`; dry-run estimates use `kind:"dry_run"` and are not spend.

## Changes

- Derive actual usage/cost totals from only `kind:"run"` receipts in the already manifest/run/tenant-bound ledger, associated with valid frozen case ids and effort levels. Do not derive actual spend solely from completed rows in the review export.
- Exclude dry-run estimates. Duplicate receipts count only the cost reported for that duplicate request (normally zero), never the original canonical record's historical cost.
- Include billed failed/incomplete receipts even if no canonical completed row exists. Reconcile record-level completed counts and findings as before.
- If any ledger entry remains `started`/`started_unknown` without a receipt, report known cost separately but mark total actual cost/cap comparison unknown; expose count and retry-inclusive reservation separately when available. Never claim the reservation is actual spend.
- Validate receipt usage values and reject malformed/negative/non-finite amounts. Preserve current report fields where their meaning remains accurate; document any additive fields.
- Add focused fixtures proving: failed billed receipt contributes to its effort and overall known cost with no review row; a dry-run estimate contributes no actual cost; duplicate receipt does not import canonical historical spend; an unresolved unknown run prevents a falsely exact total.

## Keep untouched

Do not change manifest, runner, approval gate, cursor export protocol, adjudication semantics, operator docs, server/plugin code or other plans. No live Yakka/provider call, credential, deploy, Fly/Wrangler, paid trial or `/tmp`.

## Done evidence

- Under `/home/codyh/workspace/.briefs/yakka/23b-test-tmp`: run `python3 -m unittest tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py tools/shadow-review-trial/test_phase7.py` (use 8 GiB address-space cap) → passes.
- New focused cost cases above pass.
- `git diff --check` clean.

## Report back

Under 1,000 tokens: status, files/behavior, before/after checks, deviations, unfinished work, and all live/human actions as `gate: <what>`.
