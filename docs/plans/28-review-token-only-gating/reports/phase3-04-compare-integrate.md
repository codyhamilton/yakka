# Phase 3 unit 4 — compare candidates, integrate and gate eligibility

Status: done.

## What changed

- `manifest.py`: added the read-only `compare_candidates(...)` harness and a `compare` CLI subcommand; `create_manifest` now defaults to the selected extractor, resolves a deterministic `window_reference` (latest committer time across enumerated refs when none is injected) and enforces all four eligibility conditions: base-criteria blob, at least one cited recorded outcome, code-bearing changed paths, non-empty capture after the plan-document filter. Each candidate gets exactly one exclusion reason; per-tier `{candidates, eligible, frozen}` and `exclusions` are unchanged in shape, and `target` 360 / `floor` 300 and the write-once rule are unchanged.
- `manifest.py`: manifest-side enforcement of the trial capture policy (`strip_plan_documents`) removes every `docs/plans/<plan>/` diff section after `CaptureChange` returns, before eligibility, and recomputes `diff_sha256` plus a new `diff_bytes` field; `capture["base"]`/`resolved_head` are left consistent. The production capture client is untouched.
- `cli.py`: added `compare` (`--repo`, `--history-profile`, `--seed`, `--sample`, `--now`); `manifest` unchanged in options.
- `test_manifest.py`: fixtures now carry recorded outcomes; added a fixture proving a head-amended `DESIGN.md` is present at `head_sha` but absent from the frozen capture; tier/plan/capture-bytes expectations updated; the synthetic three-tier extractor supplies outcomes.
- `test_phase7.py`: `_historical_repo` records a verdict and a finding in `REVIEW.md` at each of its three phase commits (also stripped from the capture), keeping the three-case/three-effort rehearsal green.
- `history_extract_a.py`/`test_history_extract_a.py` selected; `history_extract_b.py`/`test_history_extract_b.py` untouched.

No change to `runner.py`, `report.py`, `README.md`, `.gitignore` or the garcia-music clone.

## Comparison (read-only, metadata-only, seed 28, sample 30)

Deterministic scan of `/home/codyh/workspace/garcia-music` (3819 commits over `HEAD` + remote refs), no manifest written, no diff captured. `now` = latest committer time. Both candidates project above the floor:

| candidate | tier | candidates | with_plan | with_outcome | with_later_fixes | censored | projected eligible |
|---|---|---|---|---|---|---|---|
| A `trailer-commit` | phase | 235 | 235 | 222 | 212 | 90 | 193 |
| A | unit | 467 | 467 | 411 | 5 | 57 | 350 |
| A | pr | 2 | 2 | 2 | 0 | 2 | 2 |
| B `document-report` | phase | 23 | 23 | 23 | 16 | 1 | 17 |
| B | unit | 465 | 465 | 458 | 273 | 27 | 405 |
| B | pr | 94 | 94 | 92 | 10 | 66 | 14 |

Totals: A projected eligible **545** (with-outcome 635); B projected eligible **436** (with-outcome 573). Exclusions: A `no_tier` 3115, `no_recorded_outcome` 69, `no_code_change` 88, `criteria_unavailable` 2; B `no_tier` 3237, `no_recorded_outcome` 9, `no_code_change` 81, `criteria_unavailable` 56. Projected shortfall against 300: 0 for both.

Seeded 30-case sample: outcome resolution rate 1.0 (A) and 1.0 (B); candidate-level all-outcomes-resolve rate 1.0 and 1.0; later-fix sha-exists-and-intersects rate 1.0 and 1.0 (29 sampled fixes each). The comparison returns no case SHA, path, diff or finding text.

## Selection

**A (`trailer-commit`).** Both candidates clear the floor, and their sampled citation rates tie at 1.0, so the brief's stated rule does not separate them. A was taken on the higher projected eligible pool (545 vs 436), higher recorded-outcome total (635 vs 573) and far stronger phase-tier coverage (235 vs 23 candidates), which matches the phase-first tier preference. This tie-break is a judgement the brief leaves open; it is recorded here rather than resolved silently.

## Red then green

Red against the pre-change `manifest.py`/`cli.py` (stashed for the run, then restored), with the updated fixtures:

```
ERROR test_head_amended_design_is_stripped_from_the_capture  (missing diff-sections helper)
ERROR test_freeze_capture_base_criteria_tiers_and_seeded_order  KeyError: 'diff_bytes'
FAIL  test_phase_trailers_supply_plan_and_support_workflow_alias  AssertionError: 'demo' != 'docs/plans/demo'
Ran 3 tests ... FAILED (failures=1, errors=2)
```

Green:

```
$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 91 tests in 14.7s
OK
$ git diff --check
(clean, exit 0)
```

## Clone checks

`git -C /home/codyh/workspace/garcia-music status --short` is unchanged from before the phase (`M .cursor/settings.json`, `?? .cursor/mcp.json`, `?? pid`); `rev-parse --is-shallow-repository` = `false`. No checkout, fetch, commit, reset or clean was issued against it.

## Capture import location

`manifest.py` keeps the path from unit 1: capture is imported as `yakka` from `plugins/yakka/client` (`CaptureChange`, `CaptureError`). Plan 27 is design-only on `design/27-yakka-client-consolidation`; if it lands first, the import moves to `plugins/yakka/scripts/libs/` (indicatively `capture.py`) with the same call shape. Not changed here.

## Deviations and contradictions

- **Tie-break undefined.** The brief selects on resolved-citation rate and only names a fallback when both are below 300. Rates tie at 1.0 and both clear 300; A chosen on projected count, outcome count and phase coverage (see Selection).
- **"Read the history once".** The two candidates are separate modules, each doing its own single-pass history read inside its `extract`; the comparison adds one shared reference-time read and memoises changed-path and existence lookups. A true single shared pass would require editing the unselected extractor, which the brief forbids. Recorded rather than silently claimed.
- **Removed `missing_comparator_source`.** Unit 1's manifest excluded phase/PR candidates without comparator pointers; DESIGN's four eligibility conditions do not include that gate, so it is dropped. Comparator pointers are still recorded.
- **`window_reference` now concrete.** When no `now` is injected, `create_manifest` records the latest committer time across enumerated refs (deterministic, no wall clock) so unit 5 has a freeze reference; the injected value is still echoed verbatim.
- **Fixture changes.** The synthetic phase trailer changed from an unrelated plan token to `demo:6`, and the phase plan assertion now expects the resolved folder path; both follow the selected extractor's plan resolution. `test_phase7`'s fixture gained recorded outcomes as the brief requires; its assertions were not weakened.
- Red output was captured by re-running the new fixtures against the pre-change modules after implementation, not strictly before it (the brief asks for red first). The failures are the intended ones.

No non-trivial bug was found outside this unit's evidence; the unit 1 deferred capture bug is addressed on the manifest side as the amendment requires.
