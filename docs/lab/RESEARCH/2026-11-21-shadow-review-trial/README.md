# Shadow review trial — Plan 28 Phase 5 (HIGH effort)

Metric-only evidence from the finished real-server trial. No garcia-music diff, finding text, path list, case id list, outcome excerpt or credential is recorded here; the manifest, ledger and export stay local and gitignored.

## Run identity

| Field | Value |
|---|---|
| Server | `https://api.yakka.build` |
| Tenant | `t-60d108478da4` |
| Reviewer model | `claude-haiku-5-5` |
| Main run id | `plan28-p5-20261121` (two interleaved shards, merged locally) |
| Retry run id | `plan28-p5-20261121r` (failed/unfinished HIGH rows, refused rows excluded) |
| Main window (AEST) | 2026-11-20 23:52 – 2026-11-21 05:58 |
| Retry window (AEST) | 2026-11-21 06:17 – 07:04 |
| Manifest SHA-256 | `10f8d4d3e0c08a1e2a4883fc8f653f37cc61fefe54e8effe824f285f896d482f` |
| Main report SHA-256 | `d93eb91f84d38a4c11c67779ed4e09eb1fcac224fe5a48081c2083a11bf615dd` |
| Main metric-only SHA-256 | `ba78dcd7fdaf5961c1d0b92ac14cbeb43cb9ac564da628369e151ca283f8bfa1` |
| Retry report SHA-256 | `ca93abcb502b417ae7ff9eb0c70a295d7ac3c520816b5d0ed254ad2ad42dd7be` |
| Retry metric-only SHA-256 | `876d89c939084e04eb89732c0af1572c50a5bfc86b3e630ac9a0fc9cb7ebe932` |
| Re-run run id | `plan28-p5-20261121f` (two shards; shard a also holds the one-case canary, merged locally) |
| Re-run date (AEST) | 2026-11-21 (08:10 – 08:35) |
| Re-run report SHA-256 | `176d8fa3a0e040fb84a8e53dc9eb87a3507b9b3e09e250b9a753e1386c25d535` |
| Re-run metric-only SHA-256 | `8f59a74637f7e02ffa3efd189afd77f8eeed8ba8023b05fa2e26f7343a5ab7fe` |

`report_sha256` is the deterministic hash of the full local report; `metric_only_sha256` covers the committed aggregate JSON after case, review and path detail was removed.

## Population and floor

- Manifest: 360 eligible/frozen cases, target 360, floor 300; 100 censored cases in the manifest.
- Main run: 311 HIGH completions (`ok` 45, `ok_partial` 266) of 360 eligible; the report counts 356 canonical attempted rows and records 4 edge-cut POSTs separately as `started_unknown`.
- Retry run: 18 further HIGH completions from 43 retried rows.
- **HIGH completed: 329 of 360 eligible before the re-run, 350 of 360 after it, against the 300 floor. No padding.** The main report alone is 311; the retry report alone is 18 and is not a second independent population; the re-run adds 21 newly completed cases.

## Failures by reason

Main run (360 HIGH case POSTs; 356 canonical attempted rows in the report):

| Reason | Count |
|---|---:|
| `invalid_output` | 37 |
| — `schema` | 24 |
| — `json_parse` | 8 |
| — `unknown_field` | 4 |
| — `missing_field` | 1 |
| `unavailable` | 2 |
| `refused_disclosure` | 6 |
| `started_unknown` after HTTP 524 | 4 |

Six POSTs were cut at the edge with HTTP 524. Two reconciled to a stored `unavailable` row; four remained `started_unknown`. The four `started_unknown` rows were retried under the retry run id.

Retry run (43 rows): 18 completed; 25 remained `invalid_output` (`schema` 22, `json_parse` 2, `missing_field` 1). The 6 `refused_disclosure` rows were not retried.

Non-completions before the re-run: 31 (25 `invalid_output` + 6 `refused_disclosure`). The re-run outcomes are below.

## Re-run after #286/#285

Run `plan28-p5-20261121f` on 2026-11-21 AEST re-ran the 31 still-failed HIGH cases: 25 `invalid_output` from the retry pass (`schema` 22, `json_parse` 2, `missing_field` 1) and the 6 `refused_disclosure` cases. Shard a also held the one-case canary under the same run id.

