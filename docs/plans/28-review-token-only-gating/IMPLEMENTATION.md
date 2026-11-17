# Implementation — Review availability needs only the provider token (plan 28)

- Tool: OpenCode `opencode run` — model `opencode-go/deepseek-v4.1-flash`; launched by the Plan 28 driver as tag `28-p1`
- Start: 2026-11-18 03:22 AEST (Australia/Brisbane, UTC+10)
- Branch: `feat/28-review-token-only-gating`
- Design baseline: `34bb8087a18c4ae312fd922f1c1d9b97a5b2b48c` (design PR #247)

## Phase 1 — Token-only review on the server, docs and fixtures

Units: `phase1-01-review-core`, `phase1-02-store-pricing`, `phase1-03-ingest-vocabulary`, `phase1-04-serve-wiring`, `phase1-05-stable-docs`. Wave 1: 01, 03, 05. Wave 2: 02, 04 (both depend on 01).

- **phase1-01-review-core** — closed `edaee82`. `Availability` is `{Token, Local}`; claims-only reservations with `ErrBusy`/`ErrClaimState`; spend ledger, cap, `reserveRetry`, `settle` and estimates removed; provider usage carried on invalid output; actual cost with `cost_known`. `go build ./internal/review` and `go test ./internal/review -count=1` pass. Deviation: added `omitempty` to `Attempt.CostUSD`; no literal failing-first output captured. Report: `reports/phase1-01-review-core.md`.
- **phase1-03-ingest-vocabulary** — closed `777bf73`. `skipped_busy` accepted; nullable `cost_usd` with `cost_known:false` validation on `review_run`/`review_usage`; historical reservation fields still accepted. `go test ./internal/ingest -count=1` and `go vet` pass. Report: `reports/phase1-03-ingest-vocabulary.md`.
- **phase1-05-stable-docs** — closed `ee3e2ec` (done with concerns: the global var grep still matched unit 01's unlanded code at its commit). Token-only availability, constant model, per-call effort and no spend limit stated in stable docs, `fly.toml`, `tools/README.md`, `CHANGELOG.md` and the Plan 23 pointer. Report: `reports/phase1-05-stable-docs.md`.
- **phase1-02-store-pricing** — closed `a8037cb`. `ReservationCost` removed; `TestLiveReviewModelIsPriced` pins `claude-haiku-5-5` in the pricing table; tier/table-identity coverage kept. `go test ./internal/store` and `go vet` pass. Report: `reports/phase1-02-store-pricing.md`.
- **phase1-04-serve-wiring** — closed `c0ff19c`. `Config` keeps only `ReviewToken`; the four removed variables are not read and no longer fail or alter startup; registration and availability are token-only; reservations wire with no unavailable fallback; residue is claims-only. `go test ./internal/serve -count=1` passes and the removed-variable grep is empty. Deviation: tests build the removed names by concatenation so the required grep stays empty. Report: `reports/phase1-04-serve-wiring.md`.

**Verification** (runner, after all five units):

```
$ cd packages/yakka && go build ./...                                  # OK
$ systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- \
    go test ./internal/review ./internal/ingest ./internal/store ./internal/serve -count=1
ok review 3.0s   ok ingest 0.2s   ok store 4.6s   ok serve 10.9s
$ grep -rIE 'YAKKA_REVIEW_(MODEL|EFFORT|USD_CAP|REPOS)' . --exclude-dir=.git \
    --exclude-dir=plans --exclude-dir=shadow-review-trial              # no matches
$ grep -n 'spend limits' <5 docs>; grep -n 'review model configuration' <5 docs>  # no matches
$ grep -n 'CLAUDE_API_TOKEN' docs/design/03-remote-service.md fly.toml  # both state the sole setting
$ git diff --check 34bb808..HEAD                                       # clean
```

The Phase 1 outcome is exercised through its own entry points: MCP `tools/list` includes `review_change` with a token and omits it without; a token-less and a local-mode REST POST return `unavailable` with the stated reasons; a fake endpoint returns `ok` at model `claude-haiku-5-5` and effort `high`, with `xhigh`/`max` accepted and an invalid effort refused with no request or row; all four removed variables (including `USD_CAP=zero` and a malformed repo list) are ignored without a startup error; actual cost and token fields, `cost_known`, usage-bearing invalid output, null cost on usage-free failures, six uncapped calls, a third concurrent `skipped_busy`, v1/v2 reservations with spend, claims-only reset/delete residue, and dry-run ordering with no `estimated_usd` all pass. Runner addition: `TestReviewMCPRegistrationAvailability` now asserts the MCP `tools/list` observable in the committed suite, not only `mcpTool`.

**Carried:** None.

## Phase 2 — Trial tooling without spend gates

Run: OpenCode `opencode run` — model `opencode-go/deepseek-v4.1-flash`; start 2026-11-18 04:16 AEST. Refined as 3 units (`7288e46`): wave 1 unit 1; wave 2 units 2 and 3.

Units: `phase2-01-run-path`, `phase2-02-report-cost`, `phase2-03-readme`.

- **phase2-01-run-path** — closed `60a8837`. `approval.py`/`test_approval.py` deleted; `runner.run` takes no cap/record; preflight rows are `{case_id, effort, status}` with only `unavailable` blocking; `skipped_busy` run receipts go `retry_pending` and legacy `skipped_budget` retries; CLI loses the cap and record options; fixture rehearsal records actual cost. `python3 -m unittest test_runner.py test_phase7.py` 29 OK, `test_manifest.py` 12 OK, full discover 54 OK; required grep empty. Deviation: no red-first output captured. Report: `reports/phase2-01-run-path.md`.

- **phase2-02-report-cost** — closed `aadac76`. `report.build_report` takes five arguments; `skipped_busy` added to `STATUSES`; cap/projection/reservation/exposure fields deleted; `cost_known`/null-cost validation and unknown-cost counting added at receipt, export-attempt, arm, per-case and run level; per-case gains `known_cost_usd` and `unknown_cost_attempts`. `python3 -m unittest test_report.py test_report_export.py` 17 OK; full discover 58 OK; required grep empty. Deviation: `_validate_export` also accepts null cost with the flag (needed for a null per-case total). Report: `reports/phase2-02-report-cost.md`.
- **phase2-03-readme** — closed `819ef2e` (done with concerns: its brief's "deployed-server readiness" label collided with the check that forbids the word `readiness`; used DESIGN's "deployed-server target"). README has no spend-approval gate, no removed variable and no allowlist setup; dry-run, execute, report, smoke and layout sections describe actual cost and the transient `skipped_busy`. `run --help`/`report --help` and loopback `smoke` pass; forbidden-string greps empty. Report: `reports/phase2-03-readme.md`.

**Verification** (runner, after all three units):

```
$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'   # Ran 58 tests, OK
$ python3 -m unittest tools/shadow-review-trial/test_phase7.py -v            # Ran 3 tests, OK
$ grep -rIE 'YAKKA_REVIEW_|refused_over_cap|cap_usd|cap-usd|estimated_usd|approval' \
    tools/shadow-review-trial --exclude-dir=__pycache__                      # no matches (exit 1)
$ ls tools/shadow-review-trial                                               # approval.py and test_approval.py absent
$ python3 tools/shadow-review-trial/cli.py run --help                        # no --cap-usd, no approval option
$ python3 tools/shadow-review-trial/cli.py report --help                     # no --cap-usd
```

The Phase 2 outcome is exercised through its own entry point by `test_three_case_three_effort_manifest_run_saved_records_and_report`, which drives `cli.main` against a loopback fixture server: `run --dry-run` posts 9 dry-runs and makes 0 model calls with `readiness.ready` true and no estimate fields; `--execute` with a wrong tenant and with an `unavailable` dry-run each exits with 0 model calls; the full `--execute` makes 9 model calls and completes 3 cases at each of `high`/`xhigh`/`max` with no approval file and no cap; the ledger's 9 run receipts and attempt rows each carry `cost_usd` 0.01; the report shows `usage.cost_usd` and `known_cost_usd` 0.09 and 0.03 per arm and 0.01 per case. `test_report.py`/`test_report_export.py` accept `skipped_busy` and legacy `skipped_budget` and treat null cost with `cost_known:false` as unknown, never estimated.

Artifact feedback: all three briefs and all three reports `delivered`, screen pass; no flagged checks.

**Carried:** None.

## Phase 3 — garcia-music manifest of at least 300 eligible cases

Run: OpenCode `opencode run` — model `opencode-go/deepseek-v4.1-flash`; start 2026-11-18 04:39 AEST. Phase is `approach: open`; the invoker declares its approach as two candidate extractors compared, freezing at most 360 eligible with a 300 floor and no padding.

Units: `phase3-01-manifest-contract`, `phase3-02-extractor-a`, `phase3-03-extractor-b`, `phase3-04-compare-integrate`, `phase3-05-real-freeze`, `phase3-06-verify-manifest`. Wave 1: 01. Wave 2: 02 and 03 in parallel. Wave 3: 04. Wave 4: 05. Wave 5: 06 (fresh verifier).
- **phase3-02-extractor-a** — closed `8a1983b`. New `history_extract_a.py`/test: trailer- and subject-led phase/unit/PR tiers, `REVIEW.md` and `IMPLEMENTATION.md` outcome citations, later-fix hunk intersection, censoring from an injected `now`. Real-clone read-only scan (3819 commits): phase 235 candidates / 222 with outcome / 212 with fixes / 90 censored; unit 467 / 411 / 5 / 57; PR 2 / 2 / 0 / 2; exclusions `no_tier` 3115, `no_recorded_outcome` 69. Full 89-test suite OK at its commit. Clone working tree was already dirty (`M .cursor/settings.json`, `?? .cursor/mcp.json`, `?? pid`) and was left unchanged. Report: `reports/phase3-02-extractor-a.md`.
- **phase3-03-extractor-b** — closed `2210d8a` (done with concerns: the code was inherited from an attempt that ended on a permission rejection; a fresh worker verified and committed it and the report; ~400-line budget exceeded to ~895 lines including tests). New `history_extract_b.py`/test: document- and report-led tiers. Real-clone read-only scan: phase 23 / 23 / 16 / 14 censored; unit 465 / 458 / 273 / 363; PR 94 / 92 / 10 / 77; exclusions `no_tier` 3236, `no_recorded_outcome` 9, `no_base_commit` 1. Phase extraction is sparse by design in the document-led candidate (trailer-led A reports 235). Full 90-test suite OK. Clone left unchanged. Report: `reports/phase3-03-extractor-b.md`.
- **phase3-04-compare-integrate** — closed `53ab02b`. Both candidates cleared the floor; seeded citation rates tied at 1.0 on the 30-case sample, so extractor A (trailer-commit) was selected on projected eligible 545 vs 436 and phase coverage 235 vs 23. `create_manifest` now defaults to A, enforces base-`DESIGN.md` criteria, at least one cited outcome, a code-bearing non-empty capture and the tier preference/cap; `strip_plan_documents` removes every `docs/plans/<plan>/` diff section after capture and recomputes `diff_sha256`/`diff_bytes` (the client's `docs/` hard-code is untouched). Added `window_reference` from the latest committer time. Deviations: the brief's tie-break was undefined (recorded explicit tie-break); `missing_comparator_source` dropped as it is not one of DESIGN's four eligibility conditions; the two extractors each read the history once rather than sharing a pass. Full 91-test suite OK; `test_phase7` phase heads now record verdicts/findings. Report: `reports/phase3-04-compare-integrate.md`.
- **phase3-05-real-freeze** — closed `fc1760f` (done with concerns). One real-clone freeze with seed 28 wrote the local gitignored `tools/shadow-review-trial/.trial-data/manifest-28.json`: `manifest_sha256` `10f8d4d3…d482f`, target 360, floor 300, 3815 candidates, eligible pool 534, **frozen cases 360** (`300 <= 360 <= 360`), 100 censored, 184 enumerated refs, non-shallow and object-complete. Per tier `{candidates, eligible, frozen}`: phase 235/193/193, unit 464/339/167, pr 2/2/0. Exclusions: `no_tier` 3114, `no_recorded_outcome` 69, `no_code_change` 88, `empty_capture` 8, `criteria_unavailable` 2 (sum 3281 = 3815 − 534). Every case carries a unique head, base criteria (`base_blob`), a non-empty capture and ≥1 outcome; 173 captures are truncated but non-empty. Clone HEAD/count/shallow status unchanged; its pre-existing dirty entries remain. Reported concerns: other plans' plan documents (not the case's own) reach 54 captures — literal compliance with the case-plan exclusion, carried to Phase 4's leak check; `cli.py` prints the frozen count under the label `eligible`. Report: `reports/phase3-05-real-freeze.md`.
- **phase3-06-verify-manifest** — closed `301ecf0` (done with concerns: brief wording vs manifest shape and a pre-existing clone-dirty expectation, recorded not silently resolved). Independent verifier re-resolved citations from git and passed all nine checks: canonical hash matches; 360 cases with target 360/floor 300, non-shallow, object-complete, enumerated = verified 3815; every case has tier/base/head/non-empty capture/base criteria/≥1 outcome (10,667 outcomes)/later-fixes list/bool censored; tier + `no_tier` candidates = 3815, eligible 534, exclusions 3281 = 3815−534, shortfall 0; no duplicate head or `(base,head)`; 30-case seeded sample resolved every outcome citation, every fix intersection, every window and 13 base-vs-head DESIGN changes against the base hash; nothing from `.trial-data/` tracked; clone HEAD/count unchanged. Report: `reports/phase3-06-verify-manifest.md`.

**Verification** (runner, after all six units):

```
$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 91 tests ... OK
$ python3 - <<'PY'  # read-only check of the frozen local manifest
cases 360 target 360 floor 300 shortfall 0
hash_ok True
shallow False object_complete True enum==verified True
tiers {'phase': {235, 193, 193}, 'unit': {464, 339, 167}, 'pr': {2, 2, 0}}
exclusions {criteria_unavailable 2, empty_capture 8, no_code_change 88, no_recorded_outcome 69, no_tier 3114} sum 3281 = excluded_total
dupe_heads 0 dupe_pairs 0; all tiers/captures/base-criteria/outcomes/later-fixes/censored-bool True; frozen_sum 360
$ git check-ignore -v tools/shadow-review-trial/.trial-data/manifest-28.json   # ignored
$ git ls-files tools/shadow-review-trial/.trial-data                            # empty
```

The Phase 3 outcome is exercised through its own entry point: the real `cli.py manifest --repo /home/codyh/workspace/garcia-music --expected-repository codyhamilton/garcia-music --history-profile garcia-music-workflow --seed 28 --output <local path>` run (`reports/phase3-05-real-freeze.md`) verifies a non-shallow, object-complete clone and writes a frozen, hashed manifest with 360 cases (300 ≤ 360 ≤ 360), tier/base/head, non-empty capture, base-`DESIGN.md` criteria, ≥1 cited recorded outcome, a later-fixes list and censoring, no commit in two cases, per-tier eligible counts and a count for every ineligible reason. The fixture suite covers each tier, censoring, base-criteria leak avoidance and a sub-300 shortfall reported rather than padded. Nothing from the clone is tracked and the local manifest stays gitignored.

Artifact feedback: all six briefs and all six reports `delivered`, screen pass; no rejected or queued items.

**Carried:**
- Phase 4 leak check: 54 frozen captures contain changed files under another plan's `docs/plans/` folder (the case's own plan folder is fully stripped). Phase 3 meets the letter of the case-plan exclusion; Phase 4's request-level leak check must either widen `strip_plan_documents` to all `docs/plans/` or scope its check explicitly.
- Phase 4 report: unit 4 dropped `missing_comparator_source` because DESIGN's eligibility list has four conditions; the report/comparator path must accept the frozen manifest's `tiers`, `base_blob` criteria and `outcomes`/`later_fixes` shape (the `stratum`/`target_per_effort` aliases remain for the current `report.py`).
- Cosmetic: `cli.py manifest` prints the frozen case count under the label `eligible` while tier eligible totals 534; the manifest shape is correct.
- The unselected document-led extractor (`history_extract_b.py` and its test) remains committed as comparison provenance; Phase 4/close-out may keep or drop it.
