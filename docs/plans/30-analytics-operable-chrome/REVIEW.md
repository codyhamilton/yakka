# Review — Plan 30 operable analytics chrome (design)

Verdict: **PASS_WITH_FOLLOWUPS**

Reviewed SHA: `05c89a64ecad58c6b287b1279bcbaf52727611f0` (PR #310).

Plan sufficiency: the design is sufficient to judge intent, phase outcomes, ledger entries, and downstream QA. Screen contracts, ownership splits, capability-gated rollout, and stable-doc amendments are explicit. Builder altitude is intentionally prescriptive per user instruction.

## Phase outcomes (design acceptance)

| Phase | Assessment |
| --- | --- |
| 1 — Selected tenant and filter set with honest totals | **met** (as design). S1/N1, C1–C11, event-counts contract, retained-record predicate, and capability flags are observable. Shell/transport ownership is named. |
| 2 — Boards and explorers in plain language | **met** (as design). Full G catalogue, F1–F6 applicability, P1–P10 captions, and 23 screen specs with acceptance IDs are complete. Mockup capture checks passed for all screens. |
| 3 — Discoverable account operations | **met** (as design). A1–A6, lifecycle origin preservation, and nav restoration without IAM invention align with `07` and existing API-origin security. |

## Intent and ledger

Verbatim user intent is preserved. Ground citations to `packages/yakka-analytics/web/js/core/read-context.js` (30d default), display-only scope, and hidden profile/settings/device routes match the checkout at merge-base `313a34ca`. Activity vs retained-fact denominators are correctly separated. Nine ledger entries are closed with explicit “if wrong” paths; no open questions block sign-off.

## Findings

### Follow-up (not blocking design sign-off)

- **low** — Assumption 8: production authenticated counts and exact API image provenance remain unverified at design time; executor must validate with a legitimate owner session during phase 1 close-out, not invent numbers in fixtures.
- **low** — `record_filters` / shared retained-record predicate is a substantial store change; phase 1 refine should treat Explore alignment tests as the gate before any panel work (already named in N1).
- **low** — Phase 3 outcome asks to “record API/Pages deployment evidence”; capture that in close-out alongside promoting additive contracts into `09-analytics-workspace-contracts.md` per the stable-doc note.

## Security lens

No weakening of lifecycle same-origin gate, bearer isolation, or tenant refusal semantics. Event-counts inherits existing tenant auth and deadlines. No new membership write surface or credential handling in mockups (synthetic preview only).

## Residual risks

- Three-phase build is large; phase ordering and capability-gated event-counts rollout (`Pages-first`) must be respected to avoid blank dashboards on older servers.
- Prescriptive caption registry must stay synchronized with panel registry additions; P10 proof is the regression anchor.