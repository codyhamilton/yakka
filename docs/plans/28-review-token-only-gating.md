# Review availability needs only the provider token

Plan 28 amended Plan 23's review path so a deployed remote-mode server with `CLAUDE_API_TOKEN` offers
`review_change` to every authenticated tenant for any repo, removed Yakka's own spend gate, retargeted
the historical trial tooling at codyhamilton/garcia-music's workflow history, and ran that trial once
against the deployed server. It met its design outcome as amended by the owner's decision to run HIGH
effort only. The trial completed 329 of 360 eligible cases at HIGH effort against the 300 floor; xHIGH and
MAX were dropped by the owner. The remaining 31 cases are 25
invalid outputs and 6 disclosure refusals. The comparison reported no structural matches, and finding
adjudication is still unlabelled, so the trial establishes the instrument and the population, not review
quality.

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

An owner amendment on 18 Nov 2026 kept `YAKKA_REVIEW_MODEL` optional rather than unread: `review_change`
registers on the token, authenticated remote mode and an MCP ceiling of at least 150 seconds, and an unset
model uses `review.LiveModel` (`claude-haiku-5-5`). That superseded the "model is a code constant" wording;
the other three variables stayed unread.

## Why This Existed

Server review was gated by five settings, four of which could only usefully hold one value: the model had
to be `claude-haiku-5-5`, effort had to be unset or `high`, the repo allowlist had to name each reviewed
repo, and the USD cap had to be positive. Production held `CLAUDE_API_TOKEN` but none of the four, so
review reported `unavailable` there. The Yakka-side rolling spend reservation duplicated a limit the
Anthropic account already enforces and shaped the trial tooling with an approval file and `--cap-usd`. The
trial Plan 23 promised had never run: its manifest builder read only yakka's layout, and the shallow
history it saw offered one eligible case.

## What Was Built

Review availability is now exactly authenticated remote mode plus a non-empty `CLAUDE_API_TOKEN`. The model
defaults to `review.LiveModel` and can be overridden by the optional env; effort is per call, default
`high`; any tenant repo is reviewable. The spend ledger, cap, worst-case reservations and retry-over-cap
refusal are gone. Durable duplicate claims, the two-call in-flight limit (`skipped_busy`) and tenant
attribution remain, actual cost is still recorded from provider usage, and a usage-free failure records
null cost with `cost_known: false` rather than an estimate. The trial tooling builds repository-agnostic
manifests from a named history profile (phase, unit and PR tiers), runs without approval or cap, and
reports population, comparisons, validation controls, cost and reconciliation.

The long-lived contracts are in [remote service](../design/03-remote-service.md),
[advisory surface](../design/04-advisory-surface.md),
[server MCP contract](../design/08-server-mcp-contract.md) and
[system architecture](../design/system-architecture.md); the trial tooling contract is in
`tools/shadow-review-trial/README.md`.

**Changed:** `packages/yakka/internal/{review,serve,store,ingest}`; `tools/shadow-review-trial`;
`docs/design/{01,03,04,08}` and `system-architecture`; `docs/ARCHITECTURE.md`, `docs/OVERVIEW.md`;
`fly.toml`, `CHANGELOG.md`, `tools/README.md`; the Plan 23 record; and
`docs/lab/RESEARCH/2026-11-21-shadow-review-trial`.

### Phase 1 — Token-only review on the server, docs and fixtures

Availability collapsed to `{Token, Local}`, claims-only reservations kept `ErrBusy`/`ErrClaimState`, and
the four removed variables stopped being read or failing startup. The priced-model assertion became a
store test. Ingest accepted `skipped_busy` and nullable cost while still reading historical reservation
fields. Stable docs, `fly.toml`, `CHANGELOG.md` and the Plan 23 pointer state token-only availability.

### Phase 2 — Trial tooling without spend gates

