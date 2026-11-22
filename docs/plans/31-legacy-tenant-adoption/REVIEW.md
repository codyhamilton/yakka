# Plan 31 — automation review (PR #331)

- **Reviewed SHA:** `42e8cb49336221971f3070ec37296b6631d0ff97`
- **Base:** `6f0a88e512d661564c1e4d6852cfd09e008ae654`
- **Verdict:** `PASS_WITH_FOLLOWUPS`

## Phase outcomes (design)

| Phase | Outcome | Evidence |
| --- | --- | --- |
| Phase 1 — UI selection deny-list | **Met (spec)** | `DESIGN.md` §1.1–1.6 names files, line anchors, acceptance checks A1–A9; mockups `tenant-selector.png`, `profile-tenants.png`. Spot-check: `session-gate.js`, `app.js`, `account-console.js`, `lifecycle_profile.html` on base `6f0a88e5` match cited predicates (`activeTenants` / `lifecycle === 'active'` is the root refusal). |
| Phase 2 — destructive confirmation guard | **Met (spec)** | §2.1–2.3; `lifecycle-confirm.png`; `dialog [hidden]` rule addresses label `display:block` vs HTML `hidden`; harness/counts stub contract documented. |
| Phase 3 — server adoption + contract | **Met (spec)** | §3.1–3.9; `session.go:120` still emits `unsupported` today; Plan 23 reversal, flag hook, idempotent `AdoptUnmarkedTenants`, fly.toml placement, grep acceptance B2; MCP/CLI grep shows no lifecycle refusal surface (B3 intent). |

## Findings

### Resolved in this review

| Sev | Finding | Resolution |
| --- | --- | --- |
| — | No mechanical doc fixes required on this branch | Design-only PR; assertions verified against `origin/master` at merge-base. |

### Follow-up (non-blocking)

| Sev | Finding | Tracking |
| --- | --- | --- |
| low | Line anchors cite `6f0a88e5`; builders should re-spot-check if master moves before implementation PRs | Standard plan hygiene. |
| low | Phase 1 and Phase 2 both edit `lifecycle_profile.html`; ship Phase 1 before Phase 2 or one combined PR | Stated in Assumption 17 and phase Depends-on. |
| low | `TestNewLeavesUnmarkedWhenFlagOff` normalises fixture JSON before byte compare — easy to mis-implement | Called out in §3.8; treat as contract. |

## Intent and ledger

Verbatim intent (Cody 22 Nov 2026: unmarked tenants are normal; one-time adoption; UI must not refuse selection) is reflected in domain contracts, phase order (guard before `fly.toml` flag), and 19 ledger entries. Assumptions 3–7, 10, and 17 are the highest blast-radius items; each has a credible rollback or reorder path in the ledger.

**Plan sufficiency:** Sufficient to dispatch three implementation phases with named tests and acceptance checks; mockups are illustrative only (synthetic counts).

## Residual risks

Implementation not exercised in this review (by design). Adoption on a live registry is irreversible (Assumption 12). A one-time `cursor generation mismatch` after adoption is accepted (Architectural Implications). Production session count for Cody's tenant is unverified (Assumption 15).