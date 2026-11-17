# Review availability needs only the provider token

Amends [Plan 23](../23-llm-review-shadow.md). Headless design; there is no sign-off step.

## Intent

User request, verbatim:

> Amend Plan 23 (docs/plans/23-llm-review-shadow*) so review availability no longer requires the server env vars YAKKA_REVIEW_MODEL, YAKKA_REVIEW_EFFORT, YAKKA_REVIEW_USD_CAP or YAKKA_REVIEW_REPOS.
>
> Cody (18 Nov 2026): drop all four; a required setting that can only hold one static value is pointless; spend limits are already handled on the Claude/Anthropic account side, so Yakka's USD cap and reservation/spend accounting gate goes too (keep recording actual cost per review for reporting). The model is a code constant (currently claude-haiku-5-5). Effort is an optional per-call parameter defaulting to high (xhigh/max allowed as already designed). Any authenticated tenant's repo can be reviewed (no repo allowlist). Review is available whenever CLAUDE_API_TOKEN is set in authenticated remote mode.
>
> Current gates: packages/yakka/internal/serve/serve.go ConfigFromEnv (~lines 80-110) and packages/yakka/internal/review/availability.go CheckAvailability. Be holistic: cover every place these vars appear (Fly config, docs, operator docs, tools/shadow-review-trial README, tests, MCP tool registration conditions, analytics/status surfaces that report availability), and remove stale references.
>
> Cody (18 Nov 12:15–12:16 AM AEST): CLAUDE_API_TOKEN is already set in the deployment, so the token alone must switch review on there. Also run the real-server trial against at least 300 real past cases, comparing the reviews with the actual outcomes and validating them. Build the case manifest from codyhamilton/garcia-music workflow history only, not yakka, using a full clone. That history is real build work through the workflow: plans, phases, review findings, fixes and merges. Each case is a real phase diff paired with its recorded review outcomes and the later fixes, so the comparison is against something that actually happened. Get the manifest to 300 or more eligible cases. Define the comparison and validation report. Drop the separate spend sign-off gate for this trial — Cody asked for the trial directly, and the Claude side handles spend.
>
> Land as its own PR into master, marked ready for review.

## Problem

Server-side review is gated by five settings. Four cannot usefully vary: the model must equal `claude-haiku-5-5`, the effort setting must be unset or `high`, the repo allowlist must name each reviewed repo, and the USD cap must be a positive number. Production holds `CLAUDE_API_TOKEN` but none of the four, so review reports `unavailable` there. The Yakka-side spend gate (rolling 24-hour reservation ledger) duplicates the limit the Anthropic account already enforces. The same gate shapes the trial tooling: `tools/shadow-review-trial` requires a spend-approval record and a `--cap-usd`, and its manifest builder reads only the yakka repo's layout, so the trial Plan 23 promised (50 cases per effort) has never run and one eligible case existed in the shallow history it saw.

## Solution Shape

After this change a deployed remote-mode server with `CLAUDE_API_TOKEN` set offers review to every authenticated tenant, for any repo, with the model fixed in code and effort chosen per call (default `high`). Yakka still records the actual cost of every review attempt but never refuses or limits on spend. The trial tooling loses its spend approval and cap gates, learns to build a manifest from codyhamilton/garcia-music's workflow history (at least 300 eligible cases, each a real phase-scale diff with its recorded review outcomes and later fixes), and produces a defined comparison-and-validation report. The trial then runs once against the real server.

### Domain: Review availability and call contract (server)

