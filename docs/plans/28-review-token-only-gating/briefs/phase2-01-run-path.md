# Brief: phase2-01 — Run path without spend gates

Consumer: a build worker on the `tools/shadow-review-trial` run path (Python 3 stdlib, `unittest`), dispatched by Plan 28 `execute`.
Owned paths: `tools/shadow-review-trial/approval.py` (delete), `tools/shadow-review-trial/test_approval.py` (delete), `tools/shadow-review-trial/cli.py`, `tools/shadow-review-trial/runner.py`, `tools/shadow-review-trial/test_runner.py`, `tools/shadow-review-trial/test_phase7.py`; report `docs/plans/28-review-token-only-gating/reports/phase2-01-run-path.md`. Touch nothing else.

`cli.py` is shared with the report subcommand; this unit owns all of it. Do not edit `report.py`, its tests, `manifest.py` or `README.md` — units 2 and 3 own them.
Commits: `git rm` the two deleted files and commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: nothing. This tree already contains the closed Phase 1 server changes (`IMPLEMENTATION.md`: Carried: None).
Runs alongside: unit 3 (`phase2-03-readme`) once this unit lands, with disjoint paths. Unit 2 (`phase2-02-report-cost`) depends on this unit and must not start concurrently.
Budget: 6 files to read (use the ranges below), about 500 lines to change including tests, 90 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Domain: Trial tooling (lines 42-64), Phase 2 (235-240), Assumptions 6, 9, 12 and 17 (122-127, 143-148, 164-169, 199-204), Architectural Implications line 78. Binding.
2. `docs/plans/28-review-token-only-gating/IMPLEMENTATION.md` — Phase 1 close and `Carried: None` (lines 8-34).
3. `tools/shadow-review-trial/approval.py` — skim 1-40 and 100-124 only; confirm nothing here survives (the device-login approval code the contract protects is not this module).
4. `tools/shadow-review-trial/runner.py` — 1-120 (`_manifest`, `_certified_history`, `_case_map`), 300-410 (`_load_ledger`, `_receipt_cost`, `_prior_spend`, `_unknown_reservations`), 402-551 (`run`). The rest is context for `TrialRunner` and `build_request`; leave it.
5. `tools/shadow-review-trial/cli.py` — all 178 lines.
6. `tools/shadow-review-trial/test_runner.py` — 1-240 (fixtures and preflight/arm tests), 300-430 (identity, ledger, certification, replay, preflight-block tests), 520-642 (prior-spend, approval, ceiling tests).
7. `tools/shadow-review-trial/test_phase7.py` — 90-287 (the composed rehearsal).

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Remove the spend gate from the trial runner and CLI: `--execute` runs after the non-spending identity and dry-run readiness checks with no local authorisation record and no cap, `skipped_busy` is transient and retried on resume, legacy `skipped_budget` is never a preflight block, and the ledger keeps the actual cost every run attempt reported.

## Contract

Cited from DESIGN.md; these decisions are settled:

- "**Spend gate removed**: `approval.py`, `--approval`, the approval-binding and ceiling checks, `--cap-usd` (run and report), `cap_comparison`, the runner's `_prior_spend`/`_unknown_reservations` exposure maths, `estimated_usd` projection and `refused_over_cap`/`approval_required_usd` readiness fields are deleted; `skipped_budget` is no longer a preflight block, and `skipped_busy` is transient and retried on resume, never a `preflight_blocked`. Device-login "approval" code is unrelated and untouched. `--execute` runs after its non-spending readiness checks (`whoami` tenant/scope match, dry-run POST with no `unavailable`, frozen-manifest/ledger binding). Actual cost per case, effort and run stays in the ledger and report. Full-history proof, deployed-server target, server-held credential and dedicated-tenant gates stay; the manual-browser gate stays for reset/delete only and is not a trial prerequisite."
- Phase 2 Outcome: "`cli.py run --execute` against the loopback fixture server completes a three-case, three-effort rehearsal with no approval file and no `--cap-usd`, refuses when `whoami` tenant or scope mismatches or the dry-run returns `unavailable`, and its ledger and report still show actual cost per case, effort and run; `approval.py` and its tests are gone; the runner and report accept `skipped_busy` and legacy `skipped_budget`".
- Phase 1 facts this unit builds on: a dry-run receipt carries no `estimated_usd`; attempts carry actual `cost_usd` and `cost_known`; a review for a tenant already at its two-call in-flight limit returns `skipped_busy` with reason `tenant in-flight limit`.

Settled decisions:

