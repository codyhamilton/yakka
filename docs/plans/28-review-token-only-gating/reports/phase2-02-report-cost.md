# phase2-02 — Report actual cost only

Status: done.

## What changed

- `report.py`:
  - `STATUSES` gains `skipped_busy` (legacy `skipped_budget` kept). Added
    `NO_PROVIDER_CALL_STATUSES`, `USAGE_FIELDS`; deleted `RETRY_EXPOSURE`.
  - `_validate_receipt` drops the `estimate`-projection checks and validates cost
    through a new `_validate_cost`: `cost_usd: null` requires `cost_known: false`,
    `cost_known` when present must be a bool, and a numeric `cost_usd` is still a
    finite non-negative number. The same rule is applied to export record attempts
    in `_validate_export`, which independently validates record usage.
  - `_receipt_usage` sums only real amounts; a null/`cost_known:false` attempt is
    counted in a new `unknown_cost` count, `cost_known:true` with no amount is a
    known zero, and legacy attempts with neither field stay in `missing`. A
    no-provider-call receipt (`unavailable`, `skipped_busy`, `skipped_budget`, any
    `refused_*`) with no usage fields short-circuits to known 0 cost and 0 tokens
    with nothing added to missing counters.
  - `_empty_spend`/`_add_usage`/`_ledger_spend` carry `unknown_cost_entries`; the
    reservation, preflight-estimate read and `retry_exposure` arithmetic and output
    are gone. `_ledger_spend` still returns the unresolved-claim key list.
  - `build_report` drops the cap argument and its validation. `usage.cost_usd` is
    null when any cost is unknown or missing, `known_cost_usd` holds the known sum,
    and `unknown_cost_entries` counts unknown costs plus unresolved claims. Arms
    mirror the rule. Each `per_case` block now has `known_cost_usd` and
    `unknown_cost_attempts` beside a null-able `cost_usd`.
- `test_report.py`: `report_for` loses its cap argument and call sites drop it; the
  cap-comparison assertion is removed. Added
  `test_skipped_busy_and_legacy_skipped_budget_are_visible_and_not_completions`.
- `test_report_export.py`: dry-run receipts carry no projection; renamed
  `test_failed_billed_receipt_contributes_but_dry_run_does_not`. Reworked the
  unresolved-claim test without cap/projection fields. Added null-cost-unknown,
  known-zero, and no-provider-call tests; the malformed-receipt test now also
  refuses null-without-flag and a non-bool `cost_known`.

## Checks

Baseline before edits (old suite only, new cases absent):

```
$ python3 -m unittest tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py
Ran 13 tests ... OK
```

After:

```
$ python3 -m unittest tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py
Ran 17 tests ... OK

$ python3 -m unittest tools/shadow-review-trial/test_manifest.py \
    tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py \
    tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py
Ran 58 tests in 12.7s ... OK

$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 58 tests in 12.6s ... OK

$ python3 -m py_compile tools/shadow-review-trial/report.py
# compiled

$ grep -nIE 'cap_usd|cap-usd|estimated_usd|refused_over_cap|approval|YAKKA_REVIEW_' \
    tools/shadow-review-trial/report.py tools/shadow-review-trial/test_report.py \
    tools/shadow-review-trial/test_report_export.py
# exit 1, no matches

$ git status --porcelain tools/shadow-review-trial
 M report.py, M test_report.py, M test_report_export.py
```

All checks are Python 3 `unittest` over local fixtures: no network, no provider
call, no live server, no credentials, no tenant reset/delete and no `/tmp` use.

## Deviations

- No red-first output was captured: the new cases were written with the
  implementation, and the recorded "before" is the old suite passing. This matches
  the Phase 1/Phase 2 unit-1 noted deviation.
- The brief names `_validate_receipt` for the cost rules, but the export's own
  record-attempt validation in `_validate_export` also accepted only numeric
  `cost_usd`; it had to apply the same rule so a null-per-case cost can be
  expressed. This is an implication of the contract, not a separate change.

## Contradictions

- None found between this brief and its cited contracts.
