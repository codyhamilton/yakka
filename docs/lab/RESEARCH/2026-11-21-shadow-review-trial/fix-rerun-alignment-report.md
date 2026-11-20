# Shadow review trial report

## Population

- eligible 360 / frozen 360 / target 360 / floor 300
- censored 100; shortfall against floor 0
- exclusions (manifest): criteria_unavailable 2, empty_capture 8, no_code_change 88, no_recorded_outcome 69, no_tier 3114
- exclusions (run): duplicate_receipt 2, non_canonical_record 8, non_completed_status 2
- by tier:
  - phase: eligible 193, frozen 193
  - pr: eligible 2, frozen 0
  - unit: eligible 339, frozen 167
- by effort:
  - high: eligible 360, attempted 33, completed 21, failed 12, censored 10, shortfall 279
    - by tier: phase attempted 21 completed 14; pr attempted 0 completed 0; unit attempted 12 completed 7
    - exclusions: duplicate_receipt 2, non_canonical_record 8, non_completed_status 2
- owner-dropped arms: xhigh (attempted 0, completed 0, counted as failure false); max (attempted 0, completed 0, counted as failure false)

## Comparisons (a)–(g)

### (a) Finding recall

- high: 0/75 = 0.0000; null 0/49 = 0.0000
- tier phase: 0/47 = 0.0000; null 0/28 = 0.0000
- tier unit: 0/28 = 0.0000; null 0/21 = 0.0000

### (b) Fix recall

- uncensored cases 14; censored excluded 7
- high: 0/176 = 0.0000; null 0/12 = 0.0000
- tier phase: 0/176 = 0.0000; null 0/12 = 0.0000
- tier unit: 0/0 = n/a; null 0/0 = n/a

### (c) Corroboration

- high: findings 115, corroborated 0, valid 0, invalid 0, unknown 0, unadjudicated 115, rate 0.0000

### (d) Verdict agreement

- high: cases 15, agreement 0.6000; pass->pass 8, pass->fail 1, fail->pass 5, fail->fail 1

### (e) Severity agreement

- high: pairs 0, agree 0, rate n/a

### (f) Paired effort deltas


### (g) Cost and latency

- cost basis ledger_run_receipts
- high: reviews 21, cost_usd n/a, known_cost_usd 0.370683, unknown_cost_entries 4, latency_ms count 27 min 4780 p50 89376 p90 108992 max 140460

## Validation controls

- matching: matches 0; structural 0; adjudicated 0; uncertain band 3
- adjudication: double_labelled 0, kappa n/a, labeler n/a, second labeler n/a
- shuffled null: seed 28, method shuffled_case_map
- leak check: pass true, scope case_plan_and_outcome_excerpts (own-plan document sections only; outcome excerpts at least 5 words), requests checked 1080, own plan document section hits 0, outcome text hits 0, foreign plan document captures 54, short excerpts skipped 1458, request errors 0

## Reproducibility

- manifest_sha256: 10f8d4d3e0c08a1e2a4883fc8f653f37cc61fefe54e8effe824f285f896d482f
- seed: 28
- ledger_sha256: c9e9545d4fb037dc34a14eff0820054c1691c6d62365abb506b2bdbd9ae07b2b
- export_sha256: 58e87a79adf79e2e2eb09d5de6c93e8cb5a836a72e992acc6e5a1e70c44a5788
- report_sha256: 176d8fa3a0e040fb84a8e53dc9eb87a3507b9b3e09e250b9a753e1386c25d535

## Reconciliation

- canonical_records: 23
- completed_records: 21
- completed_without_canonical_id: 0
- completed_without_cost: 0
- unknown_cost_entries: 4
- missing_from_export: 0
- cost_basis: ledger_run_receipts
