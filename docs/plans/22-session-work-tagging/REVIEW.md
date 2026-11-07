# Review — plan 22 (session work tagging)

## Verdict

`PASS` — reviewed at `6c06c7c81b17b4a96385610f4a33f266faf38032`.

Design-only PR; no implementation phase outcomes to execute yet. The document is sufficient to sign off bounding work for #175 and to unblock refine/execute at the contract level, with Plan 24's merged design as the MCP seam.

## Phase outcome assessment (design document)

| Phase | Design readiness |
|---|---|
| 1 — Action record path | Met — ingest path, projection, segments, admin read surfaces and golden exclusions specified |
| 2 — Session-start capture | Met — env contract, probe gating, transport guard, queue shapes; Assumption 8 correctly leaves harness contingency open |
| 3 — Cost by work | Met — `action_*` join semantics, `(untagged)` / `(rejected)` / `(none)` buckets, CHM-gated item 5 |
| 4 — MCP tools | Met — registrations, scope split (`read_write` / `read`), declared context aligned with Plan 24; binding and `session_hint` explicitly open |
| 5 — Deterministic backfill | Met |
| 6 — TypeSafe classification | Met — accuracy bars and egress called out as Cody confirmation, not build blockers |
| 7 — Human review | Met |

## Intent and ledger

- Covers #175 scope: record actions, SessionStart env tagging, `record_action` / `work_cost`, cost queries, four harnesses, malformed values never block sessions, env vars separate from `YAKKA_ENDPOINT`/`YAKKA_KEY`.
- Env var rename to unified `YAKKA_ACTION_*` prefix is documented in Assumption 1 and matches the issue's intent with clearer collision avoidance.
- Reconciliation with Plan 24 on `origin/master` (`session_hint` seam, `repo_id` as `git.repo_id`, Phase 4 dependency split between Plan 24 P1 and P4) matches Plan 24's interaction section.
- Plan 21 interaction: no local effects, env vars out of `Resolve`, additive MCP/instructions overlap — consistent with Plan 21 design on master.
- Thirty-nine ledger entries; material open questions (harness env probe, session binding, hook-written pointer as local context) are named and gated to the phases that settle them, not smuggled into closed outcomes.

## Findings

| Sev | Finding | Disposition |
|---|---|---|
| follow-up | Issue #175 remains open after merge — this PR publishes the design only; implementation is seven phased PRs (~3.9k LOC estimated) | Non-blocking for this design PR |
| follow-up | Branch predates Plan 21/24 master commits; no content conflict in the diff (single new file) | Non-blocking; merge base is clean |

## Plan sufficiency

Sufficient to derive execute/refine briefs: action contract, fact shape, segment/precedence rules, analytics dimensions, MCP tool contracts, back-fill passes, rollout ordering (Phase 1 server before Phase 2 plugin), and explicit Plan 24 / Plan 21 boundaries are citeable.

## Residual risks (carried by design)

- Harness env forwarding and headless SessionStart (Open Questions; blocks Phase 2 close per harness).
- Session binding mechanism unsettled until Phase 4 (Assumption 13).
- Codex `cwd` / `project_dir` for MCP (Plan 21 OQ 1) affects Phase 4 Codex row.
- Subagent `conversation_id` and Cursor per-session pricing — Phase 3 probes.
