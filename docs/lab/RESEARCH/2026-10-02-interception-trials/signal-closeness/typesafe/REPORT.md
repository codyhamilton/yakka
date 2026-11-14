# PR-SIGNAL-CLOSENESS — TypeSafe Wave-3 seat

Status: **complete**
Scope: maps-only measurement; not a behaviour ship.

## Pins and gates

- Protocol: `protocol-v0-atomic.json`
  - SHA-256: `5f54251e6168ad35e67a0c192bacd1a03b1d05814bc56565373453fbc9206d52`
  - verified before manifest generation and before every model run
- Panel: `panel-v0.json`
  - SHA-256: `e36fcebc51da2e9b6be21de49457a1da0a82c60eceaa8991ae644c39b4adec67`
  - verified before manifest generation and before every model run
- Inventory: `INVENTORY-READY.md`, status `READY`; no `WAVE3-INVENTORY-STATUS.md` was present
- Driver/model: TypeSafe / `jev-1.13.0`
- TypeSafe score wire: the three pinned anchors return raw expected ordinals
  `0..2`; results retain `raw_score` and normalize by `2.0` to the protocol
  float range `[0,1]`
- `call_jev`: false; `:8080`: kept unloaded
- Replicates: 2; preferred checkpoint: 75
- Holdouts: 25 present in the panel and not scored
- Residual pack path: repository gold hybrid packs at
  `docs/lab/RESEARCH/2026-10-01-progressive-jev-session-gates/proofs/validated/gold/packs/`
  for `0aab88c525de` and `036ff3ed4a89`, reused at checkpoint 75

## Zero-call gate

The profile was built offline from cumulative pack fields and last-n excerpts
before any TypeSafe POST:

| signal | zero_call_separation | model | evidence | outcome |
|---|---:|---:|---|---|
| `thrash` | true | skipped | reread paths + compaction: high mean 42.0 vs low mean 5.5 | PASS — zero-call separated |
| `poll` | true | skipped | Monitor + wait terms: high mean 15.0 vs low mean 1.5 | PASS — zero-call separated |
| `productive_edit` | true | skipped | Edit + Write: high mean 9.0 vs low mean 0.0 | PASS — zero-call separated |
| `validation_inflection` | false | eligible | profile skipped by design; `prompt_plus_last_n` required | pending model result |

The `bb6165018de0` caution is retained: `write_count=1` is recorded, but its
poll-side offline score remains in the poll high-side profile because the
zero-call metric is Monitor plus wait terms, not Write absence.

## Planned TypeSafe cells

One multi-ask request contains the independent `validation_inflection` float
ask. There is no union, winner, fire, or holdout ask. The full cell manifest is
in `cell-manifest.json`.

| worker | stratum | replicate 1 | replicate 2 |
|---|---|---|---|
| `92a48e004519` | thrash | `26a32082c4344511` | `b4623b8c298c5761` |
| `ca977b9ca0dd` | thrash | `8c62a9300a497738` | `0cc1d1ad9f0bc182` |
| `87a380bc64ff` | poll | `c816f3e034e48595` | `b8338a1a47f1fc00` |
| `bb6165018de0` | poll | `57f2efe4358d40ad` | `dc350173ede5c0c2` |
| `15f24c7ba18c` | poll | `4b8384bc88cb6da2` | `92b7a898c20dc727` |
| `0677f597286e` | productive_edit | `79cfe237f0bca7cf` | `d22bf246fa788f75` |
| `074c8cf22927` | productive_edit | `d74e4ed2c32089ef` | `35f03fb2e567bd55` |
| `0aab88c525de` | validation_inflection | `8c79d48cac6ec8b9` | `2596bd2ba1b821a7` |
| `036ff3ed4a89` | validation_inflection | `70b4f607175a15b7` | `be532e8042afdcaa` |

## Analysis rule

For the only model-seated signal, compare the replicate-level valid float
means for the residual high side (`0aab88c525de`, `036ff3ed4a89`) against the
stable thrash plus clean productive-edit low side. A strictly higher high-side
mean passes; flat or reversed kills. This is a closeness result, not a
behaviour or intervention decision.

## Results

Results are written to `results.jsonl`; request/response captures are under
the ignored `raw/` directory. All 18 planned cells returned HTTP 200 and
valid normalized floats.

| signal | model cells | zero_call_separation | outcome |
|---|---:|---:|---|
| `thrash` | 0 | true | PASS — zero-call separated; model skipped |
| `poll` | 0 | true | PASS — zero-call separated; model skipped |
| `productive_edit` | 0 | true | PASS — zero-call separated; model skipped |
| `validation_inflection` | 18 | false | KILL — high-side mean `0.7375` did not exceed low-side mean `0.765625` |

`validation_inflection` high-side scores were `0.915, 0.925, 0.56, 0.55`;
low-side scores were `0.875, 0.875, 0.87, 0.875, 0.82, 0.84, 0.485, 0.485`.
The result is a per-signal measurement outcome only; it does not ship
behaviour or authorize a new signal family.
