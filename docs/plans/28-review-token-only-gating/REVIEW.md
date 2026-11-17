# Review — Plan 28 (review token-only gating)

## Verdict

`PASS_WITH_FOLLOWUPS`

## Reviewed SHA

`3edb25db8b05918f828b0f003c4e0e6cd2c61ff2`

## Phase outcomes

| Phase | Assessment | Evidence |
|-------|------------|----------|
| 1 — Token-only review | **Met** | Go tests in `review`, `serve`, `ingest`, `store`; phase reports; optional `YAKKA_REVIEW_MODEL` amendment registered in `mcp_review_test` / `reviews_test` |
| 2 — Trial without spend gates | **Met** | `approval.py` removed; runner/report tests; phase reports |
| 3 — garcia-music manifest | **Met** | Real freeze report (360 cases); fixture suite; phase3 reports |
| 4 — Comparison report | **Met** | Report/matching/leak/evidence tests; phase4 reports |
| 5 — Real-server trial | **Partial (expected)** | Probe blocked on pre-merge deploy; paid trial waits on dedicated tenant id per DESIGN |

## Findings

### Resolved in review

| Sev | Finding | Resolution |
|-----|---------|------------|
| high | Trial HTTP client 30s timeout vs 120s review wall pinned failed cases | `3edb25db` — default timeout 150s |
| medium | Failed provider response with no usage marked `UsageReported` / known $0 | `42a95953` |
| medium | Unpriced model override recorded as known $0 | `3a171ab0`, `5b350f05` |
| low | Frozen manifest world-readable; remote URL could retain http userinfo | `64c59648` |

### Follow-up (non-blocking)

| Sev | Finding | Notes |
|-----|---------|-------|
| medium | Client disconnect (`context.Canceled`) persists `api_error` with attempts; `ReviewByExecutionKey` treats it as canonical and blocks retry as duplicate | `orchestrator.go` `errorStatus`; may have billed — needs design for non-terminal failures |
| medium | Committed Phase 5 report JSON may carry garcia-music commit SHAs as `case_id` | Metric-only contract; redact or anonymise before commit when Phase 5 runs |
| low | Provider success envelope without `usage` still records known $0 on priced default model | Edge case |
| low | `report.py` duplicate cost aggregation paths; `tenantBusyLocked` dead branch | KISS cleanups |

### Security (accepted)

| Sev | Finding | Notes |
|-----|---------|-------|
| medium | No Yakka spend cap; any `read_write` tenant can spend the shared Claude key | Explicit owner decision in DESIGN |

## Intent and ledger

Implementation matches the 18 Nov amendment: `review_change` registers on token + remote + 150s MCP ceiling without requiring `YAKKA_REVIEW_MODEL`; default model `review.LiveModel`. Assumptions 1–18 remain consistent with evidence; Assumption 11 (private repo data local-only) upheld with manifest `0600` fix.

## Plan sufficiency

The design was sufficient to derive phase outcomes, QA, and review criteria. Phase 5 deploy gate is explicitly out of band.

## Residual risks

- Post-merge deploy required before live `tools/list` probe succeeds.
- Paid trial spend on Anthropic account with only per-tenant concurrency limit.
- Foreign-plan document captures in trial packets (documented; leak check scoped per Phase 4 brief).