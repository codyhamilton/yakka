# 5-04 artifact schema, bands and writing-session measures

Status: **done with concerns** (the previously identified artifact bucket ambiguity remains unsupported).

## Delivered

- `/schema` advertises `entities_artifact` with the implemented file identity, list/scatter/aggregate modes, bounded versions detail collection, numeric fields, per-kind check names, lens domains/provenance, statistics, units/null/time rules, additive eligibility and shared budgets. The check domain includes the active catalogue and retained historical score names; unknown score fields are rejected. `artifact_content` remains independent. Plan/execution/cohort/activity/action/review flags remain absent.
- Artifact rows expose scorer-specific `band:<check>` and selected-check `scorer`. Baselines use all-time distinct hashes of the same kind/check, partitioned by each latest score's scorer. Strict below-p25 and above-p75 comparisons use interpolated quartiles before display rounding; both boundaries are `mid`. Missing baseline is `baseline_unavailable`; absent score is `unscored`. Each check keeps its own scorer metadata.
- Selected-version writing-session cost, model-call, token and hook-event measures use existing deduplicated/priced session aggregation inside the active board window, read in batches of at most 500 IDs. Artifact repo/kind/path filters never remove joined calls. No calls give zero cost, all-unpriced calls give null with `all_unpriced`, and partial pricing carries lower-bound/unpriced coverage. These overlapping session associations are not advertised as additive sums across files.
- Harness/model includes and excludes apply after lifetime writer/provenance selection. An in-window re-saver cannot move the captured writer or alter file measures. Identity, hash representative rules, history and content authorization are unchanged. The remote-service description now matches these Phase 5 capabilities and correctly leaves plan entities to Phase 6.

## Before and after evidence

Before implementation, the new fixture failed with HTTP 400: `unsupported artifact field writing_session_cost_usd`.

Fixture checks now prove exact inclusive band boundaries, scorer partitioning, latest-score rescoring, independent check scorers, missing baseline versus absent score, duplicate-content file weighting, no-call/all-unpriced/partial/out-of-window session measures, list/scatter/aggregate pricing eligibility, supported-field validation, named band/scorer grouping, unadvertised buckets, capability flags and writer-lens ordering.

Commands from `packages/yakka`:

- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` — passed (store 7.299s, serve 26.032s).
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/serve -run 'TestArtifact|TestAnalyticsSchema' -count=1` — passed after the final schema metadata edits.
- `git diff --check` — passed; changed Go files formatted with `gofmt`.

An initial command from the repository root exited because `go.mod` is under `packages/yakka`; the bounded checks above used the module directory. No live service, production data, deploy, credentials, migrations or timing/animation tests were used.

## Departures and carried concerns

No departure from the assigned integration brief and no contract edits. Artifact bucket grouping remains explicitly rejected and absent from advertised operations: §17.3 does not choose a timestamp for a file with versions spanning buckets. Selecting latest-version time or in-window first/last time would invent semantics. No other unit work is unfinished.

gate: Cody must define the artifact file-to-time-bucket assignment in the design before artifact bucket grouping can be implemented or advertised.
