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
owns all three tool definitions, argument validation, state logic and user-facing wording. The
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
not upload content, scan secrets, wake workers, run arbitrary commands or delete queue entries.

| Tool | Answers | Changes the agent's decision by |
|---|---|---|
| `artifact_feedback(path)` | for the file at `path`: delivery state of its current content, screen verdict, scores per check with the tenant's baseline for that kind | telling it to fix a refusal, or revise a criterion that is out of norm, before moving on |
| `list_checks(kind)` | the checks a design, brief or report is scored against | letting it write to the rubric rather than discover it afterwards |
| `search_artifacts(query, kind?)` | similar past designs, briefs and reports in this tenant, with path, repo and a snippet | reusing or contrasting prior work |

Nothing else is exposed. Maintainer operations (defining checks, rescoring, rating) are CLI or REST
only.

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

Service reads behind the tools. All need the key, all are scoped to the key's tenant.

| Request | Response |
|---|---|
| `GET /v1/artifacts?repo_id=&path=` | `{"repo_id","path","kind","versions":n,"latest":{"content_hash","received_at","conversation_id","source","screen":{"verdict","scorer","at"}\|null,"scores":[{"check","score"}]}}`, or 404 |
| `GET /v1/checks?kind=` | `{"checks":[{"kind","name","q","levels","invert"}]}` |
| `GET /v1/baselines?kind=` | `{"kind","checks":{"<name>":{"n","p25","median","p75"}}}` over the latest version of each artifact of that kind |
| `GET /v1/search?q=&kind=&limit=` | `{"hits":[{"repo_id","path","kind","content_hash","snippet","rank"}]}` |

`search` is SQLite FTS5 over the latest screened content of each artifact (`passed` or
`unscreened`), ranked by `bm25`, with `snippet()` for the excerpt; `limit` defaults to 10. Nothing
smarter in this round.

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

1. Over stdio against a test service: `initialize`, `tools/list` relays the server's three tools,
   and each declared call carries the required reader facts to the server.
2. `artifact_feedback` for a file that is queued, rejected, delivered, and delivered at an older
   hash gives the corresponding server-formatted states; failed required context never becomes a
   clean state.
3. Service down: the shim reports its transport error and does not synthesize a local tool answer.
