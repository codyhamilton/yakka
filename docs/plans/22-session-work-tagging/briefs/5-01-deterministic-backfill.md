# Brief: 5-01 — deterministic back-fill

Consumer: Plan 22 Phase 6 classifier and Phase 7 review tool maintainers.
Owned paths: `tools/session_backfill/`, `plugins/yakka/client/yakka.py`, `plugins/yakka/client/test_facts.py`, `docs/design/02-client-and-hooks.md`. Touch nothing else except this plan's brief, report, and implementation record.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/22-session-work-tagging/reports/5-01-deterministic-backfill.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: Phases 1 and 2.
Runs alongside: nothing.
Budget: 14 files to read, about 760 lines to change, 30 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/22-session-work-tagging/DESIGN.md` — Phase 5 outcome, Capture contract, queue contract, assumptions and gates.
2. `docs/plans/22-session-work-tagging/IMPLEMENTATION.md` — Phase 1–3 outcomes and carried items.
3. `plugins/yakka/client/yakka.py` — queue parser, fact builder, and enqueue conventions.
4. `tools/transcript/parsers/` and `tools/transcript/lib/paths.py` — existing transcript store formats and path conventions.
5. `docs/design/02-client-and-hooks.md` — client queue documentation.

## Goal

Build deterministic extraction for the four local transcript stores, queue-log truth comparison, label files, dry-run reporting, and idempotent enqueue of complete labels as `source=backfill, method=deterministic`. Keep every incomplete in-scope session inspectable as partial with evidence or unresolved.

## Contract

Follow `DESIGN.md` Phase 5 and its Capture and Record/projection domains. The action vocabulary and normalization remain exclusively server-owned; the client queue writer performs no action validation. Each generated fact is a tag-only `yakka.session_action` envelope with raw action strings and deterministic provenance. Enqueueing must be idempotent and must not read or move `~/.local/share/workflow/queue`. The design's Phase 5 evidence and exclusions are binding, including excluding the 890 Flash analysis runs and reporting how many labeled sessions already have server facts.

Cody's execution gate: use only synthetic fixtures and fake clients in this worktree. Do not inspect the four production stores, perform a production dry run, drain, call ingest, or make any network/classification/egress call. Record `gate: Cody to authorize the codyh-ubuntu four-store dry run and any real enqueue/drain verification.` in the report and requested result file.

## Changes

Add the bounded tool beside `tools/transcript/`: parsers for the four stores, queue-log reader, deterministic subject/phase extraction, secret-scrubbed evidence, label-file persistence, dry-run summaries, and idempotent run/enqueue behavior. Add the smallest queue-file writer to `yakka.py` for tag-only `yakka.session_action` envelopes, with unit tests. Update client queue documentation. Use synthetic fixtures only; never make network calls.

### Keep untouched

Do not modify `~/.local/share/workflow/queue`, production transcript stores, other worktrees, other plans, server packages, or classification clients. Do not add client-side copies of the server action vocabulary. Do not run real classification or egress.

## Done evidence

Identify the targeted checks before implementation. Run them only against synthetic fixtures/fakes.

- Tool unit tests cover each store parser, deterministic extraction, queue-log truth and 95% gold-set agreement, coverage categories, exclusion, secret-scrubbed evidence, idempotency, and server-fact count reporting without accessing production stores.
- Client unit tests prove the writer's event envelope is parsed by the existing builder into exactly one `session_action` fact, and repeated stable IDs do not produce new queue files.
- Documentation describes invocation, label files, dry run versus enqueue, and safety boundaries.
- `git diff --check` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. State the production four-store dry run and real enqueue as a Cody gate. Do not report any result from production data.
