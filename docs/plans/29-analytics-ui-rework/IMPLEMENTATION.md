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

- **phase1-06-capability-parity** — closed `dd326cdb`. One retained-plus-active per-kind union (`artifactChecks`) now feeds `/schema.checks_by_kind`, `/scores`, score-by-lens and score-series outputs; `/schema.resolutions.routes["score-series"] = {buckets:["day","week","month"], auto:false}` is authoritative while legacy global flags remain; `/score-series` accepts only day/week/month (400 `unsupported_resolution` + `supported_buckets`), drops the old range-wide refusal, and enforces an explicit `max_cells` budget (400 `too_many_cells` + `max_cells` and a fitting `suggested_bucket` or `suggested_action`); session scatter publishes and serves `commits`/`unpriced_calls`. New parity tests fail against HEAD handlers via `go test -overlay` and pass after; score/query regressions, `gofmt` and `go vet` pass. Orchestrator follow-up: `d783d85d` re-pinned the page-set served/refusal split from 61/14 to 65/10 (the four previously refused reads now serve) after `TestAnalyticsPageSetSmoke` reproduced the change. Report: `reports/phase1-06-capability-parity.md`.

- **phase1-03-schema-adapter** — closed `ac0346c2` (the original worker died on a permission prompt after its checks, before its report; a fresh finisher inspected the uncommitted work, re-ran every check and wrote the report, making no code repairs). New `core/schema-adapter.js` is the single idempotent, non-throwing boundary: grain measures/lenses become name arrays with `measure_metadata`/`lens_metadata`, while `modes`, `scatter_fields`, `aggregate_fields`, `aggregate_dimensions`, `resolutions` and every other key survive. `transport.schema` keys by tenant and caches only successful adapted schemas (`invalidateSchema` exported); registry/`p10-shared`/capability-inspector read names/metadata; `PANEL_STATES` gains `unauthorized`/`busy`/`timeout` with `stateFromResponse` and a stricter `classifyResult`; `panel-frame` renders/retries each state; `app.js` keeps navigation/route rendered on schema failure and offers a fresh read. `schema-adapter`/`error-containment` specs pass (2/2, 1/1), `engine`+`degradation` 10/10, harness+read-context 2/2. `legacy-error.js` needed no change; mode-specific chooser lists are left to phase1-04. Report: `reports/phase1-03-schema-adapter.md`.

- **phase1-07-plan-conversation** — closed `0dba931e` (done with concerns: the fixture associates plan-a under repo-a only with `sess-alpha`, so its event set is four facts, not six). `PlanAssociatedCost` now clears identity `Repos` and `Plans` while keeping explicit association args and genuine filters; `PlanEntitiesPage` uses the same clearing for associated cost/unpriced source; `PlanDetailCount`/`PlanDetailPage` share one event predicate with no outer raw `repo_id`, selecting the plan's associated artifact sessions and preserving keyset/order. `ConversationEvent` gains `ToolKind` from the existing `toolKindExpr`, and every serialized event carries `tool_kind` (including `""`). New association and plan/conversation parity tests fail before (`cost <nil>`, event count 1, no `tool_kind`) and pass after (cost 0.10, 4 events with usage hook, `Read→read`, `Bash→shell`); `TestPlan|TestConversation` and `TestAnalyticsPlan|TestAnalyticsConversation` regressions pass; `gofmt`/`go vet` clean. Report: `reports/phase1-07-plan-conversation.md`.

- **phase1-04-field-validity** — closed `81a94a7c`. Movers derives split lenses from the time grain/measure dimensions and uses raw `model` (never `dim=session_model` on `/query`); session scatter axes/chooser use `scatter_fields` (default `cost_usd` vs `commits`, size `unpriced_calls`, with an older-schema fallback); score strips request only `score:<check>` numeric fields, group by returned `l`/`l.kind`, and use the same-kind catalogue; score trend uses `schema.resolutions.routes['score-series']` (known day/week/month fallback, no inferred global auto), removes the hardcoded day metadata, and renders `unsupported_resolution`/`too_many_cells` without changing the URL/window; artifact scatter and rank use published per-mode lists/dimensions. New `field-validity` spec fails 5/6 before and passes 6/6 after; scatter+quality 23/23, pulse+regression 36/36, all plan29 11/11, trends acceptance+cost 14/14. Deviation: one `tests/workspace/pulse.test.mjs` assertion `session_model`→`model` encoded the old invalid D05 request and was updated. Report: `reports/phase1-04-field-validity.md`.

Refinement feedback: the first `artifact_feedback` pass returned `local context unavailable: queue (invalid_context)` for all seven briefs. Retried after delivery: all seven briefs and all seven reports now report `state: delivered`, `screen: pass by jev-1.13.0`; scoring is off on the service, so no scores were returned.

First-refinement coarse check: Phase 2 and Phase 3 surfaces, contracts and outcomes are locatable in `DESIGN.md`/`EVIDENCE.md`, and their dependency on Phase 1 is real; no briefs were written for them.

### Orchestrator follow-up: fixed all-history `to`

Closed `f1f04805`. The integration sweep found all-history reads that sent `all=1` without the frozen `to` upper bound. Fixed in `web/js/core/read-context.js` (All resolves `to` before the `from`/`to` branch), `web/js/panels/p10-shared.js` and `web/js/panels/pulse-strips.js` (All keeps `scope.to`), `web/js/panels/rank.js` (plan rank list keeps `scope.to`), `web/js/app.js` (each board entry receives the read-context `from`/`to`), and `web/js/explorers/plans.js` (plan detail `windowParams` referenced an undefined `resolved`; detail builders and the plan scatter now receive the frozen read-context window). `tests/plan29/read-context.test.mjs` now asserts the Plans scatter and Workflow plan requests keep the fixed `to`.

