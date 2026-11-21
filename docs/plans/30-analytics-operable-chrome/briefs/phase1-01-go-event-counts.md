# Brief: phase1-01 — Go event-counts API and shared retained-record predicate

Consumer: a Go build worker for Plan 30 phase 1.
Owned paths: `packages/yakka/internal/serve/analytics.go`, `packages/yakka/internal/serve/analytics_query.go`, `packages/yakka/internal/serve/serve.go`, new `packages/yakka/internal/serve/analytics_event_counts.go`, new `packages/yakka/internal/serve/analytics_event_counts_test.go`, new `packages/yakka/internal/store/analytics_event_counts.go`, new `packages/yakka/internal/store/analytics_event_counts_test.go`, `packages/yakka/internal/store/analytics.go`, and only the predicate expectations in `packages/yakka/internal/store/analytics_test.go` / `packages/yakka/internal/serve/analytics_test.go`. Touch nothing else.
Commits: commit to the current branch when done evidence passes, with a plain-summary title. Do not add a `Yakka-Phase` trailer; the orchestrator adds that only on the phase commit.
Report: before committing, write `docs/plans/30-analytics-operable-chrome/reports/phase1-01-go-event-counts.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: `phase1-02-shell-scope` (web paths only; no file overlap).
Budget: about 10 files read, about 700 lines changed, 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

UI DIRECTION (binding): the written DESIGN.md is authoritative and literal. Implement every binding contract exactly as written: V (layout, density, tokens, prohibitions), C (shared controls on every analytics screen incl. detail screens), T (tables and statuses, 30px rows), P (panel controls and caption registry), each G chart catalogue item (exact defaults, units and the literal plain-language caption text, copied verbatim, never paraphrased), each S screen contract, the account contracts and the 'Files and components Executor must change' list. Treat every per-item acceptance check ID the phase outcome names (S1, N1, C1-C11, V1-V5, T1-T5, F1-F7, P1-P10, A1-A6, G and S checks) as a checklist: each needs a test or recorded browser evidence, and the result file must list each ID with pass/fail and evidence. Match the mockup PNG for each screen you touch (layout, order, density, controls, captions, colours); open the PNG and the matching mockups/src/*.html and compare against your own 1440x900 Chromium screenshot of the real implementation. Where the image and the text disagree, the text wins (e.g. production chart minimum height 160px, not the mockups' 112px). Mockup HTML is a visual reference only: never copy its synthetic data or local preview interactions into product code or fixtures. Do not reopen decisions in the Assumption Ledger; no invented scope, no new IAM/attribution architecture, no invites/roles/membership-write API, no lifecycle engine/auth gate changes. Fix failures on our own judgement: diagnose, fix and continue rather than stopping to ask; only a genuine design contradiction is reported as 'design-change: <what>' in the result.

## Required reading, in order

1. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 63–81 — Domain “truthful read contracts”, the full event-counts body, `record_filters`, proof **N1**. This is the binding text.
2. `docs/plans/30-analytics-operable-chrome/DESIGN.md` lines 915–930 — “Files and components Executor must change”, Exact counts row and Proof row.
3. `docs/design/09-analytics-workspace-contracts.md` lines 9–24 and 33–41 — read budget, cursor, deadline/concurrency and capability-schema contracts that do not change.
4. `packages/yakka/internal/serve/analytics.go` lines 25–220 and 238–470 — auth/bounded wrapper, `parseFilter`, `canonFilter`, `errCodeJSON`.
5. `packages/yakka/internal/serve/analytics.go` lines 1015–1091 — current `/explore` handler.
6. `packages/yakka/internal/store/analytics.go` lines 90–360 and 1196–1394 — `AnalyticsFilter`, `factWhere`, `rejWhere`, `ExplorePage`.
7. `packages/yakka/internal/serve/analytics_query.go` lines 20–100 — current `/schema` features and budgets.
8. `packages/yakka/internal/serve/serve.go` lines 560–600 — analytics route registration.
9. Existing tests: `packages/yakka/internal/store/analytics_test.go` (Explore, Summary and rejection cases) and `packages/yakka/internal/serve/analytics_test.go` (filter/Explore endpoint cases). Read only the sections your change affects.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make `/v1/analytics/event-counts` return exact retained-fact, rejection and row totals for the same predicate `/explore` uses, and correct the shared rejection-side predicate for both queries so a session-detail or filtered Explore cannot include another session’s rejections. This is the phase’s N1 server half.

## Contract

Settled by DESIGN.md lines 63–81. Do not reinterpret:

- `GET /v1/analytics/event-counts` returns exactly:
  `{"matched":{"events":8406,"rejections":4,"rows":8410},"tenant_total":{"events":12480,"rejections":9,"rows":12489},"checked_at":"2026-11-21T10:24:00Z","unit":"retained_record"}`
  (numbers are illustrative). All counts are nonnegative integers. `checked_at` is UTC RFC3339.
- `matched.events` is `COUNT(*)` of retained `facts` rows under the request filter, including every stored fact type (`hook_event`, `usage`, `artifact_version`, `commit`, `session_action`, etc.). A stored usage fact counts once. `matched.rejections` is `COUNT(*)` of retained rejections. `matched.rows = events + rejections` and must equal the exact `/explore` UNION population for the same predicate.
- `tenant_total` clears **all** filters including time, repo, kind, exclusions and cohorts, retaining only the authenticated tenant. It includes history after the current window’s end. The matched and tenant-total sets are computed in **one read transaction**.
- The route inherits tenant auth, four-request concurrency, one-second deadline, cancellation and no-silent-truncation from the existing bounded analytics wrapper. Do not add pagination or a cap.
- Filter parsing and predicates are the **same** as `/explore`: time, `repo_id`, `kind`, `harness`, `plan`, event/tool/source/conversation filters, exclusions and supported cohort membership. Reject unsupported predicates with HTTP 400 and code `unsupported_filter`; never ignore them.
- Add `event_counts=true` and `record_filters=true` to `/schema.features` alongside the existing flags.
- Shared retained-record rejection predicate, exactly (DESIGN.md line 75): fact-side fields use existing `factWhere` semantics. Rejection side: time=`at`, kind=`wf_kind(path)`, plan=`wf_plan(path)`, conversation_id=stored `conversation_id`, stage=stored `stage`; `repo_id`, `harness`, `norm_event`, `event`, `tool`, `model`, `source` are **absent and compare as empty strings**. Every include field is OR within its repeated values and AND across fields; a nonempty include cannot match an absent field. Exclusions use the same values, so excluding a nonempty absent value does not exclude a rejection. Cohort membership uses stored `conversation_id`.
- Leave every other rejection-route query (`Summary`, `Series`, distribution/`rejections` metric, `Activity` and any route that today calls `rejWhere`) semantically unchanged. Only `ExplorePage` and event-counts adopt the corrected predicate. Those other routes are phase-2 F-refusal territory.
- Do not add a new endpoint to `/schema` in a way that makes an older server blank; the client capability-detects. You only add the flag on the new server.

## Changes

1. **One store predicate helper.** In `internal/store/analytics.go`, add an unexported method, suggested `func (f AnalyticsFilter) retainedRecordRejWhere() (string, []any)`, next to `rejWhere`. It has the same window (`at >= ? AND at <= ?`, inclusive, nanoseconds), kind (`wf_kind(path)`), plan (`wf_plan(path)`), stage exclusion, cohort membership and absent-string semantics above. It must apply includes and excludes for `conversation_id`, `norm_event`, `event`, `tool`, `model` and `source` as empty-string values, which `rejWhere` currently drops. Keep all include fields ANDed and each field’s values ORed; keep exclude values AND NOT IN per field. Do not invent repo/harness from a session.
2. **Reuse it in `ExplorePage`.** Replace only the `rw, rargs := f.rejWhere()` call in `ExplorePage` (and any rejection subquery inside that function) with the new helper. Do not change `Explore`’s signature or merge/tie order.
3. **Store counts.** New `internal/store/analytics_event_counts.go` with a `Tenant` method returning the two triplets. Open one read transaction (`BeginTx` with a read-only option), run four `COUNT(*)` statements in it — matched facts, matched rejections, all facts, all rejections — and compute `rows` as the sum. Use `factWhere` for matched facts and the new rejection helper for matched rejections; the tenant totals are unfiltered `COUNT(*)` over `facts` and `rejections`. Return an error on any failure; never return a partial object.
4. **Serve handler.** New `internal/serve/analytics_event_counts.go`. Validate the query keys before `parseFilter`: allowed keys are `tenant`, `from`, `to`, `all`, `tz`, `cohort`, `exclude` and the ten shared filter names in `FILTERS`/`parseFilter` (`repo_id`, `harness`, `kind`, `plan`, `norm_event`, `event`, `tool`, `model`, `source`, `conversation_id`). Any other key is 400 `unsupported_filter` with `reason` naming the key; do not silently ignore it. Then call `s.parseFilter(w, r, ts, filterOpts{route: "event-counts"})`, call the store method, and write the exact body. Use one UTC `checked_at` from the same read.
5. **Register and advertise.** In `serve.go`, register `/v1/analytics/event-counts` with `s.method(http.MethodGet, s.auth(s.analyticsEventCounts))` beside the other analytics routes (the `/v1/analytics/` prefix automatically gets the bounded wrapper). In `analytics_query.go`, add `"event_counts": true` and `"record_filters": true` to `features`.
6. **Tests.** New store and serve tests. Cover, with a manifest the test also queries directly:
   - matched event/tenant totals and `rows = events + rejections` on the N1 population: 12,480 facts over multiple years, exactly 8,406 inside the 30-day window, 9 rejections total and 4 in-window;
   - every stored fact type counted (`hook_event`, `usage`, `artifact_version`, `commit`, `session_action`);
   - repo/kind include intersection, repeated-value OR, and exclude behaviour on both facts and rejections;
   - rejection conversation-id include/exclude now applied (a rejection with matching conversation must be included, one with a different conversation excluded); absent rejection fields (`repo_id`, `harness`, event/tool/model/source) never match a nonempty include and are never removed by excluding a nonempty absent value;
   - empty window (matched zero, tenant total nonzero); foreign tenant refusal (403 “no such tenant” through the handler);
   - `unsupported_filter` on an unknown query key;
   - matched.rows equals a full paged `/explore` traversal under the same predicate (page until no `next`, assert the row count equals `matched.rows`);
   - 503 `busy` by occupying the tenant’s `analyticsSlots` before the request, following `analytics_runtime_test.go`’s pattern;
   - `/schema` advertises both new flags.
   Where an existing Explore test encoded the old rejection-side ignore behaviour, update only that expectation and cite DESIGN.md line 75 in the test comment. Do not loosen unrelated Summary/Series/Activity expectations.

### Keep untouched

- `rejWhere` and every other rejection-route caller’s semantics.
- `parseFilter`’s existing validation, cohort resolution and cursor format.
- `exploreCap`, `defaultLimit`, `maxLimit`, deadlines, concurrency and the schema’s existing entries.
- No new table, migration, IAM, attribution or lifecycle code.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `cd packages/yakka && go test ./internal/store -run 'TestEventCounts|TestAnalyticsExplore' -count=1` → new count/predicate tests pass; Explore’s existing order and paging still pass.
- `cd packages/yakka && go test ./internal/serve -run 'TestEventCounts|TestAnalyticsSchema|TestAnalyticsExplore|TestAnalyticsRuntime' -count=1` → handler, capability, unsupported_filter, foreign tenant and 503 tests pass.
- `cd packages/yakka && go test ./internal/store ./internal/serve -count=1` → both packages green.
- Observable: `GET /v1/analytics/event-counts?tenant=<a>&from=<…>&to=<…>` returns `unit:"retained_record"`, nonnegative integer counts, `matched.rows = matched.events + matched.rejections`, and after `?all=1` the matched events equal the tenant’s total retained facts. A `?conversation_id=<id>` read returns only that conversation’s facts and rejections.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
