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
  `tools/list` declaration including `_meta."yakka/tool"` (`scope:read`, empty context,
  timeout 20, declaration rev `71aa1b57b5bba561`).
- `packages/yakka/internal/serve/mcp_list_reviews_test.go` (new): registration/golden and
  read-scope call; 1,001-row identical-`ts` walk with backdated mid-walk appends and changing
  page sizes; conjunctive tag ALL, legacy filters, both detail values; malformed/foreign
  cursors and bad tags/arguments. Every MCP page is compared decoded field-for-field with
  the REST page (rows, `next_cursor` bytes, `complete`).

## Check output

Before completion the partial handler compiled and the existing focused suite passed, but no
`list_reviews` test/golden existed and no test compared its cursor bytes with REST (the
`null`/`[]` divergence above was unexercised).

After (TMPDIR `/home/codyh/workspace/.briefs/yakka/23b-test-tmp`):

```
$ prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'ListReviews' -v
--- PASS: TestListReviewsMCPRegistrationAndGolden
--- PASS: TestListReviewsMCPMatchesRESTWalk
--- PASS: TestListReviewsMCPMatchesRESTFiltersAndDetail
--- PASS: TestListReviewsMCPRejectsInvalidArguments
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.278s

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

The walk test seeds 1,001 tenant-A rows at `ts=100` plus 20 tenant-B rows, varies limit
(37/150/500/10/91/333), and appends `ts=50` and `ts=1` rows after the first page. Both
transports return every original row exactly once in descending order, exclude the late and
tenant-B rows, and end `complete=true,next_cursor=null`.

## Deviations

- None from the brief. No plugin, shim, REST, store, review, stable-doc or phase1-04 file was
  edited. The pre-existing phase1-03 line in `IMPLEMENTATION.md` was already in the working
  tree; this commit only appends this unit's outcome.

## Contradictions

None between the brief and the cited DESIGN contract.

## Problems / unfinished

- None in this unit. The plugin still learns `list_reviews` only through `tools/list`, as the
  design requires; no client-side tool-name/schema logic was added.
