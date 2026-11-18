# MCP activity reads and faster search

Yakka-Plan: docs/plans/26-mcp-activity-reads/

## Intent

User request, verbatim:

> Lets start a design to improve the tools. We would want to be able to query more interesting data - e.g. searching executed plans for the current repo, listing recent plans and execution history (not necessarily the whole artifacts, more like understanding what has recently been done and being able to go deeper if we want). Then also being able to query stats etc. Also will want to look into the long query time.

## Problem

Agents using the yakka MCP today get artifact advice (`artifact_feedback`, `list_checks`), tenant-wide full-text search (`search_artifacts`), and paged reviews (`list_reviews`). That set answers “how was this file judged?” and “what resembles this text?” but not “what plans recently ran in this repo?” or “what happened on this plan?” without pulling artifact bodies.

Ground against the current server and shim shows four gaps:

1. **No repo-scoped activity listing on MCP.** `facts.plan` and `facts.kind` are filled at insert (`planOf`, `keys.Kind`). `ExecutionsPage` pages brief execution shapes, `ReviewPage` pages stored `review_run` rows, and `PlanDesignPaths` lists distinct `docs/plans/*/DESIGN.md` paths. REST exposes executions, artifacts, and reviews. MCP does not. `PlanDesignPaths` is not an activity API: it is alphabetical, has no timestamps, and errors when the path cap is exceeded. Agents must guess `repo_id` or leave the plugin for REST.

2. **Search is the wrong default for “plans in this repo,” and it is slow for a structural reason.** `matchExpr` (`packages/yakka/internal/serve/reads.go`) quotes up to 32 word runs — hyphens split, so a plan slug becomes many tokens — and joins them with OR. `Search` (`packages/yakka/internal/store/reads.go`) runs FTS5 `MATCH` over `search`, a virtual table of `(content_hash UNINDEXED, body)` with no repo or kind column. The `latest` CTE windows every screened `artifact_version` in the tenant. The SQL has no `LIMIT`. `kind` is applied in Go while scanning ranked rows, so a kind filter does not shrink the match set. Common tokens (`yakka`, `design`, slug fragments) rank a large posting list and hit the tool budget. The handler already cancels at `timeout_s` (default 20, `mcpDefaultTimeout`) and returns the tool error `timeout after <n> s`. The shim waits `timeout_s + 5` seconds (`_timeout` in `plugins/yakka/client/yakka.py`), so a query that honors cancellation should surface that tool error before the shim’s transport timeout. Pushing `repo_id` into the `latest` CTE alone does not stop `MATCH` from reading other repos’ bodies, because the FTS table cannot express a repo predicate.

3. **`list_reviews` is a review lens, not a plan rollup.** It returns the same `{reviews, next_cursor, complete}` object as `GET /v1/reviews` (design 08), with no local readers. It does not list plans, brief shapes, or artifact paths. It stays the drill-down for review payloads. This plan does not change it.

4. **Aggregate stats exist on REST, not on MCP.** Facets, summary, executions, and `GET /v1/analytics/query` answer counts. Design 7 states that analytics is HTTP for a person, not an MCP tool. Agents have no bounded read for “how much happened in this repo.” Usage measures (`cost_usd`, `model_calls`) accept `repo_id` and do not accept `plan` (`measureMatrix` in `packages/yakka/internal/store/query.go`). There is no `reviews` measure. A free measure list on MCP would invent a second query language and would lie about plan-grain cost.

What today’s data can prove, and what it cannot: artifact versions of kind `design`, `brief`, and `report`; brief shapes `complete` / `unreported` / `started` from `ExecutionsPage` (a same-conversation commit plus a matching report path — not a git trailer); and stored advisory reviews (`review_run`, readable via `ReviewPage` / `list_reviews`). It cannot prove phase closure. Commit facts carry no message, so `Yakka-Phase` is not a fact. `keys.Kind` matches only `DESIGN.md`, briefs, and reports, so `IMPLEMENTATION.md` and `REVIEW.md` are not stored. Plan 20’s note that reviews are not stored is stale; its note on trailers and those two filenames is not. This design does not close the ingest gaps.

## Solution Shape

