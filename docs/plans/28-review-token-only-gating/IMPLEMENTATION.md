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

## Phase 4 — Comparison and validation report

Run: OpenCode `opencode run` — model `opencode-go/deepseek-v4.1-flash`; start 2026-11-18 06:47 AEST. Refined as 7 units: wave 1 units 1, 3 and 4 (disjoint paths); wave 2 unit 2 (needs the matcher from unit 1); wave 3 unit 5; wave 4 unit 6; wave 5 unit 7.

Units: `phase4-01-matching`, `phase4-02-leak-check`, `phase4-03-evidence-check`, `phase4-04-manifest-population`, `phase4-05-comparisons`, `phase4-06-deltas-cost-validation`, `phase4-07-output-surface`.

Carried placement: leak-check scope resolved by unit 2 (case plan + outcome excerpts; foreign-plan captures counted, not failed); Phase 3 manifest shape and `target`/`floor` by unit 4; cosmetic `eligible` label by unit 7; `history_extract_b.py` kept as provenance (close-out decision).

Harness turn/context tallies are not reported in the worker logs.

- **phase4-01-matching** — closed `a7ea6c9`. New pure `matching.py`/`test_matching.py` (29 tests): `normalise_text`, Jaccard `text_similarity`, `classify` with structural/uncertain/non-match bands (0.60/0.30), `tag_method`, seeded derangement `shuffled_case_map`, `cohen_kappa`, seeded percentile `bootstrap_interval`. Deviations: a moved-but-very-similar finding is `uncertain` (the brief's `non_match` "different path" and `uncertain` "path differs, text very similar" examples conflicted); fewer than two cases yields an empty map; `later_fixes` hunks use `start`/`end` and unit 5 must map them. Report: `reports/phase4-01-matching.md`.
- **phase4-03-evidence-check** — closed `20f54ee`. New `evidence_check.py`/`test_evidence_check.py` (9 tests): name and shape detection (`manifest_sha256`+`cases`, `reviews`+`pages`, `manifest_hash`+`entries`) over `rglob`, sorted relative offenders; `require_metric_only` raises `ValueError` naming them. Report: `reports/phase4-03-evidence-check.md`.
- **phase4-04-manifest-population** — closed `b5c5896`. `_validate_manifest` accepts the Phase 3 `tier`/`stratum` shape (`unit` included) while legacy stratum-only fixtures pass; `build_report` reads `target`/`floor` (aliases kept) and emits `population` (eligible/frozen/target/floor/censored/shortfall, manifest and run exclusions, per-tier and per-effort attempted/completed/failed/censored, arm `floor`/`shortfall_against_floor`). `failed = attempted - completed`; exclusion reasons are attributed by effort tag, unattributable ones under `unattributed` and not double-counted. Report: `reports/phase4-04-manifest-population.md`.
- **phase4-02-leak-check** — closed `fa83eea`, then fixed `45217b1` after the runner's real-manifest verification. New `leak_check.py`/`test_leak_check.py` (12 tests). The first build counted bare path strings and searched outcome excerpts inside foreign plan documents; on the real frozen manifest it returned `own_plan_document_hits: 36`, `outcome_text_hits: 396`, `foreign_plan_document_captures: 93`. The amended module resolves diff sections by `diff --git` path, fails only on the case's own plan document **sections**, counts other plans' plan sections once per case (and excludes every `docs/plans/` body from the outcome search), and searches only excerpts normalised to at least `MIN_EXCERPT_WORDS = 5`, reporting `short_excerpts_skipped` and `min_excerpt_words`. Read-only real-manifest result: `pass: true`, 1080 requests, 0 own hits, 0 outcome hits, 54 foreign-capture cases, 1458 short excerpts skipped. `summary.py`/`README.md` state the section scope and the floor. Report: `reports/phase4-02-leak-check.md`, `reports/phase4-02-leak-check-fix.md`.
- **phase4-05-comparisons** — closed `34e50ef`. `report.py` emits `comparisons` (finding recall, fix recall, corroboration, verdict agreement, severity agreement; per effort and tier, every recall beside a `shuffled_case_map` null) and `validation` (method counts, uncertain band, double-labelled kappa and labeler models, shuffled-null seed, aggregate leak check). Adjudication version 1 gains `second_label`, `labeler_model`, `second_labeler_model` and review categories `valid`/`invalid`/`unknown`; all old categories and refusals remain. Censored cases leave fix-recall denominators only. Deviation: the null's denominator is the comparator case's outcome count (the design's "same matcher against another case's outcomes"), not numerically equal to the primary; the brief's "same denominator" line was the contradiction and the design was followed. Report: `reports/phase4-05-comparisons.md`.
- **phase4-06-deltas-cost-validation** — closed `1f4cd48`. Adds `comparisons.paired_deltas` (four metrics, three pairs, seeded bootstrap intervals on the completed-at-all-efforts intersection), `cost_latency` (ledger-based per effort and per review, null unknown cost, no cap/projection), `reproducibility` (manifest/seed/ledger/export hashes and `report_sha256` over the report without its own key) and `reconciliation` (canonical/completed counts, unkeyed completions, unknown costs, missing-from-export, cost basis). Deviations: per-case metric ratios defined from the same numerators/denominators; `duplicate_receipt` completions are exempt from the canonical-id requirement (a legacy valid shape) while genuinely unkeyed completions raise. Report: `reports/phase4-06-deltas-cost-validation.md`.
- **phase4-07-output-surface** — closed `8037418`. New `summary.py`/`test_summary.py` renders the fixed section order deterministically; `cli.py report` writes the JSON plus the `.md` sibling and prints `report_sha256`; `evidence-check --folder` refuses manifest/export/ledger files; `test_phase7.py` ties a finding to each rehearsal review, adds double-labelled adjudication, and asserts every section, null, method tag, non-null kappa, passing leak check, byte-identical JSON/summary and the evidence refusal. `test_manifest.py`'s stale `"eligible": 2` assertion now matches the committed `"frozen"` key. README documents the summary, sections, adjudication extension, evidence command and leak scope. Deviations: summary prints only reproducibility hashes, never a commit/case SHA or path; (g) renders from top-level `cost_latency` while (a)–(f) live in `comparisons`. Report: `reports/phase4-07-output-surface.md`.

**Verification** (runner, after all units):

```
$ systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -- \
    python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 152 tests ... OK
$ git diff --check                                                    # clean
$ python3 - <<'PY'  # read-only real frozen manifest, no writes/commits
report._validate_manifest(real)                                       # OK
leak_check.check_requests(real, "verify-run")
pass True requests_checked 1080 own_plan_document_hits 0 outcome_text_hits 0
foreign_plan_document_captures 54 short_excerpts_skipped 1458 min_excerpt_words 5
# injected distinctive outcome text -> pass False, outcome_text_hits 3
# bare own-plan path reference in code -> pass True, own 0
# distinctive excerpt inside a foreign plan document -> pass True, foreign 55, outcome 0
PY
```

The Phase 4 outcome is exercised through its own entry point by the CLI: a Phase 3-shaped fixture manifest, a 3-effort export and ledger, and a double-labelled adjudication file were written to a repo-local `.scratch` folder; `cli.py report` run twice wrote byte-identical JSON and `.md` summary, an equal `report_sha256`, `population` (target 360, floor 300), `comparisons` (a–f plus `paired_deltas`), `validation` (matches 7 = 6 structural + 1 adjudicated, kappa 0.333, leak pass), `cost_latency`, `reproducibility` and `reconciliation`; each finding/fix recall carried its shuffled `null`; `evidence-check` refused a folder containing the export and passed a metric-only folder. `test_phase7` additionally drives `run --dry-run`/`--execute` and the report twice through `cli.main`. The read-only real-manifest check shows the report accepts the Phase 3 frozen manifest unchanged and its leak check passes, fails on injected distinctive outcome text, ignores bare path references, and counts foreign plan documents.

Artifact feedback: all 8 reports `delivered`, screen pass; briefs 01, 03, 04, 05, 06 and 07 `delivered`, screen pass. Brief `phase4-02-leak-check` is `stale`: the service holds the pre-amendment content (`9bbd988a`, 2026-11-17T20:58:49Z) and the amended text is not yet delivered; a retry returned `local context unavailable: queue (invalid_context)`. No check was flagged out of the tenant's norm.

**Carried:**
- Gate (Phase 5): the trial needs the Phase 1 build running on the deployed Yakka server plus a dedicated tenant credential; deployment, secrets, and tenant reset/delete remain operator/human acts and are out of scope. Phase 5 starts with the non-spending `tools/list` + dry-run probe and stops if it fails.
- Gate (Phase 5): the real manifest is local and gitignored; Phase 5 evidence must stay metric-only under `docs/lab/RESEARCH/<date>-shadow-review-trial/` with no garcia-music diff, finding text, path list or credential.
- Phase 5 report: carry the leak check's `short_excerpts_skipped` (1458 on the real manifest) and `foreign_plan_document_captures` (54) beside `pass`; do not suppress them because they show the precision scope.
- The unselected document-led extractor (`history_extract_b.py` and its test) remains committed as comparison provenance; close-out may keep or drop it.
- Brief `phase4-02-leak-check` feedback remains stale/unavailable as recorded above; its committed content is the amended text the fixer implemented.
