# Report: phase1-06 — MCP list_reviews and transport parity

Status: `done`

Branch: `feat/23b-review-controls-trial`

## What changed

- `packages/yakka/internal/serve/mcp_list_reviews.go` (new): `RegisterListReviewsMCPTool`
  registers a server-defined `list_reviews` with read scope (default), 20 s default timeout,
  `readOnlyHint:true`, no `Context`, no `LocalActions`. Its closed schema admits the existing
  review filters, `tags` (`maxItems:16`), `detail=full`, `limit` 1–500 and `cursor` with
  `additionalProperties:false`. Validation rejects unknown fields, wrong types, bad
  kind/effort/detail enums, `phase<1`, non-integer/fractional numbers, out-of-range `limit`,
  bad tag count/charset/length and cursors that are malformed, unsupported, route-, filter-
  or tenant-mismatched. The handler derives the tenant only from the authenticated argument,
  ignores `_local`, and calls the same phase1-05 `BeginReviewWalk`, `ReviewPage`,
  `encodeReviewCursor` and `decodeReviewCursor` helpers as REST; it returns the same
  `{reviews, next_cursor, complete}` object and strips `payload` unless `detail=full`.
- Completed the partial edit by canonicalizing MCP's absent tag list to a non-nil empty
  slice. Without that, both transports selected the same rows but the bound cursor payload
  differed (`"tags":null` vs `"tags":[]`) and so did the opaque `next_cursor`.
- `packages/yakka/cmd/yakka/main.go`: registers the tool once, unconditionally, after
  `RegisterFeedbackMCPTool`.
- `packages/yakka/internal/serve/testdata/mcp-golden/list-reviews.json` (new): captured
  `tools/list` `tools` array including `_meta."yakka/tool"` (`scope:read`, empty context,
  timeout 20, declaration rev `71aa1b57b5bba561`).
- `packages/yakka/internal/serve/mcp_list_reviews_test.go` (new): a remote read token lists
  and calls the tool, matching the golden declaration; one 1,101-row identical-`ts` walk
  applies repo/plan/phase/kind/status/effort/profile/manifest/since, tag ALL and changing
  page sizes, runs both default and `detail=full` modes, and appends backdated rows after
  both walks start; every MCP page is compared decoded field-for-field with the REST page
  (rows, `next_cursor` bytes, `complete`, payload presence). Malformed, over-bound and
  foreign-tenant cursors plus bad tags return a tool error with no rows.

## Check output

Before completion the partial handler compiled and the existing focused suite passed, but no
`list_reviews` test/golden existed and no test compared its cursor bytes with REST (the
`null`/`[]` divergence above was unexercised).

After (TMPDIR `/home/codyh/workspace/.briefs/yakka/23b-test-tmp`):

```
$ prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'ListReviews' -v
--- PASS: TestMCPListReviewsDeclarationAndReadScope
--- PASS: TestMCPListReviewsMatchesRESTAcrossCompleteWalk
--- PASS: TestMCPListReviewsRejectsInvalidAndForeignCursors
    --- PASS: .../too_many_tags  --- PASS: .../bad_charset
    --- PASS: .../overlength    --- PASS: .../malformed_cursor
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.740s

$ prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve ./cmd/yakka -run 'MCP|Review|ListReviews'
ok  .../internal/serve  4.292s
ok  .../cmd/yakka  0.005s [no tests to run]

$ prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve
ok  .../internal/serve  12.011s

$ prlimit --as=8589934592 -- go test -count=1 -p=3 ./cmd/yakka
ok  .../cmd/yakka  60.293s

$ rg -n "list_reviews" packages/yakka/internal/serve
only mcp_list_reviews.go, mcp_list_reviews_test.go and the golden

$ git diff --check
(no output)
```

The walk test seeds 1,101 tenant-A rows at `ts=100` plus one tenant-B row, varies limit
(37/150/333/500), and appends `ts=50` and `ts=1` rows only after both detail walks have
started. Both transports return every original row exactly once in descending order, exclude
the late and tenant-B rows, keep every cursor byte-identical, and end
`complete=true,next_cursor=null`.

## Deviations

- None from the brief. No plugin, shim, REST, store, review, stable-doc or phase1-04 file was
  edited. `IMPLEMENTATION.md` already carried an uncommitted phase1-03 artifact-feedback line
  when this unit started; because that file is the shared unit log, this commit carries that
  pending line alongside this unit's new outcome. No production code outside the owned paths
  changed.

## Contradictions

None between the brief and the cited DESIGN contract.

## Problems / unfinished

- None in this unit. The plugin still learns `list_reviews` only through `tools/list`, as the
  design requires; no client-side tool-name/schema logic was added.