Extend the server-owned advisory surface with three new **read** MCP tools: a paged plan-activity list, a plan drill-down, and one fixed repo-window summary. Default `repo_id` from the optional `git` reader when the argument is omitted. Harden `search_artifacts` and `GET /v1/search` so repo and kind constrain the search in SQL, and so `match=all` ANDs tokens, without a new search engine. REST analytics routes stay the source of truth for the UI. MCP calls the same store methods or a shared helper, not a parallel dialect.

The shim gains no tool definitions, descriptions, or validation. It already evaluates a declared `git` reader. New tools are scope `read`, so anonymous `initialize` / `tools/list` gain them with the read catalog (plan 25) and anonymous `tools/call` stays 401.

### Domain: Store activity reads

- Owns: SQL that rolls up one tenant’s `facts` and `review_runs` by `(repo_id, plan)` without returning bodies.
- Contract:
  - `PlanActivityPage(ctx, repoID, since, cursor, limit)` returns rows sorted by last activity time descending, then `plan` ascending. `since` is an inclusive Unix-second lower bound on that time; omitted means no lower bound. Each row: `plan` (the `facts.plan` slug, the folder segment such as `26-mcp-activity-reads`), `repo_id`, `last_activity_at` (RFC3339 UTC), and in-window `artifact_version` fact counts for kinds `design`, `brief`, and `report`. Last activity time is the max of in-scope `artifact_version` `facts.ts` for that plan and in-scope `review_run` `ts` whose JSON `plan` and `repo_id` match, including when the review row’s `facts.plan` column is empty. A plan that exists only as reviews is included, with zero artifact counts. Rows with an empty plan slug are excluded. `limit` is at least 1 and at most 50; the caller’s default is 20. The cursor is opaque and bound to tenant, `repo_id`, `since`, and the sort key. The page reports whether more rows follow.
  - `PlanSummary(ctx, repoID, plan)` returns one object, or a not-found result when that repo has neither an artifact fact nor a review with that plan. Fields, each capped at 10 newest rows, all stored history (not a 30-day window): `design` is the latest `Artifact` metadata for `docs/plans/<plan>/DESIGN.md` (hash, received time, screen, scores) or null, never `body`; `executions` reuses `ExecutionsPage` with that repo and plan (shape, brief path, conversation, harness, `ts`); `reviews` reuses `ReviewPage` with `kind=phase`, that repo and plan, projected to review id, phase, status, and `ts`, with no payload; `paths` are brief and report paths only. Shape labels stay the execution-shape rules, not git closure.
  - `RepoActivitySummary(ctx, repoID, from, to)` returns one object for that window: execution shape counts from the same rules as `ExecutionsPage` (counts, not rows); `artifact_versions` counts by kind `design` / `brief` / `report`; review counts by kind `phase` / `pr` / `adhoc`; and usage totals `model_calls` and `cost_usd` at **repo** grain only. Zeros are valid. It does not accept a plan, a measure name, or a dimension list.
- Non-goals: new ingest, indexing `IMPLEMENTATION.md` / `REVIEW.md`, storing commit messages or `Yakka-Phase`, plan-grain cost, or returning artifact text or review payloads (callers use `artifact_feedback`, `search_artifacts`, or `list_reviews`).

### Domain: MCP registry (activity tools)

