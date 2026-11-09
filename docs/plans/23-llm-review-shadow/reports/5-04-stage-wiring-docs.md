# 5-04 — Advisory stage wiring and stable docs

Status: done with concerns

## Delivered

- Added one non-gating `review_change` range call to each of `execute`, `post-build`, and `comprehensive-review`. Each uses explicit range placeholders, plan/phase or PR criteria when available, and `build_models` from the run record or `unknown`; each sends no `trial` argument. The instructions keep results in session output and out of gates, verdicts, commits, reports, and plan artifacts. They treat `skipped_duplicate` as a reference to earlier evidence, not a new independent review.
- Updated the Claude plugin version from 3.4.2 to 3.4.3.
- Updated `docs/ARCHITECTURE.md`, `docs/OVERVIEW.md`, `docs/design/04-advisory-surface.md`, `docs/design/08-server-mcp-contract.md`, and `docs/design/system-architecture.md` to document server ownership, `read_write` spend-and-record behavior, shim-only bounded local capture, no provider key on machines, no local actions, conditional registration, advisory behavior, and duplicate receipts.

## Evidence

Final verification commands ran with an 8 GiB address-space cap and `TMPDIR` inside this worktree; no final test used `/tmp`.

- `GOMAXPROCS=3 prlimit --as=8589934592 -- go test -p=3 ./internal/serve` — passed (`11.273s`).
- `prlimit --as=8589934592 -- python3 -m unittest test_mcp_shim test_capture` — 36 passed (`7.585s`).
- `python3 tools/driver/check_skills.py` against a temporary install-layout fixture pointing to the repository skills — passed; found all six expected skills. The fixture lived under `.codex-phase5-tmp` in the worktree and was removed.
- Stage text/JSON fixture — passed: exactly one non-gating range call in each named skill, correct criteria kind, `build_models`, no `trial`, explicit range, duplicate semantics, and advisory wording.
- Stable-doc text check — passed for all five updated docs; manifest version check — passed (3.4.2 → 3.4.3).
- `git diff --check` — passed.

## Concerns and deviations

- The first 5-04 attempt stopped before implementation at the brief's 15-file read budget and committed handoff `ed013e1`; the one retry completed the unit.
- During that retry, a temporary checker fixture was created under `/tmp`, contrary to the task instruction. The directory was automatically removed by `TemporaryDirectory` and verified absent. All final checks were rerun with `TMPDIR` inside the worktree. No other `/tmp` path was used for final verification.
- The 5-03 report's REST replay returns `skipped_duplicate` rather than a byte-identical first receipt. Stage guidance documents the existing idempotency behavior and does not promise fresh independent findings on duplicate captures.
- Known carried issue from 5-02: `_capture_blob` reads full worktree content before enforcing the per-file cap; it remains unmodified and should be considered by a later refinement.

No paid/live provider call, credential access, deploy, Fly, or Wrangler action was used. No remaining work in this unit.
