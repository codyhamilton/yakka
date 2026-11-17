# Brief: phase4-06 — Paired deltas, cost/latency, reproducibility and reconciliation

Consumer: a build worker completing the Plan 28 Phase 4 report's quantitative and reproducibility sections, dispatched by `execute`.
Owned paths: `tools/shadow-review-trial/report.py`, `tools/shadow-review-trial/test_report.py`; report `docs/plans/28-review-token-only-gating/reports/phase4-06-deltas-cost-validation.md`. Touch nothing else.
Do not edit `cli.py`, `test_report_export.py`, `runner.py`, `manifest.py`, `README.md` or another unit's module. This unit runs after `phase4-05` and owns `report.py` until it commits.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: `phase4-01-matching` (`bootstrap_interval`), `phase4-04-manifest-population`, `phase4-05-comparisons`.
Runs alongside: nothing (same `report.py` path as units 4 and 5).
Budget: 6 files to read, about 400 lines to change including tests, 75 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Report (f) and (g) (line 61), reproducibility and ledger/server reconciliation (62), Phase 4 Outcome (269), Assumptions 3, 9 and 17 (101-107, 143-148, 199-204). Binding.
2. `docs/plans/28-review-token-only-gating/IMPLEMENTATION.md` — Phase 2 cost close (36-63) and Phase 3 close (65-100).
3. `tools/shadow-review-trial/matching.py` — `bootstrap_interval` signature and determinism rules.
4. `tools/shadow-review-trial/report.py` — `_ledger_spend` (360-386), arm reports/per-case (619-687), usage totals (739-812), and the `comparisons`/`validation` sections added by `phase4-05`.
5. `tools/shadow-review-trial/test_report.py` — the Phase 3-shaped fixtures and comparison tests added by `phase4-05`.
6. `tools/shadow-review-trial/test_report_export.py` — the ledger receipt shapes and unknown-cost tests this unit must keep green.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Finish the report's quantitative evidence: paired high/xhigh/max deltas on the same cases with seeded bootstrap intervals, actual cost and latency per review and per effort from the ledger, and the reproducibility/reconciliation controls with a byte-identical report hash from the same inputs.

## Contract

Cited from DESIGN.md; these decisions are settled and must not be weakened:

- (f) "*paired high-vs-xhigh-vs-max deltas on the same cases with bootstrap intervals*";
- (g) "*actual cost and latency per review and per effort from the ledger (no cap, no approval)*";
- "**reproducibility** (frozen manifest hash, seed, ledger and export hashes, report hash from the same inputs)";
- "**ledger/server reconciliation** (every completed row has a canonical review id and cost)";
- Phase 4 Outcome: "the same inputs produce a byte-identical report hash";
- Assumption 3: "unknown (null), not the old worst-case reservation"; Assumption 9: "every case at every effort ... paired comparisons"; Assumption 17: manifest `target`/`floor` read by the report.

Settled definitions (do not re-derive, do not widen):

- **Paired set**: the existing `paired_intersection` cases (completed at all three efforts). Deltas are computed only on that set, never on unequal arms.
- **Metrics for (f)**: `finding_recall`, `fix_recall`, `corroboration_rate`, `severity_agreement_rate` — the same values `phase4-05` reports per effort, recomputed per case where a per-case contribution is defined. For each metric and each pair `high_vs_xhigh`, `high_vs_max`, `xhigh_vs_max`, report `{"delta": float|null, "low": float|null, "high": float|null, "n": int}` using `matching.bootstrap_interval` on the per-case paired differences with `seed = manifest["seed"]` mixed deterministically with the metric name (cite the mix in a comment/docstring) and the default resamples. A metric with no defined per-case contribution on the paired set reports `delta`/bounds `null` and `n` 0; never fabricate a value.
- **Cost and latency (g)**: reuse the existing ledger-based arm cost (`arms[effort].cost_usd`, `known_cost_usd`, `unknown_cost_entries`, `latency_ms`) and per-case latency/cost. Add a top-level `cost_latency` section that states cost basis, per-effort totals, and a per-review mapping keyed by case then effort, with `cost_usd` (null when unknown, never estimated), `known_cost_usd`, `unknown_cost_attempts`, `latency_ms` distribution. Do not introduce a cap, projection or approval field.
- **Reproducibility**: add `reproducibility` with `manifest_sha256` (the frozen value), `seed`, `ledger_sha256` and `export_sha256` (canonical hashes of the parsed ledger/export objects via the existing `_canonical_hash`), and `report_sha256`. Compute `report_sha256` as `_canonical_hash(report_without_report_sha256)` over the final report object with the `reproducibility.report_sha256` key absent, then insert it. Because every collection is sorted deterministically (fix any that is not), two builds from equal inputs produce equal `report_sha256`; the CLI unit proves byte-identical files.
- **Reconciliation**: add `reconciliation` with `canonical_records`, `completed_records`, `completed_without_canonical_id` (must be 0 for a valid report; raise `ValueError` otherwise), `completed_without_cost` (count of completed canonical rows with neither `cost_usd` nor `cost_known`), `unknown_cost_entries`, `missing_from_export` (must be 0; the existing check raises), and `cost_basis`. "Every completed row has a canonical review id and cost" means a completed row with neither a cost nor an explicit unknown flag is a validation error, not a silent zero.
- Keep the report I/O-free and the `build_report(manifest, export, ledger, comparator_evidence, adjudications)` signature unchanged.

