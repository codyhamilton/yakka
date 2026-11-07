Run: Codex execute skill, run ID 22-p3-2026-11-07
Started: 2026-11-07 10:41:49 UTC
Branch: feat/22-session-work-tagging

Previous run: 22-p2-2026-11-07

Run: Codex execute skill, run ID 22-p2-2026-11-07
Started: 2026-11-07 10:25:59 UTC
Branch: feat/22-session-work-tagging

Previous run: 22-p1-2026-11-07

## Phase 1 — Action record path

### Unit outcome — `1-01-action-record-path.md`

Built the server action contract and fixture test; structural-only ingest; migration-backed projection state, normalized action rows, and deterministic conversation segments; independent retrying projection; bearer-scoped `/v1/actions`; and admin action counts plus their typed API field. Legacy conversation, hook-event, and facet results exclude `session_action` facts. Surfaces: `packages/yakka/internal/actions`, `internal/ingest`, `internal/store`, `internal/serve`, `packages/yakka-analytics/src/lib/api.ts`, and `docs/design/01-event-model-and-ingest.md`, `docs/design/03-remote-service.md`. Unit commit: `a32e3dc`; runner verification fix: `dc28c4d`.

Evidence from the unit report and runner verification:

- Baseline and final `cd packages/yakka && go test ./...` passed. The final run after the segment-boundary fix passed all packages; `cmd/yakka` took 61.962s.
- Targeted action-path, ingest, store, serve, retry, and API tests passed. In particular, fake-backed serve tests pass with scoring disabled, enabled, and unreachable; projection retries stop at three; a failed projection does not block screening; duplicate ingest is detected; invalid action values project as rejected; and the admin and legacy analytics checks pass.
- Runner verification found that later live rows lacked `segment_start`. The first new assertion failed; the projection now records each subsequent segment's start from its action timestamp. Focused `go test ./internal/store ./internal/serve -run 'Test(Action|SessionAction)' -count=1` and the full suite passed after the fix. Added checks also prove accepted live action over backfill and the latest review replacing the earlier review.
- `artifact_feedback`: the amended brief (version 2) and worker report are `delivered`, each `pass` by jev-1.13.0; no flagged checks.

Departure: the original brief listed `packages/yakka/docs/design/` paths, which do not exist; the corresponding server docs were updated under `docs/design/`. The brief was amended to name the actual paths and its second artifact feedback passed. No other departure. Worker report states no unfinished work. The runtime did not provide per-agent turn/final-context counts.

### Phase verification

Verified the phase outcome through `POST /v1/ingest` → asynchronous projection → bearer-scoped `GET /v1/actions` using the local fake-backed serve tests, and checked the returned normalized accepted/rejected rows and pending count. Store and serve tests prove duplicate handling, deterministic segments (including equal and out-of-order timestamps), source precedence, retry isolation, unchanged legacy analytics, and action status counts. The final full Go suite passed. No live classification, egress, or human review was performed or needed for Phase 1.

### Carried

- User-noted unrelated layout test failure: not reproduced by the baseline or final Go suite; not investigated. Preserve as a known external/unreproduced issue, and do not chase it in later Plan 22 phases unless it blocks their own checks.
- None of the implementation or test contracts needs amendment for the next refinement.

## Phase 2 — Session-start capture on all four harnesses

### Unit outcome — `2-01-session-start-capture.md`

Implemented Claude, Codex, OpenCode and Cursor session-start capture; robust action envelope encoding and the UTF-8 transport guard; tolerant parsing and `session_action` fact construction, including tag-only files; fixtures and tests; docs and plugin version metadata. Cursor's existing `sessionStart` registration was verified and left unchanged. Unit report: `reports/2-01-session-start-capture.md`.

The spool tests passed (7), client fact/config tests passed (22), OpenCode hook tests passed (11), and `git diff --check` was clean. The brief's test names needed correction: the client module is `test_clientconfig` and the npm script is `test:hooks`; the amended brief is delivered and passed artifact feedback (version 2). The worker report is delivered and passed artifact feedback (version 1), with no flagged checks.

### Phase verification

