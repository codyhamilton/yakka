# Plan 30 — Implementation record

Run identity: tool opencode (`opencode run`, deepseek-v4.1-flash coordinator), Plan 30 driver run (session ID not exposed by the harness), start 2026-11-21 21:19 AEST. Worktree `/home/codyh/workspace/yakka-build/30`, branch `feat/30-analytics-operable-chrome`. Design source: `docs/plans/30-analytics-operable-chrome/DESIGN.md` (design PR #310 merged at 7c3e129d).

## Phase 1 — A selected tenant and filter set means one visible query with honest totals

Refined into four units by `refine` (commit `e8f91833`):

| Unit | Brief | Depends on | Wave |
|---|---|---|---|
| U1 — Go event-counts API and shared retained-record predicate | `briefs/phase1-01-go-event-counts.md` | — | 1 (parallel) |
| U2 — Shared shell, reserved tenant scope and count strip | `briefs/phase1-02-shell-scope.md` | — | 1 (parallel) |
| U3 — Pulse/Ledger honest denominators, observations and T1–T4 states | `briefs/phase1-03-pulse-ledger.md` | U2 | 2 |
| U4 — Real-Go two-tenant fixture and Chromium Phase 1 proof | `briefs/phase1-04-proof-harness.md` | U1, U2, U3 | 3 |

### Unit outcomes

- **U3 — phase1-03-pulse-ledger** (commit `57fe6345`): exact Ledger denominator/state/paging helpers and T1–T4 rows, footer population from the current-generation count snapshot, `Load more events`/`Loading…`/`Retry next page`, All history/Reset filters through the router, River `{loaded} observations displayed of {cohort_n} matching observations` with literal G-activity caption, opt-in `renderStatus:false`, CSS. Unit tests 12 pass; Pulse 13 pass; 20k Ledger paging and empty/error Chromium pass. **Open fix:** brief put the Ledger denominator in the footer; DESIGN line 79 and S-ledger require it above the table. Move above the table in verification (brief error, not a design change).
- **U2 — phase1-02-shell-scope** (commit `aa88b120`): V1/V5 shell (46px identity row with 260px tenant select and Theme, two 32px nav rows), reserved `tenant` URL field with strict authorized-tenant precedence, tenant-change generation teardown/cache invalidation, C1–C11 native scope controls with draft/Apply and custom DST validation, `createEventCountStrip`/`currentEventCounts()` with exact loading/success/error/legacy text, V1–V5 CSS and 30px row base. Unit tests 19 pass; Plan 29 read-context/harness 2 pass serially; workspace shell 17 pass; Chromium measurements 46/32/32/32/44/32px and main 0/12/1416. Deviations recorded: kept a text-only `.scope-bar` for existing done-evidence tests (no chips), capability-gated facets, top-nav hrefs without query (tenant persists via canonical `tenant` + storage), Follow has no new-data refresh event. Known harness race outside owned paths (Plan 29 parallel scratch dir).
- **U1 — phase1-01-go-event-counts** (commit `80814ac4`): `GET /v1/analytics/event-counts` plus store `Tenant.EventCounts` (four `COUNT(*)` in one read transaction), the shared `retainedRecordRejWhere` predicate reused by `ExplorePage`, `event_counts`/`record_filters` schema flags, and store/serve tests (N1 12,480/8,406 facts, 9/4 rejections, all five fact types, Explore traversal reconciliation, unknown key 400, 503, foreign-tenant 403). `go test ./internal/store ./internal/serve` green; `go vet` clean. No deviations from contract; `Summary`/`Series`/`Activity` rejection semantics unchanged.

- **U4 — phase1-04-proof-harness** (commit `96b946c0`): real-Go `plan30harness` fixture (two disjoint tenants, tenant A 12,480 facts / 8,406 in-window / 9 rejections / 16 in-window activity observations, tenant B disjoint), `tests/plan30/harness.mjs`, `phase1-acceptance.test.mjs`, `legacy-counts.test.mjs`, and `reports/phase1-04-proof-harness.md`. First attempt died on a fixture activity mismatch (17/24 vs 16/23); retry corrected the fixture and ran the real Chromium/Go suite. Acceptance surfaced five product findings: `C7-compare` (Reset drops `cmp=period`), `C7-default-chips` (removable default window chip), `C11-cohort-scope` (cohort scope inherits `tz:null`), `C11-pick-sel` (advanced-row removal leaves `pick`/`sel`), `C11-cohort-request` (cohort/facets requests rejected 400). Ledger denominator placement remains open from U3. Fixer and re-verification follow.

- **Phase 1 fixes and verification** (commit `a80e59e3` plus the cohort-scope closing commit): default scope chips are non-removable, Compare Reset reasserts `cmp=period`, every advanced-row removal clears `pick/sel`, cohort scopes use a real IANA timezone and only source-grain lenses (Ledger static schema falls back to the server table), facets send only the frozen window and timezone, and the Ledger population sits above the table. Real Chromium/Go acceptance: **21/21 pass** (`S1, N1, C1–C11, V1/V4/V5, T1–T4`, screenshots, legacy counts); focused node 27/27; Go serve/store pass. Full per-ID evidence, screenshot comparisons and the unchanged Plan 29 regression are in `reports/phase1-05-verification.md`.

### Verification

Phase 1 verified at `2026-11-22 00:20 AEST` with the real-Go two-tenant fixture and real Chromium. Every Phase 1 outcome ID passes; see `reports/phase1-05-verification.md` for the per-ID table, evidence, 1440×900 screenshot/mockup comparisons, and the two signed-in production gates. Plan 29 phase-3 acceptance remains 5/5 pass/fail on its pre-Plan-30 responsive measurements; no Plan 29 file changed.

Carried: full S-start table, Pulse/Trends board layouts and the nine-column S-ledger contract remain Phase 2, as assigned by the unit briefs. Signed-in production checks are gated.

## Phase 2 — Every board and explorer answers its displayed question in plain language

Refined into twelve units by `refine` (commits `f732556e`, wave-dependency fix `dce3ad93`):

| Unit | Brief | Depends on | Wave |
|---|---|---|---|
| U1 — Shared caption, filter applicability and panel-view infrastructure | `briefs/phase2-01-shared-caption-applicability.md` | — | 1 |
| U2 — Board assembly order, Start tables and shell wiring | `briefs/phase2-02-board-order-start.md` | — | 1 |
| U3 — Pulse and activity panels | `briefs/phase2-03-pulse-activity.md` | U1 | 2 |
| U4 — Trends and Cost time-series, rank and treemap | `briefs/phase2-04-trends-cost-time.md` | U1, U2 | 2 |
| U5 — Distribution and Compare panels | `briefs/phase2-05-distribution-compare.md` | U1, U2 | 2 |
| U6 — Quality score panels | `briefs/phase2-06-quality.md` | U1, U2 | 2 |
| U7 — Scatter panels | `briefs/phase2-07-scatter.md` | U1, U2 | 2 |
| U8 — Plans, Sessions and Event ledger lists | `briefs/phase2-08-explorers-list.md` | U1, U2 | 2 |
| U9 — Plan and session detail screens | `briefs/phase2-09-plans-session-detail.md` | U1, U2, U8, U11 | 4 |
| U10 — Artifact and Operations screens | `briefs/phase2-10-artifact-ops.md` | U1, U2 | 3 |
| U11 — Tools and Workflow boards | `briefs/phase2-11-tools-workflow.md` | U1, U2, U3, U4, U7 | 3 |
| U12 — Phase 2 acceptance harness and proof | `briefs/phase2-12-proof-harness.md` | U1–U11 | 5 |

Units ran sequentially in this single shared worktree to avoid concurrent Git-index and moving-tree test races; dependencies and ownership stayed exactly as refined.

### Unit outcomes

- **U1 — phase2-01-shared-caption-applicability** (commit `d8d001dd`): new `panels/captions.js` (sixteen family templates, controlled label dictionary, explicit unregistered-caption refusal), new `core/filter-applicability.js` (measure-dimension intersection, response `ignored_filters`, exact F sentence, alphabetical labels), one applicability classification in `panel-state`, optional `caption`/`applies`/`filterExceptions` in the registry, caption slot plus no-marks refusal and `Edit filters` in `panel-frame`, `mountPanelViews` chart/table local toggle in `p10-shared`, explicit-column and `select:false` support in `charts/table`. New unit tests 13 pass; engine + activity regression 14 pass; all operable-chrome 37 pass. Deviation recorded: applicability auto-applies only to panels that declare `applies`/`scopeFilters`; panel modules adopt it in their own units. No gate.

## Phase 2 — Every board and explorer answers its displayed question in plain language

Refined into twelve units by `refine` on 2026-11-22:

| Unit | Brief | Depends on | Wave |
|---|---|---|---|
| U1 — Shared caption, filter applicability and panel-view infrastructure | `briefs/phase2-01-shared-caption-applicability.md` | — | 1 (parallel) |
| U2 — Board assembly order, Start tables and shell wiring | `briefs/phase2-02-board-order-start.md` | — | 1 (parallel) |
| U3 — Pulse and activity panels | `briefs/phase2-03-pulse-activity.md` | U1 | 2 (parallel) |
| U4 — Trends and Cost time-series, rank and treemap | `briefs/phase2-04-trends-cost-time.md` | U1, U2 | 2 (parallel) |
| U5 — Distribution and Compare panels | `briefs/phase2-05-distribution-compare.md` | U1, U2 | 2 (parallel) |
| U6 — Quality score panels | `briefs/phase2-06-quality.md` | U1, U2 | 2 (parallel) |
| U7 — Scatter panels | `briefs/phase2-07-scatter.md` | U1, U2 | 2 (parallel) |
| U8 — Plans, Sessions and Event ledger lists | `briefs/phase2-08-explorers-list.md` | U1, U2 | 2 (parallel) |
| U9 — Plan and session detail screens | `briefs/phase2-09-plans-session-detail.md` | U1, U2, U8, U11 | 4 (parallel) |
| U10 — Artifact and Operations screens | `briefs/phase2-10-artifact-ops.md` | U1, U2 | 4 (parallel) |
| U11 — Tools and Workflow boards | `briefs/phase2-11-tools-workflow.md` | U1, U2, U3, U4, U7 | 3 |
| U12 — Phase 2 acceptance harness and proof | `briefs/phase2-12-proof-harness.md` | U1–U11 | 5 |

Phase 1 Carried placement: U2 owns the full S-start table; U3/U4 own the Pulse/Trends board layouts; U8 owns the nine-column S-ledger. No new Carried item was introduced.

`artifact_feedback` (jev-1.13.0) delivered and screened every Phase 2 brief and this phase record as `pass`; scoring is not configured on the service. One shape note was resolved in the brief rather than the design: G-sessionlanes' chart table (event/plan/conversation/session cost) and S-session-detail's full-width records table (time/type/repo/path/cost) are different column sets; U9 configures both explicitly instead of choosing one silently.
- **U2 — phase2-02-board-order-start** (commit `843d2a70`): exact eight preset panel orders (Pulse metrics first), G-item specs with literal `scope.captionKey` (stripped from wire scope), prescribed full-width/odd-final `data-span` assembly, Start semantic Question-paths table (140/380/remaining) and Saved-boards table (300/80/80/remaining), Compare `Comparison` select writing `cmp` and each `pN.scope.cmp` in one push, two-column 704px grid with 8px gap, 30px rows, no coverage strip on Start or boards. New board-order unit test plus updated Start test: 7/7; all operable-chrome 41/41. Reported out-of-owned follow-ups: `pulse.test.mjs` old order (U3), `acceptance.test.mjs` saved-board selector/tenant and stale `clientPlot` helper (verification fixer), pre-existing `cohort-compare` failure.
- **U3 — phase2-03-pulse-activity** (commit `2c021ee2`): River, Pulse metrics, movers, calendar and coverage register the literal G captions, render prescribed chart/table through `mountPanelViews`, and refuse unsupported active filters before any read with the exact F sentence; River defaults to its observation table, metrics fixes seven cells/all-history previous, movers fixes cost/model order, calendar labels the daily heat matrix, coverage is one tenant-metadata table; CSS enforces 30px rows and the 160px chart minimum. `pulse.test.mjs` updated to the metrics-first order: 31/31 across pulse/trends. Concerns recorded for verification: `tests/plan30/phase1-acceptance` N1 still selects `.activity-caption` (caption moved to `.workspace-panel-caption`), and `tests/workspace/acceptance` still asserts superseded river/movers/coverage shapes. Deviation: owned panels remove the inner `.p10-views` `data-panel` duplicate after mount.
- **U4 — phase2-04-trends-cost-time** (commit `8ae2adff`): trend-columns/lines/multiples, rhythm, rank and treemap now select the eleven literal G captions by `scope.captionKey`, fix their defaults/choosers (cumulative removed with the exact refusal and Choose columns action), render the prescribed long-format tables, use `mountPanelViews`, pre/post F refusal with zero marks and 160px chart height. The compare/previous and plan-rank language is kept. Named unit test: 29/29 across trends/cost/rank; Compare 8/8. Concerns for the fix pass: G-multiples shared Y domain and G-complines dashed previous series need `charts/scales.js`/`yk-chart` support outside the unit's owned paths; unowned acceptance tests still assert superseded table shapes.

- **U5 — phase2-05-distribution-compare** (this run, over budget): the three distribution panels select the six literal G captions by `scope.captionKey` and fall back to the P10 template when measure/grain/group/comparison mode no longer matches; `distributionSpec` resolves Grain/Group by from `scope` then the top-level spec then the per-item default; P4 intersects `DIST_MEASURES`/`DIST_DIMS` with `/schema` in registry order, keeps an incompatible group visible/disabled, and refuses an invalid call+session lens; tables use the exact G columns and group-asc/current-before-previous order, with `unpriced` stated once per group/period; F2 and the other unsupported filters are checked before the read and on `ignored_filters` with zero marks; Compare refuses all history with the exact finite-window sentence and adds the shared-boundary note to Data details. Named tests: 25/25 (new unit 6, compare/cohort 19); cost.test 7/8 and trends acceptance 3/6 still assert superseded table shapes. Deviations: G-comphist grouped current/previous bars render as paired small multiples because `yk-ranges` histogram is single-series and `charts/*` is out of scope; previous dashed/outlined styling for G-compranges/G-compecdf also needs chart support. Ran past the ~450-line budget (~790 lines including the new test); no handoff blocker.
- **U5 — phase2-05-distribution-compare** (commit `d4518d6c`): distribution panels now carry the six literal G captions, P4 grain/group/measure handling, the F2 zero-read refusal for unsupported kind, long-format range/histogram/ECDF tables and V3 tokens; Compare shows current/previous within the finite-period contract. Named tests 25/25, board order 4/4, 1440×900 browser check clean. Over budget (~790 lines). Concerns for the fix pass: G-comphist uses paired small multiples instead of grouped current/previous bars, previous dashed/outlined styling needs chart support, and unowned cost/trends acceptance tests still assert superseded table shapes.
- **U6 — phase2-06-quality** (commit `3370b9ae`): score-ranges/score-trend/score-strips/band-mix register the literal G captions, P5 Check/Scorer/Group-by controls, normalized 0–1 units, exact 11-column ranges table, content-version weighting, file-weighted strips, published band order, the all-history baseline label/band and multi-kind refusal; `mountPanelViews`, 160px charts. New/rewritten tests 14/14; all operable-chrome units 74/74; 1440×900 browser checks pass. Over budget (~1,037 lines). Chart-kit limitations recorded for the fix pass: dashed quartile lines, horizontal band stacking and per-panel status tokens in `yk-bars`; unowned trends acceptance test still asserts old P5 controls/copy.
- **U7 — phase2-07-scatter** (commit `9b2f5479`): the four scatter panels and shared marginal helper now use the literal G captions, P6 axis/size/colour handling, whole-population marginals, equal-size rule, incomplete-bucket marking and exact tables; 34/34 named tests. Over budget (~942 lines). Reported preset contradiction for verification: `p11-scatter.js` presets `session_model` colour where the unit read G-dayxy as colour None; panels honoured the explicit preset.
- **U8 — phase2-08-explorers-list** (commit `a6262853`): S-ledger nine-column table with exact caption/no Select and exact Open destinations; S-plans table-only with eleven columns/widths, contract measures, default `associated_cost_usd:desc`, sort URL round-trip; S-sessions thirteen columns including Select, contract measures, default `cost_usd:desc`, scoped Open; T1–T4 in-table states, next-page retry, 1416px internal scroll, 30px single-line rows. Owned suite 49/49; plan-detail regression 10/10; browser widths/row/paging checks pass. Out-of-scope old-shape acceptance suites listed in the report for the verification fixer.
- **U10 — phase2-10-artifact-ops** (commit `54d4a89e`): S-artifact exact identity form/strip, version table widths, newest/hash/compare URL, immutable Show-diff reads, complete plain-text viewer and F5 outside-filter notice; artifact-content complete-bytes hint; S-ops four fixed health rows with exact sources/notices, keyset-paged recent retained records with no reason column, exact-tenant admin footprint with binary bars and 403 text; 30px rows and 12/18 monospace viewer. Owned tests 51/51. Remaining failures are the unowned `tests/workspace/acceptance.test.mjs` old shapes plus one stale footprint retry expectation, assigned to the verification fixer.
- **U11 — phase2-11-tools-workflow** (commit `444b375e`): G-mix fixed to hook_events by tool category × harness with its literal caption and long-format table; G-shapes exact seven columns, unreported DESC/identity ASC, top-12 label and status tokens with P7 Plan-only; G-planline one plan lane with event-time order, exact columns, served plan list/unreported order, global-then-local plan precedence and T2 empty state. Named tests 25/25. Departure for the fix pass: `yk-bars` draws stacked bars vertically, not the G-shapes horizontal stacked form; values/order/table match. Pre-existing `cost.test.mjs` distribution failure reproduces at HEAD.
