# Brief: phase4-04 — Manifest ingestion and population section

Consumer: a build worker extending the Plan 28 Phase 4 report to ingest the Phase 3 frozen manifest and emit the population section, dispatched by `execute`.
Owned paths: `tools/shadow-review-trial/report.py`, `tools/shadow-review-trial/test_report.py`, `tools/shadow-review-trial/test_report_export.py`; report `docs/plans/28-review-token-only-gating/reports/phase4-04-manifest-population.md`. Touch nothing else.
Do not edit `cli.py`, `runner.py`, `manifest.py`, `matching.py`, `leak_check.py`, `evidence_check.py`, `README.md` or their tests — other Phase 4 units own them.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: nothing.
Runs alongside: `phase4-01-matching`, `phase4-02-leak-check`, `phase4-03-evidence-check` (disjoint paths). Units 5 and 6 edit `report.py` after this one.
Budget: 6 files to read, about 350 lines to change including tests, 80 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Case (48-52), Sample (57), Report population (60), Phase 4 Outcome (269), Assumptions 13 and 17 (171-176, 199-204). Binding.
2. `docs/plans/28-review-token-only-gating/IMPLEMENTATION.md` — Phase 3 close and `Carried:` second bullet (65-100), which names this exact gap.
3. `tools/shadow-review-trial/report.py` — `_validate_manifest` (60-92), `build_report` head/target (512-530), canonical/attempt bookkeeping (534-618), arm reports and per-case (619-687), return (785-812).
4. `tools/shadow-review-trial/test_report.py` — all 208 lines (legacy fixture shape that must keep passing).
5. `tools/shadow-review-trial/test_report_export.py` — `make_manifest`/`make_export` and the provenance refusals; these guards must survive.
6. `tools/shadow-review-trial/manifest.py` — `create_manifest` frozen output (373-441): `tier`, `stratum`, `target`, `floor`, `tiers`, `exclusions`, `excluded_total`, `censored`, `shortfall_against_floor`, per-case `outcomes`, `later_fixes`, `censored`, `criteria` (`source: "base_blob"`).

For shape only you may read `tools/shadow-review-trial/.trial-data/manifest-28.json` read-only (gitignored). Do not commit, quote, copy or test against it.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make `cli.py report` able to ingest the Phase 3 frozen manifest unchanged and emit the full population section (per effort and tier, against the 300 floor, with censored count and exclusion reasons) while every existing export, ledger, canonical-id and cost guard keeps its behaviour.

## Contract

Cited from DESIGN.md; these decisions are settled:

- Population: "eligible, frozen, attempted, completed (valid) per effort and tier; failures and exclusions by reason; shortfall against 300; censored count."
- Sample: "the manifest freezes the eligible pool, capped at 360 cases ... and records `target` 360 and `floor` 300 ... Separately, completed reviews below 300 at any effort are reported as a shortfall. Each frozen case also records per-reason exclusion counts for all candidates."
- Assumption 17: "manifest `target` 360 and `floor` 300 recorded in the frozen manifest; report reads them."
- Phase 3 `Carried` (binding for this unit): "the report/comparator path must accept the frozen manifest's `tiers`, `base_blob` criteria and `outcomes`/`later_fixes` shape (the `stratum`/`target_per_effort` aliases remain for the current `report.py`)."
- Existing correctness guards stay: "The existing report already certifies the export, ledger, canonical ids, cost/unknown-cost and paired completion counts. Those correctness guards must survive; do not delete them."

Settled decisions:

- `_validate_manifest` accepts `case["tier"]` in `("phase", "unit", "pr")`, and accepts `case["stratum"]` in `("phase", "unit", "pr", "unaccompanied")`. A case whose `tier` is present must have `stratum == tier` or be a legacy `unaccompanied` with no `tier`. Legacy fixtures with only `stratum` in `("phase","pr","unaccompanied")` keep working. Do not change the hash, schema, eligibility or history certification checks.
- `build_report` reads `target = manifest.get("target", manifest.get("target_per_effort", 50))` and `floor = manifest.get("floor", target)`, both validated as positive integers. Keep `target_per_effort` readable. Existing `arms[effort].shortfall` keeps its current target-based meaning; add `arms[effort].floor` and `arms[effort].shortfall_against_floor = max(0, floor - completed)`.
- Case tier: `case.get("tier")` when it is one of the three tiers, else `case.get("stratum")` when one of the three, else `"unaccompanied"`. Never invent a tier.
- Add a top-level `population` object (exact shape below). Existing top-level keys and `arms` stay; do not delete `denominators`, `records_by_status`, `provenance`, `excluded_records`, `paired_intersection`, `outcomes`, `historical_findings`, `new_findings` or `usage`.
- `population.exclusions` merges the manifest's candidate `exclusions` (reason → count) with the run's `excluded_records` (reason → count) under separate sub-keys, because they answer different questions; do not sum them into one map.
- Censored is read from `manifest["censored"]` when present, else counted from `case["censored"]`; never recompute it from windows.
- Attempted per effort/tier: records carrying `manifest:<hash>` and `trial:<run_id>` tags for that effort, grouped by the case's tier. Completed per effort/tier: the existing `valid_by_arm` cases grouped by tier. Failures per effort: attempted minus completed, plus the existing `excluded_records` reasons when they can be attributed to an effort (non-completed canonical rows already carry an effort through the ledger/attempted tags; if not attributable, count under `"unattributed"`).
- Keep the report deterministic and I/O-free; keep the 3-argument `build_report(manifest, export, ledger, comparator_evidence, adjudications)` signature untouched (later units add sections, not arguments).