Verified the Phase 2 entry point through the fake queue fixtures and behavior tests: a session-start envelope carrying action fields reaches the Python `Build` step and produces a `session_action` fact alongside normal session facts; an action-only `yakka.session_action` event produces only one action fact; absent, malformed and non-object action values do not reject the queue file; the spool process exits zero and preserves JSON escaping and the over-length UTF-8 guard; OpenCode records one raw action at `session.created`; and setting only `YAKKA_ACTION_*` leaves client config resolution unchanged. Independent reruns passed: `python3 plugins/yakka/script/test_kick.py` (7), `cd plugins/yakka/client && python3 -m unittest test_facts test_clientconfig` (22), `cd packages/opencode-yakka-hooks && npm run test:hooks` (11), and `git diff HEAD^ HEAD --check` (clean).

The real headless probes (`claude -p`, `codex exec`, `opencode run`, `cursor-agent -p`) and per-harness server projection were not run because they can invoke classification or external egress. No real classification, egress or human review call was made. Under the documented-limit path allowed by Phase 2's outcome, the report records all four runtime observations as unverified and makes no runtime support claim. Local fake-backed behavior is verified; safe runtime probes remain a release precondition before CHM relies on launch-time tags from any harness.

Phase 2 closes via its documented-limit alternative; runtime support is not claimed for any harness.

### Carried

- Before CHM relies on launch-time tags from any harness, record hook/plugin execution and exported-variable visibility using a safe, non-classifying and non-egress probe; verify action projection if possible without real egress. Each harness currently has a documented limit in the Phase 2 report.
- The unrelated layout-test failure documented in the design was not rerun or investigated; do not chase it unless it blocks later Plan 22 work.

## Phase 3 — Cost by work

### Unit outcome — `3-01-cost-by-work-query.md`

Extended the in-memory usage query to attribute cost-bearing calls to the projected action segment at each call timestamp. Added the six `action_*` dimensions and filters, distinct-conversation `sessions`, special buckets for untagged and rejected-only conversations, top-N preservation, and HTTP validation for up to three all-action dimensions. Updated `docs/design/03-remote-service.md`. Unit commit: `72531ecd1f80ef29fe335ab98d3b295bcab7438f`.

Seeded coverage exercises action segment boundaries, rejected actions between accepted actions, reconciliation and top-N survival for `(untagged)` and `(rejected)`, `(none)` dimensions, unpriced calls, distinct sessions, filter and measure validation, and the HTTP dimension limit. The no-action HTTP golden remains byte-identical. The unit report's pre-change regression failed because `cost_usd` rejected `action_kind`; after implementation, the complete store and serve suites passed.

`artifact_feedback` for brief `3-01-cost-by-work-query.md` and report `3-01-cost-by-work-query.md` returned `delivered`, screened `pass` by jev-1.13.0 (version 1) for each. The service was initially called with relative paths and returned a path error; the corrected absolute-path calls passed. The runtime did not provide per-agent turn or final-context counts.

### Phase verification

Verified seeded tenant behavior through the `/v1/analytics/query` handler into the usage aggregation and projected action segments. Runner rerun `cd packages/yakka && go test -count=1 ./internal/store ./internal/serve` passed (`store` 5.710s, `serve` 10.658s). `git diff HEAD^ HEAD --check` was clean. These checks cover action bucket attribution and reconciliation, the mid-session timestamp split, special bucket visibility, rejected segment continuity, unpriced calls, distinct sessions, action-field validation, three-dimension HTTP behavior, and unchanged no-action JSON.

Phase 3's fake-backed query implementation is verified. No live classification, egress, private tenant data, real endpoint, or real `harness pick` launch was used.

### Carried

- Cody: verify Phase 3 real-data item 4 in an authorized environment. Message-time versus import-time timestamps for each harness, Phase 2 session cost, and subagent and Cursor counts remain unverified.
- Cody/CHM: after CHM's change lands, verify Phase 3 item 5 with one `harness pick` build launch per harness, accepted `source=env` action rows, and an `action_plan` cost query.
- The unrelated layout-test failure noted in the design remains unreproduced and uninvestigated; do not chase it unless it blocks later Plan 22 work.
