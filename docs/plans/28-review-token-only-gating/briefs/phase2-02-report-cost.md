# Brief: phase2-02 — Report actual cost only

Consumer: a build worker on `tools/shadow-review-trial/report.py` (Python 3 stdlib, `unittest`), dispatched by Plan 28 `execute`.
Owned paths: `tools/shadow-review-trial/report.py`, `tools/shadow-review-trial/test_report.py`, `tools/shadow-review-trial/test_report_export.py`; report `docs/plans/28-review-token-only-gating/reports/phase2-02-report-cost.md`. Touch nothing else.
Do not edit `cli.py`, `runner.py`, `manifest.py`, `README.md` or their tests — units 1 and 3 own them.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: unit 1 (`phase2-01-run-path`) — it drops the cap argument from the CLI's `build_report` call and removes the gate from the run path, so the full suite only goes green with it landed.
Runs alongside: unit 3 (`phase2-03-readme`), with disjoint paths, once unit 1 has landed.
Budget: 3 files to read, about 300 lines to change including tests, 70 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Domain: Trial tooling (lines 42-64), Phase 2 (235-240), Assumptions 3 and 16 (101-107, 192-197). Binding.
2. `docs/plans/28-review-token-only-gating/IMPLEMENTATION.md` — Phase 1 close and `Carried: None`, especially the `cost_usd`/`cost_known` and ingest changes (lines 8-34).
3. `tools/shadow-review-trial/report.py` — 20-35 (module constants and `STATUSES`), 200-350 (`_validate_receipt`, `_validate_ledger`, `_receipt_usage`, `_empty_spend`, `_add_usage`, `_ledger_spend`), 476-510 (`build_report` head), 587-645 (arm reports and per-case usage), 690-767 (usage totals and output).
4. `tools/shadow-review-trial/test_report.py` — all 196 lines.
5. `tools/shadow-review-trial/test_report_export.py` — all 252 lines.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make the alignment report spend-free and cost-honest: it validates and sums actual provider cost from ledger receipts, accepts `skipped_busy` and legacy `skipped_budget`, and treats Phase 1's `cost_usd: null` + `cost_known: false` as an explicitly unknown entry rather than inventing an estimate — with no cap, projection, reservation or exposure arithmetic anywhere.

## Contract

Cited from DESIGN.md; these decisions are settled:

- "**Spend gate removed**: ... `--cap-usd` (run and report), `cap_comparison`, the runner's `_prior_spend`/`_unknown_reservations` exposure maths, `estimated_usd` projection and `refused_over_cap`/`approval_required_usd` readiness fields are deleted ... Actual cost per case, effort and run stays in the ledger and report."
- "**Report** ... (g) actual cost and latency per review and per effort from the ledger (no cap, no approval)."
- "**Actual cost** per attempt and per review is recorded as today from provider usage and the embedded pricing table ... A failed attempt with no reported usage records `cost_usd: null` with `cost_known: false` (ingest accepts null only with that flag; sums ignore it; the trial report counts it as an unknown entry), never a worst-case estimate".
- "Status vocabulary gains `skipped_busy`; `ingest` and `report.py` must accept it, and `skipped_budget` stays readable."
- Phase 2 Outcome: "the runner and report accept `skipped_busy` and legacy `skipped_budget`", and "its ledger and report still show actual cost per case, effort and run".
- Assumption 16: "unknown cost is `cost_usd: null` plus `cost_known: false`".

Settled decisions:

- `report.build_report(manifest, export, ledger, comparator_evidence, adjudications)` — delete the optional `cost_cap_usd` parameter and its validation.
- Delete from `report.py` and its output: `RETRY_EXPOSURE`, the preflight `estimated_usd` read, `reservation`, `reservation_known`, `reservation_complete`, and the output keys `usage.cap_usd`, `usage.cap_comparison`, `usage.unknown_reservation_usd`, `usage.reservation_retry_exposure`; delete `estimated_usd` from `_validate_receipt`. No replacement cap or exposure field.
- `STATUSES` gains `skipped_busy` and keeps `skipped_budget`; both appear in `records_by_status` / `attempts_by_status` when present. A `skipped_busy` row is not a completion (existing completion rules already exclude it).
- Cost semantics:
  - A `cost_usd` of `null` is valid only when the same object says `cost_known: false`; otherwise it is a validation error. `cost_known`, when present, must be a bool.
  - A `cost_usd` number is validated as a finite non-negative number as today.
  - `cost_known: true` with no `cost_usd` means a known cost of 0.
  - A legacy object with neither `cost_usd` nor `cost_known` keeps today's meaning: a missing field counted in `missing_usage_fields` / `missing_data`.
  - A `cost_usd: null` + `cost_known: false` is an *unknown* entry: excluded from sums, counted in `unknown_cost_entries`, never estimated. It makes the enclosing case, arm and run `cost_usd` null while their known sums stay in `known_cost_usd`.
  - A run receipt whose status never reached the provider — `unavailable`, `skipped_busy`, legacy `skipped_budget`, or a `refused_*` status — and which carries no usage fields contributes known 0 cost and 0 tokens, adds nothing to the missing counters, and is not an unknown entry.