- Owns: tool definitions, validation, the existing handler timeout, and JSON result objects for agents.
- Contract:
  - **Repo default, all three tools.** Optional `git` reader `v: 1` with `of: cwd`, `required: false`, plus optional `cwd`. No path argument, no `file` / `queue` / `drain`, no local actions. Non-empty argument `repo_id` wins. If it is omitted, the handler uses `_local.git.repo_id` when that reader succeeded. If the argument is omitted and git is missing, failed, or empty, the result is a tool error naming `repo_id` as required (`isError: true`). A git claim that disagrees with an explicit `repo_id` is not an error.
  - **Authority.** Tenant identity is only the authenticated tenant (`tenantState`). `repo_id`, whether from the argument or from `git`, is an untrusted filter inside that tenant. A forged id returns that repo’s rows or an empty page. It does not cross tenants. This is the same trust model as `list_reviews`’s `repo_id` argument and as `artifact_feedback`’s git claim.
  - **`list_plan_activity`** (`read`, `timeout_s` 20): arguments `repo_id?`, `since?` (non-negative Unix seconds), `limit?` (1–50, default 20), `cursor?`. Result is a JSON-RPC data object `{plans, next_cursor, complete}` in the same posture as `list_reviews`, not an MCP text content block. Unknown arguments and a cursor that does not match tenant, repo, or `since` are tool errors. `instruction` is one sentence: list recent plans in the current repo, then open `get_plan_summary` for one slug.
  - **`get_plan_summary`** (`read`, `timeout_s` 20): arguments `plan` (non-empty slug, required), `repo_id?`. Result is one JSON object with the `PlanSummary` fields. Unknown plan is a tool error `unknown plan`. `instruction` is one sentence: drill into one plan’s design metadata, brief shapes, phase reviews, and paths, without bodies.
  - **`summarize_repo`** (`read`, `timeout_s` 20): arguments `repo_id?`, `since?`, `until?` (Unix seconds). Default `until` is now and `since` is 30 days earlier, matching analytics `parseFilter` when `from` is omitted. A window the executions route rejects (today, wider than `maxBuckets` UTC days) is a validation error. Result is the `RepoActivitySummary` object, including `usage.grain: "repo"`. There is no `measures` argument. `instruction` is one sentence: repo-window counts, not a plan drill-down and not plan-grain cost.
  - Registration follows design 8. `tools/list` for `read` includes them. Anonymous discovery lists the same names, descriptions, and schemas as a `read` bearer and runs no handler. Descriptions and schemas contain no tenant-specific examples.
- Non-goals: changing `review_change` or `list_reviews`; write tools; exposing `/v1/analytics/query` on MCP; text-only renderings of paged results; shim changes beyond the readers these declarations already name.

### Domain: Search hardening (`search_artifacts` and `GET /v1/search`)

- Owns: the match expression, repo and kind predicates inside SQL, and the existing timeout path.
- Contract:
  - `search_artifacts` gains optional `repo_id` (string) and optional `match` (`any` | `all`, default `any`). `GET /v1/search` gains the same as query parameters. `any` keeps today’s OR of up to 32 quoted tokens. `all` joins those tokens with AND. Empty queries stay rejected. `limit` stays 10 on MCP and unchanged on REST (default 10, max 50).
  - When `repo_id` is set, every hit has that `repo_id`. When `kind` is set, every hit has that kind. Both predicates are applied in SQL, with a SQL row limit, so Go does not drop rows after a tenant-wide rank. The current FTS table has no repo or kind column; this phase may add one and reindex, or may restrict `MATCH` to the repo’s content hashes. “Filter the `latest` CTE before `MATCH`” is not, by itself, the contract.
  - The handler keeps `context.WithTimeout` of the tool’s `timeout_s`. On deadline the result stays the existing tool error `timeout after <n> s`. This phase does not add a second timeout string.
  - Acceptance is a conformance fixture, not a production millisecond SLO: the same high-frequency token stored on many artifacts in at least two repos; `search_artifacts` with that `repo_id`, `match=all`, and a selective query returns only that repo’s hits and does not return the timeout tool error; the same token with no `repo_id` and `match=any` either returns hits or `timeout after 20 s`. REST applies the same predicates.
- Non-goals: a new search engine; changing tokenization aside from AND versus OR; raising `timeout_s` above the default to hide a slow query.

### Domain: Stable docs (advisory surface)

- Owns: the tool table and API row in [docs/design/04-advisory-surface.md](../../design/04-advisory-surface.md), the shipped-tools list in [docs/design/08-server-mcp-contract.md](../../design/08-server-mcp-contract.md), and the one sentence in [docs/design/07-analytics-site.md](../../design/07-analytics-site.md) that says analytics is not an MCP tool.
- Contract: doc 04 lists the three tools, repo defaulting, the drill-down chain (`list_plan_activity` → `get_plan_summary` → `artifact_feedback` / `list_reviews` / `search_artifacts`), and `search_artifacts` `repo_id` and `match`. Doc 08 names the new read tools and the search arguments, and states that their results are data objects like `list_reviews`. Doc 07 keeps the analytics UI on HTTP and adds that `summarize_repo` is a closed advisory count, not the analytics API on MCP. [docs/OVERVIEW.md](../../OVERVIEW.md) may gain one advisory sentence in the same implementation pass; that sentence does not gate the phase.
- Non-goals: copying the full MCP schema into doc 04 (it still cites design 08); editing those docs in this design folder.

