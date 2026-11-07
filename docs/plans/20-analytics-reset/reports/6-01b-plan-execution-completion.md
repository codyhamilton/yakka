Status: done with concerns

Before change:
`GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -run 'Analytics(Plan|Execution|Entity)' -count=1` failed in serve as expected: plan artifact-kind counts and execution session-model lens were missing. Store passed.

After change:
- The same focused command passed.
- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store ./internal/serve -count=1` passed (store 6.677s; serve 24.565s).
- `git diff --check` passed.

Added plan artifact counts by kind, latest per-check design scores, plan harness/session-model lenses, execution brief/report per-check scores, and execution session-model lens. Existing event and plan collection paging behavior remains intact.

Concerns: complete plan sort coverage and cursor pinning to receive watermark/derivation revision are not implemented here. No derivation revision API exists on the current surface; shared cursor structs already have a fact watermark, but plan/execution handlers do not capture/apply it. Execution detail ordering and event cursor ties still lack the requested new fixture coverage. The plan/execution entries in /schema are outside this brief's owned paths and still need measures/lenses updated to match the delivered fields. No contract changes, new routes, dependencies, or external services were used.
