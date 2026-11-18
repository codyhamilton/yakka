# 13-04 — Release checks and stable documentation

Status: `done`. Every done-evidence line in the brief passes on
`feat/20-analytics-reset`. Nothing was deployed, pushed, or merged, and no
PR was opened.

## Done against the brief

- **Residual-name false positive, narrowed.** The first scanner pattern in
  `tools/release/scan_residual_names.py` now exempts only the exact Phase 12
  identifiers (`PANEL_IDS`, `PANELS`, `PRESET_ID`, `SPECS`, with or without
  `P12_`). The exemption ends on a word boundary, so a stale name such as
  `WORKFLOW_SPECS_OLD` still fails. The explanatory comment was reworded so it
  no longer contains the literal prefix; the scanner had been flagging its own
  comment.
- **Regression evidence.** `test_phase12_workflow_symbols_not_residual` in
  `tools/release/test_scan_residual_names.py` asserts zero hits for current
  symbols and three hits for stale ones. A manual fixture check also flagged
  `const a = WORKFLOW_OLD_SPECS;`.
- **Package README.** `packages/yakka-analytics/README.md` keeps the four
  fields (`**Consumers**`, `**Build**`, `**Test**`, `**Release**`) and now
  states: `web/` is the static no-build output; `build.sh` embeds it and never
  uploads; Pages deploys from `./web` on merge via external automation; the
  API is released separately on Fly; the UI detects capability from
  `/v1/analytics/schema`; no manual deploy, configuration or secrets step.
- **Design 03.** `docs/design/03-remote-service.md` gained one paragraph with
  the same facts (no-build `web/`, embedding, Docker/`go test` placeholder,
  Pages on merge, separate Fly API release, schema capability detection). One
  stale phrase changed from "dashboard" to "workspace".
- **CONTRACTS 14.** Item 1 is relabelled "Current (landed in Phase 1;
  `wrangler.toml` names it)" in place of "Target (Phase 1)". Its `./web`
  content is unchanged.

## Check output, before and after

| Check | Before | After |
|---|---|---|
| `TMPDIR=/home/codyh/.cache/plan20p13 python3 tools/release/test_release.py` | 11 run, OK (~11.8 s) | 11 run, OK (5.7 s) |
| `python3 tools/release/test_layout.py` | 7 run, OK | 7 run, OK |
| `python3 tools/release/test_scan_residual_names.py` | 4 run, **2 failures** (`test_phase5_clean_in_repo`, `test_all_clean_in_repo`) | **5 run, OK** |
| `scan_residual_names.py --scope phase5` | exit 1 (WORKFLOW_ hits) | exit 0 |
| `scan_residual_names.py --scope phase6` | exit 0 | exit 0 |
| `scan_residual_names.py --scope all` | exit 1 (WORKFLOW_ hits) | exit 0 |
| `node --test tests/static-shell.test.mjs` (bundle secret scan, run from `packages/yakka-analytics`) | not run before | 3 tests, 3 pass, 0 fail |
| `git diff --check` | — | clean, exit 0 |
| `git status --porcelain packages/yakka/internal/serve/site` | — | empty (placeholder restored) |

The before row for `test_scan_residual_names` was the first run with the
original pattern. The fifth test was added by this unit.

## Departures from the brief

- **Bundle secret scan location.** The brief says the release/layout checks
  assert the bundle secret scan. They do not. `test_release.py` and
  `test_layout.py` contain no secret-pattern scan. The scan lives in
  `packages/yakka-analytics/tests/static-shell.test.mjs`, run with `node --test`,
  and I ran it there. I did not edit either release test file.
- **Test invocation.** The brief names `python3 -m unittest tools.release.test_release`.
  I ran the equivalent `python3 tools/release/test_release.py`, which gave the
  same 11 tests.
- **Scratch and resource wraps.** Scratch went to
  `/home/codyh/.cache/plan20p13` via `TMPDIR`. Python and Node runs were wrapped
  in `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0`.

## Contradictions and carried items

- **CONTRACTS 10.1, 10.2 and 11.2** still carry "Current (master)" and
  "Target" labels that describe the pre-Phase-1 state. They are outside this
  brief's scope and were left unchanged. They need a Phase 13 or close-out
  unit to relabel them.
- **Worktree state.** `packages/yakka/internal/serve/site_test.go` is modified
  and `packages/yakka-analytics/tests/identity/browser.test.mjs` is untracked.
  Both belong to other Phase 13 workers. They are not staged here.

## Unfinished, actionable

- Relabel CONTRACTS 10.1, 10.2 and 11.2 (see above). The edit is one label per
  section.
- Nothing else in this unit remains open.

## Problems

- No known failures remain in the owned checks.

## gate lines

- `gate: external Pages automation must accept ./web as its output directory (not verifiable here; no deploy/contact)`
- `gate: ready implementation PR must carry Yakka-Plan: docs/plans/20-analytics-reset (not applied; no PR published)`
