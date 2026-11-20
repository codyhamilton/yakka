# Review — dense analytics UI and evidence-led data repairs (design)

Verdict: **PASS_WITH_FOLLOWUPS**

Reviewed SHA: `20c8f7b07528fe4c6f7219bc2546dc8adb50e051` (PR #280); post-review fixes on branch pending push (Yakka-Plan marker, Plan 20 link, D02 line reference).

Plan sufficiency: the design is enough to judge intent, phase outcomes, the six ledger entries, D01–D18 repair obligations, and downstream QA. Domains (read context, retained analytics serving, dense workspace/theme), evidence topology, and per-phase observable checks are explicit and grounded in local Chromium/Go runs at baseline `62bb9300`.

## Phase outcomes (design acceptance)

| Phase | Assessment |
| --- | --- |
| 1 — Every read represents the selected question | **met** (as design). Tenant/scope propagation, adapter normalization, catalogue parity, scatter/score fields, explicit error states, and route-specific score-series capability are contract-complete; EVIDENCE maps each board to D01–D09, D14–D18. |
| 2 — Retained history is queryable at useful latency | **met** (as design). Performance acceptance workload (235k facts, association fan-out, p95 ≤500 ms under four-request load) and batching obligations for D10–D13 are stated with query-plan attribution; depends on Phase 1 for faithful request shapes. |
| 3 — Dense full-width views follow the active theme | **met** (as design). Viewport widths, density tokens, 12-column layout, theme inheritance across document/shadow/canvas, and accessibility floor are measurable; D16 local proof and gallery theme replay support the contract. |

## Intent and ledger

Verbatim Cody intent and headless posture are preserved. Problem statement matches Plan 20 workspace constraints (1120 px cap) and reproduced failures. Assumptions 1–6 bound delivery (design-only), visual language, evidence sources, authorization, theme/performance policy, and score-series resolution scope. Adversarial review gaps (workload fan-out, route-specific resolution wire contract) are closed in DESIGN and mirrored in `docs/design/09-analytics-workspace-contracts.md` § Read context / resolution.

## Findings

### Resolved in review

- **low** — `EVIDENCE.md` D02 cited `session_entities.go:499` (wrong function); corrected to `489–490` where `AnalyticsCoverage` scans nullable `SUM` into plain `int`.
- **low** — `DESIGN.md` lacked the `Yakka-Plan:` marker used by recent plan folders; added for discoverability.
- **low** — Plan 20 cross-reference was prose-only; linked to `../20-analytics-reset.md`.

### Follow-up (not blocking design sign-off)

- **medium** — Production/deployed parity remains unverified (remote 403 non-JSON, white-canvas complaint not reproduced locally). Recorded in Open Questions; execution must replay against the live tenant before claiming deployment fixes.
- **low** — Diagnostic schema interception in EVIDENCE exposes layered defects but is explicitly not acceptance proof; Phase 1 browser tests must use the real adapter boundary.
- **low** — Ground noted SQLite driver interrupt behaviour on deadline was not verified at evidence time; Phase 2 should confirm cancellation releases readers under load.

## Security lens

Evidence handling avoids committing bodies, cookies, or personal rows. Design preserves tenant isolation, strict cookie `tenant` propagation, and explicit admin/permission states (Operations footprint). No new attack surface in this documentation-only PR.

## Residual risks

- Eighteen independent repair threads span client adapter, serve handlers, and store query paths; phase order (reads → performance → presentation) is load-bearing.
- Stale local history (pre-30d usage) can look like broken ingestion without coverage UX (D01); Phase 1/3 must keep that distinction visible.
- Tight 1s query deadline on historical ledger remains a demonstrated failure mode until Phase 2 batching lands; raising deadline is explicitly rejected as a repair.