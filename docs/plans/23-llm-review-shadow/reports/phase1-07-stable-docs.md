# Report: phase1-07 — Stable documentation promotion

Status: `done`

Branch: `feat/23b-review-controls-trial`

## What changed

Promoted only implemented Phase 1 review controls to the seven owned docs. Phase 2 reset and all
deployed/paid trial claims stay pending.

- `docs/design/01-event-model-and-ingest.md`: review fact now carries tags and
  configured/requested/effective effort; added the content-free `review_usage` fact. States both
  stay outside conversation/hook/facet counts and work/quality aggregates, and `review_usage` feeds
  only the tenant review-spend measure.
- `docs/design/03-remote-service.md`: deleted the `YAKKA_REVIEW_TRIAL_ENABLED` row; rewrote
  `YAKKA_REVIEW_EFFORT` as a high-only default/validation setting that never caps a per-call
  override; added `POST /v1/reviews` and `GET /v1/reviews` API rows (filters, repeated `tag`,
  `detail`, `limit` 100/1–500, `cursor`, `reviews`/`next_cursor`/`complete`). Storage now says the
  controls and paged reads are implemented while the bounded reset is pending; lines 188–193 are
  untouched.
- `docs/design/04-advisory-surface.md`: replaced the pending note with implemented
  effort/tags/store, full cached duplicates, status taxonomy and read-only `list_reviews`; added the
  tool row, API rows, paging description and duplicate test wording.
- `docs/design/08-server-mcp-contract.md`: `list_reviews` is `read` (no local readers/actions),
  `review_change` stays `read_write`; replaced reference-only duplicate text with the full
  fresh-shape response, `in_progress`/`outcome_unknown`/`cache_unavailable`, and the
  non-idempotent `store=false` statement; added controls and the `list_reviews` contract.
- `docs/design/system-architecture.md`, `docs/OVERVIEW.md`, `docs/ARCHITECTURE.md`: principle,
  seam and summaries now describe the controls, cached duplicates and `list_reviews`.

### Proof per promoted statement

| Statement | Code / test |
|---|---|
| `effort`/`tags`/`store` validated before effects; trial gate removed | `internal/review/orchestrator.go` (`resolveCallControls`, `UnmarshalJSON`), `internal/review/availability.go`; `orchestrator_test.go:TestRunCallControlsRefuseBeforeEffects`, `TestRunEffortsInBothModesWithoutTrialEnv`; `mcp_review.go` |
| `YAKKA_REVIEW_EFFORT` high-only default, never caps override | `internal/review/availability.go:32-51`, `internal/serve/serve.go:reviewAvailability`; `orchestrator_test.go:TestHistoricalEffortsRemainSeparateFromLiveHigh` |
| Full cached duplicates, `cached`/`original_review_id`/`original_status`, state taxonomy | `internal/review/orchestrator.go:cachedReceipt`; `orchestrator_test.go:TestDuplicateClaimsReportActiveAndDurableWithoutReplay`, `TestCacheUnavailableForCorruptOriginalDoesNotReplay`; `mcp_review_test.go` parity |
| Direct execution-key lookup | `internal/store/reviews.go:ReviewByExecutionKey`; `reviews_test.go:TestReviewByExecutionKeyFindsOldRowAndCreatesIndex`, `orchestrator_test.go:TestCompletedOriginalBeyond500FoundAfterTenantRestart` |
| Content-free `review_usage`; isolated spend | `internal/store/review_usage.go`, `internal/ingest/ingest.go`; `review_usage_test.go`, `ingest_test.go:TestReviewUsageAcceptanceValidationAndIsolation`, `orchestrator_test.go:TestStoreFalseWritesContentFreeUsageFact` |
| Complete cursor pages, ALL tags, fixed high-water, `next_cursor`/`complete` | `internal/store/reviews.go:BeginReviewWalk/ReviewPage`, `internal/serve/serve.go:reviewsGetRoute`, `review_cursor.go`; `review_cursor_test.go`, `reviews_test.go:TestReviewPageWalkIsFixedAtHighWaterAndComplete` |
| `list_reviews` read tool, no local readers/actions | `internal/serve/mcp_list_reviews.go`, `cmd/yakka/main.go:119`; `mcp_list_reviews_test.go` (declaration, REST parity, cursor rejection) |

No claim was made for the admin tenant reset/cascade, synthetic tenancy, full-history trial fetching,
the spend gate or any deployed/paid result.

## Check output

Before (HEAD):

```
$ git grep -n "YAKKA_REVIEW_TRIAL_ENABLED" HEAD -- docs/design docs/OVERVIEW.md docs/ARCHITECTURE.md
HEAD:docs/design/03-remote-service.md:75:| `YAKKA_REVIEW_TRIAL_ENABLED` | ... |
$ git grep -nE "pending implementation|not implemented" HEAD -- docs/design/03-remote-service.md docs/design/04-advisory-surface.md docs/design/08-server-mcp-contract.md
03-remote-service.md:198, 04-advisory-surface.md:52
```

After:

```
$ git diff --check
(no output)
$ rg -n "YAKKA_REVIEW_TRIAL_ENABLED" docs/design docs/OVERVIEW.md docs/ARCHITECTURE.md
no matches
$ rg -n "pending implementation|not implemented" docs/design/04-advisory-surface.md docs/design/08-server-mcp-contract.md docs/design/03-remote-service.md
no matches
$ rg -n "DeleteTenant|delete.*tenant|tenant.*reset" docs/design/03-remote-service.md
193:DeleteTenant API or registry method.   # unchanged statement
$ git diff --stat -- docs/design docs/OVERVIEW.md docs/ARCHITECTURE.md
 ARCHITECTURE.md | 11 ++++--
 OVERVIEW.md | 17 ++++++-----
 design/01-event-model-and-ingest.md | 11 ++++---
 design/03-remote-service.md | 11 ++++----
 design/04-advisory-surface.md | 46 +++++++++++++++++-------
 design/08-server-mcp-contract.md | 40 +++++++++++++++-----
 design/system-architecture.md | 15 ++++++---
 7 files changed, 111 insertions(+), 40 deletions(-)
```

The commit also carries this report and the phase1-04 outcome already pending in
`IMPLEMENTATION.md`; no other path changed. No tests were needed for a docs-only change. No live
server/provider, secret, deploy, or external temp directory was used.

## Deviations

- None in scope or owned paths. `IMPLEMENTATION.md` already held an uncommitted phase1-04 outcome
  line at start; it is included with this unit's append because it is the shared unit log.

## Problems / unfinished

- None. Phase 2 reset, Phase 3 trial tooling and operator/deployment evidence remain explicitly
  pending by design.

## Contradictions

None found between this brief, `DESIGN.md` and the code.
