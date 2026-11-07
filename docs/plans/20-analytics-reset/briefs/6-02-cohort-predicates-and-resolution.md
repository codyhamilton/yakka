# Brief: 6-02 — Cohort predicates and resolution

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/serve/` cohort/filter code and registrations, `packages/yakka/internal/store/` cohort resolution reads, focused cohort tests under `packages/yakka/internal/{serve,store}/`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-02-cohort-predicates-and-resolution.md` and include it in the commit.
Depends on: 6-01; Phases 1–5.
Runs alongside: Nothing; target-route integration and activity use this shared resolver.
Budget: 16 files to read, about 1,000 lines to change, 22 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` — section 17.3, especially `cohort=`, predicate grammar, typed populations, cross-grain joins, URL and runtime budgets.
2. `docs/plans/20-analytics-reset/DESIGN.md` — Assumption 29 and Phase 6 outcome.
3. Existing analytics shared filter parsing/application and Phase 4–5 entity resolver code.

## Goal

Implement canonical, bounded cohort definitions and positive source resolution to session sets for `session`, `artifact`, `content`, `execution` and `plan`. Make source subtraction resolve the positive predicate first; the later route-integration unit consumes this resolver.

## Contract

Follow CONTRACTS.md 17.3 verbatim: canonical grammar/encoding and validation limits; frozen source scope; source mappings through `conversation_id`; include/exclude set semantics; empty valid sets; named `cohort_invalid` and `unsupported_join` errors; typed relation/expansion metadata; stateless evaluation under shared deadline, memory and predicate budgets. Source Boolean `not` complements within its grain before resolution. Do not implement time-source selection here.

## Changes

- Add the bounded parser, schema validation, normalization and resolver needed by existing analytics routes, with deterministic identities and fixture-backed population counts.
- Resolve artifact via selected-version writing sessions and content via the same canonical representative rule as `/scores`; execution and plan sources follow the contract joins.
- Do not materialize unbounded identity lists or introduce stored cohorts, recursive references, arbitrary SQL, or new query syntax.
- Leave the resolver callable behind existing route surfaces; 6-03/6-04 own broad target-route/time-source integration.

### Keep untouched

Preserve all no-cohort request semantics and existing route response defaults. Preserve the 8 KiB total encoded view URL ceiling. Do not fake or infer Plans 21/22/23 features.

## Done evidence

Identify or write a failing check before changing code. Report its output before and after.

- Focused cohort parser/resolver tests → canonical equivalent predicates produce the same key/result; valid empty sets, bounded include lists, source `not`, positive-set subtraction, fixed scope and late-data revision behavior match fixtures.
- Malformed grammar, unsupported source joins and each published limit → 400 `cohort_invalid` or `unsupported_join` with reason/try as specified; no query executes past budget.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Cohort|Entity)' -count=1` → passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include before/after check output, deviations and any contract contradiction.
