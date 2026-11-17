# Brief: 6-04 — Capability schema publication and filter alignment

Consumer: the Phase 6 server worker.
Owned paths: `packages/yakka/internal/serve/analytics_query.go` (`/schema`), `packages/yakka/internal/serve/analytics_entities.go` (session and time filters), `packages/yakka/internal/serve/analytics.go` (exclude whitelist), `packages/yakka/internal/serve/analytics_artifact_population.go` (artifact filters), focused serve tests, and this brief's report. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/6-04-schema-capability-publication.md` and include it in the commit.
Depends on: 6-03.
Runs alongside: Nothing; route integration and the proof unit read this schema.
Budget: 10 files to read, about 500 lines to change, 20 tool turns. Past the budget, stop and hand off in `IMPLEMENTATION.md`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.3.1 — Matrix is the maximum; Routes; Phase 4 and 5 alignment owed by Phase 6.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` 17.2 — `grains`, `filters`, `predicate`, `features`, budgets.
3. `packages/yakka/internal/serve/analytics_query.go` and `analytics_artifact_schema.go` — current grain/lens/budget publication.

## Goal

Publish the signed grain `filters` and `predicate`, the `content` grain and scope budgets, and bring the session/artifact/time filter parsing to 17.3.1's meaning, so `/schema` offers exactly what the 6-03 resolver answers.

## Contract

- Each of `session`, `artifact`, `content`, `execution`, `plan`, `time` publishes `filters` (every name `/entities?grain=g` accepts as an include filter and as `exclude=<name>:<value>`) and `predicate` (`measures`, `lenses`, `undefined: [{name, reason}]`). `predicate` is the subset 6-03 resolves and never less than what `/schema.grains[g].measures` and the published lenses already list for `g`.
- Add the `content` grain (aggregate/cohort-only, required kind/check). `features.cohort` is **not** advertised by this unit; 6-07 proves and advertises it.
- `/schema.budgets` gains the scope budgets (`scope_elements` 64, `scope_values` 64, `value_bytes` 256/1,024 for `id`); the artifact grain's existing `predicate_budgets` key stays.
- On `/entities?grain=session` only, `harness`, `session_model` and `session_repo` are lens filters over the lifetime-derived `l` values; `id` filters by `conversation_id`; `model=` stays an alias for `session_model`. Legacy routes keep fact-level `harness`.
- Every filter name is accepted under its own name; the artifact route parses `session_model` (keeping `model=` as an alias). Extend the `exclude=` dimension whitelist to the same names.
- `/entities?grain=time` reports a filter it ignores in `ignored_filters` (Phase 4 dropped it). A cohort definition with an inapplicable time filter is refused by the resolver/target unit, not here.
- Requests without `cohort=` stay byte-identical to today outside these additive fields.

## Changes

- Build the grain `filters`/`predicate` maps from one source shared with 6-03's kernel table; do not hand-maintain a second list. `undefined` names only the time-grain non-`id` lenses with `not_defined_for_grain`.
- Route the session lens filters through the lifetime provenance read used by the session rows; a fact-level `harness` value must not replace the lens value on this route.
- Add `ignored_filters` to the time entity response, populated from the shared filter dimensions the time measures do not apply.
- Extend `allowedExclude` and the artifact/session filter parsing, keeping legacy handlers unchanged for requests without the new names.

### Keep untouched

Do not change response shapes for legacy requests beyond adding `ignored_filters` to time entities. Do not advertise `features.cohort` here. Preserve Phase 4's `where=`/`predicate=` entity filtering and every existing budget key.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `/schema` HTTP assertions: all six grains present with `filters` and `predicate`; `content` present; scope budgets present; `features.cohort` absent.
- A two-harness / `(mixed)`-model fixture proves `/entities?grain=session` `harness`/`session_model`/`session_repo` filter on the lifetime-derived lens, and `model=` aliases `session_model`; legacy `/conversations` harness stays fact-level.
- `/entities?grain=time` with an inapplicable filter returns `ignored_filters` naming it.
- `exclude=` accepts every published filter name (400 only for an unpublished one).
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/serve -run 'Analytics(Schema|Entity|Time|Session)' -count=1` → passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, check output before and after, deviations, and any contradiction. Never resolve a contradiction silently.
