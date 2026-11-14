# shape-qual-full-maps-v1 — Grok seat

n=34. `model` is `Grok` on every verdict. Early signals are cited only at turns ≤ 120. Exit turn is secondary and was not tuned for agreement.

`poll_monitor` is a distinct label outside the §11 trio (`late_pivot` / `early_thrash` / `unclear`). It is used where standby on a monitor, census, or dispatched unit is the session shape. That includes `87a380bc64ff`.

## shape_label counts

| shape_label | n |
|-------------|--:|
| unclear | 24 |
| late_pivot | 4 |
| poll_monitor | 4 |
| early_thrash | 2 |

### early_thrash

- `92a48e004519` — silent Bash/Read loop on the same parser files from turn 75; compactions and rereads climb; text frozen; no Edit/Write.
- `ca977b9ca0dd` — same pattern at the first checkpoint: reread cluster, compactions already 10, text stuck, empty tails.

### late_pivot

- `0aab88c525de` — assembler edits and passing tests, then a park on the Perth extraction monitor (turns 165–180).
- `7c99c180742e` — suite already green, then the rest of the prefix is a re-armed disc-check wait.
- `5163c22a6a3e` — edits/writes already in the histogram, then a breakage side-look and a pause on a long extractor.
- `582c23b3c6e4` — silent bash tail, then an explicit failed sha gate and a refusal to commit.

### poll_monitor

- `87a380bc64ff` — only checkpoint; every prose turn is waiting on compare_disc and roundtrip monitors.
- `bb6165018de0` — census standby from turn 68 until the census finishes at turn 149.
- `15f24c7ba18c` — parent orchestrator; Monitor is the top tool (28) at turn 75.
- `8e36f8e80baa` — record, dispatch a unit agent, then Monitor on verification.

### unclear

Not one shape. Clusters:

- Build, test, or record still on the brief, including evidence waits that resolve in the pack: `036ff3ed4a89`, `0853bc21d3aa`, `7b00225cb824`, `89608cc68603`, `6e06ab86aa72`, `5a152464f6e5`, `d34bb8ba01ba`, `52ea24516a6e`, `7af2854bba92`, `79a557b56a6e`, `a318f4b89a6a`, `16a958631580`, `0677f597286e`, `9b156dbab5d9`, `a3cc4da7e21c`, `91a9aa8050fb`, `d84416c7c9d4`, `074c8cf22927`, `9da2f589b11b`.
- Bash-only or empty-tail prefixes where a reread loop or a stated wait is not in the pack: `daf933273c8f`, `e28a2428b192`, `de5b76cc68a6`, `07357f196666`.
- Single checkpoint with a gate wait and moderate rereads, not a multi-checkpoint loop: `e8aa4f271927`.

## early_signals

No worker has an empty `early_signals` list. Every cited turn is ≤ 120, and `early_signal_window_respected` is true on all 34 files.
