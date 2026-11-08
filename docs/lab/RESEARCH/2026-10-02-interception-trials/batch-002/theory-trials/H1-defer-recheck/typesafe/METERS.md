# H1-defer-recheck TypeSafe meters

**Generated:** 2026-10-02 UTC  
**Stratum:** `maps-5h`  
**Approach:** `H1-defer-recheck`  
**Driver/model:** TypeSafe System One / `jev-1.13.0`

This is Maps-only evidence from four requested fixtures. It is an offline
assessment/decision trial: no hooks, assert-hook changes, Pilot live Jev, or
product wiring.

## Execution

| Measure | Result |
|---|---:|
| Cells | 8 |
| Sessions | 4 |
| Checkpoints | 75 and 90 |
| Re-check interval | 15 turns |
| HTTP successes | 8 |
| Errors | 0 |
| Parse misses | 0 |
| Fire | 1 |
| Defer | 7 |

| Checkpoint | Cells | Fire | Defer |
|---:|---:|---:|---:|
| 75 | 4 | 0 | 4 |
| 90 | 4 | 1 | 3 |

The 90-turn cell for `bb6165018de0` was the only fire:
`330f878d73bbfe36`.

## Fire-time versus ideal steer

The fixture manifest shows all four sessions continuing well past the
re-check (API-turn totals: 154, 161, 192, and 296). That makes them
runaway-tail candidates for exploratory timing discussion, but it is not an
evidence-based ideal-steer label. The transcript fixtures do not provide
independent adjudicated steer windows, and final length was never sent to the
judge.

| Session | Observed decision path | Fire-time | Trajectory-only read |
|---|---|---:|---|
| `92a48e004519` | defer → defer | none | Long-tail candidate; ideal window unknown |
| `bb6165018de0` | defer → fire | 90 | 90 is a plausible H1 re-check fire point; ideal window unlabelled |
| `0aab88c525de` | defer → defer | none | Long-tail candidate; ideal window unknown |
| `036ff3ed4a89` | defer → defer | none | Long-tail candidate; ideal window unknown |

Accordingly, this slice does not claim a fire-time error, hit, or miss.
`near_done_fp` and `runaway_miss` counts are **unknown**, not zero: no
outcome-label sidecar exists for these eight checkpoint cells.

## Artifact paths

- `cell-manifest.json` — stable cell IDs, inputs, decisions, ratings, and timestamps
- `results.jsonl` — normalized rows with raw answers and response paths
- `raw/` — per-cell request and TypeSafe response captures (on-disk; ignored by
  the batch-wide bulky-capture rule)
- `run_h1_defer_recheck.py` — reproducible runner

The manifest is the authoritative cell list. The raw response captures retain
the full System One payloads; `window_status=unidentified` and
`reference_fire=null` are intentional.
