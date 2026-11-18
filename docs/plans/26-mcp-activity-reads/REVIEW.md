# Review — MCP activity reads and faster search (design)

Verdict: **PASS_WITH_FOLLOWUPS**

Reviewed SHA: `e343a3c` (PR #235).

Plan sufficiency: the design is enough to judge intent, phase outcomes, ledger entries, and downstream QA. Domains, store contracts, MCP registration posture, search hardening acceptance, and stable-doc surfaces are explicit and grounded in current code.

## Phase outcomes (design acceptance)

| Phase | Assessment |
| --- | --- |
| 1 — Search respects repo and finishes | **met** (as design). SQL-level repo/kind predicates, `match=all`, conformance fixture, and timeout string reuse are observably stated. Grounding matches `matchExpr`, unscoped FTS `search`, and Go-side `kind` filtering in `mcpSearchArtifacts`. |
| 2 — Plan activity list and drill-down | **met** (as design). `PlanActivityPage` / `PlanSummary` contracts, optional `git` repo default, JSON data objects like `list_reviews`, and discovery registration outcomes are complete. |
| 3 — Repo-window counts | **met** (as design). Fixed `RepoActivitySummary` shape, `parseFilter` default window, executions cap alignment, and repo-grain usage labeling are stated. Depends on phase 2 repo-default rule only. |

## Intent and ledger

Verbatim intent is preserved. Problem analysis aligns with code: five advisory tools in doc 04, `PlanDesignPaths` / `ExecutionsPage` / `ReviewPage` on REST but not MCP for plan rollups, FTS schema without repo/kind columns, `measureMatrix` usage measures without `plan`, stale Plan 20 review-storage note called out correctly. Interactive provenance is recorded in `PROVENANCE.md`; assumption ledger is empty with open usage question left for sign-off.

## Findings

### Resolved in review

- **low** — `PROVENANCE.md` lacked a trailing newline; fixed.

### Follow-up (not blocking design sign-off)

- **low** — Open question on including repo-grain `usage` on `summarize_repo` (doc 07 amendment); resolve at sign-off before phase 3 execute.
- **low** — Phase 1 may require FTS schema/reindex work; keep the phase outcome fixture-based rather than committing to one migration shape in refine.

## Security lens

Tenant authority stays on bearer; `repo_id` from argument or optional `git` is an untrusted filter inside the tenant, consistent with `list_reviews` and `artifact_feedback`. New tools are `read` scope with anonymous discovery only on `tools/list`; anonymous `tools/call` remains 401. No new cross-tenant surface.

## Residual risks

- Search phase complexity (FTS reindex vs content-hash restriction) is intentionally left to refine/execute; outcome fixture must drive the choice.
- `get_plan_summary` review rows are advisory storage, not git-proven phase closure; doc 04 wording in execute must preserve that honesty.