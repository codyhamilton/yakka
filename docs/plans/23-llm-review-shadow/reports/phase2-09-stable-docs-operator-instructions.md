# Report: phase2-09 — Stable docs and operator instructions for owner lifecycle

Status: `done`

Branch: `feat/23b-review-controls-trial`

## What changed

Promoted only the landed Phase 2 owner lifecycle/isolation/cross-origin contract out of "pending" in the docs named by the brief; Phase 3/live-trial and captcha deferral stay pending.

- `docs/design/03-remote-service.md`
  - Storage paragraph no longer says "There is currently no DeleteTenant API"; raw directory deletion is still described as incomplete on its own, and the landed owner lifecycle routes are named as the complete-cleanup path (`tenant_lifecycle.go`, `registry_lifecycle.go`).
  - The amendment sentence now says reset/delete landed.
  - Renamed `### Pending owner tenant lifecycle API (Plan 23 Phase 2)` to `### Owner tenant lifecycle API`; dropped the `(pending)` table header.
  - Profile view is described as served at the API origin (not "Phase 2 must serve"); owned `/me` entries now "carry" `lifecycle_state`/`lifecycle_generation` (not "Phase 2 also extends", matching `session.go:104-131` and `handleMe`).
- `docs/design/07-analytics-site.md`
  - Renamed the pending heading to `## Owner lifecycle UI (Plan 23 Phase 2)`; states the API-origin view and Pages navigation are landed, no MCP/key path; `Phase 2 extends/provides` reworded to landed; anchor updated; captcha deferral and no-deploy claims preserved.
- `docs/design/08-server-mcp-contract.md`
  - `[pending owner lifecycle API]` link/text now owner lifecycle API; Trust paragraph no longer says reset is pending, stating instead it is implemented, cookie-session/UI-only and adds no MCP surface. No reset/delete tool is claimed.
- `docs/design/04-advisory-surface.md`
  - Same link/text and pending-reset sentence updated to landed owner-only behavior with no MCP/key path.
- `tools/shadow-review-trial/README.md`
  - `Pending owner-only trial cleanup` → `Owner-only trial cleanup`; operations stated as implemented; "Recommended operator path after implementation" → "Recommended operator path". Reset-vs-delete, typed-id confirm, key/bearer refusal, re-selection/rekey and no-automatic-replay wording retained; Phase 3 spend/deploy prerequisites untouched.
- No change to `system-architecture.md`, `OVERVIEW.md` or `ARCHITECTURE.md`: grep found no stale tenant-lifecycle statement in them, so the brief's "only where stale" condition did not apply.

The human-owner sentence is verbatim in 03, 07, 08 and the trial README.

## Check output

Before: the stale-claim check matched the "remain pending implementation (Phase 2)" and "not implemented"/"Pending ... API" text in 03/07/README.

After:

```
$ git diff --check
(no output)

$ rg -n "There is currently no|remain pending|not implemented" docs/design/03-remote-service.md docs/design/07-analytics-site.md tools/shadow-review-trial/README.md
(no matches)

$ rg -n "Only the human owner may reset or delete a tenant" docs/design/03-remote-service.md docs/design/07-analytics-site.md docs/design/08-server-mcp-contract.md tools/shadow-review-trial/README.md
present in all four

$ rg -n "reset/delete MCP tool|reset tool|delete tool" docs/design/08-server-mcp-contract.md
60:There is no reset/delete MCP tool. The [owner lifecycle API](...)
(only the negative statement)

$ git diff --stat
 docs/design/03-remote-service.md      | 31 ...
 docs/design/04-advisory-surface.md    |  5 ...
 docs/design/07-analytics-site.md      | 19 ...
 docs/design/08-server-mcp-contract.md |  5 ...
 tools/shadow-review-trial/README.md   | 10 ...
 5 files changed, 37 insertions(+), 33 deletions(-)
```

No live server, provider, credential, deployment, paid trial, Fly/Wrangler command or `/tmp` was used. No code, tests, analytics bundle or plugin files changed, so no plugin version bump.

## Departures

- **Three owned docs untouched:** `system-architecture.md`, `OVERVIEW.md` and `ARCHITECTURE.md` were left unchanged because their greps (`tenant`, `lifecycle`, `session`) showed no statement that became false or needs a lifecycle pointer. The brief permitted but did not require edits there.
- Line budget: 70 changed lines vs the ~250 guidance; stayed inside it by not rewriting unrelated advisory prose.

## Problems / unfinished

- None. All required done-evidence checks pass.

## Contradictions

- None between the brief and the cited `DESIGN.md` contracts. The only "reset" tool string in 08 is the required negative "There is no reset/delete MCP tool."
