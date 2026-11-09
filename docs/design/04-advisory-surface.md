# Design Intent 4: Agent Advisory Surface

What the agent can ask the system through the local shim and server. Part of
[system-architecture.md](system-architecture.md); the shim's plumbing is in
[02-edge-capture.md](02-edge-capture.md#mcp-shim) and the service it reads is
[03-remote-service.md](03-remote-service.md).

## Problem

The legacy MCP exposed sixteen tools. Most existed to feed the dataset (`post_design`,
`start_execution`, `complete_execution`, …), and the skills require the agent to call them, which is
what principle 1 removes. The agent still benefits from a few answers that change what it does in
this run: whether its artifact arrived and how it was judged, what it will be judged on, and what
similar work exists.

## Shape

`python3 plugins/yakka/client/yakka.py mcp` is a stdio shim registered by each harness. The server
owns all tool definitions, argument validation, state logic and user-facing wording. The
shim forwards `initialize`, `tools/list` and `tools/call` to `POST /v1/mcp` using the shared login,
injects the declared facts it reads from its fixed local reader table, and relays server replies.
Local read failures are injected context, not synthesized tool results. A remote transport or
configuration failure is the shim's own error; it never answers from local queue state while the
service is down.

The v2 declaration authorizes one bounded `enqueue_file_snapshot` pointer action for the exact
reviewed file resolved and guarded during the call. The server decides whether the action is needed
and supplies the final wording after the shim returns effect facts and refreshed context. The
`readOnlyHint:true` annotation and read scope describe service access; the declared local action is
a separate, explicitly bounded queue effect. It writes pointer metadata through the existing
spool path; the drain remains the content reader and uploader. Enqueue acknowledgment does not
prove queued or delivered: those states require current covering queue evidence or a matching
service hash. Unsupported versions, unknown outcomes and failures remain visible. The shim does
not upload artifact content or scan it on this feedback path, wake workers, run arbitrary commands
or delete queue entries. The separate `change` reader below scans and transmits bounded diffs.

| Tool | Answers | Changes the agent's decision by |
|---|---|---|
| `artifact_feedback(path)` | for the file at `path`: delivery state of its current content, screen verdict, scores per check with the tenant's baseline for that kind | telling it to fix a refusal, or revise a criterion that is out of norm, before moving on |
| `list_checks(kind)` | the checks a design, brief or report is scored against | letting it write to the rubric rather than discover it afterwards |
| `search_artifacts(query, kind?)` | similar past designs, briefs and reports in this tenant, with path, repo and a snippet | reusing or contrasting prior work |
| `review_change(mode, build_models, …)` | a server-owned single-call review receipt, with validated findings when `detail=full` | advisory comparison beside existing reviews; never a workflow decision input |
| `list_reviews(filters…)` | a tenant's stored reviews as a complete, cursor-paged listing with the same filters as `GET /v1/reviews` | whether earlier reviews exist and what they found, without spending on a new call |

The review tool is exposed only when server review model configuration and the MCP timeout ceiling
permit registration, and only to `read_write` callers. `list_reviews` is a `read` tool with no local
readers or actions. Maintainer operations (defining checks, rescoring, rating) are CLI or REST
only.

Only the human owner may reset or delete a tenant. Agents must not perform or attempt this on a user's behalf.
There is no reset/delete MCP tool. The [pending owner lifecycle API](03-remote-service.md#pending-owner-tenant-lifecycle-api-plan-23-phase-2)
is cookie-session/profile-UI-only, with same-origin and dedicated UI-header guards; keys never
qualify, even beside an owner cookie. Agents must not try REST, browser automation or header
spoofing to bypass that boundary. The guards are spoofable, not proof of a human; a future
human-verification/captcha step is out of scope for this amendment.

## `review_change`

The [Plan 23 follow-up amendment](../plans/23-llm-review-shadow/DESIGN.md) added per-call
effort/tags/store controls, full cached duplicate replies and a paged `list_reviews` tool. All three
are implemented; the same amendment's bounded tenant reset remains pending (Phase 2).

The server owns the tool definition, prompt and exclusion policy, stored brief or plan/phase criteria
resolution, provider call, validation, spend limits and tenant-local review record. It uses the same
orchestrator as authenticated `POST /v1/reviews`; records are read through `GET /v1/reviews` or the
read-only `list_reviews` tool. Optional `effort` (default `high`; `high`, `xhigh` or `max` only),
`tags` (at most 16 exact strings) and `store` (default `true`; `false`
skips all dedupe, cache and record writes) are validated before any spend or storage, and
`YAKKA_REVIEW_EFFORT` is a high-only server default that never caps a valid per-call override.
`read_write` scope and `readOnlyHint:false` disclose this spend-and-record boundary. Local collection
is read-only: the declaration has a 150-second timeout and no local actions. The shim alone captures
uncommitted changes or an explicit Git range using the server-declared `change` reader, scans before
egress and supplies bounded diff content and an omission manifest. The server rescans, and alone
holds the provider credential; machines use their existing Yakka login and need no provider key.
Receipts contain no captured diff content; `detail=full` includes validated findings. A duplicate of
a completed stored original returns the original review in the full fresh response shape, with
`cached=true`, `original_review_id`, `original_status` and the original findings; a still-running or
unknown original returns `in_progress` or `outcome_unknown` with `cached=false` and no second
provider call, and a missing or corrupt original returns `cache_unavailable`.

`execute` calls once after each phase closing commit; `comprehensive-review` and `post-build` each
call once at their reviewed/candidate PR head. These are non-gating `range` calls with explicit base
and head SHAs, stored criteria references where available, and contributor `build_models` from the
run record or `unknown`. Stages send no `trial` argument. Identical repeated `store=true` captures
return `skipped_duplicate` with the earlier review's full content, not an independent review;
`store=false` calls are independent paid work and are never deduplicated. Receipt summaries
and findings stay in session output, outside workflow handoffs. They never feed gates, verdicts,
commits, trailers, exit codes or plan-folder files and never trigger local fixes or dispatch.
Absent, unavailable and failed calls leave the stage's existing decisions unchanged.

## `artifact_feedback`

The server evaluates `artifact_feedback` from its authenticated tenant's artifact and baseline
data plus the declared local facts: resolved path, file metadata and hash, repository identity,
queue coverage and rejection facts, and drain liveness. It owns path-kind checks, feedback states
and wording. The queue reader returns bounded diagnostic samples; for the v2 enqueue action its
complete-coverage facts are computed over the full matching set, so a truncated sample cannot be
treated as proof of absence. If a required reader fails or is missing, the server reports local
context unavailable rather than a clean delivery state. Matching is by repository/path and current
content hash, not conversation. The shim computes repository identity using the same rules as the
drain (design 1).

## API

Service reads behind the original advisory tools. All need the key, all are scoped to the key's tenant.
The review POST additionally spends and records with `read_write` scope as described above.

| Request | Response |
|---|---|
| `POST /v1/reviews` | a review receipt: `status`, optional `reason`, validated findings under `detail=full`, and for a completed duplicate `cached`, `original_review_id`, `original_status` and the original findings even at receipt detail; captured content is never returned |
| `GET /v1/reviews?repo_id=&plan=&phase=&kind=&status=&effort=&profile=&manifest_hash=&since=&tag=&detail=&limit=&cursor=` | `{"reviews":[…],"next_cursor":<string\|null>,"complete":<bool>}`; repeated `tag` filters are conjunctive (ALL), `limit` defaults to 100 (range 1–500), and `cursor` is opaque and bound to the tenant, filters and detail |
| `GET /v1/artifacts?repo_id=&path=` | `{"repo_id","path","kind","versions":n,"latest":{"content_hash","received_at","conversation_id","source","screen":{"verdict","scorer","at"}\|null,"scores":[{"check","score"}]}}`, or 404 |
| `GET /v1/checks?kind=` | `{"checks":[{"kind","name","q","levels","invert"}]}` |
| `GET /v1/baselines?kind=` | `{"kind","checks":{"<name>":{"n","p25","median","p75"}}}` over the latest version of each artifact of that kind |
| `GET /v1/search?q=&kind=&limit=` | `{"hits":[{"repo_id","path","kind","content_hash","snippet","rank"}]}` |

`search` is SQLite FTS5 over the latest screened content of each artifact (`passed` or
`unscreened`), ranked by `bm25`, with `snippet()` for the excerpt; `limit` defaults to 10. Nothing
smarter in this round.

`GET /v1/reviews` is a complete cursor walk, not a capped export. The first page fixes an insertion
high-water mark; later pages use a strict descending `(ts, insertion_id)` boundary, so rows appended
after the first page, including backdated ones, cannot enter the walk. A nonterminal page is
`complete=false` with a `next_cursor`; the exhausted page is `complete=true` with `next_cursor=null`.
The authenticated tenant, route, filters and detail are bound into the cursor; a malformed,
mismatched or foreign-tenant cursor is an error, never a silent row drop. `detail=full` includes the
stored payload; default receipts omit it. Captured diff content is never stored in or returned from
a review row.

## Scores and baselines

Scores are per check, 0 to 1, as the scorer returns them. The baseline is the tenant's median and
interquartile range per check for the same kind. A check below the lower quartile is flagged. As in
the current skills, ratings are comparative: the outlier is the signal, not the number.

## Unreachable service

A configured endpoint that cannot be reached produces the shim's `unreachable` error, with the
local pending-write count and a fix. An unresolved login produces `bad config`. Neither condition
falls back to local mode or a local answer. The server remains the only source of advisory tool
results and wording.

## What changes in the skills

- `design`, `refine` and `execute` stop requiring `post_design`, `post_brief`, `patch_*`,
  `start_execution`, `patch_execution` and `complete_execution`. Writing the file is the
  submission (principle 1).
- Where a skill required ratings to be reported, it calls `artifact_feedback` after writing and
  reports flagged checks.
- Frontmatter IDs (`design_id`, `brief_id`) are dropped from templates; the artifact key is
  `(repo_id, path)`.
- Commit titles drop `[exec <id>]`. The execution is a derived view keyed by conversation
  (design 1). Phase closure stays on the closing commit as a git trailer and PR plan marker (see
  [system-architecture.md](system-architecture.md#plan-folder-and-phase-closure)).
- The execution report at `docs/plans/<plan>/reports/<brief-name>.md` becomes a required output of
  each worker (design 1).

## Registration

Every harness registers the shim as a stdio command: `python3 plugins/yakka/client/yakka.py mcp`.
`plugins/yakka/bin/yakka mcp` execs that same script. The HTTP registration of `127.0.0.1:8765/mcp` is
removed.

## Tests

1. Over stdio against a test service: `initialize`, `tools/list` relays the server's registered,
   scope-visible tools, and each declared call carries the required reader facts to the server.
2. `artifact_feedback` for a file that is queued, rejected, delivered, and delivered at an older
   hash gives the corresponding server-formatted states; failed required context never becomes a
   clean state.
3. Service down: the shim reports its transport error and does not synthesize a local tool answer.
4. Fake-provider review calls exercise both capture modes, `read`-scope refusal, validated full
   findings, `effort`/`tags`/`store` validation, and a completed duplicate that returns the original
   review with `cached`/`original_review_id`/`original_status`, plus `in_progress`, `outcome_unknown`
   and `cache_unavailable` paths, without local file changes or returned captured content. A paged
   `list_reviews` walk matches `GET /v1/reviews` across filters, tags, cursors and completion
   metadata. Stage text checks establish one non-gating range call per stage and recorded
   build-model provenance.
