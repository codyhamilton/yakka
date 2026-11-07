# 5-01 artifact entity handoff

Status: **closed for the assigned base artifact unit**. Phase 5 capability publication remains with integration after 5-02 and 5-03. No feedback result is claimed; the execution runner records that separately when obtained.

## Delivered against the brief

The original core identity/history implementation is in `e3b48c8`. Retry brief amendment `f2a497d` enumerated the uncovered existing contract work before code changes. The retry extracts artifact population handling into `analytics_artifact_population.go` so the score/lens unit can enrich the same file-weighted rows.

- File membership remains in-window; latest displayed version remains lifetime `received_at DESC,rowid DESC`. History preserves receive-time/hash paging and earliest-event/row-hash writing-session provenance. Identical bytes remain separate file identities.
- List, scatter and aggregate now share entity predicates. Numeric `where` includes selected-version score and content-size measures, including colon-bearing score names. Boolean `and`, `or`, `not`, inclusive `range`, `in` and `is_null` use the signed bounded grammar (64 leaves/values, depth 8, 8 KiB encoded URL). Shared fact exclusions apply before membership. Null ranges are false. Unsupported base fields/lenses are errors.
- Lists keyset-page every supported numeric measure, including null scores, with full repo/path tie-breaks. Cursor binding includes predicates and every query field, freezes the scope window, and handles null cursor boundaries.
- Aggregates group by zero to two base artifact dimensions (`repo_id`, `kind`, `plan`, `source`, `screen_verdict`, `harness`, `session_model`) in deterministic order. Count, additive-field sum, exact nearest-rank percentiles and histograms report group populations and zero omitted coverage. Timestamp/score sums are rejected. The published output cell budget, including the product of dimension cardinalities, is enforced without silent slicing.
- List and scatter report typed per-measure whole-population eligibility and `unscored`/`content_unavailable` counts independent of page/sample size. Null row values name their reasons. Scatter retains deterministic SHA-256 sampling and whole-population marginals.
- Removed the unpublished 20,000-file content-size ceiling. Reads page in batches of 500 under the existing request deadline/cancellation budget; output grouping uses `max_cells`. The unified implementation currently materializes enriched rows for exact sorting/statistics; it has no invented population truncation.

## Verification

Before implementation, `TestArtifactPopulationGroupingPredicatesAndCoverage` failed with 400 “artifact aggregate dimensions are not supported”. It now proves grouping, score ranges, Boolean/null predicates, exclusions, lowered cell budgets and page-independent missing coverage. Further fixtures prove grammar validation/depth, nullable score cursor traversal and cancellation. Existing artifact fixtures cover identity, version history and writer/scorer provenance.

From `packages/yakka`:

- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` — passed (store 7.470s, serve 25.989s).
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/serve -run TestArtifact -count=1` — passed again after final population/budget adjustments.
- `gofmt` applied to changed Go files.

## Integration handoff and carried limitations

5-02 owns score-name/catalogue validation, selected-check scorer/band lenses and filters, scorer baselines, writing-session measures, and applying derived harness/model filters after provenance selection. The current score-name recognizer accepts a nonempty `score:` suffix; schema publication must wait for that validation. The helper exposes `artifactPopulationRow` and `artifactPopulation` for this integration. 5-03 owns complete content byte serving, separately from the existing content-size read.

Artifact aggregate `bucket` other than `none` is explicitly rejected and is not advertised: section 17.3 allows optional bucket grouping but defines no artifact file timestamp assignment when versions span buckets. Choosing latest-version time versus in-window first/last time would create semantics absent from the signed contract. This limitation is carried to the phase owner; no time mapping was invented. Cohort resolution remains a later-phase capability and is explicitly rejected rather than ignored.

No other route, grain, join, dependency, gesture, contract, deployment or secret access was added. No external gate was required for this unit. Full `entities_artifact` publication remains absent pending the named integration work.
