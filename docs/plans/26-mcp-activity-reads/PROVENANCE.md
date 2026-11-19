# Provenance: MCP activity reads

## Session

- Session: Initial design (2026-11-15)
- Timestamp: 2026-11-15T11:35:00Z
- CWD: /home/codyh/workspace/yakka

## Initial Request (verbatim)

> Lets start a design to improve the tools. We would want to be able to query more interesting data - e.g. searching executed plans for the current repo, listing recent plans and execution history (not necessarily the whole artifacts, more like understanding what has recently been done and being able to go deeper if we want). Then also being able to query stats etc. Also will want to look into the long query time.

## Design Conversation

### Turn 1

**Agent asked:** (implicit) whether to expose the full analytics query language on MCP or curated activity tools, and whether “current repo” should default from local git context.

**User responded:** (no separate reply — the initial request specifies repo-scoped plan search, recent activity summaries, optional drill-down, stats, and search latency.)

**Agent decisions:**

- Add curated read tools for plan activity and a small stats surface; do not expose `GET /v1/analytics/query` verbatim on MCP.
- Default `repo_id` from the optional `git` MCP reader when the caller omits it (same posture as `artifact_feedback`), with an explicit override argument.
- Harden `search_artifacts` in the same plan because latency blocked the existing search path during Ground.

## Agent Decisions

- **Advisory surface amendment**: Extend [docs/design/04-advisory-surface.md](../../design/04-advisory-surface.md) and register new tools on the server per [docs/design/08-server-mcp-contract.md](../../design/08-server-mcp-contract.md); the shim gains no new local behaviour beyond existing `git` / `cwd` readers.
- **Phase closure honesty**: Phase-level execution history comes from stored `review_runs` (`list_reviews` filters) and artifact timestamps; git `Yakka-Phase` trailers are still not first-class facts (see the [Plan 20 record](../20-analytics-reset.md)) — the record documents that gap instead of inventing ingest here.
- **Separation from Plan 20**: The analytics workspace UI and its new pages stay in Plan 20; this plan only adds agent-facing MCP reads and search fixes on existing store queries.

### Turn 2

**Agent asked:** (grounding and an adversarial pass; no new user wording) whether three tools are the right surface, whether a measure-picker stats tool is honest, whether phase 1 is only an index change, and whether repo defaulting can be spoofed.

**User responded:** (no separate reply — the parent continued the same request: current-repo plan activity, execution history with drill-down, stats, and long search times.)

**Agent decisions:**

- Keep three tools. Replace the `measures` array with one fixed repo-window tool, `summarize_repo`. Usage totals stay at repo grain only, because `cost_usd` and `model_calls` have no `plan` dimension and there is no `reviews` query measure. Sign-off may drop the usage block; the count blocks stay.
- Plan list rows are identity, last activity, and kind counts. Execution shapes are only on `get_plan_summary`. `since` on the list has no default window.
- Paged and summary results are JSON data objects in the `list_reviews` posture. Text-first would not carry an opaque cursor.
- Search phase outcome is repo and kind predicates in SQL, plus a schema or reindex change if the current FTS table cannot express them. Filtering the `latest` CTE before `MATCH` is not sufficient: `search` has no repo column. Keep the existing tool error `timeout after <n> s`. Drop the production “under 2 seconds” bar; acceptance is a two-repo fixture.
- `repo_id` from the argument or from optional `git` of `cwd` is a filter inside the authenticated tenant, not authority. Explicit `repo_id` wins. The git reader stays optional so a caller outside a checkout can still pass `repo_id`.
- Plan 20’s “reviews are not stored” is stale (`review_runs` and `list_reviews` exist). Missing `Yakka-Phase` on commit facts and missing `IMPLEMENTATION.md` / `REVIEW.md` kinds stay out of scope.
- Name doc 04, doc 08, and the doc 07 “analytics is not an MCP tool” sentence as phase surfaces. Do not edit those files in the design turn.
- No phase is a single unit, so none skips `refine`. Phase 2 does not technically depend on phase 1. Phase 3 depends on phase 2’s repo-default rule.
