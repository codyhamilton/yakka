# 6-02 — Cohort predicates and resolution

Status: done with concerns

## Before and after evidence

Before implementation, the required check `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Cohort|Entity)' -count=1` passed with `[no tests to run]` in both packages.

After implementation, the same check passes. Store fixtures cover canonical equivalent predicates, malformed and unsupported definitions, source `not`/positive exclusion semantics, artifact selected-version writer resolution, and executable session, artifact, execution and plan source subqueries. `git diff --check` passes.

## Result and limits

- Added strict JSON validation, canonical predicate/scope serialization and SHA-256 definition identity. Enforces the 8 KiB definition cap, 64 leaves, 64 values per `in`, depth 8, finite ordered numeric bounds, published grain names and schema-known predicate names. The canonical parser sorts/deduplicates commutative children and string values and normalizes absolute times to UTC.
- Added parameterized SQLite positive-source subqueries for session, artifact, execution and plan. The query remains inside SQLite and returns distinct `conversation_id` values; `op=exclude` never complements the source predicate. Artifact resolution uses the lifetime selected version and earliest observed writer; execution maps to its conversation; plan expansion uses associated sessions active in the frozen source window.
- Kept cohort capabilities unpublished and did not wire target routes; 6-03 owns that integration. Time resolution remains with 6-04. Plans 21/22/23 capabilities are not inferred or advertised.
- Some schema-valid predicates currently produce `unsupported_join` from the resolver where their derived measure/lens query is not implemented (including selected content score, scorer/model provenance, session cost, and several plan/execution measures). This is explicit rather than silently dropping a condition.

## Gates

- `gate: CONTRACTS.md 17.3 gives no element grammar for scope.include/scope.exclude; resolver rejects non-empty lists until their encoded shape and semantics are defined.`
- `gate: content cohorts need selected kind/check metadata to use the canonical /scores representative, but the cohort definition has no kind/check field; resolver rejects content sources until the contract defines that selection.`
- `gate: source-specific derived measures/lenses and derivation revision metadata need further resolver coverage before those predicates are advertised.`
