# Review — Plan 20 Phase 6 design clarification (docs)

Verdict: **PASS**

Reviewed SHA: `e18b1c40c5fda0c3d16a935c62d2a7a1ee1079ce` (PR #249).

Plan sufficiency: sufficient to unblock the Phase 6 build. CONTRACTS.md 17.3.1 is normative; Assumptions 30–35 and the expanded Phase 6 outcome tie acceptance to fixtures and schema publication without adding phases.

## Phase outcomes (design amendment)

| Target | Assessment |
| --- | --- |
| Phase 6 — cohort scope grammar (`scope.include` / `scope.exclude`) | **met** (as design). Element shape, Boolean meaning, source-equals-`/entities` definition, budgets, and invariants (4–5) are specified. |
| Phase 6 — association counts for rejections | **met** (as design). `population.relation.associations[]` shape, unit, identity, and source/target `side` rules are complete; eligibility counts stay in `missing_by_reason`. |
| Phase 6 — capability matrix, routes, population/relation | **met** (as design). Six-grain matrix, offer-implies-resolve gate, eleven-route allowlist (`/series` included), refused routes, and per-route population placement are aligned with 17.3. |

Phase count (13), order, and non–Phase-6 outcomes are unchanged per DESIGN.md Provenance Notes.

## Intent and ledger

Assumptions 30–35 answer the three gates named in the PR body. Corrections against closed Phase 1–5 code (session lens filters, time `ignored_filters`, schema `filters`/`predicate`, `content` grain) are recorded in 17.3.1 and ledger entries, not left implicit. Open Question 5 remains the only owner option.

## Findings

No blockers, high, or medium findings. Internal cross-links (`17.3` ↔ `17.3.1`), route lists, and Assumption 32 match.

### Follow-up (non-blocking)

- **low** — Capability matrix row for `session` still says “plus `first_ts`, `last_ts`” though 17.3 session measures now name them inline; redundant wording only.

## Contract lens

17.3.1 cleanly separates `scope.exclude` from `op=exclude`, refuses silent filter ignore in cohort definitions while preserving legacy `ignored_filters` on ordinary time requests, and keeps `features.cohort` behind full-matrix resolution. Phase 4/5 alignment section accurately states current gaps for implementers.

## Residual risks

- Phase 6 scope is larger than the first unpublished build assumed (Assumption 31); owner may later choose staged publication (Open Question 5).
- Provenance dates use 2026-11-18 amendment label while the PR landed 2026-11-17 UTC; cosmetic only.