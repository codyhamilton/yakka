# 5-01 artifact entity handoff

Status: **unfinished**. The route and core file-weighted reads are implemented, but the fixed Phase 5 artifact outcome is not yet complete; keep `entities_artifact` absent from `/schema`.

## Implemented

- `/v1/analytics/entities?grain=artifact` lists file identities selected by in-window facts, sorts and keyset-pages them, and selects the display version over lifetime by `received_at DESC, rowid DESC`. The selected version time and out-of-window status are returned. Direct repo, kind, plan, source, screen verdict, selected-version score/scorer fields, and the earliest-fact writing session are exposed.
- `/v1/analytics/entity?grain=artifact` pages distinct version identities by receive time descending and hash ascending. The writing session is selected by earliest event time, then row hash; repeated saves are counted in `also_seen_sessions`. Per-check scores/scorers and screen metadata are returned.
- Artifact aggregate supports count, sum, percentiles and histograms for versions, distinct writing sessions and time measures; score measures use the latest score row per hash/check. Content-size aggregates use promoted blob sizes and mark unavailable blobs as missing. Scatter uses stable SHA-256 sampling and whole-population histograms for the supported measures. Numeric `where` is applied to versions, writing-session count and first/last timestamps.
- The focused fixture verifies in-window membership versus lifetime latest selection, repeated-save attribution, equal-receive-time history ordering, separate repo identities, detail scores/scorers, aggregate count and scatter output.

## Verification

- `gofmt -w internal/store/artifact_entities.go internal/store/artifact_entities_test.go internal/serve/analytics_entities.go internal/serve/analytics_artifact_test.go internal/serve/serve.go` — passed.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p 3 ./internal/store ./internal/serve -count=1` from `packages/yakka` — passed (`internal/store` 7.743s; `internal/serve` 25.114s).

## Remaining work and problems

- Aggregate grouping dimensions are not implemented. Numeric predicates are limited to four base measures; score and content-size predicates are rejected. List and scatter coverage does not yet report complete whole-population missing-score/content counts per measure.
- Score bands and scorer-specific baseline semantics remain unimplemented here. The content-size aggregate has a 20,000-file work ceiling and returns `too_many_cells`; that ceiling is not currently published in `/schema`.
- No artifact capability metadata was added because the above handlers do not yet implement the full contracted field, dimension, predicate and typed-coverage surface. Do not enable `entities_artifact` until those are complete and fixture-proven.
- The `/entity` route registration changes only the mux for the route already named by CONTRACTS 17.3. The brief's owned paths were amended to include `serve.go` for this registration after orchestrator direction; no new route semantics were added.

Departures: report the incomplete items above; no contract or identity changes were made. No live deploy, production data or credentials were needed. No external gate is pending.