- Owns: whether review runs, the model, the effort default and validation, tool registration, and the receipt/status vocabulary.
- Contract:
  - **Availability** is exactly: authenticated remote mode (not `Config.Local()`) and a non-empty `CLAUDE_API_TOKEN`. `CheckAvailability` returns `authenticated remote mode required`, then `CLAUDE_API_TOKEN`, then the effort error for a bad per-call effort; it has no configuration-dependent refusal, and the runtime priced-model and reservation-state refusals are deleted (a store test asserts the constant is priced). The only other refusals are per-request or operational, not configuration: capture, disclosure and criteria refusals, the tenant in-flight limit, and `review claim state unavailable` when a durable claim cannot be written to disk. An unreadable `review-reservations.json` starts with empty claims instead of disabling review. No other environment variable influences review. In dry-run the availability check runs before capture and criteria resolution, so an unconfigured server answers `unavailable` whatever the capture; dry-run receipts carry no `estimated_usd`. `YAKKA_REVIEW_MODEL`, `YAKKA_REVIEW_EFFORT`, `YAKKA_REVIEW_USD_CAP` and `YAKKA_REVIEW_REPOS` are not read: a set value is ignored and an invalid `YAKKA_REVIEW_USD_CAP` no longer fails startup.
  - **Model** is `review.LiveModel` (`claude-haiku-5-5`), the only source. A store test, not a runtime check, asserts it is in the pricing table.
  - **Effort** is the optional per-call `effort` (`high`, `xhigh`, `max`), default `high`, through the same REST and MCP paths as today; invalid values are refused before any effect. The `ReviewEffort` config disappears; the record and usage field `configured_effort` stays for compatibility and always carries the default constant `high`.
  - **Repo scope**: any `repo` on an authenticated tenant is reviewable; tenant isolation is unchanged.
  - **MCP registration**: `review_change` is registered when `CLAUDE_API_TOKEN` is non-empty, the server is not local, and the MCP call ceiling is at least 150 seconds. `list_reviews` is unchanged. `tools/list` for a read_write caller is the non-spending observable availability signal; a dry-run review POST is the REST one.
  - **No spend gating**: the rolling-spend ledger, `YAKKA_REVIEW_USD_CAP`, worst-case reservation estimates, `reserveRetry` and the retry-over-cap refusal are removed. The `skipped_budget` status is never emitted again but remains valid when reading or ingesting historical rows.
  - **Kept, because it is not spend**: durable duplicate claims and cached-duplicate returns; the per-tenant in-flight limit (two), now reported as `skipped_busy` with reason `tenant in-flight limit`; tenant-attributed claims and in-flight tracking used by synthetic-tenant reset/delete. Tenant residue becomes claims-only and the spend-anonymising branch of `PurgeTenant` is deleted.
  - **Actual cost** per attempt and per review is recorded as today from provider usage and the embedded pricing table (`cost_usd`, tokens, tier, `pricing_table_id`), including failed attempts that report usage. A failed attempt with no reported usage records `cost_usd: null` with `cost_known: false` (ingest accepts null only with that flag; sums ignore it; the trial report counts it as an unknown entry), never a worst-case estimate; `reservation_outcome` and `reservation_usd` are no longer written and remain accepted when ingesting older rows.
  - **Persistence compatibility**: the existing `review-reservations.json` (version 1 and 2, with `spent`) decodes without error; spend entries are ignored and dropped on the next save; claims are preserved.
- Non-goals: any replacement limit (rate, daily, per-tenant budget); per-tenant model choice; deployment automation; changing the review prompt, packet, criteria or record schema beyond the fields above.

### Domain: Trial tooling (`tools/shadow-review-trial`)