## Changes

### `report.py`

- Add per-case paired metric contributions alongside the existing per-effort computation; reuse `phase4-05`'s helpers rather than duplicating matching logic.
- Add `comparisons.paired_deltas` with the three pairs and four metrics.
- Add `cost_latency` from the existing ledger spend and per-case data.
- Add `reproducibility` and `reconciliation`; sort every set/dict that feeds them.
- Compute and insert `report_sha256` last, excluding its own key.

Required shapes (consumed by the summary unit; do not rename):

```
"comparisons": {..., "paired_deltas": {metric: {"high_vs_xhigh": {"delta","low","high","n"}, "high_vs_max": {...}, "xhigh_vs_max": {...}}}},
"cost_latency": {
  "cost_basis": "ledger_run_receipts"|"canonical_record_attempts",
  "by_effort": {e: {"cost_usd": float|null, "known_cost_usd": float, "unknown_cost_entries": int,
                    "reviews": int, "latency_ms": {"count","min","p50","p90","max"}}},
  "per_review": {case_id: {effort: {"cost_usd": float|null, "known_cost_usd": float,
                                     "unknown_cost_attempts": int, "latency_ms": {...}}}}
},
"reproducibility": {"manifest_sha256": str, "seed": int, "ledger_sha256": str,
                     "export_sha256": str, "report_sha256": str},
"reconciliation": {"canonical_records": int, "completed_records": int,
                    "completed_without_canonical_id": int, "completed_without_cost": int,
                    "unknown_cost_entries": int, "missing_from_export": int,
                    "cost_basis": str}
```

### `test_report.py`

- Add `test_paired_deltas_on_common_cases_with_bootstrap`: a 3-case, 3-effort fixture with a known per-case metric difference; all three pairs present; `n` equals the paired case count; intervals are deterministic across two builds; an unpairable metric reports nulls rather than a fabricated value.
- Add `test_cost_latency_per_review_and_effort`: costs/latencies visible per case and effort and equal to the existing arm totals; an unknown cost stays null and counts as unknown.
- Add `test_reproducibility_and_reconciliation`: `report_sha256` is stable across two builds from the same inputs; `manifest_sha256`, `seed`, `ledger_sha256`, `export_sha256` present; every completed row has a canonical id and cost; a completed ledger row lacking cost fields raises `ValueError`.
- Keep every existing assertion.

### Keep untouched

- All of `phase4-05`'s comparison definitions, method tags, nulls, kappa, leak check and adjudication rules.
- `population`, `arms`, `denominators`, `provenance`, `excluded_records`, `paired_intersection`, `outcomes`, `historical_findings`, `new_findings`, `usage`.
- `_validate_export`/`_validate_ledger`/`_validate_receipt` and the no-provider-call zero-cost rule.

## Done evidence

Identify or write the failing tests first; report their output before and after.

- `cd /home/codyh/workspace/yakka-build/28 && python3 -m unittest tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py` → all pass.
- `python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'` → all pass (91 + units 01–06 tests; `test_phase7.py` is updated by unit 7).
- Two `report.build_report` calls on equal inputs produce `==` dicts and equal `reproducibility.report_sha256`; a report with a completed row missing cost raises.
- `git diff --check` → clean. `git status --porcelain tools/shadow-review-trial` → only this unit's two files.
- No network, no provider call, no live server, no `.trial-data/` read in tests: state the commands you ran.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
