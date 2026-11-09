# Plan 23 follow-up design review

Recommendation: **proceed with the docs-only PR after the compatibility correction recorded below**. No unresolved material design finding remains. This is a design assessment, not implementation or deployed-service validation.

The resulting DESIGN.md SHA-256 is `abacb8a8911b47bae51dc1488913b64e2c0e3fe7d773dfe56354dc7edcb8e65f`. The independent reviewer examined the first complete draft; the author then applied its bounded correction and verified the resulting text. No second independent pass is claimed.

## Independent adversarial pass

One clean-context `gpt-6-astra` agent at high reasoning effort read the local design skill, amendment, historical record, relevant current code and stable docs. Its instructions included all ten owner decisions. It challenged value, verbatim intent (all eight new Cody quotes), scope, API/persistence/tenancy contracts, phase outcomes/order and the headless ledger. Haiku was unavailable in this harness; narrow read-only Ground agents used the inherited available model. These authoring models do not change the designed Haiku reviewer.

**Medium finding applied — legacy cache identity could defeat tag isolation.** The first draft retained old execution-key lookup for every deprecated trial-adapter call, while promising that distinct tags create independent experiment evidence. Landed keys omit tags, so an added experiment tag could still hit an old claim. The amended contract now defines deterministic adapter effort/manifest/case tags, validates the merged set, and permits legacy fallback only for the exact mapped tag set with every legacy identity field matching. An extra caller tag forbids fallback. Ordinary untagged requests preserve their exact old key serialization/hash, preventing upgrade-induced replay of earlier paid work. Ledger entries 8/12 and Phase 1 prove both unchanged reuse and distinct-tag work.

The pass found no further material gap. In particular, it confirmed the three amendment-local phase numbers fit the existing default-branch-to-HEAD trailer resolver; the fresh-tenant reset explicitly bounds opaque legacy ownership; cleanup covers concurrent work, crashes and global assets; ephemeral reservations are distinguished from forbidden dedupe claims; and paid execution is separated from provider-free preflight. The author applied the recommendation; this record does not describe that application as a second independent review.

## Contracts and outcomes checked

| Decision | Design coverage |
| --- | --- |
| 1 — paging/filter | REST plus new server-owned MCP list_reviews; ALL-tag filters, existing filters, fixed insertion high-water and explicit exhausted-cursor evidence. Direct dedupe lookup also removes its hidden 500-record scan ceiling. |
| 2 — real server | Deployed server owns the Fly provider secret; clients use only dedicated tenant Yakka auth. Fixtures/local servers remain test instruments; real dry_run is provider-free. |
| 3 — duplicates | Full original payload and metadata, cached/original id/status, no client follow-up GET; explicit pending/unknown/missing-result states and REST/MCP parity. |
| 4 — effort | Drop YAKKA_REVIEW_TRIAL_ENABLED entirely; optional high/xhigh/max effort with configured/requested/effective audit. Model stays fixed server-side. Legacy adapter is compatibility, never a prerequisite. |
| 5 — tags | General list of strings, concrete 16 × 96 ASCII bounds, canonical set, ALL filtering and cache identity; trial naming is convention only. |
| 6 — store | store=false returns full result, skips every cache lookup/claim/write and stores no review/input/findings. Only tenant-local content-free usage and spend controls remain outside quality/work/session aggregates. |
| 7 — isolation | Fresh dedicated synthetic tenant/key/allowlist; reviews, tracking, search, analytics and cost never enter the real-work tenant. Shared provider cap remains a separate safety mechanism. |
| 8 — cleanup | Current CreateTenant/no DeleteTenant and orphaned registry facts stated accurately. Admin-authenticated bounded reset removes fresh tenant assets and identity, grants and global claims; legacy-ineligible tenants fail before effects; zero-residual/no-cross-damage/restart outcomes are explicit. |
| 9 — history | Trial preparation fetches/unshallows full history, verifies identity/tip/objects/count before freeze. Honest eligible/completed shortfalls and paired >=50 distinct valid cases per effort remain. Capture reader remains network-free. |
| 10 — spend | Explicit Cody approval before paid live smoke/trial/retries, bound to preflight/tenant/run/ceiling/expiry. Illustrative estimate $0.0018/review, estimate $0.09/50 high, estimate $0.27+ across three levels before retries; xhigh/max output unknown. Real-server retry-inclusive dry_run is the authoritative estimate for approval. |

