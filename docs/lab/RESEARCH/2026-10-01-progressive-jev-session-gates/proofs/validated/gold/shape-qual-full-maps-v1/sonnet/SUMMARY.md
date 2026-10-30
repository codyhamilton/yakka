# shape-qual-full-maps-v1 — Sonnet seat (n=34)

Seat: Sonnet. Input: hybrid_v0 pack rows only (all `75:15` checkpoints per worker). No `--call-jev`; no prior seat labels, nicknames or turn count used as the answer. Exit turn / earliness left `null` (secondary).

## shape_label counts

| shape_label | n |
|---|---|
| late_pivot | 0 |
| early_thrash | 2 |
| unclear | 32 |

Total 34. The three-value enum is coarse for this corpus: most workers are ordinary completions or wait-dominated runs with no pivot, so I kept `unclear` for them and added a free-text `shape_detail` field (extra to the SEAT-PROMPT schema) to carry the real distinction.

## shape_detail (finer taxonomy)

| shape_detail | n | workers |
|---|---|---|
| steady_build_to_commit | 11 | `0677f597286e`, `074c8cf22927`, `0853bc21d3aa`, `16a958631580`, `5a152464f6e5`, `79a557b56a6e`, `89608cc68603`, `91a9aa8050fb`, `9b156dbab5d9`, `9da2f589b11b`, `e8aa4f271927` |
| bash_only_silent | 4 | `07357f196666`, `582c23b3c6e4`, `de5b76cc68a6`, `e28a2428b192` |
| build_then_long_wait | 4 | `5163c22a6a3e`, `52ea24516a6e`, `7c99c180742e`, `a3cc4da7e21c` |
| poll_monitor_wait | 3 | `6e06ab86aa72`, `87a380bc64ff`, `bb6165018de0` |
| orchestrator_dispatch_wait | 2 | `7af2854bba92`, `8e36f8e80baa` |
| churn_compaction_loop | 2 | `92a48e004519`, `ca977b9ca0dd` |
| wait_verify_then_record | 1 | `036ff3ed4a89` |
| steady_build_then_wait | 1 | `0aab88c525de` |
| orchestrator_monitor_burst | 1 | `15f24c7ba18c` |
| steady_build_with_perf_debug | 1 | `7b00225cb824` |
| debug_iterate_runaway_job | 1 | `a318f4b89a6a` |
| steady_build_with_audit_of_existing | 1 | `d34bb8ba01ba` |
| research_measurement | 1 | `d84416c7c9d4` |
| silent_bash_loop_then_monitor | 1 | `daf933273c8f` |

Definitions: `steady_build_to_commit` = authoring then verify/commit, no pivot; `build_then_long_wait` / `steady_build_then_wait` = authoring finished early, remainder is bounded waits on long jobs; `poll_monitor_wait` = visible turns are mostly waiting/monitoring with little or no authoring; `bash_only_silent` = single-tool Bash stream with ~no narration, productivity not inferable from the pack; `churn_compaction_loop` = read/bash loop on a fixed file set with heavy compaction and no new inputs; `orchestrator_*` = dispatch/verify orchestrators.

## Notable workers

- `92a48e004519`, `ca977b9ca0dd` — the only `early_thrash` labels. Both show the churn signature by T75: 10-12 compactions, no edits, fixed re-read set, near-zero narration. `92a48e004519` later changes character (~T225 closeout); the pack cannot show whether its middle ~150 turns were converging debug, so confidence is moderate there and higher for `ca977b9ca0dd`.
- `87a380bc64ff` (poll/monitor, kept as requested) — lands as a distinct `poll_monitor_wait` shape: zero Edit/Write in 75 turns, repeated 'waiting on both monitors'. Only one checkpoint (T75; 14 turns unseen).
- `bb6165018de0`, `6e06ab86aa72` — also `poll_monitor_wait`; they end cleanly (census completes T149; coord_scale PASS T118).
- `15f24c7ba18c` — 28 Monitor calls by T75, a burst that stops by T90 (orchestrator, not a runaway).
- `582c23b3c6e4` — ends at T75 with a `needs context` report (uncommitted); that report is outcome, not an early signal.
- `5163c22a6a3e` — last visible turn (T90) is a pause-and-wait declaration, no commit visible.
- `late_pivot`: none assigned. No worker showed usable progress followed by a clear change of fortune after which continuing was evidently a mistake within the visible packs; `a318f4b89a6a` (runaway-process diagnosis at T86) was the closest and was kept `unclear`.

## Early-signal window

- 138 early signals across 34 workers; max cited turn = 120 (all ≤ 120; `early_signal_window_respected` true for all).
- Workers with empty early_signals: none.
- For workers whose only checkpoint is T75 (T ≤ ~90), signals are anchored at T75 (cumulative counts) or to turns visible in the 8-turn tail; the pack shows only the last 8 turns per checkpoint, so turns T1-67 are cumulative-only.

## Coverage limits

Workers whose last checkpoint precedes T (unseen tail turns, cannot be labelled from the pack): `036ff3ed4a89` (11), `0677f597286e` (3), `07357f196666` (8), `074c8cf22927` (1), `0853bc21d3aa` (5), `0aab88c525de` (12), `15f24c7ba18c` (3), `16a958631580` (4), `52ea24516a6e` (2), `582c23b3c6e4` (2), `5a152464f6e5` (14), `6e06ab86aa72` (3), `79a557b56a6e` (5), `7af2854bba92` (9), `7b00225cb824` (2), `7c99c180742e` (10), `87a380bc64ff` (14), `89608cc68603` (5), `8e36f8e80baa` (7), `91a9aa8050fb` (11), `92a48e004519` (11), `9b156dbab5d9` (3), `9da2f589b11b` (1), `a318f4b89a6a` (5), `a3cc4da7e21c` (1), `bb6165018de0` (4), `ca977b9ca0dd` (4), `d34bb8ba01ba` (11), `d84416c7c9d4` (6), `daf933273c8f` (2), `de5b76cc68a6` (4), `e28a2428b192` (12), `e8aa4f271927` (1).

## Could not label

None: all 34 workers have a verdict. Several (`bash_only_silent`) are labelled `unclear` because the packs contain too little narration to separate productive from looping behaviour.
