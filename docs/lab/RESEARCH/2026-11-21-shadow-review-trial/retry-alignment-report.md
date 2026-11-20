# Shadow review trial report

## Population

- eligible 360 / frozen 360 / target 360 / floor 300
- censored 100; shortfall against floor 0
- exclusions (manifest): criteria_unavailable 2, empty_capture 8, no_code_change 88, no_recorded_outcome 69, no_tier 3114
- exclusions (run): non_canonical_record 25
- by tier:
  - phase: eligible 193, frozen 193
  - pr: eligible 2, frozen 0
  - unit: eligible 339, frozen 167
- by effort:
  - high: eligible 360, attempted 43, completed 18, failed 25, censored 13, shortfall 282
    - by tier: phase attempted 33 completed 16; pr attempted 0 completed 0; unit attempted 10 completed 2
    - exclusions: non_canonical_record 25
- owner-dropped arms: xhigh (attempted 0, completed 0, counted as failure false); max (attempted 0, completed 0, counted as failure false)

## Comparisons (a)–(g)

### (a) Finding recall

- high: 0/23 = 0.0000; null 0/17 = 0.0000
- tier phase: 0/21 = 0.0000; null 0/17 = 0.0000
- tier unit: 0/2 = 0.0000; null 0/0 = n/a

### (b) Fix recall

- uncensored cases 13; censored excluded 5
- high: 0/259 = 0.0000; null 0/31 = 0.0000
- tier phase: 0/259 = 0.0000; null 0/14 = 0.0000
- tier unit: 0/0 = n/a; null 0/17 = 0.0000

### (c) Corroboration

- high: findings 101, corroborated 0, valid 0, invalid 0, unknown 0, unadjudicated 101, rate 0.0000

### (d) Verdict agreement

- high: cases 9, agreement 0.6667; pass->pass 6, pass->fail 0, fail->pass 3, fail->fail 0

### (e) Severity agreement

- high: pairs 0, agree 0, rate n/a

### (f) Paired effort deltas


### (g) Cost and latency

- cost basis ledger_run_receipts
- high: reviews 18, cost_usd 1.142236, known_cost_usd 1.142236, unknown_cost_entries 0, latency_ms count 43 min 32228 p50 108813 p90 177654 max 234239

## Validation controls

- matching: matches 0; structural 0; adjudicated 0; uncertain band 2
- adjudication: double_labelled 0, kappa n/a, labeler n/a, second labeler n/a
- shuffled null: seed 28, method shuffled_case_map
- leak check: pass true, scope case_plan_and_outcome_excerpts (own-plan document sections only; outcome excerpts at least 5 words), requests checked 1080, own plan document section hits 0, outcome text hits 0, foreign plan document captures 54, short excerpts skipped 1458, request errors 0

## Reproducibility

- manifest_sha256: 10f8d4d3e0c08a1e2a4883fc8f653f37cc61fefe54e8effe824f285f896d482f
- seed: 28
- ledger_sha256: 35bf969b48fd92082f7b9ab62755ad1e1e5240635659b0b5ae9c28fc940548bf
- export_sha256: e7ff0be1b8f10a1422f90a236cffd3851ce87a83e1c23718c728f14515f751ec
- report_sha256: ca93abcb502b417ae7ff9eb0c70a295d7ac3c520816b5d0ed254ad2ad42dd7be

## Reconciliation

- canonical_records: 18
- completed_records: 18
- completed_without_canonical_id: 0
- completed_without_cost: 0
- unknown_cost_entries: 0
- missing_from_export: 0
- cost_basis: ledger_run_receipts