- Owns: manifest construction, the run ledger, evidence export and the comparison/validation report.
- Contract:
  - **Spend gate removed**: `approval.py`, `--approval`, the approval-binding and ceiling checks, `--cap-usd` (run and report), `cap_comparison`, the runner's `_prior_spend`/`_unknown_reservations` exposure maths, `estimated_usd` projection and `refused_over_cap`/`approval_required_usd` readiness fields are deleted; `skipped_budget` is no longer a preflight block, and `skipped_busy` is transient and retried on resume, never a `preflight_blocked`. Device-login "approval" code is unrelated and untouched. `--execute` runs after its non-spending readiness checks (`whoami` tenant/scope match, dry-run POST with no `unavailable`, frozen-manifest/ledger binding). Actual cost per case, effort and run stays in the ledger and report. Full-history proof, deployed-server target, server-held credential and dedicated-tenant gates stay; the manual-browser gate stays for reset/delete only and is not a trial prerequisite.
  - **Repository-agnostic manifest**: `--expected-repository` selects the repo; layout assumptions (trailer names, plan paths, comparator sources) come from a named history profile, `garcia-music-workflow` first. History is fetched full and verified non-shallow and object-complete before freezing, as now.
  - **Case** (garcia-music workflow history only): one of three tiers, each a real diff with `base_sha`/`head_sha`, never padded and never mixed with a differently-defined case:
    1. `phase` — the diff of one phase of a plan, from the previous phase's closing commit (or the plan's first implementation commit) to this phase's closing commit, located from `Workflow-Phase`/`Yakka-Phase` trailers and phase-close records in branch history (all remote refs, not only mainline).
    2. `unit` — the commit that landed one refined unit of a phase, identified by a unit handoff report under `docs/plans/<plan>/reports/` added in that commit.
    3. `pr` — a squash-merged PR commit carrying a plan marker, with its review record.
    Tiers are used in that order of preference until the pool reaches the target (phase first, then unit, then PR), and per-tier counts are reported. A commit belongs to at most one case.
  - **Eligibility** (all required): code-bearing diff that the existing capture policy accepts non-empty; plan criteria resolvable; at least one **recorded review outcome**; case window closed or flagged censored (below).
  - **Criteria** are the plan's `DESIGN.md` blob at the case's `base_sha`, not at `head_sha`, because reviews in this history routinely caused later DESIGN amendments and head-state criteria would leak the answer. A plan whose `DESIGN.md` is absent at `base_sha` is `criteria_unavailable`. The manifest's trial-only capture policy also excludes the whole `docs/plans/<plan>/` folder from the diff (production policy unchanged), so amended DESIGN or review text cannot reach a packet.
  - **Recorded review outcomes** (`outcomes`): findings and verdicts the workflow actually recorded for that case — `REVIEW.md` findings and verdict for the plan or phase, phase verification/concerns/carried items in `IMPLEMENTATION.md`, and commits whose subject records review findings being applied (`blocking review findings`, `address review`). Each outcome stores severity if stated, the cited path and line range, blob or commit id, and a verbatim text excerpt held only in the local manifest.
  - **Later fixes** (`later_fixes`): commits after `head_sha` and within the case window that are attributed to the same plan (marker, subject or issue reference) and whose diff intersects the files of the case diff. Each stores sha, subject, intersecting paths and hunk ranges. The window ends at the plan's close-out commit or 60 days after `head_sha`, whichever is earlier; a case whose window has not closed is marked `censored` and excluded from fix-recall metrics. An empty `later_fixes` on an uncensored case is a recorded negative.
  - **Sample**: the manifest freezes the eligible pool, capped at 360 cases by seeded, tier-stratified selection, and records `target` 360 and `floor` 300 (the old default of 50 is gone). Phase 3 closes only at 300 or more; if every tier is exhausted below 300 the phase stops with tier counts and blockers and the trial does not start. Separately, completed reviews below 300 at any effort are reported as a shortfall. Each frozen case also records per-reason exclusion counts for all candidates.
  - **Run**: all cases at each of `high`, `xhigh`, `max` (shared case set), through the existing resumable, claim-before-I/O runner and a dedicated synthetic tenant; tags `trial:`, `effort:`, `manifest:`, `case:` unchanged.
  - **Report** (comparison and validation), emitted as one JSON document plus a rendered summary:
    - Population: eligible, frozen, attempted, completed (valid) per effort and tier; failures and exclusions by reason; shortfall against 300; censored count.
    - Comparison against outcomes, per effort and tier: (a) *finding recall* — share of recorded review findings matched by a review finding; (b) *fix recall* — share of later-fix hunks whose file and line neighbourhood a review finding flags, uncensored cases only; (c) *corroboration* — share of review findings matching a recorded finding or later fix, with the uncorroborated remainder sampled for adjudication as valid, invalid or unknown; (d) *verdict agreement* — review verdict against recorded verdict (confusion matrix); (e) severity agreement where both state one; (f) paired high-vs-xhigh-vs-max deltas on the same cases with bootstrap intervals; (g) actual cost and latency per review and per effort from the ledger (no cap, no approval).
    - Validation controls: matching is deterministic (path, line-range overlap, normalised-text similarity) with every match tagged `structural` or `adjudicated`, and an adjudication file for the uncertain band, with sampled double-labelling and Cohen's kappa; a **shuffled-comparator null** (the same matcher run against another case's outcomes) reported beside every recall figure; a **leak check** (review packets contain no `REVIEW.md`/`IMPLEMENTATION.md`/post-base `DESIGN.md` content, and no outcome text appears in any request); reproducibility (frozen manifest hash, seed, ledger and export hashes, report hash from the same inputs); ledger/server reconciliation (every completed row has a canonical review id and cost).
  - **Data handling**: garcia-music is private and `yakka` is public. Diffs, outcome text, review text and case lists exist only in locally held, gitignored files. Anything committed to `yakka` is aggregate and metric-only: counts, rates, intervals, costs, hashes, tier labels and anonymised case ordinals. A pre-commit check in the trial CLI rejects an evidence folder that contains any manifest or export file.
