# Brief: phase2-05 — Grouped artifact band counts

Consumer: the execute worker for phase2-05; the Phase 2 verifier reads the artifact-band evidence.
Owned paths: `packages/yakka/internal/serve/analytics_artifact_population.go`, `packages/yakka/internal/store/artifact_entities.go`, `packages/yakka/internal/serve/phase2_artifact_band_test.go` (new), `packages/yakka/internal/store/phase2_artifact_aggregate_test.go` (new). Touch nothing else; `store/store.go` migrations belong to phase2-02.
Commits: commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/29-analytics-ui-rework/reports/phase2-05-artifact-bands.md` (rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase2-01 for the retained-scale table. Runs alongside: phase2-01, phase2-02, phase2-04.
Budget: read about 8 files, change about 380 lines, 40 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md`, commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/29-analytics-ui-rework/DESIGN.md:177` — Phase 2 outcome; `:97-98` — shared scoped work, artifact bands and the performance contract; `:89-100` — the domain.
2. `docs/plans/29-analytics-ui-rework/EVIDENCE.md:43` — D13; `:66,72` — Quality band mix and Scatter artifact observations; `:80` — artifact text/versions/bands row.
3. `docs/design/09-analytics-workspace-contracts.md:59-61` — artifact → score, version selection and baseline bands; `:78` — aggregate `stat=count` grouping; `:81` — content/scorer baseline mode; `:25` — aggregation bounds.
4. `packages/yakka/internal/serve/analytics_artifact_population.go:31-175` — `artifactPopulation` and per-file enrichment; `:303-520` — list/aggregate/scatter dispatch, filtering and `populations`; `:521-620` — aggregate grouping; `:731-811` — statistics and writer-cost coverage.
5. `packages/yakka/internal/store/artifact_entities.go:70-137` — `ArtifactEntitiesPage`; `:137-373` — existing aggregate/score/file aggregate helpers; `:374-469` — count, screen, versions, scores; `packages/yakka/internal/serve/analytics_artifact_schema.go:28-69` — baselines and `artifactScoreBand`.
6. Existing tests: `packages/yakka/internal/serve/analytics_artifact_test.go` (grep `aggregate`, `band`, `unscored`, `baseline_unavailable`); `packages/yakka/internal/store/artifact_entities_test.go`.
7. `packages/yakka/internal/serve/analytics_retained_bench_test.go` and `testdata/retained-request-shapes.json` from phase2-01.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make the artifact band-mix aggregate (`mode=aggregate&stat=count` with `dim=band:<check>` and/or `kind`) complete at retained-history scale by computing grouped counts from selected latest versions, latest scores and baseline bands in SQL, instead of loading and enriching every artifact file.

## Contract

- `DESIGN.md:97`: "Multi-dimension usage and artifact bands must share scoped work rather than rebuild the population per combination or per artifact."
- `EVIDENCE.md:43`: "Compute grouped counts from selected latest versions/check/scorer and baseline bands; derive only requested lenses, batch remaining enrichment, avoid full-population/per-file work for a count."
- Performance acceptance, verbatim: "Retain the existing p95 ≤500 ms target over at least 20 warm requests per affected request shape, measured alone and with a four-request board load; no timeout in either run. Record cold/migration latency separately. The one-second deadline is not increased as the acceptance mechanism."
- `09-analytics-workspace-contracts.md:60`: "Bands use per-kind/check/scorer all-time baselines over distinct hashes, with strict below-p25/above-p75 and inclusive `mid`; missing baseline is `baseline_unavailable`, not `unscored`."

## Changes

- **Grouped aggregate path** (`analytics_artifact_population.go`): for `mode=aggregate&stat=count`, do not call `artifactPopulation`. Compute groups directly:
  - select file identity `(repo_id, path)` membership under the same window/filters/cohort as today, with the selected latest version per file and the selected check's latest score per `(content_hash, check)`;
  - join the all-time baseline for the selected kind/check/scorer (the same distinct-content population `LatestContentScores` supplies) and classify each file as `low`, `mid`, `high`, `unscored` or `baseline_unavailable` with the existing strict-below-p25/above-p75/inclusive-mid rule;
  - derive only the requested `dim=` lenses (for example `band:<check>` and `kind`) and return the same group shape/labels/population metadata as the current aggregate path.
- **Baselines**: keep the content/scorer baseline semantics; load the baseline once per kind/check for the request, not per file. Do not switch to the file-weighted legacy baseline.
- **Keep list/scatter/predicate paths**: membership predicates, ranges, `fields=`, `populations`, null reasons and flags on list/scatter stay on the existing population path with unchanged behavior. If a helper is shared, make its behavior mode-explicit rather than silently changing list/scatter.
- If the aggregate needs a store helper (for example a grouped band count), add it in `store/artifact_entities.go` with the same window/filter arguments the route uses. Do not edit migrations; if a measured plan requires an index, report it to the orchestrator for phase2-02 and continue with the best available plan.

### Keep untouched

- Artifact grain identity `repo_id,path`, population unit, file-weighted measures and score/scorer independence.
- Band values and ordering, `unscored` vs `baseline_unavailable`, content-unavailable null reasons.
- List/scatter response shapes, cursor/filter behavior, schema capabilities.
- One-second deadline; no backfill or rescoring.
- Production parity, deployment and the Plan 28 trial.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after. Retained-scale harness data lives under the worktree's ignored `.scratch/`, never `/tmp`; ordinary unit fixtures may use `t.TempDir()`. Use `GOTOOLCHAIN=auto` and `GOMEMLIMIT=8GiB`.

- New `TestAnalyticsArtifactBandAggregateGroupedCounts` → passes after. Fixture: multiple versions per path, two scorers for one check, scored and unscored hashes, and a hash without a baseline. It asserts group keys, counts, `unscored`/`baseline_unavailable` handling and that group counts sum to the selected-file population. Include the correct-band boundaries (strictly below p25 = low, strictly above p75 = high, p25..p75 inclusive = mid). The pre-change failing acceptance is the retained-scale timeout below; if the current small-fixture output is wrong for a boundary, report that before/after too.
- Retained scale (phase2-01): `YAKKA_RETAINED_PROFILE=1 YAKKA_RETAINED_RUNS=20 go test ./internal/serve -run '^TestAnalyticsRetainedWorkload$' -count=1 -timeout 30m` filtered to the band-mix shape `grain=artifact&mode=aggregate&stat=count&dim=band:<check>&dim=kind&check=<check>&all=1`. Before: 503/query_timeout on the retained copy. After: p95 ≤500 ms alone and under the four-request load, zero 503.
- Oracle: total count equals the independent selected-file population; each group's count equals an independent SQL grouping; `kind` and `band:<check>` labels match the schema's published values.
- List/scatter parity: the same fixture's list and scatter responses are unchanged before/after (or differ only where the old path was wrong, with the difference named).
- Regressions: `… go test ./internal/serve -run 'TestAnalyticsArtifact' -count=1` and `… go test ./internal/store -run 'TestArtifact' -count=1` → pass.
- `gofmt -l` clean on changed files; `go vet ./internal/store ./internal/serve` passes.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