## Architectural Implications

- Doc 04 grows from five tools to eight. The principle is unchanged: the server owns definitions, the shim forwards. Phase 1 updates the search row and the `GET /v1/search` API line. Phase 2 adds `list_plan_activity` and `get_plan_summary`. Phase 3 adds `summarize_repo`.
- Doc 08’s shipped-tools section is the contract for result shape and for “no shim schema.” Each phase that changes a tool updates that section with the tool.
- Doc 07’s “analytics is not an MCP tool” sentence is narrowed in phase 3, not repealed. The dashboard stays HTTP. Plan-grain cost stays off MCP because the measure matrix has no `plan` dimension for usage.
- Plan 20’s analytics UI may later call the same store methods. No UI work is in this plan. Do not treat plan 20’s “reviews are not stored” as current; do treat missing `Yakka-Phase` facts and missing `IMPLEMENTATION.md` / `REVIEW.md` kinds as current.
- `get_plan_summary` review rows are stored advisory reviews. Wording in the tool description and in doc 04 must not call them git-proven phase closure.
- Anonymous discovery (plan 25) publishes every new `read` tool’s name, description, and input schema. The discovery test that lists `list_checks`, `search_artifacts`, `artifact_feedback`, and `list_reviews` is updated in the phase that registers each new name. No tenant data is computed on the anonymous path.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Tool count | Three tools: list, summary, repo summary | Listing, drill-down, and a window aggregate are different result shapes. One free-form `query_yakka` was rejected. |
| Stats surface | Fixed `summarize_repo` object, no `measures` array | `reviews` is not a query measure; usage measures ignore `plan`; a measure enum is a second query language. |
| Usage on MCP | Include `model_calls` and `cost_usd` at repo grain, labeled `grain: repo` | The request asks for stats. The honest grain is the one the store supports. |
| Activity list contents | Counts and last activity only; execution shapes live on the summary | Shape SQL is a correlated existence check. The list stays a page of plan identity. |
| Default repo | Explicit `repo_id` wins; else optional `git` of `cwd` | Matches “current repo.” Git is an untrusted claim, same as today’s feedback path. `of: cwd` needs no file path. |
| Since on the list | Optional filter, no default window | Newest-first paging is “recent.” A silent 30-day window would hide older plans that are still the latest work. |
| Stats window | Default last 30 days; reject windows the executions route rejects | Reuses `parseFilter`’s default and the executions cap instead of inventing a third window rule. |
| Search `match` default | `any` (OR) | Preserves current queries. Agents opt into `all` for slug tokens. |
| Search predicates | In SQL, including a schema or reindex change if required | The FTS table cannot filter by repo today. A CTE-only filter does not fix `MATCH`. |
| Result format | JSON data objects, like `list_reviews` | Opaque cursors and drill-down fields are part of the contract. Text-first would drop them. `list_checks` and `search_artifacts` stay text. |
| Timeout text | Keep `timeout after <n> s` | That string and the shim’s `timeout_s + 5` budget already exist. |
| Yakka-Phase and implementation files | Out of scope | Inventing closure from missing facts would falsify history. |
| Stable docs in this design | Name the edits; do not apply them here | Execute updates doc 04, doc 08, and doc 07 with the phase that ships the contract. |

## Assumption Ledger

None — see [PROVENANCE.md](PROVENANCE.md).

## Open Questions

- **Repo-grain usage on `summarize_repo`.** The design includes `model_calls` and `cost_usd` labeled `grain: repo`, which is what forces the doc 07 amendment. Sign-off can drop the `usage` object. Phase 3’s execution, artifact, and review counts still stand. Nothing else is blocked on this.

## Phases

### Phase 1 — Search respects repo and finishes