Phase 1 proves call controls and complete cached reads; Phase 2 proves isolation and complete reset; Phase 3 proves complete trial evidence, history preparation and the spend gate. All are Known and fixture-provable. No paid call, deployed smoke or attained historical comparison is required to close a build phase. The seven landed phases remain historical evidence in LANDED.md and are not reopened.

## Author verification and artifact feedback

Author checks verified all prior Intent quote text against the owner-supplied prior DESIGN, eight separately timestamped additions, 28 complete ledger decisions, exactly three headings recognized by the shipped phase resolver, preservation of the closed record under LANDED.md, local documentation links and docs-only scope. Whitespace checks are run over the staged final change. No implementation tests are warranted or claimed for this documentation amendment.

`artifact_feedback` was called after the initial write and after each material compatibility fix. The final call used the resulting design digest above and returned **stale**: current content not delivered; the service holds hash prefix `567f31280665` from `2026-11-09T09:39:58Z`. No rejection, scores or outlier checks were returned. This is a delivery gap, not a quality pass; no paid submission, enqueue workaround or other-plan work was initiated. The same result is reported in the PR and completion summary.

Publication is headless and authorized: this worktree and branch only, ordinary push, new ready PR to master, no merge or messages. No secrets, deployment, paid API calls, HOLD removal, other checkout edits or unpausing occurred. Live readiness, actual eligible population and higher-effort cost remain later operator questions; none blocks this design PR.

---

## Automation PR review (`2348437`)

Verdict: **PASS_WITH_FOLLOWUPS**

Reviewed SHA: `234843723b0a7ad51c0ccc815192ad99868c77b5` on `docs/23-followup-paging-tags-effort`.

Classification: docs-only Plan 23 amendment (~299 lines). Reviewed in-process against `DESIGN.md`, stable-doc deltas (03/04/08), `LANDED.md` relocation, author `REVIEW.md`, and spot-checks of cited code (`maxReviewRecords`/dedupe scan, trial gate, registry lifecycle).

### Phase outcomes (amendment acceptance)

| Phase | Assessment |
| --- | --- |
| 1 — Review controls and complete cached reads | **met** (as design). Effort/tags/store, duplicate full-body parity, tag-sensitive execution keys with bounded legacy fallback, paging/`list_reviews` and direct-key dedupe are specified with fixture-verifiable outcomes. |
| 2 — Synthetic isolation and disposable reset | **met** (as design). Fresh-tenant-only admin reset, global-asset attribution, cross-tenant non-leakage and zero-residual proofs are explicit; legacy 409 boundary is honest. |
| 3 — Trial evidence, history and spend gate | **met** (as design). Full-history preparation, complete cursor reads, tag conventions, Cody approval artifact and dry_run authority are bounded; live trial remains operator work. |

### Findings

**Resolved in review**

- **low** — Renaming `docs/plans/23-llm-review-shadow.md` to the folder layout broke the Plan 22 cross-reference. Updated to `../23-llm-review-shadow/LANDED.md`.

**Follow-up (not blocking design sign-off)**

- **low** — `artifact_feedback` delivery remained **stale** on final digest (reported in author review); downstream tuning may close the delivery gap; not a design-quality rejection.
- **low** — Plan 20 analytics copy still references branch `origin/docs/23-llm-review-shadow`; harmless until that plan is next edited.

### Intent, ledger and plan sufficiency

Ten owner decisions map to domains with 28 ledger entries; the prior adversarial legacy-key/tag finding is reflected in the amended contract. Stable docs correctly label pending versus landed behaviour and correct the directory-delete implication in design 03. The design is sufficient to derive execute/refine briefs and QA for the three follow-up phases.

### Residual risks

Implementation phases carry real complexity (cursor high-water, global reservation ownership, admin reset concurrency). Open questions on deploy readiness, eligible population and xhigh/max cost remain operator concerns, as recorded in `DESIGN.md`.
