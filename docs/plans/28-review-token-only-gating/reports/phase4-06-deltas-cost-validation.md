# Phase 4 unit 6 — paired deltas, cost/latency, reproducibility and reconciliation

Status: done.

## What changed

- `report.py` adds four sections without changing `build_report(manifest, export, ledger, comparator_evidence, adjudications)`, the report's I/O-free contract or any existing key/guard:
  - `comparisons.paired_deltas` for `finding_recall`, `fix_recall`, `corroboration_rate` and `severity_agreement_rate`, each with `high_vs_xhigh`, `high_vs_max` and `xhigh_vs_max`, shaped `{delta, low, high, n}`.
  - `cost_latency` with `cost_basis`, `by_effort` totals (`cost_usd`, `known_cost_usd`, `unknown_cost_entries`, `reviews`, `latency_ms`) and `per_review[case_id][effort]` (`cost_usd`, `known_cost_usd`, `unknown_cost_attempts`, `latency_ms`), all reused from `arms`/`per_case`, never estimated.
  - `reproducibility` with `manifest_sha256`, `seed`, `ledger_sha256`, `export_sha256` (existing `_canonical_hash` over the parsed objects) and `report_sha256`.
  - `reconciliation` with `canonical_records`, `completed_records`, `completed_without_canonical_id`, `completed_without_cost`, `unknown_cost_entries`, `missing_from_export` and `cost_basis`.
- `report_sha256` is `_canonical_hash(report)` with `reproducibility.report_sha256` absent, inserted last. Equal inputs therefore give an equal hash; the section is assembled from sorted collections only.
- Paired per-case contributions reuse unit 5's `_analyse_record` output (recorded/fix targets, matched sets, severity pairs, adjudication index). The paired set is the existing completed-at-all-three-efforts intersection. A case contributes no value where the ratio has no denominator; censored cases contribute no fix recall.
- Bootstrap seeds are the low 64 bits of `sha256("<manifest seed>:<metric>")` (documented in `_metric_seed`); resamples are `matching.bootstrap_interval`'s defaults. A metric with no paired contribution reports `{delta:null, low:null, high:null, n:0}`.
- `test_report.py` adds `test_paired_deltas_on_common_cases_with_bootstrap`, `test_cost_latency_per_review_and_effort` and `test_reproducibility_and_reconciliation`. All prior assertions are untouched.

## Red then green

Red — the three new tests against `HEAD`'s `report.py` (copied under repo-local `.scratch/red`, removed afterwards; `matching.py`, `leak_check.py`, `runner.py` copied alongside):

```
$ python3 -m unittest test_report.AlignmentReportTests.test_paired_deltas_on_common_cases_with_bootstrap \
    test_report.AlignmentReportTests.test_cost_latency_per_review_and_effort \
    test_report.AlignmentReportTests.test_reproducibility_and_reconciliation
ERROR ... KeyError: 'paired_deltas'
ERROR ... KeyError: 'cost_latency'
ERROR ... KeyError: 'reproducibility'
Ran 3 tests ... FAILED (errors=3)
```

Baseline before this unit (HEAD two-file suite, same scratch copy):

```
$ python3 -m unittest test_report.py test_report_export.py
Ran 22 tests ... OK
```

Green after:

```
$ python3 -m unittest tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py
Ran 25 tests ... OK
$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 146 tests ... FAILED (failures=1)
```

The single failure is the pre-existing `test_manifest.test_cli_freezes_fixture_repository` `"eligible": 2` label assertion (unit 7's stale CLI label), untouched as instructed; unit 5 recorded the same failure at 143 tests before this unit's three additions.

Other done evidence: two `build_report` calls in `test_reproducibility_and_reconciliation` return `==` dicts with equal `reproducibility.report_sha256`; a completed row with no cost field raises `ValueError`; `git diff --check` is clean; `git status --porcelain tools/shadow-review-trial` lists only `report.py` and `test_report.py`. No network, provider call, live server or `.trial-data/` read: only `python3 -m unittest` over fixture dictionaries and `git show`/`cp` into a removed `.scratch/` copy.

## Deviations and contradictions

- The brief defines the metrics but not their per-case formula. This unit uses the same ratios unit 5 aggregates per effort (`matched/recorded`, `matched/hunks`, `(corroborated+valid)/findings`, `agree/pairs`) with each case's own denominator, and treats a zero denominator as undefined (`None`) so no value is fabricated.
- `completed_without_canonical_id` must be 0, but an existing valid ledger shape (`test_duplicate_receipt_does_not_import_canonical_historical_spend`) has a `state:"complete"` duplicate-receipt entry without a canonical id. The check therefore excludes entries carrying `duplicate_receipt`; a genuinely unkeyed completion still raises. Without this exemption the pre-existing test would fail, which the brief forbids.
- `missing_from_export` is reported as 0 because the existing canonical-id check raises `"missing from the export"` before a report can be returned; no non-zero value can reach the section.
- `cost_basis` follows the existing `usage` basis: `ledger_run_receipts` when run receipts exist, otherwise `canonical_record_attempts`.
- No red-first run of the full suite at HEAD was captured; the verified HEAD baseline is the two-file suite (22 OK), plus unit 5's recorded 143-test full-suite result with the same single pre-existing failure.
