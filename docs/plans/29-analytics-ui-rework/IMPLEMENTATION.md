# Implementation — Dense analytics UI and evidence-led data repairs (plan 29)

- Tool: OpenCode `opencode run` — model `opencode-go/deepseek-v4.1-flash`; Phase 1 retry orchestrated in worktree `/home/codyh/workspace/yakka-build/29`
- Start: 2026-11-21 00:06 AEST (Australia/Brisbane, UTC+10)
- Branch: `feat/29-analytics-ui-rework`
- Design baseline: `e5052a43` (design PR #280); design artifacts `DESIGN.md`, `EVIDENCE.md`, `REVIEW.md`

## Phase 1 — Every read represents the selected question

Units and waves: see `DESIGN.md` § Phase 1 Units.

| Unit | Brief | Wave | Depends on |
| --- | --- | --- | --- |
| phase1-01 | `briefs/phase1-01-real-go-two-tenant-harness.md` | 1 | — |
| phase1-02 | `briefs/phase1-02-read-context.md` | 1 | 01 (browser evidence) |
| phase1-05 | `briefs/phase1-05-coverage.md` | 1 | — |
| phase1-03 | `briefs/phase1-03-schema-adapter.md` | 2 | 01, 02 |
| phase1-06 | `briefs/phase1-06-capability-parity.md` | 2 | — |
| phase1-04 | `briefs/phase1-04-field-validity.md` | 3 | 01, 03, 06 |
| phase1-07 | `briefs/phase1-07-plan-conversation.md` | 3 | 01, 06 |

- **phase1-05-coverage** — closed `afde1561`. `AnalyticsCoverage` zero-coalesces the empty-session `SUM` aggregates (empty tenant `/schema` 200 instead of 500 `read failed`), returns per-fact-type event-seconds and receive-nanosecond bounds, adds a separate `usage` recency entry (null when absent) and explicit `units`; `facts` stays an empty object. `go test ./internal/store -run 'TestAnalyticsCoverageEmpty'` and `./internal/serve -run 'TestAnalyticsSchemaEmptyTenant'` fail before and pass after; `go test ./internal/store -run 'TestAnalytics|TestCoverage'` and `./internal/serve -run 'Analytics'` pass. Go 1.27.1 via `GOTOOLCHAIN=auto`; `gofmt -l` clean. Deviation: brief's commit line overridden by the orchestrator's uncommitted-handoff instruction. Report: `reports/phase1-05-coverage.md`.
- **phase1-01-real-go-two-tenant-harness** — closed `b10d5eb7` (done with concerns: brief's `tenant=plan29-a` and `/start` assumptions did not match the product). New test-only `//go:build plan29harness` real remote-auth Go fixture with two route-created owned tenants (a seeded, b empty), `$0.10` empty-raw-repo usage, artifacts/scores/legacy check, tool rows, recency ordering; Node harness serves `web/` with the declared CSP and proxies `/v1/`, and a Chromium smoke passes. `node --test tests/plan29/harness.test.mjs` fails before (missing file) and passes after; without the tag `go test ./internal/serve` excludes the fixture. Deviations: tenant IDs are opaque (name→id resolved in helpers), Start is `/`, Start mounts no panel frames, login's `EnsureDefaultTenant` creates an unused `default` that is never selected, and cleanup group-signals the Go child. Report: `reports/phase1-01-real-go-two-tenant-harness.md`.

- **phase1-02-read-context** — closed `f0d18951`. New `web/js/core/read-context.js` resolves one `{tenant, tz, scope, window}` per render from a single captured `now`: relative windows become absolute `from`/`to`, All becomes `all=1&to=<frozen>`, and `win` is never sent. Tenant now rides Ledger first/more/schema, Sessions first/more/schema/detail, Plans first/more/detail, artifact content and `/v1/baselines`, with tenant in baseline/text/band cache keys; Pulse summary/previous, design quality headline and Coverage share the scope; Coverage converts event seconds and receive nanoseconds explicitly, shows per-fact-type bounds, latest event/age, separate latest usage, range, scored hashes and repo attribution, and an empty finite window offers an explicit All-history action. `plan29/read-context.test.mjs` fails before on the first tenant-less Ledger request and passes after; `ledger`/`plans-list` 26 pass, `workspace/pulse` 13 pass. Deviations: `fetchConversation` lives in unowned `session-lanes.js`, so tenant is passed at the `sessions.js` call sites; the all-history empty cause lives in Coverage's empty branch. Report: `reports/phase1-02-read-context.md`.

Refinement feedback: `artifact_feedback` returned `local context unavailable: queue (invalid_context)` for all seven briefs. Recorded as queued, not scored; refine continued.

First-refinement coarse check: Phase 2 and Phase 3 surfaces, contracts and outcomes are locatable in `DESIGN.md`/`EVIDENCE.md`, and their dependency on Phase 1 is real; no briefs were written for them.

Phase 1 status: not started; the orchestrator builds and closes it.

