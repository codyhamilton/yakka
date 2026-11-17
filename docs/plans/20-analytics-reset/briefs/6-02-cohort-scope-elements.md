# Brief: 6-02 — Cohort scope elements and bounded grammar

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/store/analytics_cohort.go`, focused tests under `packages/yakka/internal/store/`, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-02-cohort-scope-elements.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 6-01d; Phases 1–5.
Runs alongside: Nothing; the resolver and schema units build on this grammar.
Budget: 8 files to read, about 400 lines to change, 18 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` section 17.3.1 — Scope elements, Boolean meaning, Meaning of a lens, Scope is not `op`, Valid/empty/invalid/unsupported.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` section 17.3 — the `cohort=` paragraph.
3. `packages/yakka/internal/store/analytics_cohort.go` — current `CohortScope`, `ParseCohortDefinition`, `CohortSessionSubquery`.

## Goal

Replace the rejected `[]string` scope lists with the signed structured element grammar, validate and canonicalise it, and expose the include/exclude predicate so the resolver can apply it to a source population.

## Contract

CONTRACTS.md 17.3.1 is binding:

- `scope.include` and `scope.exclude` are arrays of `{"lens": <name>, "values": [<string>, ...]}`. `[]` means none; `null` or an absent key stays 400 `cohort_invalid`. `values` empty is `cohort_invalid`.
- `lens` is a member of `/schema.grains[<source grain>].filters`. A name `/schema` publishes for no grain is 400 `cohort_invalid`; a published name outside this grain's `filters` is 400 `unsupported_join` with reason `not_defined_for_grain` and `try`.
- `values` are exact case-sensitive strings, 1 to 64 per element, 256 bytes per value (1,024 for an `id` of a composite identity). Budgets on the canonical form: at most 64 elements per list, 64 values per element, 256/1,024 bytes per value. Over-budget reasons are `scope_elements`, `scope_values` and `value_bytes` on `cohort_invalid`.
- Boolean meaning: for one lens the include values are a union (OR); across lenses AND; include applies first, then exclude (AND NOT IN). Canonical form merges same-lens elements, deduplicates and sorts values lexically, and sorts elements by lens; the canonical key uses it.
- `scope.exclude` narrows the source population; `op=exclude` subtracts resolved sessions from the target. Keep them distinct.

The per-grain filter names are the matrix in 17.3.1 and the schema unit (6-04) will publish them. Define one shared Go table of each grain's filter names in this package so both units use it; do not hand-list names in two places.

## Changes

- Change `CohortScope.Include/Exclude` to a `[]CohortScopeElement` with `Lens` and `Values`; strict-decode each element (unknown fields rejected). Reject bare strings and null with `cohort_invalid`.
- Add the grain `filters` table from 17.3.1 (session `harness`, `session_model`, `session_repo`, `id`; artifact `kind`, `plan`, `repo_id`, `harness`, `session_model`, `source`, `screen_verdict`, `scorer`, `band:<check>`, `id`; content `harness`, `session_model`, `repo_id`, `plan`, `scorer`, `screen_verdict`, `band`, `id`; execution `shape`, `plan`, `repo_id`, `harness`, `session_model`, `id`; plan `repo_id`, `harness`, `session_model`, `id`; time the shared dimensions its measures apply plus `id`). Validate `lens` against it; dynamic `band:<check>` is validated by the resolver unit against the catalogue.
- Canonicalise and compute the key over the merged/sorted canonical form.
- Expose a small function that compiles the canonical scope to a WHERE fragment and args given a `map[lens]sqlExpression` of source columns, so the resolver unit can bind it without duplicating the Boolean rule. It must return `not_defined_for_grain`/`try` for an unmapped lens rather than ignoring it.
- Keep the existing predicate grammar (`and`/`or`/`not`/`range`/`in`/`is_null`), its limits and canonical ordering unchanged.

### Keep untouched

Preserve current predicate parse/canonical behaviour, the 8 KiB encoded-definition ceiling, and every existing non-scope error. Do not add a stored cohort, nesting across lenses, or a `v` 2 grammar.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store -run 'Cohort' -count=1` → passes, with cases for: `[]` accepted; `null`/missing rejected; element objects required; unknown-for-any-grain name → `cohort_invalid`; published-name-outside-grain → `unsupported_join`/`not_defined_for_grain`; each budget reason; canonical merge/dedup/sort and key stability across element/value order.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` → passes (the two activity failures noted in `IMPLEMENTATION.md` are pre-existing and owned by 6-06; note them, do not fix here).

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, check output before and after, deviations, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.
