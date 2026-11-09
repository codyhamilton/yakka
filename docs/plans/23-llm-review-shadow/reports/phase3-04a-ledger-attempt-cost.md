# Report: phase3-04a — Report cost correction for failed billed attempts

Status: `done`

Branch: `feat/23b-review-controls-trial`

Depends on: Phase 3-04 at `14b943e`.

## What changed

- `tools/shadow-review-trial/report.py`
  - Added `_ledger_spend` / `_receipt_usage`: actual usage and cost now come from `kind:"run"` receipts in the manifest/run/tenant-bound ledger, including billed failed and incomplete requests that have no canonical completed review row.
  - Dry-run attempts (`kind:"dry_run"`) and the retry-inclusive estimate are excluded from spend. A duplicate entry contributes only its own receipt cost (normally zero); the original canonical record's historical export cost is never re-imported.
  - A ledger `duplicate_receipt` is counted once, deduplicated against the same receipt already present in `attempts` (as `runner.py` writes both).
  - Receipt selection is restricted to entries whose `case_id` is a frozen manifest case and whose `effort` is `high`/`xhigh`/`max`.
  - `_validate_ledger` now validates ledger entry case membership, attempt shape, and every receipt's `cost_usd`, `estimated_usd`, `latency_ms`, `input_tokens`, `output_tokens`. Malformed, negative, non-finite and boolean amounts are rejected. `preflight_receipt` is validated too.
  - `started`/`started_unknown` entries without a run receipt keep known cost separate and force total actual cost and cap comparison to unknown. When available, the retry-inclusive reservation is exposed separately at `RETRY_EXPOSURE = 2` (mirrors `runner.py`); it is never added to actual spend.
  - Additive report fields: `usage.cost_basis`, `usage.known_cost_usd`, `usage.unknown_cost_entries`, `usage.unknown_reservation_usd`, `usage.reservation_retry_exposure`, `arms[effort].known_cost_usd`, `arms[effort].unknown_cost_entries`.
  - Receipt mode is used whenever the ledger carries at least one run receipt. When a ledger carries no run receipts at all (legacy, or the existing report fixtures), cost falls back to canonical completed-record attempts; `usage.cost_basis` identifies which basis was used. Completed counts, findings, adjudication, paired intersection and provenance semantics are unchanged.
- `tools/shadow-review-trial/test_report_export.py`
  - Four focused cases: a billed timeout receipt adds to its effort and the known total with no review row while a dry-run estimate adds nothing; a zero-cost duplicate receipt does not import the canonical row's historical cost; an unresolved unknown started run leaves total cost/cap unknown with known cost and reservation separated; malformed receipt usage is refused.
  - Local ledger helpers build receipt-bearing entries; existing certified-export, refusal and canonical-cost tests remain.

## Checks

Before (new focused tests run against `HEAD`'s `report.py` in the brief temp area):

```
TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest test_report_export.py
Ran 8 tests in 0.017s
FAILED (failures=2, errors=2)
```

After (exact done-evidence command, 8 GiB address-space cap):

```
TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest \
  tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py \
  tools/shadow-review-trial/test_phase7.py
Ran 16 tests in 7.4s
OK
$ git diff --check
(no output)
```

## Deviations

- Fallback cost basis: when the ledger has no run receipts, spend still comes from canonical completed-record attempts. This preserves the existing `test_report.py` fixtures (outside this brief's owned paths) and older ledgers; receipt-bearing ledgers always use receipts.
- In receipt mode, `arms[effort].cost_usd` now means actual attempt spend for that effort, not canonical completed-record usage. `known_cost_usd` and `unknown_cost_entries` make the distinction explicit, and `usage.cost_basis` names the basis.
- `RETRY_EXPOSURE = 2` is duplicated from `runner.py` rather than imported, to keep `report.py` free of runner dependencies. Its value matches the landed runner constant.

## Contradictions

- The 3-04 report's known limitation ("a hypothetical canonical failed row with usage would not contribute") is now resolved: failed billed run receipts contribute even with no canonical row.
- DESIGN says usage totals use "this trial's canonical attempts/usage"; this brief clarifies that billed failed attempts must count. Ledger run receipts are treated as the canonical attempt evidence, and the export's completed rows are no longer the cost source when receipts are present.
- Ledger entries that both reference an already-used `canonical_review_id` are still refused by the existing uniqueness check. A real runner `skipped_duplicate` resolution could in principle produce such a shared reference; refusing it is conservative and avoids double-counting, and no fixture requires accepting it.

## Problems / unfinished

- Fixtures only. No live ledger, export, provider call or report over real trial evidence.
- Failed receipts are reported by effort and overall only; there is no per-case cost row because no canonical case row exists.
- `tools/shadow-review-trial/README.md` and `cli.py` were not touched; the additive report fields are documented here only.

## Gates

- gate: a live report over real evidence requires a deployed Yakka server, a dedicated `wk_` key with matching tenant and `read_write` scope, a certified full-history manifest and a certified paged export.
- gate: any paid execution, retry or resumed live work requires Cody's explicit spend approval; none was attempted.
- gate: real trial evidence export/adjudication and operator sign-off remain human steps.