- Non-goals: a Yakka-side cost limit or approval of any kind; trialling yakka's own history; running the trial from CI; changing alignment methodology beyond the metrics above; deleting the trial tenant (human-only, per Plan 23).

### Domain: Stable and operator documentation

- Owns: the statements about availability, configuration and gates in `docs/design/{01-event-model-and-ingest,03-remote-service,04-advisory-surface,08-server-mcp-contract,system-architecture}.md`, `docs/ARCHITECTURE.md`, `docs/OVERVIEW.md`, `fly.toml`'s header comment, `tools/shadow-review-trial/README.md` and `tools/README.md`, and the Plan 23 record.
- Contract: each states token-only availability, the code-constant model, per-call effort and no Yakka spend limit (the "spend limits" phrase in the server-ownership sentences of `04`, `08`, `system-architecture`, `ARCHITECTURE` and `OVERVIEW` is removed, and `01`'s `review_usage` row drops `reservation_outcome`/`reservation_usd` from what new rows carry); the agent skills' "spend and record" wording stays true and is unchanged; `docs/design/03-remote-service.md` lists `CLAUDE_API_TOKEN` as the sole review setting and `fly.toml` gains a header comment (it has none today) that it is a `fly secrets` value and the only review setting; `CHANGELOG.md` records the removal, `skipped_busy` and the registration condition; Plan 23's record gains a short pointer to this plan beside the sections it supersedes without rewriting history. After this plan no file outside `docs/plans/` mentions any of the four variable names, and `docs/plans/` mentions them only in records of what was decided then.
- Non-goals: rewriting historical plan records.

## Architectural Implications

- The server no longer carries a spend control; the only brake is the Anthropic account. Any tenant holding a `read_write` key can cause provider spend on any repo. This is the stated decision; the in-flight limit is the only remaining protection.
- Stable docs at `docs/design/03`, `04`, `08` and `system-architecture` currently assert the four settings and a spend cap; each is scope here, and Plan 23's "Residual Risks"/"Follow-ups" statements about a separate spend approval are superseded.
- `GET /v1/admin/status` and the analytics site report no review availability or cap today; no surface is added. Availability is observable through `tools/list` and dry-run only.
- Status vocabulary gains `skipped_busy`; `ingest` and `report.py` must accept it, and `skipped_budget` stays readable.
- `tools/shadow-review-trial/manifest.py` imports the capture client from `plugins/yakka/client`; Plan 27 relocates that client. Refinement must check where it lives when Phase 3 starts.
- The trial requires the Phase 1 build to be running on the deployed server; deployment is an operator act outside this plan.

## Decisions

None beyond the owner decisions in Intent; the remaining questions are ledgered below.

## Assumption Ledger

### Assumption 1

- Question: Where does the amendment live: edit Plan 23's record, or a new plan?
- Answer chosen: new plan folder `28-review-token-only-gating` (its own PR); Plan 23's record gets only a pointer at close of Phase 1.
- Rationale: Plan 23 is closed out into one record file and the folder convention says one folder per change.
- If wrong: fold this DESIGN into an edit of the record; contracts unchanged.

### Assumption 2

- Question: Should the per-tenant in-flight limit (two concurrent calls) survive removal of the spend gate?
- Answer chosen: keep it, report it as `skipped_busy`.
- Rationale: Cody removed spend limits; concurrency protects the single 1 GB Fly machine and reset/delete quiescence depends on in-flight tracking. It is not a spend control and the trial runner is sequential.
- If wrong: delete the limit and `skipped_busy`; Phase 1 outcome unchanged otherwise.

### Assumption 3

- Question: What cost is recorded for a failed attempt with no provider usage?
- Answer chosen: unknown (null), not the old worst-case reservation.
- Rationale: reporting must not invent spend; the reservation estimate existed only for the removed gate.
- If wrong: trial cost totals understate failed attempts by an unknowable amount; the report already counts them as unknown entries.

### Assumption 4

- Question: Does review dry-run stay, now that cost estimates come from reservation pricing?
- Answer chosen: dry-run stays as a no-provider-call readiness check; estimate fields are dropped.
- Rationale: it is the only REST-level way to prove availability without spending, which Phase 5 needs.
- If wrong: probe via `tools/list` only.

### Assumption 5

- Question: Registration when the token is set but the server is local.
- Answer chosen: not registered; review is refused in local mode as today.
- Rationale: Cody's wording is "authenticated remote mode"; local mode has no tenant identity to attribute the call to.
- If wrong: one condition in `New` and one in `CheckAvailability`.

### Assumption 6

- Question: What is a "phase diff" in garcia-music, where PRs are squash-merged and phase commits live only on branch refs?
- Answer chosen: three tiers (phase, unit, PR) used in that order until the pool reaches target, never padded, per-tier counts reported.
- Rationale: grounding on the clone found about 145 distinct numbered phase trailers, 590 unit handoff reports in about 400 commits and about 1,000 squash PR commits; strict phases alone are unlikely to reach 300 with a recorded outcome, while the unit and PR tiers are real work with recorded reviews.
- If wrong: if phases alone suffice, the other tiers stay empty at no cost; if even all tiers fall below 300 the shortfall is reported, never padded.

### Assumption 7

- Question: Which date window defines "later fixes", and how are not-yet-fixed cases treated?
- Answer chosen: close-out commit or 60 days after head, whichever is first; open windows are `censored` and excluded from fix recall only.
- Rationale: an unbounded window would credit unrelated later changes; right-censoring is the standard correction.
- If wrong: widen or narrow the constant; metrics recompute from the frozen manifest.

### Assumption 8

- Question: Criteria at base or head?
- Answer chosen: `DESIGN.md` at `base_sha`.
- Rationale: plan 208's REVIEW.md shows DESIGN amended in response to review; head-state criteria would leak review conclusions.
- If wrong: plans created in the same commit as the first phase have no base DESIGN; these cases fall back to the first commit that adds it only if it precedes `head_sha`, else are excluded as `criteria_unavailable`.

### Assumption 9

- Question: Run all three efforts on every case, or a subset for xhigh/max?
- Answer chosen: every case at every effort, up to 360 × 3 = 1,080 calls.
- Rationale: Plan 23's shared-case-set design gives paired comparisons and the Claude side handles spend; this reuses runner logic unchanged.
- If wrong: run `high` on all and a seeded subset of at least 100 for `xhigh`/`max`; report paired metrics on the subset.

### Assumption 10

- Question: How is the uncertain matching band adjudicated in a headless run?
- Answer chosen: deterministic matcher for clear matches and non-matches; the uncertain band goes to the adjudication file, labelled by an agent with a different model from the reviewer, with a sampled second label and kappa reported; every match is tagged by method so structural-only figures are always available.
- Rationale: no human sign-off exists in this posture and the report must say how much rests on judgement.
- If wrong: a human re-labels the sample and the report recomputes; no phase is blocked.

### Assumption 11

- Question: Sending garcia-music code to the Yakka server and Anthropic, and where results may be committed.
- Answer chosen: permitted by Cody's request; stored only in the dedicated synthetic tenant and local gitignored files; committed evidence is metric-only.
- Rationale: yakka is a public repository, garcia-music private.
- If wrong: add redaction before capture; Phase 5 outcome unchanged.

### Assumption 12

- Question: The trial needs the Phase 1 build deployed; who deploys?
- Answer chosen: out of scope. Phase 5 begins with a non-spending probe and stops with a reported blocker if the server still says `unavailable`.
- Rationale: no deploy automation exists in the repo and this plan does not own one.
- If wrong: add a deploy step to Phase 5.

### Assumption 13

- Question: Manifest size.
- Answer chosen: freeze up to 360 eligible (20% over the 300 floor).
- Rationale: some calls will fail or truncate; the floor is on completed reviews.
- If wrong: raise or lower the cap; the floor stays 300.

### Assumption 14

- Question: Does this PR include building the phases?
- Answer chosen: no. "Own PR, ready for review" is read as this design landing on its own; the phases, including the deploy-gated Phase 5, are built after it.
- Rationale: Phase 5 cannot complete without an operator deploy, and a design PR is the unit `execute` consumes.
- If wrong: Phases 1–4 become the PR body and Phase 5 follows.

### Assumption 15

- Question: What happens when the reservations/claims file is unreadable, and what remains a refusal?
- Answer chosen: start with empty claims and keep reviewing; a claim that cannot be persisted refuses with `review claim state unavailable`.
- Rationale: "available whenever the token is set" outweighs a fail-closed spend guard that no longer exists; claim durability still matters for duplicates.
- If wrong: duplicates after a corrupt-file restart may spend twice; restore the fail-closed path.

### Assumption 16

- Question: What does `configured_effort` mean after the setting is gone, and how is unknown cost encoded?
- Answer chosen: `configured_effort` is kept and always `high`; unknown cost is `cost_usd: null` plus `cost_known: false`.
- Rationale: avoids a record/ingest schema break on historical rows while making unknown spend explicit.
- If wrong: drop the field or use omission; ingest and report change together.

### Assumption 17

- Question: The old trial default `target_per_effort` was 50; what binds the 300 floor?
- Answer chosen: manifest `target` 360 and `floor` 300 recorded in the frozen manifest; report reads them.
- Rationale: one source of truth for the number the owner asked for.
- If wrong: constants only.

### Assumption 18

- Question: Plan 27 relocates the capture client the manifest imports; which location does Phase 3 use?
- Answer chosen: whichever exists at refinement; Phase 3's refine step checks `plugins/yakka/client` versus the Plan 27 location and records it.
- Rationale: Plan 27's execution state is not part of this design.
- If wrong: a changed import path.

## Open Questions

None blocking. Whether the unit and PR tiers will be needed is answered by Phase 3's counts.

## Phases

### Phase 1 — Token-only review on the server, docs and fixtures

- Outcome: with `CLAUDE_API_TOKEN` as the only review variable and remote mode configured, a read_write MCP `tools/list` includes `review_change`, and a `POST /v1/reviews` for a tenant and a repo never named in config, against a fake provider endpoint, returns a completed review with model `claude-haiku-5-5` and effort `high`; `effort:"xhigh"` and `"max"` complete and any other value is refused with no effect. Without the token the same call returns `unavailable` with reason `CLAUDE_API_TOKEN` and the tool is absent; in local mode it returns `authenticated remote mode required`. Setting all four removed variables, including `YAKKA_REVIEW_USD_CAP=zero`, changes nothing and does not prevent startup. Review records and usage facts still carry actual `cost_usd` and tokens, a failed attempt with usage carries its real cost and one without carries null, and a 24-hour run of calls totalling any amount is never refused; a third concurrent call for a tenant returns `skipped_busy`; a v1 and a v2 `review-reservations.json` (with spend entries) load, keep claims and reset/delete residue checks pass. a dry-run on an unconfigured server returns `unavailable` before any capture refusal and carries no `estimated_usd`, `grep -rIE 'YAKKA_REVIEW_(MODEL|EFFORT|USD_CAP|REPOS)'` outside `docs/plans/` and `tools/shadow-review-trial/` returns nothing, and the stable docs, `fly.toml` comment, `tools/README.md` and the Plan 23 record say token-only availability.
- Surfaces: `packages/yakka/internal/serve/{serve.go,mcp_review.go,reviews_test.go,tenant_isolation_test.go,mcp_review_test.go}`; `packages/yakka/internal/review/{availability.go,orchestrator.go,availability_test.go,orchestrator_test.go}`; `packages/yakka/internal/store/{pricing.go,pricing_test.go,review_usage.go}`; `packages/yakka/internal/ingest/{ingest.go,ingest_test.go}` (status vocabulary, nullable cost); `packages/yakka/internal/serve/lifecycle_*_test.go` (residue and purge); `CHANGELOG.md`; `docs/design/{01,03,04,08}*.md`, `docs/design/system-architecture.md`, `docs/ARCHITECTURE.md`, `docs/OVERVIEW.md`, `fly.toml`, `tools/README.md`, `docs/plans/23-llm-review-shadow.md` (pointer).
- Approach: known
- Depends on: nothing
- Units:

| Unit | Brief | Depends on | Runs alongside |
|---|---|---|---|
| 1 — Token-only availability, durable claims and orchestration | `briefs/phase1-01-review-core.md` | nothing | 3, 5 |
| 2 — Priced live model test and reservation-cost removal | `briefs/phase1-02-store-pricing.md` | 1 | 4 |
| 3 — Ingest status vocabulary and nullable cost | `briefs/phase1-03-ingest-vocabulary.md` | nothing | 1, 5 |
| 4 — Server wiring and claims-only lifecycle residue | `briefs/phase1-04-serve-wiring.md` | 1 | 2 |
| 5 — Stable docs, changelog and Plan 23 pointer | `briefs/phase1-05-stable-docs.md` | nothing | 1, 3 |

### Phase 2 — Trial tooling without spend gates

- Outcome: `cli.py run --execute` against the loopback fixture server completes a three-case, three-effort rehearsal with no approval file and no `--cap-usd`, refuses when `whoami` tenant or scope mismatches or the dry-run returns `unavailable`, and its ledger and report still show actual cost per case, effort and run; `approval.py` and its tests are gone; the runner and report accept `skipped_busy` and legacy `skipped_budget`; `tools/shadow-review-trial/README.md` lists no spend-approval gate and no removed variable; `grep -rIE 'YAKKA_REVIEW_|refused_over_cap|cap_usd|cap-usd|estimated_usd|approval' tools/shadow-review-trial` returns nothing; the fixture suite passes.
- Surfaces: `tools/shadow-review-trial/{approval.py,cli.py,runner.py,report.py,test_approval.py,test_runner.py,test_phase7.py,test_report.py,test_report_export.py,README.md}`.
- Approach: known
- Depends on: Phase 1
- Units:

| Unit | Brief | Depends on | Runs alongside |
|---|---|---|---|
| 1 — Run path without spend gates | `briefs/phase2-01-run-path.md` | nothing | nothing (2 and 3 need it) |
| 2 — Report actual cost only | `briefs/phase2-02-report-cost.md` | 1 | 3 |
| 3 — Trial README without the spend gate | `briefs/phase2-03-readme.md` | 1 | 2 |

### Phase 3 — garcia-music manifest of at least 300 eligible cases

- Outcome: `cli.py manifest --repo <full clone of codyhamilton/garcia-music> --expected-repository codyhamilton/garcia-music --history-profile garcia-music-workflow --seed <n> --output <local path>` verifies a non-shallow, object-complete clone and writes a frozen, hashed manifest whose `cases` number at least 300 (at most 360; below 300 the phase is not closed), every case carrying `tier`, `base_sha`, `head_sha`, a non-empty capture, criteria from `DESIGN.md` at `base_sha`, at least one cited recorded review outcome, a `later_fixes` list (possibly empty) with `censored` set where the window is open, and no commit in two cases; it records per-tier eligible counts and an exclusion count for every ineligible candidate reason; a fixture suite built from synthetic repos covers each tier, censoring, base-criteria leak avoidance, and a shortfall under 300 reported rather than padded; running against the real clone reports the actual counts. Nothing from the clone is committed.
- Surfaces: `tools/shadow-review-trial/{manifest.py,cli.py,test_manifest.py,test_phase7.py}` (the last for the fixture update the new eligibility requires), a new history-profile module, extractor and fixture modules in the same folder, the capture import path (Plan 27 location), `.gitignore` for the local trial data directory.
- Approach: open — extracting findings, verdicts, phase boundaries and later fixes from garcia-music's heterogeneous markdown and commit conventions has no settled method. Yardsticks are the real count and a hand-checked sample of 30 cases whose outcome citations and fix attributions must all resolve to the cited blobs/commits. Bound: two candidate extractors are built and compared; if neither reaches 300 after the tier fallback the phase stops and reports.
- Declared approach (invoker, recorded at refinement): build and compare two candidate extractors; freeze at most 360 eligible cases with a floor of 300; never pad. If neither candidate reaches 300 after the phase → unit → PR tier fallback, the phase stops and reports the per-tier counts and blockers; it does not invent or pad cases.
- Depends on: nothing (sequenced after Phase 2 only because both edit `cli.py`; it is independent of Phase 1)
- Units:

| Unit | Brief | Depends on | Runs alongside |
|---|---|---|---|
| 1 — Manifest contract, history profile and candidate accounting | `briefs/phase3-01-manifest-contract.md` | nothing | nothing |
| 2 — Candidate extractor A (trailer- and commit-driven) | `briefs/phase3-02-extractor-a.md` | 1 | 3 |
| 3 — Candidate extractor B (document- and report-driven) | `briefs/phase3-03-extractor-b.md` | 1 | 2 |
| 4 — Compare candidates, integrate and gate eligibility | `briefs/phase3-04-compare-integrate.md` | 1, 2, 3 | nothing |
| 5 — Real-clone freeze at the 300 floor | `briefs/phase3-05-real-freeze.md` | 4 | nothing |
| 6 — Independent manifest verification and 30-case hand-check | `briefs/phase3-06-verify-manifest.md` | 5 | nothing |

### Phase 4 — Comparison and validation report

- Outcome: given the Phase 3 fixture manifest, a rehearsal run export and ledger, and an adjudication file, `cli.py report` writes the JSON and rendered summary with every population, comparison (a–g) and validation-control section defined above; recall figures appear next to their shuffled-comparator null; a request that contains outcome text makes the leak check fail the report; the same inputs produce a byte-identical report hash; every match carries a method tag; kappa is computed on the double-labelled sample; and the metric-only evidence check refuses a folder containing a manifest or export file.
- Surfaces: `tools/shadow-review-trial/{report.py,cli.py,test_report.py,test_report_export.py}`, new matcher and evidence-check modules with tests, README report section.
- Approach: known
- Depends on: Phases 2 and 3
- Units:

| Unit | Brief | Depends on | Runs alongside |
|---|---|---|---|
| 1 — Deterministic matcher, null, kappa and bootstrap | `briefs/phase4-01-matching.md` | nothing | 2, 3, 4 |
| 2 — Request-level leak check | `briefs/phase4-02-leak-check.md` | nothing | 1, 3, 4 |
| 3 — Metric-only evidence check | `briefs/phase4-03-evidence-check.md` | nothing | 1, 2, 4 |
| 4 — Manifest ingestion and population | `briefs/phase4-04-manifest-population.md` | nothing | 1, 2, 3 |
| 5 — Comparisons (a)–(e) and matching/adjudication controls | `briefs/phase4-05-comparisons.md` | 1, 2, 4 | nothing (owns `report.py`) |
| 6 — Paired deltas, cost/latency, reproducibility and reconciliation | `briefs/phase4-06-deltas-cost-validation.md` | 1, 4, 5 | nothing (owns `report.py`) |
| 7 — Report output surface, CLI and README | `briefs/phase4-07-output-surface.md` | 3, 4, 5, 6 | nothing |

Wave 1: 1, 2, 3, 4. Wave 2: 5. Wave 3: 6. Wave 4: 7.

Carried placement: the foreign-plan capture item (54 real captures) is resolved by unit 2's scoped request check — the case's own plan documents and every recorded outcome excerpt fail; other plans' `docs/plans/` files are counted as `foreign_plan_document_captures`, surfaced in unit 5's validation section and documented in unit 7's README. The `tiers`/`base_blob`/`outcomes`/`later_fixes`/`target`/`floor` ingestion is unit 4. The cosmetic `eligible` label on `cli.py manifest` is unit 7. `history_extract_b.py` stays committed as comparison provenance; whether to drop it is a close-out decision, not Phase 4 work.

### Phase 5 — Real-server trial on garcia-music history

- Outcome: against the deployed Yakka server, `tools/list` for the trial tenant's key includes `review_change` and a dry-run review POST is not `unavailable` (the probe; if it fails the phase stops and reports the blocker); the real manifest from Phase 3 runs to completion at all three efforts on the dedicated tenant, and the Phase 4 report states, per effort, the completed valid case count against the 300 floor with every shortfall and failure reason; its aggregate JSON and summary are committed under `docs/lab/RESEARCH/<date>-shadow-review-trial/` with run identity, hashes, population, all comparison metrics with nulls, validation results and actual cost, and contain no garcia-music diff, finding text, path list or credential; the manifest, ledger and export remain local and gitignored.
- Surfaces: `docs/lab/RESEARCH/<date>-shadow-review-trial/` (new), `docs/lab/RESEARCH/INDEX.md`, local-only trial data.
- Approach: known
- Depends on: Phases 1–4, and Phase 1 deployed to the Yakka server. This design PR carries only the design; each phase is built afterwards by `execute`, and Phase 5's evidence lands with a recorded deploy, not in this PR.

## Provenance Notes

- The old rule "availability requires `YAKKA_REVIEW_EFFORT` unset or `high`" contradicted the documented per-call `xhigh`/`max` override; the design resolves it by removing the setting rather than documenting around it.
- The reservation type holds three things: a spend ledger (removed), durable duplicate claims and tenant attribution (kept), in-flight counting (kept). Phase 1 separates them rather than deleting the type.
- Rejected: keeping a generous default cap as a safety net (Cody: the Claude side handles spend); an allowlist defaulting to all tenants (a setting that can only hold one value); a `YAKKA_REVIEW_ENABLED` flag (the token already is one).
- Rejected: building the garcia-music cases only from `phase` trailers; grounding showed about 145 distinct numbered phase trailers, short of 300 before the recorded-outcome requirement.
- Plan 23's follow-up Phase 3 added the approval gate and `--cap-usd`; this plan removes them on the owner's instruction and keeps the full-history, tenant-scope and ledger-claim protections that guard correctness rather than spend.
