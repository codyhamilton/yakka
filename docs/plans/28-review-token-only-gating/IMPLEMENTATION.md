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
