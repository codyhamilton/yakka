# Brief: phase1-07 — Stable documentation promotion

Consumer: a documentation worker in `packages/yakka` / `docs` who can read the landed code and promote only implemented contracts.
Repo: `/home/codyh/workspace/yakka-build/23b` (Go module under `packages/yakka`).
Branch: `feat/23b-review-controls-trial`.
Owned paths: `docs/design/01-event-model-and-ingest.md`, `docs/design/03-remote-service.md`, `docs/design/04-advisory-surface.md`, `docs/design/08-server-mcp-contract.md`, `docs/design/system-architecture.md`, `docs/OVERVIEW.md`, `docs/ARCHITECTURE.md`. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase1-07-stable-docs.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase1-03, phase1-04, phase1-05 and phase1-06. Read their reports and the final code before writing; do not document a behavior that is not in the tree.
Runs alongside: nothing.
Budget: read 9 files, about 220 lines changed, 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Architectural Implications (155–163, especially 158); Phase 1 outcome and Surfaces (217–218); Domain contracts (89–119).
2. `docs/plans/23-llm-review-shadow/reports/phase1-01-…` through `phase1-06-…` — what actually landed, including any recorded deviation.
3. `docs/design/01-event-model-and-ingest.md` — `### Facts` (17–31).
4. `docs/design/03-remote-service.md` — `### Configuration` (60–77), `## API` (106–138), `## Storage` (175–199, but do not rewrite the corrected directory-delete sentence at 188–193).
5. `docs/design/04-advisory-surface.md` — `## Shape` (16–46), `## review_change` (48–71), `## API` (85–99), `## Tests` (135–145).
6. `docs/design/08-server-mcp-contract.md` — `### Scope` (59–64), `### Trust` (130–146), `### Budgets` (148–163), `### The shipped tools` (165–196).
7. `docs/design/system-architecture.md` — `## Principles` (28–52), `## Seams` (54–79).
8. `docs/OVERVIEW.md` — `## Advisory change review` (45–65).
9. `docs/ARCHITECTURE.md` — `## Advisory change review` (75–96).

## Goal

Promote the implemented Phase 1 call controls, complete cached duplicate responses, paged reads and `list_reviews` from design-only to current behavior, while keeping Phase 2 reset and any live/deployed/paid claim explicitly pending.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- "Follow-up phases promote their implemented contracts to docs 01/03/04/08/system-architecture and architecture/overview as needed. No stable doc may claim a pending contract is already shipped."
- `DESIGN.md:158`: "Stable docs describe the landed API until implementation. This amendment names the pending pivot in docs 03/04/08; docs 03's directory-delete claim is corrected now because the cleanup decision relies on it."
- The Phase 1 behavior to document: per-call `effort`/`tags`/`store`; `YAKKA_REVIEW_TRIAL_ENABLED` removed; `YAKKA_REVIEW_EFFORT` is a high-only default/validation setting that never caps a valid per-call override; full cached duplicate responses with `cached`/`original_review_id`/`original_status`; direct execution-key lookup; content-free `review_usage` for `store=false`; cursor-paged REST `GET /v1/reviews` and MCP `list_reviews` with `next_cursor`/`complete`, ALL tag filters, fixed high-water; `review_change` stops promising unconditional idempotency.
- Do **not** document as shipped: the admin tenant reset/cascade, synthetic tenancy, full-history trial fetching, the spend gate, or any deployed/paid trial result; those are Phase 2/3 or operator work.

## Changes

- `01-event-model-and-ingest.md`: extend the review fact description with `tags`, configured/requested/effective effort, `store=false` and the content-free `review_usage` fact; state it stays outside conversation/hook/facet counts and work/quality aggregates.
- `03-remote-service.md`: delete the `YAKKA_REVIEW_TRIAL_ENABLED` row; rewrite `YAKKA_REVIEW_EFFORT` as a high-only server default/validation setting that does not cap per-call effort; add `POST /v1/reviews` and `GET /v1/reviews` API rows with filters, repeated `tag`, `limit` default 100 / range 1–500, `cursor`, `detail`, and `reviews`/`next_cursor`/`complete`. In `## Storage`, update only the pending sentence that bundles these controls (195–199) to say they are implemented, while leaving the bounded reset explicitly pending; leave 188–193 untouched.
- `04-advisory-surface.md`: replace the `review_change` pending note (50–52) with the implemented controls, full cached duplicate reply and read-only `list_reviews`; document `effort`/`tags`/`store`, `detail=full`, the duplicate fields and that captured content is never returned; add the review read shape/paging to `## API`; update the duplicate test wording (135–145).
- `08-server-mcp-contract.md`: list `list_reviews` as a `read` tool, keep `review_change` `read_write`; replace the reference-only duplicate wording (130–146) with the full cached fresh-shape response and the pending/unknown/missing states; state that `review_change` no longer promises unconditional idempotency; add `effort`/`tags`/`store` and the `list_reviews` contract to `### The shipped tools`, including no local readers/actions.
- `system-architecture.md`: update the annotation principle and review seam for the non-idempotent `store=false` case, full cached duplicates and the `list_reviews` read.
- `OVERVIEW.md` and `ARCHITECTURE.md`: update the advisory-review summaries to the same duplicate/control/`list_reviews` wording.
- Do not edit `DESIGN.md`, plan records other than this brief's report, code, plugin files, or the corrected tenant-delete paragraph.

### Keep untouched

`docs/design/03-remote-service.md:188–193` (the corrected directory-delete statement), all Phase 2/3 pending text, historical plan records, code and plugin files.

## Done evidence

- `git diff --check` → no whitespace errors.
- `rg -n "YAKKA_REVIEW_TRIAL_ENABLED" docs/design docs/OVERVIEW.md docs/ARCHITECTURE.md` → no matches.
- `rg -n "pending implementation|not implemented" docs/design/04-advisory-surface.md docs/design/08-server-mcp-contract.md docs/design/03-remote-service.md` → any remaining hit is only for Phase 2 reset / Phase 3 trial work, never for Phase 1 controls, duplicates, paging or `list_reviews`.
- `rg -n "DeleteTenant|delete.*tenant|tenant.*reset" docs/design/03-remote-service.md` → still says there is no implemented DeleteTenant/reset; no Phase 1 text claims a cascade.
- A short `git diff --stat` in the report showing only the seven owned docs changed.
- For each promoted statement, the report names the code/test file that proves it (for example `mcp_list_reviews.go`, `review_cursor.go`, `review_usage.go`).

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