### Verification

- Real-Go two-tenant browser sweep (runner-only `.scratch/plan29-verify/sweep.mjs`, 29 board/explorer paths including every `?win=all` variant, session detail, and plan detail): **0 failures of 29**; every path settled, every analytics request carried the selected tenant, no request carried `win`, every `all=1` request carried `to`.
- `go test ./internal/store -count=1` pass; `go test ./internal/serve -run 'TestAnalytics(PageSetSmoke|CapabilityParity|PlanConversationParity|EmptySchema)' -count=1` pass (176.7s); full `go test ./internal/serve -count=1` pass (210.3s); `go vet ./internal/store ./internal/serve` clean. `gofmt -l` reports one pre-existing untouched file, `internal/serve/mcp_discovery_limits.go`.
- Node: all `tests/plan29/*.test.mjs` pass (including the new all-history assertions); `tests/workspace/pulse.test.mjs`, `tests/trends-quality/{acceptance,cost,quality}.test.mjs` and `tests/scatter-sessions/scatter.test.mjs` pass.
- Read-only production parity probe (trial tenant `t-60d108478da4`, no writes): deployed `/schema` serves 200; deployed `/score-series?bucket=auto` still returns 400 `bucket must be day, week, or month` (no `supported_buckets`), and deployed session scatter still returns 400 `unsupported session scatter field commits`, confirming the D06/D08 behaviour is still in production. Deployed-canvas white sampling was not attempted because the UI session gate needs an interactive `/v1/me` session and the trial token is an API key, not a browser session.
- `gate: production parity canvas sampling needs an authenticated deployed UI session`.

Phase 1 status: closed (2026-11-21 02:29 AEST). Commit trailer `Yakka-Phase: 29-analytics-ui-rework:1`.

## Phase 2 — refinement

Refined 2026-11-21 from the Phase 2 outcome and the retained-analytics contract. Five units in two waves; Units list is in `DESIGN.md` § Phase 2 Units. No product code changed in this run.

| Unit | Brief | Wave | Depends on |
| --- | --- | --- | --- |
| phase2-01 | `briefs/phase2-01-retained-workload.md` | 1 | — |
| phase2-02 | `briefs/phase2-02-plan-reads.md` | 1 | 01 (performance table) |
| phase2-04 | `briefs/phase2-04-multidim-treemap.md` | 1 | 01 (performance table) |
| phase2-05 | `briefs/phase2-05-artifact-bands.md` | 1 | 01 (performance table) |
| phase2-03 | `briefs/phase2-03-conversation-distribution.md` | 2 | 01, 02 (shared `analytics_entities.go`) |

- **Carried items placed.** All-zero `commits`/`unpriced_calls` session-scatter marginals → `phase2-03` (new whole-population session marginal path; `/distribution`'s public measures unchanged). REVIEW.md's unverified SQLite interrupt/deadline behaviour → `phase2-01` cancellation test under the retained workload. D18 `$0.10` mixed-attribution acceptance → required green check in `phase2-02`, not re-implemented. The cell-budget residue is not a unit; see the decision below.
- **Cell-budget decision (phase1-06 residue).** No pre-query cell bound is added in Phase 2. The contract defines a cell as a returned bucket × returned series/check group, which is only known after aggregation; the existing guard therefore bounds the response, not the scan. Window-independent work remains bounded by the unchanged one-second deadline, the query row cap and SQL aggregation; a pre-query refusal would risk rejecting a request whose aggregation fits. Phase 1's session-scatter sample is already a server-side `LIMIT` (`min(population, 5000)`), so only the score-series cell refusal is post-aggregation. This is recorded rather than silently ignored; no clipping, no deadline change.
- **Measurement.** `phase2-01` writes the committed workload record (`packages/yakka/internal/serve/testdata/retained-workload.json`) and report; it commits the pre-fix baseline. The orchestrator reruns the prepared-ledger measurement after wave 2 and cites the refreshed record here. The opt-in real-ledger path is `YAKKA_RETAINED_LEDGER=<prepared-copy-dir>`; large test data stays under the worktree's ignored `.scratch/plan29-phase2/`, never `/tmp`.
- **Kickoff split.** `phase2-01`'s full prepared-ledger run is expected to exceed ten minutes; the brief permits the orchestrator to split preparation/handoff from a fresh verification run.
- **Feedback.** All five briefs returned `state: delivered`, `screen: pass by jev-1.13.0`. Scoring is off on the service, so no scores were returned.
- **Refinement verdict.** Proceed: five units, maximum four in parallel in wave 1, `phase2-03` after `phase2-02`. No design bounce.
- **Gates.** `gate: none`. The diagnostic ledger is local and read-only; no secret, deployment or external system is required.


## Phase 2 — Retained history is queryable and correct at useful latency

- Tool: OpenCode `opencode run` — model `opencode-go/deepseek-v4.1-flash`; build orchestrated in worktree `/home/codyh/workspace/yakka-build/29`
- Start: 2026-11-21 03:00 AEST (Australia/Brisbane, UTC+10)
- Branch: `feat/29-analytics-ui-rework`
- Design baseline: `e5052a43`; Phase 1 closed `f5fe52fd`; Phase 2 refinement `4f65947d`
- Units and waves: see `DESIGN.md` § Phase 2 Units.