- `approval.py` and `test_approval.py` are deleted. No module, argument, helper, exception or error message in `cli.py` or `runner.py` retains the gate.
- `runner.run` becomes `run(manifest_path, ledger_path, runner, reviewer_model, *, run_id, tenant_id, execute=False, config_id="default")`. Delete the `cap_usd`, `approval_path` and `clock` parameters and the `now` value that only served expiry.
- Keep `runner.verify_identity(tenant_id)` (tenant and `read_write` scope) before any review POST, and keep `_load_ledger`'s manifest/run/tenant binding. These are the non-spending readiness checks that remain.
- Preflight: one dry-run POST per case and effort, as today, with no estimates. Each row is `{"case_id", "effort", "status"}`. Only status `unavailable` blocks; `skipped_busy` and legacy `skipped_budget` never do. The summary keeps `manifest_hash`, `run_id`, `tenant_id`, `preflight` (the rows) and `readiness: {"ready": bool, "blocked_efforts": [effort,...]}`; delete `estimates`, `projected_usd`, `retry_exposure_per_review`, `cap_usd`, `refused_over_cap`, `approval_required_usd`, `authorized_max_usd`.
- Without `--execute` the command returns that summary and makes no run POST: that is the non-spending probe. With `--execute`, if `readiness.ready` is false, save the ledger, make no run POST and raise `RunnerError` naming the blocked efforts.
- A run receipt with status `skipped_busy` sets the entry state to `retry_pending`, records the receipt attempt as today, and does not set `preflight_config_seen` or `preflight_blocked`; the next invocation posts it again. A legacy entry left `preflight_blocked` by a `skipped_budget` preflight is retried: only `unavailable` may skip an entry for an unchanged config. `unavailable` run receipts keep today's `preflight_blocked` + config-stamp behaviour.
- The preflight config digest (`cfg`) is the sha256 of `{"reviewer_model", "config_id"}` only.
- Delete unused spend debris in `runner.py`: `RETRY_EXPOSURE`, `ProjectionOverCap`, `_receipt_cost`, `_prior_spend`, `_unknown_reservations`, and the now-unused `math` import if nothing else uses it.
- Do not change ledger entry shape beyond removing estimate fields: `attempts[{kind, at, receipt}]`, `preflight_status`, `preflight_receipt`, `state`, `canonical_review_id`, `duplicate_receipt` all stay.
- `target_per_effort` keeps its current default in `runner.py`; Phase 3 owns recording 360/300, Phase 4 owns report targets.
- In tests and any comment, do not leave the literal names the phase-final grep forbids (`YAKKA_REVIEW_`, `refused_over_cap`, `cap_usd`, `cap-usd`, `estimated_usd`, `approval`). Assert their absence by concatenating fragments in the test source (Phase 1 used this pattern in `serve` tests), e.g. a `"cap" + "_usd"` attribute check and an `("appro" + "val.py")` path check. The final phase grep is not this unit's evidence, but this unit's own files must not leave a match.

## Changes

### `runner.py`

- Delete `import approval`, `RETRY_EXPOSURE`, `ProjectionOverCap`, `_receipt_cost`, `_prior_spend`, `_unknown_reservations`, and the spend/estimate block at 429-473.
- `run`: validation becomes `if not reviewer_model: raise RunnerError(...)`. Remove the execute-time record load and binding. Keep `verify_identity`, ledger load and manifest validation exactly where they are.
- Preflight loop: keep the per-arm dry-run POST, the `preflight_status`/`preflight_receipt`/`preflight_config_seen` writes and the re-probe when the config changes. Drop `estimate`, `retry_total`, `estimate_rows` cost fields and `projection`; set `entry["state"] = "preflight_blocked"` only for `unavailable`.
- Summary and the `execute=False` return as specified above. On `execute=True` with blocked efforts, raise before the reconciliation/run loop.
- Run loop: replace the `{"unavailable", "skipped_budget"}` sets at 491 and 508 with `unavailable` only, plus the new `skipped_busy` → `retry_pending` branch. Leave the duplicate, model-mismatch, awaiting/final reconciliation and all claim-before-I/O behaviour unchanged.

### `cli.py`

- Delete `import approval`.
- `run` parser: delete `--cap-usd` and the local-record option (currently `--approval`); reword `--execute` help to "run reviews after the identity and dry-run readiness checks". Call `run_trial(args.manifest, args.ledger, client, args.reviewer_model, run_id=args.run_id, tenant_id=args.tenant_id, execute=args.execute, config_id=args.config_id)`.
- `report` parser: delete `--cap-usd`; call `alignment_report.build_report(frozen, export, ledger, comparators, adjudication)` (five arguments; unit 2 removes the optional sixth, and this call works before and after it).
- Exception tuple: drop `approval.ApprovalError`.

