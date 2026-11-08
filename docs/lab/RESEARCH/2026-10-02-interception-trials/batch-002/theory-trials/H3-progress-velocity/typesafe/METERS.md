# H3-progress-velocity TypeSafe meters

**Generated:** 2026-10-02 UTC  
**Stratum:** `maps-5h`  
**Approach:** `H3-progress-velocity`  
**Driver/model:** TypeSafe System One / `jev-1.13.0`

Maps-only offline assessment/decision evidence. The H3/H4 cells use the H1 prefix-only state projection and 75/90 grid. Only the approach question and response classes differ. No hooks, assert-hook changes, Pilot live Jev, or product wiring.

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

## H2 null baselines

These are deterministic baselines over the same eight cells; no model call or outcome label is used.

| Null | Fire | Defer |
|---|---:|---:|
| `never_fire` | 0 | 8 |
| `constant_turn_75` | 8 | 0 |
| `constant_turn_90` | 4 | 4 |

## Fire-time versus ideal steer

The fixture set has no independent adjudicated steer-window sidecar. `ideal_steer_window` is therefore unidentified, and `near_done_fp` and `runaway_miss` are unknown rather than zero. This trial does not claim a timing hit, miss, or false-positive rate.

## Artifact paths

- `cell-manifest.json` — stable cell IDs, inputs, decisions, ratings, and timestamps
- `results.jsonl` — normalized rows with raw answers and response paths
- `meters.json` / `METERS.md` — execution counts, H2 nulls, and honest unknowns
- `raw/` — per-cell request and TypeSafe response captures
