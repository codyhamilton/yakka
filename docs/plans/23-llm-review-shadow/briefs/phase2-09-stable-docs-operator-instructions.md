# Brief: phase2-09 — Stable docs and operator instructions for owner lifecycle

Consumer: a docs worker who can edit the named stable design docs and the trial README without claiming unshipped behavior.
Repo: `/home/codyh/workspace/yakka-build/23b`.
Branch: `feat/23b-review-controls-trial`.
Owned paths: `docs/design/03-remote-service.md`, `docs/design/04-advisory-surface.md`, `docs/design/07-analytics-site.md`, `docs/design/08-server-mcp-contract.md`, `docs/design/system-architecture.md`, `docs/OVERVIEW.md`, `docs/ARCHITECTURE.md` (only where a lifecycle statement is stale), `tools/shadow-review-trial/README.md`. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase2-09-stable-docs-operator-instructions.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase2-04, phase2-05, phase2-06, phase2-07 and phase2-08. Read their reports and the code they left.
Runs alongside: nothing.
Budget: read 12 files, about 250 lines changed, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Architectural Implications (184–193), stable-docs decision 26 (230), Phase 2 outcome/surfaces (270–275), and the Phase 2 implementation reports.
2. `docs/design/03-remote-service.md` — current tenant/storage statements (178–197) and pending lifecycle API (201–230).
3. `docs/design/07-analytics-site.md` — pending owner lifecycle UI (55–90) and hosting (341–390).
4. `docs/design/08-server-mcp-contract.md` — lifecycle/no-tool statements (55–65) and `review_change` annotations (130–200).
5. `docs/design/04-advisory-surface.md` — advisory/tool descriptions that mention lifecycle or owner-only actions; grep `reset`, `delete`, `lifecycle`, `tenant`.
6. `docs/design/system-architecture.md` — tenant/auth/architecture statements; grep `tenant`, `lifecycle`, `session`.
7. `docs/OVERVIEW.md` and `docs/ARCHITECTURE.md` — tenant lifecycle statements only.
8. `tools/shadow-review-trial/README.md` — "Pending owner-only trial cleanup" section (1–40) and run/report contract.
9. The implemented code: `tenant_lifecycle_http.go`, `registry_lifecycle.go`, `tenant_lifecycle.go`, `lifecycle_profile.go`, `session.go` (`handleMe`), `review_cursor.go`.
10. Phase 1 `briefs/phase1-07-stable-docs.md` and its report — the promotion style and exclusions.

## Goal

Promote only the implemented Phase 2 owner-lifecycle, isolation and cross-origin selection contracts into the stable docs and trial operator instructions, removing the pending wording those implementations now satisfy while leaving Phase 3 and any unshipped behavior pending.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "Stable docs describe the landed API until implementation. This amendment names the pending pivot in docs 03/04/08; docs 03's directory-delete claim is corrected now because the cleanup decision relies on it. Follow-up phases promote their implemented contracts to docs 01/03/04/08/system-architecture and architecture/overview as needed. No stable doc may claim a pending contract is already shipped."
- "Only the human owner may reset or delete a tenant. Agents must not perform or attempt this on a user's behalf. These operations are owner cookie-session/UI-only, have no MCP surface, and require API-origin profile serving in Phase 2; they do not inherit admin authority or the broader CORS allowlist. Human verification/captcha is deferred."
- Phase 2 outcome: reset/delete complete-disposal semantics, `/me` lifecycle fields, explicit refusal ordering, API-origin view with Pages navigation, and tenant isolation are now implemented and may be described as landed.
- "No fixture, preflight or docs-only PR is labeled a completed live trial." / "No deployment is authorized by this amendment." / Phase 3 "real-server paid trial remain pending."

## Changes

- In `docs/design/03-remote-service.md`: replace the stale "There is currently no … these remain pending" text around 190–197 with the landed owner-only reset/delete routes, exact gate/error ordering, `/me` lifecycle fields, complete cleanup and post-reset rekey/re-selection behavior. Keep the mandatory human-owner wording and the "guardrail, not proof of a human" caveat.
- In `docs/design/07-analytics-site.md`: change "Pending owner lifecycle UI" to the landed API-origin bounded view and Pages navigation/revalidation; keep the captcha deferral and no-deploy statements accurate.
- In `docs/design/08-server-mcp-contract.md`: state that no reset/delete MCP tool exists (implemented reality), and do not add one; keep advisory scope/annotations accurate.
- In `docs/design/04-advisory-surface.md`, `system-architecture.md`, `OVERVIEW.md` and `ARCHITECTURE.md`: update only statements that are now false or that must point at the landed lifecycle contract. Do not rewrite unrelated analysis or advisory content.
- In `tools/shadow-review-trial/README.md`: change the cleanup section from "pending" to the implemented human-owner path, including API-origin view navigation, typed-id confirmation, key/bearer refusal, reset-vs-delete behavior, new key/re-selection after reset and no automatic replay. Keep the Phase 3 live-trial/spend/deploy prerequisites pending and do not claim a completed trial.
- Do not change code, tests, the analytics bundle, plugin files or any stable doc outside the owned paths. If a plugin/shim file is touched (it should not be), bump the plugin version; otherwise no version change.

### Keep untouched

Phase 1 contracts and proofs, Phase 3 trial/history/spend-gate behavior, unrelated analytics-site redesign, deploy/hosting claims, and any statement that would claim the trial ran or the provider was called. Preserve the exact required human-owner sentence.

## Done evidence

- `git diff --check` → no whitespace errors.
- `rg -n "There is currently no|remain pending|not implemented" docs/design/03-remote-service.md docs/design/07-analytics-site.md tools/shadow-review-trial/README.md` → no stale Phase 2 claims (remaining pending text must name only deferred captcha, legacy cleanup/migration or Phase 3/live-trial items).
- `rg -n "Only the human owner may reset or delete a tenant" docs/design/03-remote-service.md docs/design/07-analytics-site.md docs/design/08-server-mcp-contract.md tools/shadow-review-trial/README.md` → present in each.
- `rg -n "reset|delete|lifecycle" docs/design/08-server-mcp-contract.md` → says no lifecycle tool; `rg -n "reset/delete MCP tool|reset tool|delete tool" docs/design/08-server-mcp-contract.md` → no positive claim of a tool.
- `git diff --stat` → only the owned docs changed.
- The report states that no live server, provider, credential, deployment or paid trial was used.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
