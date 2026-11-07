# Brief: phase4-04 — stable docs and plugin release metadata

Consumer: the Phase 4 execution worker updating the user-facing architecture description and plugin version metadata.
Owned paths: `docs/design/02-edge-capture.md`, `docs/design/03-remote-service.md`, `docs/design/04-advisory-surface.md`, `plugins/yakka/.claude-plugin/plugin.json`, `plugins/yakka/.cursor-plugin/plugin.json`, `plugins/yakka/.codex-plugin/plugin.json`, `docs/plans/24-server-mcp-shim/reports/phase4-04-docs-and-release.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/24-server-mcp-shim/reports/phase4-04-docs-and-release.md` and include it in the commit.
Depends on: `phase4-02-readers-and-enqueue`.
Runs alongside: `phase4-03-conformance-and-guard`.
Budget: 7 files to read, about 300 lines to change, 20 tool turns. Past the budget, stop and report over budget.

## Required reading, in order

1. `docs/plans/24-server-mcp-shim/DESIGN.md` — Phase 4 outcome; Domain: Shim, Local context readers, tools and hooks/drain; authorized v2 addendum.
2. `docs/plans/24-server-mcp-shim/IMPLEMENTATION.md` — Phase 3 behavior and carried limitations.
3. The three owned stable docs and three plugin manifests — current proposed notes, stale ownership descriptions, version and cross-references.

## Goal

Describe the implemented server-defined MCP boundary accurately in stable docs and release the shim runtime with one consistent plugin version bump.

## Contract

Phase 4 outcome clause 9 requires docs 02 and 04 to describe the shim as built and the plugin version to be bumped. The `/v1/mcp` API row in doc 03 must no longer say no client uses the endpoint until Phase 4; document the shipped shim client accurately. The v2 addendum's one bounded pointer enqueue is the sole local action, and docs must distinguish authorization, implementation, and deployment claims. Server owns tools/state/wording; shim handles shared login, transport, declared readers and the bounded directive. The drain remains the content reader and posts ingest; the shim does not upload content or own a drain launcher.

## Changes

Rewrite the proposal notes and stale text that claim the shim owns tools, answers from the queue, kicks the drain, or locally responds while offline. Keep the three server tools and same user-visible advisory purpose; describe transport failure as the shim's own error. Document the v2 bounded action precisely as a pointer and avoid asserting that enqueue acknowledgment proves delivery. Update the `/v1/mcp` row. Bump all three plugin manifest versions consistently; use the next patch version after 3.4.0 and do not alter harness registrations.

### Keep untouched

Do not change harness launch configuration, hooks, spool/drain descriptions beyond correcting the MCP boundary, tool contracts, design 24, or plugin functionality unrelated to MCP.

## Done evidence

- Search of docs 02/03/04 finds no stale claim that the shim owns tool definitions/state, answers with local queue state, or launches a drain; new descriptions agree with Phase 4 contracts.
- All three manifest versions are identical and incremented from the previous value; JSON parsing succeeds.
- `git diff --check` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. State the before/after docs checks, parsed manifest versions, deviations and any contract ambiguity.

A non-trivial bug outside this unit's evidence: report its symptom, location and root cause; do not fix it here.

Do not spawn agents beyond read-only research helpers.