| Status | Reason | Count |
|---|---|---:|
| `ok` | — | 6 |
| `ok_partial` | — | 15 |
| `invalid_output` | `json_parse` | 1 |
| `invalid_output` | `unknown_field` | 1 |
| `refused_disclosure` | `env_assignment` | 6 |
| `api_error` (duplicate unresolved) | — | 2 |

The split reason names are the #286 vocabulary. No `schema` or `missing_field` invalid output remained in the re-run; the two remaining `invalid_output` rows are `json_parse` and `unknown_field`. Two `skipped_duplicate` receipt rows were excluded as duplicate receipts.

- Newly completed: **21** (6 `ok` + 15 `ok_partial`). Unresolved after the re-run: 10 (2 `invalid_output`, 6 `refused_disclosure`, 2 `api_error`).
- Actual cost from the run's ledger receipts: **USD 0.3706833** known across 23 receipts (1,308,163 input, 479,734 output tokens). Four attempt entries carry no cost (the 2 `api_error` rows and their cached duplicate receipts), so the all-in cost is unknown, not estimated.
- Before/after HIGH totals: **before 329/360** (main 311 + retry 18); **after 350/360** (329 + 21 newly completed) against the 300 floor.

## Cost

Actual cost is the sum of canonical run receipts in the ledgers; nothing is estimated.

| Scope | Known cost (USD) | Input tokens | Output tokens |
|---|---:|---:|---:|
| Main | 5.690711 | 17,976,111 | 7,206,826 |
| Retry | 1.142236 | 2,914,701 | 1,236,978 |
| **Total** | **6.832947** | **20,890,812** | **8,443,804** |

The 4 main-run `started_unknown` rows carry no receipt, so their spend is unknown rather than zero; the tool reports the all-in cost as unknown and keeps the known receipt sum separate. The re-run's known cost (USD 0.3706833) is additional and is reported in its section above.

## Effort arms

- HIGH: attempted and reported as above.
- xHIGH and MAX: **owner-dropped arms** (Cody, 20 Nov 2026 11:53 PM AEST: HIGH effort only). 0 attempted, 0 completed, not failures, never padded. They carry no shortfall.

## Adjudication

The committed adjudication file is version 1 with no findings labelled: `labeler_model` and `second_labeler_model` are null and double-labelled pairs are 0. Kappa is **not measured: no human labels exist**. 964 required review-finding adjudications from the main trial remain `unadjudicated`; corroboration therefore stays unlabelled. The re-run adds 115 findings (79 required adjudications), also unlabelled. `gate: adjudication labelling`.

## Validation

- Leak check: **pass**; 1,080 requests checked, 0 own-plan document hits, 0 outcome-text hits, 54 foreign-plan document captures, 1,458 short excerpts skipped (the Phase 4 precision scope).
- Structural matching: 0 matches, 80 uncertain-band findings; no finding was adjudicated into a match.
- Shuffled null: seed 28, `shuffled_case_map`.
- Export certification: complete cursor-paged `detail=full` export, one terminal page per run, canonical tags and tenant checked, no truncation, no duplicate identities, no missing canonical record.

## Server changes during the trial

- #281: review output cap raised to 128k, input budget to 92k, attempt timeout to 15m.
- #279: async review row is terminalized when finalize fails.

## Follow-up fixes after the trial

- #285 (redaction happens before JSON parse) and #286 (explicit criteria carry no ids; synthetic `X1..Xn` ids and split schema reasons): merged as PR #304 and verified live before the re-run; the canary returned and validated outcome `X1`.
- #287 (input estimate can undercount by up to 15%): merged as PR #305 with a conservative estimate.
- #288 (POST 524s leave lookup/unknown-row handling incomplete): **pending**, not merged at the time of this re-run.

## Artifacts

- [`alignment-report.json`](alignment-report.json) / [`alignment-report.md`](alignment-report.md) — main run, HIGH only, metric-only aggregate.
- [`retry-alignment-report.json`](retry-alignment-report.json) / [`retry-alignment-report.md`](retry-alignment-report.md) — retry pass.
- [`fix-rerun-alignment-report.json`](fix-rerun-alignment-report.json) / [`fix-rerun-alignment-report.md`](fix-rerun-alignment-report.md) — re-run after #286/#285, HIGH only, metric-only aggregate.