`approval.py` and its tests were deleted; `--cap-usd`, approval binding, exposure maths and estimate fields
were removed. The runner's preflight has only `unavailable` as blocking and retries `skipped_busy`; the
report records actual cost with explicit unknown entries. The fixture rehearsal completed three cases at
three efforts with no approval file or cap.

### Phase 3 — garcia-music manifest of at least 300 eligible cases

Two candidate extractors were built and compared; the trailer/commit-led extractor won on projected
eligible cases (545 vs 436) and phase coverage (235 vs 23) with tied citation rates. A real full-clone
freeze produced 360 cases (target 360, floor 300) from 534 eligible: phase 193, unit 167, PR 0. Criteria
came from `DESIGN.md` at `base_sha`; each case carried a non-empty capture, at least one cited recorded
outcome and a later-fixes list; 100 cases were censored. An independent verifier re-resolved a 30-case
sample and all nine manifest checks.

### Phase 4 — Comparison and validation report

Added the deterministic matcher with structural/uncertain/non-match bands, shuffled-comparator nulls,
bootstrap intervals and kappa; a section-scoped request leak check; a metric-only evidence check; manifest
population and floor accounting; comparisons (a)–(e); paired effort deltas; ledger-based cost and latency;
reproducibility hashes; and reconciliation. On the real frozen manifest the leak check passed 1,080
requests with 0 own-plan and 0 outcome-text hits, 54 foreign-plan captures and 1,458 short excerpts
skipped.

### Phase 5 — Real-server trial on garcia-music history

The non-spending probe passed after the Phase 1 build reached the deployed server. Main run
`plan28-p5-20261121` (two interleaved shards, merged ledger and certified paged export) completed 311 HIGH
cases of 360 (`ok` 45, `ok_partial` 266); retry run `plan28-p5-20261121r` completed 18 more from 43 retried
rows, for 329 final completions against the 300 floor with no padding. Main failures were 37
`invalid_output` (`schema` 24, `json_parse` 8, `unknown_field` 4, `missing_field` 1), 2 `unavailable`, 6
`refused_disclosure` and 4 `started_unknown` after HTTP 524; the retry left 25 `invalid_output` (`schema`
22, `json_parse` 2, `missing_field` 1), and the 6 refusal rows were not retried. Known cost from canonical
receipts was USD 5.690711 main plus USD 1.142236 retry, USD 6.832947 total; 4 main rows carry no receipt
and are unknown. xHIGH and MAX were owner-dropped arms (0 attempted, 0 completed, not failures). The
metric-only aggregate and summaries are committed under the research folder; manifest, ledgers and exports
stay local and gitignored. The comparison reported 0/465 finding recall, 0/1903 fix recall, 80
uncertain-band findings, 0 structural matches and verdict agreement 0.6434 over 143 cases.

## Deviations

- The optional-model amendment superseded the design's "model is a code constant / env is not read"
  wording; the other three variables remained unread.
- Phase 1 tests build the removed env names by concatenation so the required grep stays empty.
- Phase 2's README brief used a label the check forbade; the worker used the design's wording.
- Phase 3's extractor B was inherited from a permission-rejected attempt and came in at about 895 lines
  against a roughly 400-line budget. The compare unit made an undefined tie-break explicit and dropped a
  candidate reason not in the design's four eligibility conditions.
- Phase 4's first leak check over-counted bare path strings and outcome text inside plan documents; it was
  amended to resolve diff sections and to search normalised excerpts of at least five words. The null's
  denominator is the comparator case's outcome count, as the design defines it, not the primary's.
- Phase 5 had no Units table; it ran as one operational unit with no refine and no worker brief or report.
  The report CLI gained `--efforts` (including explicit owner-dropped arms) and `--metric-only` for the
  aggregate artifact.

## Review