### `test_runner.py`

- Remove the deleted module import and the preflight-digest helper. `FakeREST` loses `estimate`; its dry-run response is `{"status": "dry_run"}` and nothing else; delete every `estimated_usd` and `estimate=` use. Add a status hook or subclass for `unavailable` / `skipped_busy` / legacy `skipped_budget` preflight responses.
- Rewrite the `execute(...)` helper without cap, local record, ceiling, clock or overrides.
- Delete the tests for prior spend, execute-without-record, missing/expired/mismatched records, and the ceiling. Replace with:
  - dry-run: 2 cases → 6 dry-run POSTs, 0 model calls, `preflight` rows with exactly `{case_id, effort, status}`, `readiness == {"ready": True, "blocked_efforts": []}`, and no removed summary keys.
  - `--execute` with nothing but the required flags: all arms complete, model calls equal cases × 3.
  - `whoami` tenant mismatch and `read` scope mismatch abort before any POST (keep the existing test, drop the record plumbing).
  - a dry-run `unavailable` arm makes `--execute` raise `RunnerError` naming the effort, with zero run POSTs and the preflight saved in the ledger.
  - an `unavailable` arm is re-probed when `config_id` changes and then runs (adapt the old block-then-allow test).
  - `skipped_busy` from a dry-run does not block (`ready` true, run completes); `skipped_busy` from a run receipt records `retry_pending` and the next invocation posts it again; a legacy `skipped_budget` preflight is retried, never blocked.
  - keep the arm-normalisation test without the cap refusal; keep the started/started_unknown no-replay and ledger-binding tests with the new signature.

### `test_phase7.py`

- Remove the deleted module import and the local-record file. The fake's dry-run reply loses its estimate; the successful run receipt gains `cost_usd` and an `attempts` entry carrying `cost_usd`, `input_tokens`, `output_tokens` and `latency_ms` (e.g. `0.01`), so the ledger records actual cost.
- Run with no cap and no local record: `--dry-run` returns `readiness.ready` true and 0 model calls; `--execute` runs without any extra file and makes 9 model calls for 3 cases × 3 efforts; assert the summary has no removed keys and `preflight` rows carry no cost.
- Add CLI-level refusals: a mismatched tenant and an `unavailable` dry-run each make `cli.main(["run", ..., "--execute"])` exit (argparse `SystemExit`) with 0 model calls.
- Keep the manifest and request-integrity assertions. Extend the report step to assert actual cost: each of the 9 ledger run receipts has `cost_usd == 0.01`; report `usage.cost_usd` and `usage.known_cost_usd` are `0.09`; each arm's `cost_usd` is `0.03`; each `per_case[case].cost_usd` is `0.01`. These field names survive unit 2 unchanged.
- Add parser-surface assertions using concatenated fragments: the `run` and `report` namespaces have no `cap_usd` / removed-record attribute, and the module and its test file are absent from `TOOL`.
- Keep the loopback-only, no-provider-call posture and the existing tool-local fixture directory.

### Keep untouched

- `manifest.py`, `report.py`, `test_report.py`, `test_report_export.py`, `README.md`.
- `_manifest`, `_certified_history`, `_case_map`, `build_request`, `TrialRunner`/`get_reviews`, evidence page limits, tags, duplicate resolution, model-mismatch and shortfall accounting, and `target_per_effort`.
- `smoke`'s fake endpoint and output fields.
- Full-history certification, the deployed-server assumption, and the dedicated-tenant identity check.

## Done evidence

Identify or write the failing tests first; report their output before and after.

- `cd /home/codyh/workspace/yakka-build/28 && python3 -m unittest tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py` → all pass.
- `python3 -m unittest tools/shadow-review-trial/test_manifest.py` → still passes.
- `ls tools/shadow-review-trial` → `approval.py` and `test_approval.py` are absent.
- `git status --porcelain tools/shadow-review-trial` → only this unit's six owned paths (plus the deletions).
- `grep -nIE 'cap_usd|cap-usd|estimated_usd|refused_over_cap|approval|YAKKA_REVIEW_' tools/shadow-review-trial/cli.py tools/shadow-review-trial/runner.py tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py` → no matches. (The tool-wide grep stays red until units 2 and 3 land; that is expected.)
- The rehearsal makes no network call except loopback and needs no credential: state the command you ran.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
