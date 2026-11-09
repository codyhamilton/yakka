# Report: phase1-04 — Ephemeral usage and dry-run readiness

Status: `done`

Branch: `feat/23b-review-controls-trial`

## What changed

- `internal/store/review_usage.go` (new): a dedicated `review_usage` table keyed by a random `usage_id`, outside `facts`, `review_runs`, `review-inputs` and every analytics rollup. It stores the canonical content-free fact plus `ts`; no content-derived row hash is persisted. Added `ReviewUsageRecords` (test-facing read) and `ReviewSpend` (the explicitly named tenant review-spend measure). A separate table was chosen because `Summary`, `Facets`, hook/conversation rollups and work-cost measures read only `facts`; a separate table cannot feed them.
- `internal/ingest/ingest.go`: new `review_usage` type. Public `Ingest` rejects it as server-authored; the authenticated path is `IngestReviewUsage`, parallel to `IngestReviewRuns`. Validation requires usage id, models/efforts/status, `store=false`, a numeric `ts` and a string tag array, and rejects repo/plan/phase/pr/session/capture/input/content hash/conversation/prompt/criteria/findings/result/payload/error/reason/manifest/case/key fields.
- `internal/review/orchestrator.go`: `dry_run` now checks `CheckAvailability` (config, allowlist, effort) and a priced model before returning the existing `status=dry_run` estimate. It still returns before any provider call, review row, review input, usage fact, reservation or claim, and still wins over `store`/`detail`. `store=false` calls that reach the provider now write one content-free usage fact for success, provider error, timeout, invalid output or credential rejection, with configured/returned model, three effort values, tokens, `cost_usd`, `pricing_table_id`, `ts`, canonical tags, `store=false`, status/attempts and `reservation_outcome`/`reservation_usd` (`settled` on success, `conservative` otherwise). Fresh reservation id and no durable claim are unchanged and verified.
- Tests: `internal/store/review_usage_test.go`; ingest acceptance/validation/isolation; orchestrator success, provider-error, timeout, dry-run for both store values, bad allowlist/effort/tag/disclosure, and Summary/Facets/Conversations equality with a seeded hook fact.

## Check output

Before: the new tests could not compile against the pre-change API (`ReviewUsageRecords`, `IngestReviewUsage` absent); existing focused tests passed without covering ephemeral usage or dry-run readiness.

After (TMPDIR `/home/codyh/workspace/.briefs/yakka/23b-phase1-04-tmp`, outside `/tmp` and the repo):

```
$ TMPDIR=... prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review ./internal/store ./internal/ingest -run 'Review|Usage|DryRun|StoreFalse'
ok  .../internal/review  0.783s
ok  .../internal/store   0.935s
ok  .../internal/ingest  0.206s

$ TMPDIR=... prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review ./internal/store ./internal/ingest
ok  .../internal/review  5.649s
ok  .../internal/store   8.316s
ok  .../internal/ingest  0.461s

$ TMPDIR=... prlimit --as=8589934592 -- go test -count=1 -p=3 -run '^$' ./...
(all 16 packages compile; no tests run)

$ git diff --check
(no output)
```

## Deviations

- Budget: read more than 9 files and changed ~640 lines (about 235 production lines, the rest the six required tests) against the ~260-line guidance; tool turns stayed under 50. The extra change is test coverage, not new scope.
- Usage facts are written only when at least one provider attempt ran, matching the brief's success/provider-error/timeout enumeration. Pre-call availability and budget refusals write no usage fact because no spend or attempt occurred.
- Dry-run readiness is checked after criteria/Build so disclosure refusal can occur; a bad config/allowlist now returns an `unavailable` receipt instead of a `dry_run` receipt. Existing `TestRunTreatsReceiptDetailAsSummary` was updated from an empty `RunConfig` to an available config, because its old expectation relied on not validating readiness.
- `persistReviewUsage` failure fails the call after the provider reply, matching existing review-record persistence failure behavior.

## Contradictions

None found between the brief and the design contracts it cites. The "exactly" field list was implemented as the required key set plus the identifying `type`; no forbidden field is present.

## Problems / unfinished

- None blocking. Later phases may consume `ReviewSpend`; no HTTP or MCP surface was added, as required.

Artifact feedback: delivered, screen pass (`jev-1.13.0`).