- Surviving output field names (unit 1's rehearsal asserts these; do not rename): `usage.cost_usd`, `usage.known_cost_usd`, `usage.cost_basis`, `usage.input_tokens`, `usage.output_tokens`, `usage.latency_ms`, `usage.missing_data`, `usage.unknown_cost_entries`; `arms[effort].cost_usd`, `arms[effort].known_cost_usd`, `arms[effort].unknown_cost_entries`, `arms[effort].completed`, `arms[effort].per_case[case].cost_usd`. Add `per_case[case].known_cost_usd` and `per_case[case].unknown_cost_attempts` so a null per-case cost says what is known.
- Keep `target_per_effort` reading and validation, the determinism, provenance, canonical-id, exclusion, adjudication and chip/stratum logic untouched. Phase 3 records 360/300 and Phase 4 owns any target/floor reporting change.
- Do not leave a literal that the phase-final grep forbids (`YAKKA_REVIEW_`, `refused_over_cap`, `cap_usd`, `cap-usd`, `estimated_usd`, `approval`) in this unit's three files. Tests do not need those names; assert behaviour instead of absences.

## Changes

### `report.py`

- `STATUSES`: add `skipped_busy`.
- `_validate_receipt`: drop the `estimated_usd` checks; add the `cost_known`/null rules above at both attempt and receipt level.
- `_receipt_usage`: rewrite the cost half to the `cost_known` rules and return an unknown-cost count; keep token/latency handling. Short-circuit no-provider-call receipts to known zeros.
- `_empty_spend` / `_add_usage` / `_ledger_spend`: add an unknown-cost counter beside the existing `unknown_entries` claim list; delete the reservation arithmetic and `retry_exposure` from the returned dict.
- `build_report`: drop the cap argument; drop the cap/exposure output; compute `usage.cost_usd = None` when the run has any unknown or missing cost, with `known_cost_usd` the known sum and `unknown_cost_entries = unknown costs + unresolved claims`. Mirror the rule in each arm and per-case block using the canonical record attempts.
- Keep `unknown_entries` (the claim-key list) internal or replace it with a count; no output key may imply an estimate.

### `test_report.py`

- `report_for` loses its `cap` parameter; every call site drops it.
- `test_three_case_comparators_adjudication_usage_and_determinism`: drop the `cap_comparison` assertion and the cap argument; keep the `input_tokens` 900, `output_tokens` 180 and `cost_usd` 1.2 assertions.
- Add a case-status test: a `skipped_busy` record and a legacy `skipped_budget` record appear in `records_by_status`, do not add completions, and add no cost or unknown entries.

### `test_report_export.py`

- `test_failed_billed_receipt_contributes_but_dry_run_estimate_does_not`: remove `estimated_usd` from the dry-run receipts (a dry-run receipt now carries no estimate); keep the assertion that only real run receipts contribute; rename the test to drop "estimate" if it helps.
- `test_unresolved_unknown_run_prevents_a_falsely_exact_total`: drop the cap argument, the `cap_comparison` and `unknown_reservation_usd` assertions; drop the preflight estimate; keep `cost_usd` null, `known_cost_usd` `0.12`, `unknown_cost_entries` `1`, and the same arm assertions.
- Add `test_null_cost_with_unknown_flag_is_counted_not_summed`: known `0.12` receipt plus a receipt attempt `{"status": "timeout", "cost_usd": None, "cost_known": False}` → `usage.cost_usd` null, `known_cost_usd` `0.12`, `unknown_cost_entries` `1`, arm mirrors it, per-case `cost_usd` null with `known_cost_usd` and `unknown_cost_attempts` set.
- Add `test_cost_known_true_without_amount_is_a_known_zero`: an attempt with `cost_known: true` and no `cost_usd` adds 0 to the known total and no unknown entry.
- Add `test_no_provider_call_statuses_cost_zero_and_are_not_unknown`: ledger run receipts with `skipped_busy`, legacy `skipped_budget` and `unavailable`, no cost fields → `usage.cost_usd` `0.0`, `unknown_cost_entries` `0`, missing counters unchanged, statuses visible.
- `test_malformed_receipt_usage_is_refused`: keep the non-finite/negative/non-numeric refusals; add that `cost_usd: null` without `cost_known: false` is refused and `cost_known: "false"` is refused.

### Keep untouched

- Manifest/export provenance validation, page/cursor/digest checks, canonical-id uniqueness and tenant/run/tag checks.
- Adjudication, comparator normalisation, outcome summaries, strata, finding rows, shortfall and paired logic.
- Latency and token aggregation; `cost_basis` values.

## Done evidence

Identify or write the failing tests first; report their output before and after.

- `cd /home/codyh/workspace/yakka-build/28 && python3 -m unittest tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py` → all pass.
- `python3 -m unittest tools/shadow-review-trial/test_manifest.py tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py tools/shadow-review-trial/test_runner.py tools/shadow-review-trial/test_phase7.py` → all pass (needs unit 1).
- `grep -nIE 'cap_usd|cap-usd|estimated_usd|refused_over_cap|approval|YAKKA_REVIEW_' tools/shadow-review-trial/report.py tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py` → no matches.
- `git status --porcelain tools/shadow-review-trial` → only this unit's three files (plus unit 1's if it is still uncommitted; say which).
- No network, no provider call, no live server: state the commands you ran.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
