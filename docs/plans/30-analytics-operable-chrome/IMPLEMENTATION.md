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

### Verification

(Populated at phase close: every Phase 1 check ID with evidence, plus 1440×900 screenshot/mockup comparisons.)

Carried: none.
