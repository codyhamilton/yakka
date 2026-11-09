# 5-04 — Advisory stage wiring and stable docs

Status: `over budget`

## Done

- Read the assigned design sections and architecture contracts, all three stage skills, plugin manifest, skill checker, Phase 5 implementation record, and the 5-03 integration report.
- Confirmed the registered tool is `review_change`; its required arguments are `mode` and `build_models`. It accepts explicit range refs (`base`, `head`) and plan/phase or PR criteria references. The registered declaration uses `read_write` scope, a 150-second timeout, no local actions, and the `project_dir`, `cwd`, `git`, `change` context order.
- Recorded the handoff in `IMPLEMENTATION.md`.

## Not done

- No stage skill calls, stable documentation updates, plugin version bump, or checker changes were made.
- `python3 tools/driver/check_skills.py`, the requested stage-call fixture check, and `git diff --check` were not run because the brief's 15-file read budget was exceeded before implementation and required stopping.

## Contradiction and known concern

- The 5-03 report says repeated identical captures return `skipped_duplicate`, naming the original receipt, rather than a fresh independent review. Do not alter that idempotency behavior in this unit. Stage guidance should accurately describe duplicate receipts as advisory and avoid promising a new review for a repeated capture.

No live provider call, trial, secret, deploy, Fly or Wrangler action was used. No implementation changes were made.
