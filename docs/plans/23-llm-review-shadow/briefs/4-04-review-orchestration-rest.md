# Brief: 4-04 — Review orchestration and REST routes

Consumer: Plan 23 Phase 5 MCP integration and Phase 6/7 trial tooling; this unit closes Phase 4.
Owned paths: new orchestration, availability and spend-reservation files under `packages/yakka/internal/review/`; `packages/yakka/internal/serve/serve.go` (`ConfigFromEnv`, POST/GET review routes and route body limits); focused tests in those packages; `docs/design/01` and `docs/design/03` review fact/environment contract sections; and `docs/plans/23-llm-review-shadow/reports/4-04-review-orchestration-rest.md`. Do not modify provider-transport files owned by 4-03, persistence files owned by 4-02, or pricing files owned by 4-01. Touch nothing else.
Commits: Commit implementation and report when done evidence passes, with a plain-summary title.
Report: Before committing, write the report named above (rubric: `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: 4-01 shared pricing, 4-02 review record persistence, and 4-03 provider call and reply validation.
Runs alongside: nothing; complete after all three dependencies land.
Budget: 18 files to read, about 1,800 lines to change, 60 tool turns. Past the budget, stop and report an actionable handoff.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Domain: Review run, Domain: Review record and tracking, Architectural Implications pricing/server-only settings, and Phase 4 Outcome.
2. `docs/plans/23-llm-review-shadow/briefs/4-01-shared-haiku-pricing.md`, `4-02-review-record-persistence.md`, and `4-03-provider-call-validation.md`, plus their reports — consume their landed APIs and deviations.
3. `packages/yakka/internal/serve/serve.go` and adjacent route tests — configuration, auth scopes and route patterns.
4. `packages/yakka/internal/review/` — `Build`, `ResolveCriteria`, and the provider interface established by 4-03.
5. `packages/yakka/internal/store/` and `internal/ingest/` — persistence APIs established by 4-02 and pricing API established by 4-01.
6. `docs/design/01` and `docs/design/03` — existing fact and server-environment documentation to amend narrowly.

## Goal

Compose criteria resolution, packet building, provider call, reply validation, cost, budget reservation, idempotency, persistence and read access into the authenticated REST review surface.

## Contract

Binding design text:

> “`POST /v1/reviews` (bearer, `read_write`) takes the arguments and a capture in its body and runs the whole review” and “`GET /v1/reviews?...` (read scope, tenant-bound) returns records with the keys above” (Domain: Tool surface and shadow invocation; Domain: Review record and tracking).

> “Argument and capture errors … are tool errors and record nothing, since nothing was accepted to key a record on. Everything after that is a recorded run with exactly one status” (Domain: Review run).

> “zero-provider-attempt preflight outcomes (including disabled trial, unavailable configuration and skipped budget) are recorded but do not consume the execution claim. Atomically reserve budget and claim the key immediately before a provider attempt may start; release the claim only if no provider attempt began.” (Domain: Review run, Idempotency, retry, spend)

> “`dry_run=true` builds everything, returns the estimate and the manifest, calls no model and records nothing.” (Domain: Review run)

The criteria lookup uses captured/explicit `repo_id` and never searches across repositories. A resolver refusal becomes a recorded `refused_criteria` with the resolver code. Live calls require exact Haiku id and `high`; historical override is range-only `high|xhigh|max` and remains disabled by default. Do not infer session binding when Plan 22 is absent.

## Changes

- Add server configuration validation and zero-call availability checks for server-only credential/model/effort/cap/repository allowlist/trial settings. Never log or return secret values.
- Implement argument validation and the review state flow using APIs from units 4-01 to 4-03. Keep malformed arguments/capture and scope errors unrecorded; after acceptance, record exactly one `review_run` for every terminal status.
- Enforce tenant-scoped idempotency and atomic spend/in-flight reservation before provider attempts, conservative worst-case reservation per attempt/retry, settlement to usage, duplicate behavior, bounded retry, and preflight resume semantics as stated in the design.
- Provide the authenticated `POST /v1/reviews` and tenant-bound `GET /v1/reviews` routes, read/write scope checks, filters and body limits. `dry_run` must make zero calls and create no record.
- Store captured input only through the unit 4-02 content-addressed review-input API. Return receipts by default; never return captured input.
- Update only the matching `docs/design/01` review fact contract and `docs/design/03` env table rows.

### Keep untouched

- No MCP registration, shim changes, stage wiring, trial CLI, live deployment, Fly/Wrangler operation, secret access, or paid/live model call; those are outside this phase or explicitly prohibited.
- Do not alter other docs/design sections, other plans/phases, existing auth behavior, or review packet/criteria/provider/persistence/pricing implementations owned by dependency units.

## Done evidence

- Fake-endpoint route fixtures exercise all Phase 4 statuses and contract cases, including auth scope, resolver error propagation, retries, invalid/redacted replies, duplicate and changed keys, concurrent cap reservation, timeout reservation, disabled→enabled and budget→available resume, trial effort separation, dry-run zero-call behavior and tenant isolation.
- Tests prove the captured review input stays outside screening/scorer paths, review facts do not affect conversation/hook/facet counts, and GET returns only matching tenant records and requested filters.
- Default and retry requests explicitly carry `model: claude-haiku-5-5` and `output_config.effort: high`; fake historical calls carry each requested effort while live configuration stays high.
- Run focused Go suites under an 8 GiB address-space cap with `-p=3`; run `git diff --check`.
- The Phase 4 Outcome in `DESIGN.md` is verified through `POST /v1/reviews` → fake endpoint → persisted/readable result and through each unit's done evidence. Record the verification and any carried findings in `IMPLEMENTATION.md` when closing the phase.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include exact check commands and outputs, end-to-end status coverage, deviations, contradictions, unfinished work, and known problems. No credentials, provider calls, deploys, Fly, Wrangler, or paid/live review steps.