- Outcome: On a conformance fixture that stores one high-frequency token on many artifacts in at least two repos, `search_artifacts` with that `repo_id`, `match=all`, and a selective query returns only that repo’s hits and does not return a timeout tool error. The same token with no `repo_id` and `match=any` either returns hits or the tool error `timeout after 20 s`. `GET /v1/search` with the same `repo_id` and `match` returns the same inclusion rule. A `kind` argument does not admit other kinds.
- Surfaces: `packages/yakka/internal/serve/reads.go`, `packages/yakka/internal/store/reads.go` (and the `search` virtual table plus reindex if the current FTS schema cannot constrain repo or kind), `packages/yakka/internal/serve/mcp_stateless.go`, search and MCP goldens, [docs/design/04-advisory-surface.md](../../design/04-advisory-surface.md) search row and API line, [docs/design/08-server-mcp-contract.md](../../design/08-server-mcp-contract.md) `search_artifacts` sentence.
- Approach: known
- Depends on: nothing

### Phase 2 — Plan activity list and drill-down

- Outcome: In a fixture tenant with plans in two repos, `list_plan_activity` with `repo_id` omitted and a successful `git` claim for repo A returns repo A’s plans, newest activity first, at most `limit`, with `next_cursor` set when another page exists and `complete: true` on the last page. `get_plan_summary` for a listed slug returns design metadata or null, execution shapes, phase-review ids and statuses, and brief/report paths, and returns no body and no review payload. An explicit `repo_id` for repo B returns repo B even when git claims repo A. Omitting `repo_id` when git is absent or failed returns a tool error that says `repo_id` is required. An unknown slug returns `unknown plan`. Both names appear on anonymous `tools/list` and are absent from any shim tool table; an anonymous `tools/call` stays 401 with no handler run.
- Surfaces: new store activity reads beside `packages/yakka/internal/store/analytics.go` and `reviews.go`, new MCP registration beside `packages/yakka/internal/serve/mcp_list_reviews.go`, serve startup registration, `packages/yakka/internal/serve/mcp_discovery_test.go`, conformance goldens, [docs/design/04-advisory-surface.md](../../design/04-advisory-surface.md), [docs/design/08-server-mcp-contract.md](../../design/08-server-mcp-contract.md). Not `plugins/yakka/client/yakka.py` tool schemas.
- Approach: known
- Depends on: nothing. Ordered after phase 1 so the search drill-down is usable; the list and summary do not call search.

### Phase 3 — Repo-window counts

- Outcome: `summarize_repo` with no `measures` argument, default window, and a fixture that has briefs, phase reviews, and usage rows for the repo returns the fixed object: execution shape counts, artifact counts by kind, review counts by kind, and `model_calls` / `cost_usd` with `grain: repo`. An empty repo returns zeros, not an error. A window the executions route rejects is a validation error. The tool is on `tools/list` for `read` and on the anonymous catalog; anonymous `tools/call` stays 401.
- Surfaces: MCP registration, `ExecutionsPage` / `Query` / `ReviewPage` or one store helper that returns those counts, [docs/design/04-advisory-surface.md](../../design/04-advisory-surface.md), [docs/design/07-analytics-site.md](../../design/07-analytics-site.md), [docs/design/08-server-mcp-contract.md](../../design/08-server-mcp-contract.md), discovery test name list. [docs/OVERVIEW.md](../../OVERVIEW.md) one sentence is allowed and not required for the outcome.
- Approach: known
- Depends on: Phase 2 (the same repo-default and tool-error rule; do not invent a second one)

No phase is a single unit. Do not skip `refine`.

## Provenance Notes

- Session evidence before this draft: `search_artifacts` on a common token and on long slugs ran into the ~20s tool budget; a specific token returned. That matches OR-of-tokens over an unscoped FTS index, not a missing client timeout.
- `list_reviews` is the precedent for a paged JSON result. Following it avoids a text encoding of `next_cursor`.
- Rejected: one mega-tool with a free query string. It duplicates the analytics query API without its validation.
- Rejected: client-side repo filtering after FTS. The posting list is the cost.
- Rejected: requiring the `git` reader. An explicit `repo_id` must work when the caller is not in a checkout. Required readers fail the call before the handler sees the argument.
- Rejected: putting `open_executions` on every list row. The list would run the execution-shape query per plan; the summary already returns shapes for the one plan the agent opened.
- `PlanDesignPaths` stays a path lookup for other callers. It is not the activity page.
