# Shadow review trial report

## Population

- eligible 360 / frozen 360 / target 360 / floor 300
- censored 100; shortfall against floor 0
- exclusions (manifest): criteria_unavailable 2, empty_capture 8, no_code_change 88, no_recorded_outcome 69, no_tier 3114
- exclusions (run): missing_attempt_data 2, non_canonical_record 43
- by tier:
  - phase: eligible 193, frozen 193
  - pr: eligible 2, frozen 0
  - unit: eligible 339, frozen 167
- by effort:
  - high: eligible 360, attempted 356, completed 311, failed 45, censored 98, shortfall 0
    - by tier: phase attempted 189 completed 157; pr attempted 0 completed 0; unit attempted 167 completed 154
    - exclusions: missing_attempt_data 2, non_canonical_record 43
- owner-dropped arms: xhigh (attempted 0, completed 0, counted as failure false); max (attempted 0, completed 0, counted as failure false)

## Comparisons (a)–(g)

### (a) Finding recall

- high: 0/465 = 0.0000; null 0/550 = 0.0000
- tier phase: 0/269 = 0.0000; null 0/257 = 0.0000
- tier unit: 0/196 = 0.0000; null 0/293 = 0.0000

### (b) Fix recall

- uncensored cases 226; censored excluded 85
- high: 0/1903 = 0.0000; null 0/1573 = 0.0000
- tier phase: 0/1903 = 0.0000; null 0/723 = 0.0000
- tier unit: 0/0 = n/a; null 0/850 = 0.0000

### (c) Corroboration

- high: findings 1569, corroborated 0, valid 0, invalid 0, unknown 0, unadjudicated 1569, rate 0.0000

### (d) Verdict agreement

- high: cases 143, agreement 0.6434; pass->pass 92, pass->fail 1, fail->pass 50, fail->fail 0

### (e) Severity agreement

- high: pairs 0, agree 0, rate n/a

### (f) Paired effort deltas


### (g) Cost and latency

- cost basis ledger_run_receipts
- high: reviews 311, cost_usd n/a, known_cost_usd 5.690711, unknown_cost_entries 4, latency_ms count 348 min 6274 p50 81382 p90 147999 max 290305

## Validation controls

- matching: matches 0; structural 0; adjudicated 0; uncertain band 80
- adjudication: double_labelled 0, kappa n/a, labeler n/a, second labeler n/a
- shuffled null: seed 28, method shuffled_case_map
- leak check: pass true, scope case_plan_and_outcome_excerpts (own-plan document sections only; outcome excerpts at least 5 words), requests checked 1080, own plan document section hits 0, outcome text hits 0, foreign plan document captures 54, short excerpts skipped 1458, request errors 0

## Reproducibility

- manifest_sha256: 10f8d4d3e0c08a1e2a4883fc8f653f37cc61fefe54e8effe824f285f896d482f
- seed: 28
- ledger_sha256: 57d506dbe47e7296f66588ec3e2d34cdc30d15d655632feff44b8e47e8813e2b
- export_sha256: 4ac925c395f77deef4808898eecda7ab7883235f253db36b2b1729109f85868f
- report_sha256: d93eb91f84d38a4c11c67779ed4e09eb1fcac224fe5a48081c2083a11bf615dd

## Reconciliation

- canonical_records: 313
- completed_records: 311
- completed_without_canonical_id: 0
- completed_without_cost: 0
- unknown_cost_entries: 4
- missing_from_export: 0
- cost_basis: ledger_run_receipts
