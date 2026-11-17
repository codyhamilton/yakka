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

