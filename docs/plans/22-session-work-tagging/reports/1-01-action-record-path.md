status: done with concerns

Implemented the Phase 1 server action record path: the shared action contract and fixtures, structural-only `session_action` ingest, durable asynchronous projection and retry state, order-independent conversation segments, `/v1/actions`, admin action counts, and the typed admin API field. Legacy summary/facet/query paths exclude action facts. Fake-backed serve coverage exercises scoring enabled, disabled, and unreachable, accepted/rejected projection, duplicate ingest, read isolation, failed projection isolation, and admin counts. No real classification or egress call was made.

Evidence:

- Before implementation, baseline `cd packages/yakka && go test ./...` passed. The user-noted unrelated layout failure was not reproduced and was not investigated.
- After implementation, `cd packages/yakka && go test ./...` passed for every package (including `cmd/yakka`, 60.631s).
- `go test ./internal/actions ./internal/ingest ./internal/store ./internal/serve` passed after final code changes.
- `go test ./internal/serve -run 'TestAction' -count=10` passed; `go test ./internal/serve -run 'TestFailedActionProjection' -count=10` passed.
- `git diff --check` passed.

Departure: the brief lists design-doc paths under `packages/yakka/docs/design/`, which do not exist in this checkout. Updated the corresponding existing server docs at `docs/design/01-event-model-and-ingest.md` and `docs/design/03-remote-service.md` instead. No other departure. No unfinished work. Known concern: the documented layout test failure remains user-noted but unreproduced in this run.
