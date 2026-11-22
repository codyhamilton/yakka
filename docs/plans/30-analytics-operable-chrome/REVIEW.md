# Plan 30 — automation review (PR #311)

- **Reviewed SHA:** `eefdcfc1`
- **Base:** `7c3e129d6e46fe2a12ede19968d3cabd33d33638`
- **Verdict:** `PASS_WITH_FOLLOWUPS`

## Phase outcomes

| Phase | Outcome | Evidence |
| --- | --- | --- |
| Phase 1 — tenant scope, filters, honest totals | **Met** | `go test` event-counts + `plan30`/`legacy-counts` unit suites; scope and event-counts JS units (31 pass). Terminal-review fixes present on branch. |
| Phase 2 — captions, boards, applicability | **Met** | Filter-applicability and pulse-caption units; fix commit `eefdcfc1` for exclude/ignored_filters/Pulse kind-exclusion gating. |
| Phase 3 — account console, lifecycle link | **Met** | Identity contract tests; lifecycle profile Go tests; `3b98d2ff` refuses silent tenant substitution on lifecycle page. |

## Findings

### Resolved in this review (committed on branch)

| Sev | Finding | Resolution |
| --- | --- | --- |
| high | `exclude` query values treated as a synthetic filter name, refusing all applicable panels | `eefdcfc1` — excludes count as their dimension in applicability. |
| high | Rhythm panel omitted `repo_id`, refusing repository-scoped heatmap | `eefdcfc1` — `repo_id` declared on rhythm measure. |
| medium | Lifecycle page substituted another owned tenant when URL tenant was foreign/inactive | `3b98d2ff` — explicit refusal UI, no silent substitution. |
| medium | Server-listed `ignored_filters` still drew marks client-side | `eefdcfc1` — those names refuse with literal caption. |
| medium | Pulse kind *exclusion* did not gate priced/hook cells | `eefdcfc1` — gate on exclusion as well as include. |
| low | Unapplicable exclude dimensions returned 500 on counts/explore | `3b98d2ff` — `400 unsupported_filter`. |
| low | Event-count responses cacheable | `3b98d2ff` — `Cache-Control: private, no-store`. |
| low | Lifecycle link accepted non-http(s) API base | `3b98d2ff` — http(s) only for reset/delete href. |
| low | Mechanical dead branches / wrong guards in chrome modules | `5f0db01d` — scope, event-counts, account-console, artifact cleanup. |

### Follow-up (non-blocking)

| Sev | Finding | Tracking |
| --- | --- | --- |
| medium | `globalOverrideValue` treats multi-value repo/kind as absent; panel override can replace global filter | Brief for follow-up; behaviour edge case with workarounds (Apply bar). |
| low | Some panels still omit HTTP status mapping for 401/403 | Existing issue backlog (#318–#330 family). |
| low | Event-count cache key does not refetch on filter-only in-place panel update | Acceptable; generation bump on commit covers primary flow. |
| low | Production signed-in gates, deploy, real lifecycle writes | Documented in plan record; not automatable here. |

## Intent and ledger

Implementation matches the collapsed plan record (`docs/plans/30-analytics-operable-chrome.md`): reserved tenant field, draft/Apply filters, capability-gated counts, caption registry with refusal not silent drop, account console on session APIs, lifecycle on API origin unchanged in authority.

**Plan sufficiency:** Sufficient for review and QA; close-out promotion into `docs/design/09-analytics-workspace-contracts.md` is present.

## Residual risks

Pre-existing `tests/trends-quality/cost.test.mjs` failure and stale `tests/e2e/*.spec.ts` remain outside Plan 30 evidence. Chromium acceptance suites were not re-run in this VM (browser cache absent); unit and Go suites were re-run on `eefdcfc1`.