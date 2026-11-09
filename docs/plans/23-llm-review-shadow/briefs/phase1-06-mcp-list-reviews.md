# Brief: phase1-06 — MCP list_reviews and transport parity

Consumer: a Go worker in `packages/yakka` who knows the server-defined MCP registry (`RegisterMCPTool`, conformance/golden tests).
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `packages/yakka/internal/serve/mcp_list_reviews.go` (new), `packages/yakka/internal/serve/mcp_list_reviews_test.go` (new), `packages/yakka/internal/serve/testdata/mcp-golden/list-reviews.json` (new), `packages/yakka/cmd/yakka/main.go` (only the `list_reviews` registration call). Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase1-06-mcp-list-reviews.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase1-05 (REST cursor/filter parsing and response object). Read its report and extracted helpers before editing.
Runs alongside: phase1-04 (ephemeral usage; it owns `internal/review`, `internal/store` review usage and `internal/ingest`, not these files).
Budget: read 9 files, about 220 lines changed, 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — the reads paragraph (113), filters/response (115), cursor binding (117), completion (119); decisions 1 and 6 (lines 177, 180).
2. `docs/plans/23-llm-review-shadow/briefs/phase1-05-rest-paged-reads.md` and its report — the exact query/cursor/response helpers and where they live.
3. `packages/yakka/internal/serve/mcp_stateless.go` — `RegisterStatelessMCPTools`, `list_checks` and `search_artifacts` registration (16–60), validation/handler style.
4. `packages/yakka/internal/serve/mcp.go` — `MCPTool` fields (58–73), `RegisterMCPTool` scope/default/annotation rules (143–314), `tools/list` and `tools/call` (523–605).
5. `packages/yakka/cmd/yakka/main.go` lines 108–120 — startup registration.
6. `packages/yakka/internal/serve/mcp_stateless_test.go` — golden comparison (48–122).
7. `packages/yakka/internal/serve/mcp_review_test.go` — `TestReviewMCPAndRESTShareOrchestrationAndReceipt` (79–148).
8. `packages/yakka/internal/serve/testdata/mcp-golden/stateless-tools.json` — the golden shape.
9. `packages/yakka/internal/serve/serve.go` — the GET handler and cursor helpers from phase1-05.

## Goal

Add a server-defined, read-scope `list_reviews` MCP tool that returns the same data object as `GET /v1/reviews` over the same complete cursor walk, with no local readers or actions and no client/shim change.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "Owner: REST GET reviews, new server-defined MCP `list_reviews` (read scope, read-only, no local readers/actions), store review queries. The shim learns the tool through the registry; no tool-name/schema logic is added to the client."
- "Both entries accept the existing repo_id/plan/phase/kind/status/effort/profile/manifest_hash/since filters, `detail=full`, `limit` and `cursor`; add exact tag filtering: repeated REST `tag=value`, MCP `tags:[value,...]`, with the same 16 × 96 bounds. Multiple tags mean **ALL**, conjunctive with all other fields. An empty filter matches all tenant reviews, including old untagged records; a tag filter never matches an untagged record. Invalid filters return an explicit argument error. Preserve the existing REST `reviews` array and add `next_cursor` (opaque string or null) and `complete` (boolean); MCP returns the same data object."
- "Malformed, mismatched or unsupported cursors fail explicitly (REST 400 / MCP invalid arguments)."

## Changes

- Add `(s *Server) RegisterListReviewsMCPTool() error` with `Name: "list_reviews"`, a description that says it is a read-only tenant-scoped complete paged review listing, `Annotations: {"readOnlyHint": true}`, no `Context`, no `LocalActions`, read scope (omit `Scope` or set `TokenScopeRead`), and a timeout within the server default.
- Input schema: optional `repo_id`, `plan`, `phase` (integer ≥1), `kind` (enum phase/pr/adhoc), `status`, `effort` (enum high/xhigh/max), `profile`, `manifest_hash`, `since` (number), `tags` (array of strings, `maxItems:16`), `detail` (enum `full`), `limit` (integer 1–500), `cursor` (string). `additionalProperties:false`. Validate types, tag bounds/charset and cursor mismatches; return a non-empty validation message before the handler (MCP invalid arguments).
- Handler: derive the tenant from the authenticated `tenant` argument (never from `_local`), call the same phase1-05 query/cursor functions, and return the same `{reviews, next_cursor, complete}` data object. Do not duplicate cursor logic; share it. Do not add local readers or actions.
- Register it at startup in `cmd/yakka/main.go` next to `RegisterStatelessMCPTools`/`RegisterFeedbackMCPTool` (read-only, unconditional). Do not touch the plugin or shim: the client discovers it through `tools/list`.
- Add a golden `testdata/mcp-golden/list-reviews.json` captured from the server's `tools/list` declaration (name, description, inputSchema, annotations, `_meta."yakka/tool"` if present) and compare it in the new test.
- If a full-inventory conformance test enumerates every registered tool, update that test/golden; do not change unrelated tools.

### Keep untouched

REST `GET`/`POST /v1/reviews` behavior, the store page API, review orchestration, the plugin/shim and its discovery code, other MCP tools and their goldens, stable docs, and `phase1-04` files.

## Done evidence

- `cd packages/yakka && prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve ./cmd/yakka -run 'MCP|Review|ListReviews'` → passes. (Fall back to `GOMEMLIMIT=8GiB GOMAXPROCS=3`.)
- New test: `list_reviews` appears in `tools/list` with read scope, `readOnlyHint:true`, no context/local actions; a `read` token can call it; the declaration matches the golden.
- New test: for the same paged walk (identical `ts`, >1,000 rows, backdated append, tag ALL, legacy filters, both detail values, page-size change), MCP `list_reviews` and REST `GET /v1/reviews` return the same decoded `reviews` rows, `next_cursor` selection and `complete` value.
- New test: invalid `tags` (over 16, bad charset/overlength), invalid `cursor`, and a cursor from another tenant each produce an MCP invalid-argument error, not rows.
- `rg -n "list_reviews" packages/yakka/internal/serve` shows the server registration/handler and tests only; no plugin/shim file is modified.
- `git diff --check` → no whitespace errors.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
