# Design Intent 4: Agent Advisory Surface

What the agent can ask the system, through the local shim. Part of
[system-architecture.md](system-architecture.md); the shim's plumbing is in
[02-edge-capture.md](02-edge-capture.md#mcp-shim) and the service it reads is
[03-remote-service.md](03-remote-service.md).

## Problem

The current MCP has sixteen tools. Most exist to feed the dataset (`post_design`,
`start_execution`, `complete_execution`, …), and the skills require the agent to call them, which is
what principle 1 removes. The agent still benefits from a few answers that change what it does in
this run: whether its artifact arrived and how it was judged, what it will be judged on, and what
similar work exists.

## Shape

> **Proposed bounded extension, authorized 7 Nov 2026; implementation requires separate verification.**
> [Plan 24's v2 addendum](../plans/24-server-mcp-shim/DESIGN.md#authorized-amendment-bounded-enqueue-declaration-v2)
> and [Plan 21's reconciliation](../plans/21-feedback-delivery/DESIGN.md#bounded-action-approval-and-amendment-basis)
> permit the server to request one guarded pointer enqueue for the specific reviewed file. Only
> the final server answer reaches the agent after refreshed context. `readOnlyHint:true` and read
> scope describe service reads; the explicit local-action declaration and bounded approval separately
> govern the local queue effect and must be disclosed to the harness. Enqueue acknowledgment is not
> proof of queued/delivered: those require current covering queue evidence/matching service hash.
> Unsupported versions, unknown effect outcomes and failures stay visible. No MCP file content,
> direct post, secret scan, worker wake, arbitrary commands/paths or queue deletion is authorized.
> Pointer freshness and the spool's normal Python-drain kick follow Plan 24; this note claims no
> implementation or deployment and preserves the historical v1 proposal below.

> **Proposed by [plan 24](../plans/24-server-mcp-shim/DESIGN.md), not built.** Today this document describes the shim as the
> owner of the three tools. Plan 24 moves every tool, its wording and its state logic to a `POST /v1/mcp` endpoint on the
> server; the shim then only adds the bearer and reader-collected local context (`_local`) and relays replies. Until that
> plan's Phase 4 closes, the text below is what runs.

`python3 plugins/yakka/client/yakka.py mcp` is a stdio MCP server, spawned by each harness,
reading the client config (design 2). It forwards to the service's advisory reads and adds local
queue state. Every tool is read-only.

| Tool | Answers | Changes the agent's decision by |
|---|---|---|
| `artifact_feedback(path)` | for the file at `path`: delivery state of its current content, screen verdict, scores per check with the tenant's baseline for that kind | telling it to fix a refusal, or revise a criterion that is out of norm, before moving on |
| `list_checks(kind)` | the checks a design, brief or report is scored against | letting it write to the rubric rather than discover it afterwards |
| `search_artifacts(query, kind?)` | similar past designs, briefs and reports in this tenant, with path, repo and a snippet | reusing or contrasting prior work |

Nothing else is exposed. Maintainer operations (defining checks, rescoring, rating) are CLI or REST
only.

## `artifact_feedback`

> **Proposed by [plan 24](../plans/24-server-mcp-shim/DESIGN.md), not built:** the states and wording below are decided on the server from reader-collected context
> (file metadata and hash, repository identity, queue and drain facts). The shim no longer kicks the drain; hooks own that.
> The only intended differences are listed in the plan's parity table.

The shim resolves `path` against the working directory, reads the file, and hashes it. Then, in
order:

1. **Queued.** Any queue file whose envelope refers to `path` after normalisation (resolved
   against the envelope's `cwd`, then made repo-relative with the drain's function). The shim parses
   each queue file to check; the queue is normally a handful of files, so this is accepted. If present, the shim kicks the drain,
   waits up to about 1.5 s, and re-checks. Still queued: report count, oldest age, and why
   (`bad config`, `remote unreachable`, `draining`).
2. **Rejected.** Any `rejected/` file for `path`: report the reason. The fix is to rewrite the file;
   that fires a new hook.
3. **Delivered.** Ask the service for `(repo_id, path)`: the latest version's hash, its screen
   verdict, and its scores. If that hash differs from the file's current hash, say the current
   content is not yet delivered, which is normally a write still in the batch window.

Matching is by path and content hash, not by conversation. The shim is not told which conversation
spawned it, and an artifact written in an earlier conversation is still answerable.

The repo ID is computed by the shim the same way the drain computes it (design 1).

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

> **Proposed by [plan 24](../plans/24-server-mcp-shim/DESIGN.md), not built:** the shim no longer answers from local state when the service is down. A configured
> remote that cannot be reached is the shim's own `unreachable` error (naming the host, the count of local writes still
> queued, and the fix); an unresolved login is `bad config`. Neither falls back to local mode or to a local answer.

The shim never fails a tool call because the service is down. It answers with what it knows locally
(queued, rejected) and says the service is unreachable. A missing config says so and names the
file.

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

1. Over stdio against a temp service: `initialize`, `tools/list` shows exactly the three tools,
   each call returns.
2. `artifact_feedback` for a file that is queued, rejected, delivered, and delivered at an older
   hash gives the four distinct answers.
3. Service down: the call returns local state and says so, with no MCP error.