Required `population` shape:

```
"population": {
  "eligible": int,              # manifest frozen case count (== len(cases))
  "frozen": int,                # same count; explicit per DESIGN vocabulary
  "target": int, "floor": int,
  "censored": int,
  "shortfall_against_floor": int,          # max(0, floor - frozen)
  "exclusions": {"manifest": {reason: count}, "run": {reason: count}},
  "by_tier": {tier: {"eligible": int, "frozen": int}},
  "by_effort": {effort: {"eligible": int, "attempted": int, "completed": int,
                          "failed": int, "censored": int,
                          "shortfall_against_floor": int,
                          "by_tier": {tier: {"attempted": int, "completed": int}},
                          "exclusions": {reason: count}}}
}
```

Read `tiers` for `by_tier` eligible/frozen when present; otherwise count the legacy cases by their derived tier. `by_tier` includes all three DESIGN tiers plus `"unaccompanied"` only when a legacy case actually has it.

## Changes

### `report.py`

- `_validate_manifest`: tier/stratum acceptance above; keep every other refusal verbatim.
- `build_report`: replace the `target_per_effort`-only read with target/floor; keep the existing `target` positive-int validation and extend it to `floor`.
- Add tier/effort population bookkeeping beside the existing attempted/completed bookkeeping; do not rewrite the canonical, exclusion, cost or usage logic.
- Add `floor` and `shortfall_against_floor` to each arm, and the `population` object to the returned report.

### `test_report.py`

- `make_manifest` keeps its legacy shape by default (so the existing tests stay meaningful), and gains an option to produce a Phase 3-shaped manifest: `tier` as well as `stratum`, `target`/`floor`, `tiers`, `exclusions`, `excluded_total`, `censored`, `shortfall_against_floor`, per-case `outcomes` and `later_fixes` (empty lists are enough here; later units add content), and `criteria` with `source: "base_blob"`.
- Add `test_phase3_manifest_population_and_floor_shortfall`: a 3-case Phase 3-shaped manifest with one `unit` tier case and `floor` 5 → `population.by_tier` counts match, `arms[e].floor` is 5, `shortfall_against_floor` is 2, `censored` is read from the manifest, and both the manifest and run exclusion maps are present.
- Add `test_legacy_manifest_aliases_still_read`: a manifest with only `target_per_effort` and `stratum` still builds, target/floor derive as above, and no `population` key changes an existing completion count.
- Keep every existing test's assertion; change only what the new floor/tier fields require.

### `test_report_export.py`

- Keep all provenance/refusal/cost tests. Update any `make_manifest` call only where a new required field is genuinely needed; legacy fixtures must still pass through `_validate_manifest`.

### Keep untouched

- `_validate_export` page/cursor/digest rules, `_validate_ledger` canonical-id uniqueness and binding, `_validate_receipt` cost rules, `_ledger_spend` and the no-provider-call zero-cost rule.
- Comparator normalisation, adjudication categories, `_outcome_summary`, strata and the paired-intersection logic.
- `denominators`, `provenance`, `records_by_status`, `excluded_records` and `usage` field names and meanings.

## Done evidence

Identify or write the failing tests first; report their output before and after.

- `cd /home/codyh/workspace/yakka-build/28 && python3 -m unittest tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py` → all pass.
- `python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'` → all pass (91 + this unit's tests; `test_phase7.py` still uses the legacy CLI surface and must not need changes here).
- A read-only check against a small Phase 3-shaped fixture asserts `population.target`, `population.floor`, `population.censored`, `population.shortfall_against_floor`, per-tier attempted/completed, and that `_validate_manifest` accepts a real `tier: "unit"` case.
- `git diff --check` → clean. `git status --porcelain tools/shadow-review-trial` → only this unit's three files.
- No network, no provider call, no live server, no read of `.trial-data/` in tests: state the commands you ran.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
