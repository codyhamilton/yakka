# Brief: phase1-01 — Call controls and execution identity

Consumer: a Go worker in `packages/yakka` who knows `internal/review`, `internal/serve` and the tenant store.
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka/internal/review/orchestrator.go`, `packages/yakka/internal/review/orchestrator_test.go`, `packages/yakka/internal/review/availability.go`, `packages/yakka/internal/serve/serve.go` (only the review config fields, `ConfigFromEnv` review parsing and `reviewAvailability`), `packages/yakka/internal/serve/reviews_test.go` (only the review env test), `packages/yakka/internal/serve/mcp_review.go`, `packages/yakka/internal/serve/mcp_review_test.go`. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase1-01-call-controls-identity.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: phase1-02 (it owns `internal/store/reviews.go`; do not edit that file).
Budget: read 11 files, about 380 lines changed, 60 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Phase 1 outcome (line 217); Domain "review call and cached response (Decisions 3–6)" lines 89–109, especially the `effort`, `tags`, `store` table rows (94–98), the `YAKKA_REVIEW_TRIAL_ENABLED` paragraph (99), the legacy-adapter paragraph (101) and the identity paragraph (103). Decisions 4, 5, 10, 11, 12, 21 (lines 178–186, 195).
2. `packages/yakka/internal/review/orchestrator.go` — `Request`/`Receipt`/`Trial` types (37–85), `Run` argument validation and effort path (97–146, 196–240), `validateRequest` (315–344), `validEffort` (424), `executionKey` (458–464), `persistRecord` (517–565).
3. `packages/yakka/internal/review/availability.go` — `Availability`, `CheckAvailability` (21–59), `Reservations.begin` (162–189).
4. `packages/yakka/internal/review/provider.go` — `NewReviewer` and request body effort (73–140); confirm effective effort is already sent on every attempt.
5. `packages/yakka/internal/serve/serve.go` — `Config` review fields (42–49), `ConfigFromEnv` review parsing (81–114), `reviewAvailability` (725–727).
6. `packages/yakka/internal/serve/mcp_review.go` — input schema (53–70), allowed keys (72), `validateReviewMCPArgs` (74–134), registration annotations (18–36).
7. `packages/yakka/internal/review/orchestrator_test.go` — `availableConfig` (43–45), `TestRunStatusFixturesAndPreflightResume` trial branch (314–334), `TestHistoricalEffortsRemainSeparateFromLiveHigh` (392–414), `TestSameHistoricalCaseAtDifferentEffortsIsNotDuplicate` (416–445).
8. `packages/yakka/internal/serve/reviews_test.go` — `TestReviewEnvironmentConfigValidation` (110–121).
9. `packages/yakka/internal/serve/mcp_review_test.go` — `TestReviewMCPRegistrationContract` (18–51), `TestReviewMCPAndRESTShareOrchestrationAndReceipt` (79–148).

## Goal

Add general per-call `effort`, `tags` and `store` controls with strict pre-effect validation, drop the deployment trial toggle, keep the deprecated `trial` object as an input-only adapter, and make execution identity tag-sensitive while preserving the exact pre-upgrade key for ordinary untagged requests.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- `effort`: "Omitted means `high`; exact strings `high`, `xhigh`, `max` only. Null, empty, other values and wrong types are argument errors before spend or storage. Valid for any supported review mode; neither trial identity nor a deployment toggle is required. Persist configured effort (`high`), requested effort (including default resolution) and effective effort; send effective effort explicitly on every provider attempt."
- `tags`: "Omitted means `[]`. At most 16 strings, each 1–96 ASCII bytes matching `[A-Za-z0-9][A-Za-z0-9._:/=-]{0,95}`; case-sensitive. Reject wrong types/null, controls, whitespace, invalid charset, overlength or overcount before effects. Count the submitted list before deduplicating; canonicalize accepted values as a sorted unique set. Apply existing metadata disclosure checks; tags are visible metadata, never provider prompt content."
- `store`: "Boolean, omitted means `true`; null/wrong types rejected. `false` returns full validated review data, never writes review records, captured inputs or findings and never enters list/search/quality pathways. Skip **all dedupe/cache reads and writes**, including persistent execution claims. Each explicit call is independent paid work if it reaches the provider; transport ambiguity must never cause an automatic replay."
- Trial gate removal: "`YAKKA_REVIEW_TRIAL_ENABLED` is dropped entirely: remove its config field, env parsing, availability branch, documentation and fixture expectations." (Documentation is phase1-07's job; remove code and fixtures here.) "`YAKKA_REVIEW_EFFORT` remains a high-only server default/validation setting; it never limits a valid per-call override."
- Legacy adapter: "old `trial{manifest_hash,case_id,effort}` remains only as a deprecated input adapter, with its existing syntax/range validation but **no env gate**. It translates to the same effort and general tags, preserves legacy manifest/case/profile read fields and can resolve old execution claims. Top-level effort plus a conflicting legacy effort is an argument error; equal values are accepted. The adapter generates `effort:<level>`, `manifest:<hash>` and `case:<sha256-of-case-id>` tags, unions them with caller tags, and validates both the submitted and merged sets against the same bounds. Original cached legacy records remain immutable and untagged; a compatibility duplicate audit row may carry these mapped tags and the canonical pointer. New clients never send `trial` or a special run/label argument."
- Identity: "For ordinary requests with an empty canonical tag set, preserve the exact pre-upgrade execution-key serialization/hash, including its ordinary profile, so existing untagged paid work remains cached after upgrade. Nonempty tag sets use a distinct versioned key containing the canonical set, so independently tagged experiments remain distinct; they never collide with untagged keys."
- Decision 10: "Drop it completely. Effort defaults high and permits high/xhigh/max per call, recorded configured/requested/effective." Decision 11: no client model parameter; configured/returned reviewer ids remain recorded.

## Changes

- Add to `review.Request`: `Effort string`, `Tags []string`, `Store` plus custom `UnmarshalJSON` (or raw fields) so omitted, null and wrong types are distinguishable. Omitted `effort` → `high`; omitted `tags` → `[]`; omitted `store` → `true`; explicit `null` for any of the three is an argument error. Keep `Trial *Trial` for the deprecated adapter.
- Validate all three before any write, provider call or claim. Reject: wrong Go/JSON types (`tags` not an array of strings, `store` not boolean, `effort` not a string), `effort` empty/other, `tags` length >16 submitted or >16 after the legacy union, any tag outside 1–96 ASCII bytes or the stated regex, controls/whitespace, and tags failing `secrets.Scan`. Canonicalize accepted tags as a sorted unique set.
- Effort resolution: configured = `Availability.Effort` when set, else `high`; requested = submitted effort or `high`; effective = requested. Persist `configured_effort`, `requested_effort`, `effective_effort` (add the requested field; keep the existing two). Pass `effective` to `NewReviewer`.
- Drop `Availability.TrialEnabled`, `Config.ReviewTrialEnabled`, the `YAKKA_REVIEW_TRIAL_ENABLED` parse, and the `trial_disabled`/trial-effort branches. Change `CheckAvailability` to `(c Availability, tenant, repo, effectiveEffort string) error`: keep local/token/model/effort-config/USDCap/priced-model/repo allowlist; require configured `Effort` to be `""` or `high`; require `effectiveEffort` in `high|xhigh|max`. `reviewAvailability` drops the field.
- Legacy adapter: keep existing `trial` syntax/range checks (`range` mode only; 64-hex manifest; non-empty case id; effort in `high|xhigh|max`) but no env gate. When top-level `Effort` is also supplied and differs → argument error; equal is accepted. Generate `effort:<level>`, `manifest:<hash>`, `case:<hex sha256 of case_id>` and union with caller tags. Keep persisting `manifest_hash`/`case_id` and profile `historical_trial`.
- Execution identity: keep the pre-upgrade `executionKey` byte-for-byte for a request whose canonical tag set is empty (same JSON field order/values, including ordinary profile). For nonempty canonical tags, return a distinct versioned key that includes the canonical sorted set; it must never equal an untagged key or another tag set's key. Also expose a helper that recomputes the pre-upgrade key for a legacy-adapter request (used by phase1-03's restricted fallback).
- `persistRecord`: persist `tags` as the canonical sorted array and the three effort fields. Do not pass tags into `Build` or any prompt content.
- `store=false`: branch before `persistedClaim` and before `Reservations.begin` claim persistence. Never call `WriteReviewInput`, `ingest.IngestReviewRuns`, or write a review/finding. Still call the provider and return the full validated review regardless of `detail` (force full). Use a fresh non-cache reservation identifier so spend/in-flight limits apply without a durable dedupe claim; conservative charge on unknown outcomes. Do not implement the `review_usage` fact here (phase1-04).
- MCP schema: add `effort` (`enum high,xhigh,max`), `tags` (array of strings), `store` (boolean) and keep `trial`. Add them to `reviewMCPAllowed`; reject wrong types in `validateReviewMCPArgs`. Change `review_change` annotations to stop promising unconditional idempotency (`idempotentHint` false or removed) because `store=false` spends independently.
- Keep `dry_run` returning before effects; do not move its readiness validation into this unit (phase1-04 owns it).

### Keep untouched

`Capture`, criteria, packet, prompt policy, disclosure scans, retries, pricing, model selection and tenant selection. Do not edit `internal/store/reviews.go` (phase1-02), the REST/MCP read routes (phase1-05/06), stable docs (phase1-07), the plugin/shim, or `docs/plans/23-llm-review-shadow/DESIGN.md`.

## Done evidence

Write failing checks first, then report before/after output.

- `cd packages/yakka && prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review ./internal/serve -run 'Review|Run|Effort|Trial|MCP'` → passes. (If `prlimit` is unavailable use `GOMEMLIMIT=8GiB GOMAXPROCS=3` with `-p=3`.)
- New table test: `effort` null/empty/`"min"`/number, `tags` null/string/`[]any` with a non-string/17 entries/97-byte value/`"a b"`/control char, and `store` null/string each refuse with no provider call, no `review_runs` row and no `review-inputs` object.
- New test: `high`, `xhigh`, `max` succeed in both `uncommitted` and `range` modes with no `trial` and no env field; the fake provider receives the chosen effort; the stored record has `configured_effort="high"`, `requested_effort=<chosen>`, `effective_effort=<chosen>`.
- New test: a pure legacy-adapter call maps exactly the three deterministic tags, unions caller tags, rejects a conflicting top-level effort and a merged set over 16, and works with no trial env.
- New test: the ordinary untagged execution key equals a recorded pre-upgrade fixture hash; two different nonempty tag sets produce different keys; neither equals the untagged key.
- New test: `store=false` with an already-stored identical ordinary request still calls the provider, returns `result` with `detail` omitted, and leaves review-row and `review-inputs` counts unchanged; no durable claim is present after the call.
- `rg -n "TrialEnabled|YAKKA_REVIEW_TRIAL_ENABLED|trial_disabled" packages/yakka/internal` → no matches.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
