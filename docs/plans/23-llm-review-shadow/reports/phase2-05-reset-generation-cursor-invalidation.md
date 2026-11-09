# Report: phase2-05 — Reset-generation cursor invalidation for REST and MCP review walks

Status: `done`

Branch: `feat/23b-review-controls-trial`

## What changed

- `internal/serve/review_cursor.go`
  - Added an additive `Generation string` payload field (`json:"generation,omitempty"`), binding the tenant lifecycle generation observed when the first page fixed its high-water mark. Version, tenant, route, filters/detail and high-water fields are unchanged.
  - Added `Server.tenantReviewGeneration(tenant)`, which reads `Registry.TenantGeneration` (registry metadata only, no lazy store open). Missing record (keyed/local or unsupported legacy tenant) yields `""`.
  - `validate` now takes the current generation and rejects a mismatch with an explicit `cursor generation mismatch`. A pre-change cursor decodes to `""`, so it matches only an empty-generation tenant and fails an ownership-marked tenant.
- `internal/serve/serve.go` (`reviewsGetRoute`): reads the current generation after `beginTenantUse` (tenant read gate held, so a reset cannot interleave) and before the walk/page read; validates later pages against it and stamps it into every issued cursor.
- `internal/serve/mcp_list_reviews.go`: same generation read inside the MCP call (which already holds the read gate), validates `q.cursor`, and stamps the generation into issued cursors. A mismatch surfaces as an invalid-arguments tool error via the existing `isError` path.
- Tests: `review_cursor_test.go` and `mcp_list_reviews_test.go` add the reset-invalidation (REST 400 / MCP tool error, fresh walk empty), legacy-empty-generation completion, unaffected second tenant, page-size-change + route/generation mismatch cases.

## Check output

Before (checks written first, against unchanged code):

```
$ TMPDIR=... prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'CursorInvalidAfterReset|CursorGenerationBinding'
--- FAIL: TestMCPListReviewsCursorInvalidAfterReset
    stale MCP cursor after reset accepted: {"complete":true,"next_cursor":null,"reviews":[]}
--- FAIL: TestReviewRESTCursorInvalidAfterReset
    stale cursor after reset = 200 {"complete":true,"next_cursor":null,"reviews":[]}, want 400
FAIL
```

The pre-reset cursor silently read the new empty store incarnation — the bug this unit closes.

After:

```
$ TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'ReviewCursor|ListReviews|Review'
ok  .../internal/serve  1.463s

$ TMPDIR=... prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve
ok  .../internal/serve  14.119s

$ go vet ./internal/serve && go build ./...
(no output)
$ gofmt -w ... && git diff --check
(no output)
```

## Deviations

- Line budget: ~180 changed lines (49 prod + 131 test) against the ~160 guidance. Production code is ~25 lines; the required reset/legacy/other-tenant/page-size/mismatch matrix accounts for the tests.
- The `validate` signature gained a generation argument; both transports and the existing test helpers are the only callers. No cursor version bump, so page-size/filter/tenant tests remain meaningful.

## Problems / unfinished

- None for this unit. HTTP route status mapping, `/me` rendering and profile selection clearing belong to phase2-04/06; this unit only binds the generation into cursor state.

## Contradictions

- None found between the brief and the cited contracts. The brief's "empty generation legacy tenant keeps working" is satisfied by keyed/local tenants having no registry lifecycle record; such tenants cannot be reset.
