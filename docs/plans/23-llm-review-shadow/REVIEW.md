# Review — LLM review shadow (design amendment)

Verdict: **PASS** (design only, after the corrections below).

Reviewed design content: SHA-256 `aeb8148762ef138dac67a0d06234beb541ce62514f1e913390c95dd5e197225a` of `DESIGN.md`.
The independent pass examined the amended working copy on rebased commit `22b4f5f`;
this digest identifies the resulting design after the author applied its findings.
It does not claim implementation, provider access or deployment was tested.

## Scope and method

One clean-context independent adversarial pass by `gpt-6-astra` at `high` reasoning
effort, covering value, intent alignment (including both Cody quotes of
2026-11-09 ~1:25–1:26 PM AEST), scope, contracts, phase outcomes, ordering,
dependencies and the headless ledger. Read-only dependency Ground used
`gpt-6-luna` because Haiku subagents are unavailable in this harness. These are
authoring/review process models; the designed feature uses Haiku as specified.

The amendment changes only Plan 23 design/review docs. The branch retains its
earlier separate `docs/automation/post-build.md` marker fix. No implementation,
other-plan changes, secret access, deploy, paid API call or merge was performed.
Cody explicitly authorizes Plan 23 to build despite the wider Yakka hold; other
work, including Plan 22, stays paused. Headless design requires no human sign-off.

## Phase outcomes (design sufficiency)

| Phase | Assessment |
| --- | --- |
| 1 — Local change capture | Fixture-proved read-only capture and manifest; independent of MCP wiring. |
| 2 — Review packet and prompt policy | Pure assembly, filtering, evidence identity and disclosure checks. |
| 3 — Criteria resolution | Versioned tenant-bound criteria and explicit failure cases. |
| 4 — Review handler, record, availability | Exact Haiku id, explicit high live effort, gated historical overrides, effort-aware identity, atomic execution claims/reservations, tier-aware shared pricing, no-Plan-22 path. |
| 5 — MCP tool and stage wiring | Landed Plan 24 transport; bounded typed-policy validator extension and change reader are Plan 23 work; compatibility/error/effort fixtures, optional session integration, non-gating stage calls. |
| 6 — Historical manifest | One frozen case set and settings for high/xhigh/max; eligibility and shortfalls per level; pinned comparators and leakage exclusions. |
| 7 — Trial run and report | Fake-endpoint proofs for ≥50 distinct valid reviews per level, 49-case shortage, asymmetric failures, resume and paired comparisons of findings, novelty, latency and cost. |

All seven outcomes are provable with local fixtures and fake provider endpoints.
REST-first ordering stays unchanged. Executor can start Phase 1/refine now;
there is no outstanding external-plan prerequisite.

## Findings applied

- **Material — typed reader policy gap:** Plan 24 implements the argument-fed
  foundation, but master’s parameter validator supports string/enums plus special
  cases, rather than every type promised by stable doc 8. Architectural (a),
  Assumptions 6/32 and Phase 5 now explicitly assign the bounded numeric/boolean/
  array policy extension and legal/illegal/compatibility fixtures to Plan 23.
- **Material — disabled/budget-blocked trial could never resume:** zero-provider-
  attempt preflight records no longer consume execution identity. Claim execution
  atomically with spend reservation when an attempt can begin. Repeated started,
  completed or unknown-outcome work stays deduplicated. Phase 4/7 proofs cover
  disabled→enabled, budget→available and concurrent unchanged-key submissions.
- **Consistency — session ids:** Assumption 17 and the domain contract require an
  available resolver to validate an explicit session id. Without Plan 22, the
  review completes unbound; no duplicate resolver or guessed binding is built.
- **Consistency — stale review record:** this record replaces the older SHA,
  unbuilt-#177 dependency, unmerged-Plan-22-design and single-100-trial assessments.

The independent pass otherwise found the amendment aligned, with no additional
phase split or implementation detail warranted. Both material corrections and
both consistency corrections were applied; no unresolved design blocker remains.

## Dependency evidence and residual limits

- GitHub and current `origin/master` (`5405447`) checked 2026-11-09: Plan 24 design
  PR #180 merged (`f5a9f9e`), build PR #181 merged (`b2094eb`, ancestor of master),
  issue #177 closed. Scope, timeout and bulk seams (b–d) exist. Argument-fed seam
  (a) exists with the typed-policy extension explicitly remaining in Plan 23.
- Plan 22 design PR #182 merged (`377d6d7`); build #184 remains open, draft and
  unmerged. Session hints/actions remain optional and its work remains paused.
- Provider documentation verified read-only on 2026-11-09: exact
  `claude-haiku-5-5`, `output_config.effort`, all five supported levels and Haiku’s
  medium default. Live reviews explicitly use high; the trial alone compares
  high/xhigh/max. Real credential acceptance, account entitlement, deployment
  settings and Fly/Cloudflare/harness long-call behavior remain unverified.
- Master lacks the Haiku price entry and tier-aware pricing; Phase 4 owns that
  shared pricing work. Actual eligible history and ≥50-per-level attainment are
  established only by a later authorized trial, with shortfalls reported honestly.
- Review-input retention has no automatic expiry; allowlisting is operator
  consent, not proof of client-asserted repository identity (existing ledger).

## Verification and feedback

Author checks preserve all earlier Intent bytes, append both new quotes exactly,
retain seven phases and 35 complete ledger entries, and remove superseded model,
trial-size and prerequisite requirements. Whitespace validation passes for the
amendment. No implementation tests are claimed for a docs-only change.

`artifact_feedback` was called on the amended design path. Initial and final results:
**not delivered** — no service version and nothing queued; no rejection, scores or
outlier feedback was returned. The final call matched the design digest above;
this result is also reported in PR #179 and the completion summary. Delivery absence is not a quality pass; any explicit
rejection must be fixed before publication (Assumption 35).