Terminal review at `5ca99b17` (including `3edb25db`) returned PASS_WITH_FOLLOWUPS with no blocker or high
finding. Phases 1–4 were met; Phase 5 was not met at review time because the deploy probe still hit a
server that required `YAKKA_REVIEW_MODEL`. The low findings were the retained document-led extractor
(kept as comparison provenance) and the cosmetic `eligible` label (fixed in Phase 4). The medium items were
the Phase 5 deploy/tenant gates (completed 21 Nov 2026) and the accepted Assumption 15 trade-off. All
briefs and reports delivered through the artifact screen except one Phase 4 brief whose service copy stayed
stale; its committed content is the amended text.

PR #290 automation review at `b9b0495`: **PASS_WITH_FOLLOWUPS**. Phase 5 is met — 329 HIGH completions of
360 eligible against the 300 floor, metric-only evidence passes `evidence-check`, hashes match the research
README, and owner-dropped xHIGH/MAX arms are recorded without shortfall inflation. `--efforts` /
`--metric-only` and `attempts: null` handling are covered by the Python suite (158 tests). Go `review`,
`ingest`, `store` and `serve` suites pass locally. No blocker, high or critical findings. Follow-ups remain
#285–#288 and `gate: adjudication labelling` (documented, not invented).

## QA

No separate QA stage ran. Go suites for `review`, `ingest`, `store` and `serve` passed under the 8 GiB cap;
the Python trial-tooling suite grew from 58 tests at Phase 2 to 91 at Phase 3 and 152 at Phase 4 and passes
158 now. Both trial reports were produced twice from the same local inputs with equal `report_sha256`
(`d93eb91f…` main, `ca93abcb…` retry); the metric-only folder passes `cli.py evidence-check --folder`;
export certification found no truncation, duplicate identity or missing canonical record.

## Residual Risks

- Any `read_write` tenant can cause provider spend on any repo; the Anthropic account is the only brake.
  This was the stated owner decision, and the two-call in-flight limit is the only remaining server-side
  protection.
- The trial does not establish review quality. Finding recall and fix recall were zero on the deterministic
  matcher, 80 findings sit in the uncertain band, and 964 required findings remain unadjudicated, so the
  corroboration rate is unlabelled.
- An unreadable `review-reservations.json` starts with empty claims and keeps reviewing (Assumption 15).
  A claim that cannot be persisted still refuses with `review claim state unavailable`.
- Failed attempts with no provider usage record unknown cost; the 4 main-run rows with no receipt mean the
  reported total understates by an unknowable amount.
- The private garcia-music manifest, ledgers and exports remain on local disk; only metric-only aggregates
  were committed.

## Follow-ups

- [#285](https://github.com/codyhamilton/yakka/issues/285): redaction happens before JSON parse.
- [#286](https://github.com/codyhamilton/yakka/issues/286): explicit criteria carry no ids, so any outcome
  fails as `schema`.
- [#287](https://github.com/codyhamilton/yakka/issues/287): input estimate can undercount by up to 15%.
- [#288](https://github.com/codyhamilton/yakka/issues/288): POST 524s leave lookup and unknown-row handling
  incomplete.
- Adjudication labelling remains a gate, recorded as `gate: adjudication labelling` in the trial evidence
  README; no labels were invented.
- The unselected document-led extractor (`history_extract_b.py` and its test) stays committed as comparison
  provenance.

## Decisions Worth Keeping

- Token-only availability, with no replacement spend limit. The owner removed Yakka's cap; the provider
  account is the brake.
- `YAKKA_REVIEW_MODEL` is optional, with `review.LiveModel` as the default. This supersedes the earlier
  code-constant contract and keeps one override without making it required.
- Keep the in-flight limit and report it as `skipped_busy`. It protects the small server and tenant reset
  quiescence without being a spend control.
- Unknown cost is null plus `cost_known: false`, never a worst-case estimate.
- The leak check is section-scoped to the case's own plan documents and outcome excerpts; other plans'
  captures are counted, not failed, and the precision scope is reported beside the pass.
- xHIGH and MAX are owner-dropped arms, recorded as such rather than as failures or shortfalls.
