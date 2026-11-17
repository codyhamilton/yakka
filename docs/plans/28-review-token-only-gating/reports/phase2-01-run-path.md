# phase2-01 — Run path without spend gates

Status: done.

## What changed

- Deleted `tools/shadow-review-trial/approval.py` and `test_approval.py`.
- `runner.py`: dropped the approval import, `RETRY_EXPOSURE`, `ProjectionOverCap`,
  `_receipt_cost`, `_prior_spend`, `_unknown_reservations` and the `math` import.
  `run` is now `run(manifest_path, ledger_path, runner, reviewer_model, *, run_id,
  tenant_id, execute=False, config_id="default")`; the cap, approval path and clock
  parameters are gone. Preflight emits rows of `{case_id, effort, status}` and a
  summary with `readiness: {ready, blocked_efforts}` only. Only an `unavailable`
  dry-run blocks; `skipped_busy` and legacy `skipped_budget` never do. A run receipt
  `skipped_busy` sets `retry_pending` without stamping the config or blocking;
  `unavailable` run receipts keep `preflight_blocked` plus the config stamp.
  `verify_identity`, ledger binding, claim-before-I/O, duplicate/model-mismatch and
  reconciliation paths are unchanged.
- `cli.py`: dropped the approval import and its exception; removed `--cap-usd` from
  `run` and `report`, removed the local-record option, reworded `--execute` help, and
  calls `run_trial` and `build_report` with the new argument lists.
- `test_runner.py`: FakeREST has no estimate and a plain `{"status": "dry_run"}`
  reply plus a `dry_status` hook. Removed the approval/preflight-digest helper and
  the prior-spend, execute-without-record, expired/mismatched-record and ceiling
  tests. Added dry-run row/readiness, execute-with-required-flags, unavailable
  refusal and re-probe, skipped-busy dry-run and run-retry, and legacy
  skipped-budget retry coverage.
- `test_phase7.py`: removed the approval import and record file; the fake dry-run
  has no estimate, the run receipt carries actual cost and attempt usage, and the
  rehearsal runs with no cap or extra file. Added CLI tenant/unavailable refusals,
  actual-cost ledger/report assertions and parser-surface absence checks built from
  concatenated fragments.

## Checks

Baseline before any edit (old suite):

```
$ python3 -m unittest tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py
Ran 28 tests ... OK
```

After:

```
$ python3 -m unittest tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py
Ran 29 tests in 10.4s ... OK

$ python3 -m unittest tools/shadow-review-trial/test_manifest.py
Ran 12 tests in 2.3s ... OK

$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 54 tests in 12.6s ... OK

$ ls tools/shadow-review-trial
# approval.py and test_approval.py absent

$ git status --porcelain tools/shadow-review-trial
D  approval.py, D  test_approval.py, M cli.py, M runner.py, M test_runner.py, M test_phase7.py

$ grep -nIE 'cap_usd|cap-usd|estimated_usd|refused_over_cap|approval|YAKKA_REVIEW_' \
    cli.py runner.py test_runner.py test_phase7.py
# exit 1, no matches
```

Rehearsal command (loopback only, no credential beyond the fixture token):

```
$ python3 -m unittest tools/shadow-review-trial/test_phase7.py
```

The composed rehearsal serves `127.0.0.1:0`, drives git against a tool-local bare
fixture remote, and makes no provider call and no external network call.

## Deviations

- No red-first output was captured. The new expectations were written with the
  implementation; the recorded "before" is the old suite passing. This matches the
  Phase 1 unit's noted deviation rather than a brief requirement I could satisfy
  cheaply without swapping code under the tests.

## Contradictions

- None found between this brief and its cited contracts. `report.py` still holds
  spend fields (`cap_usd`, `estimated_usd`, cap comparison); that is unit 2's owned
  surface, and this unit leaves it untouched as instructed.
