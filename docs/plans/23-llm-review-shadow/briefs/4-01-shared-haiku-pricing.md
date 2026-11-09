# Brief: 4-01 — Shared Haiku pricing

Consumer: Plan 23 Phase 4 review orchestration and the existing Go/Python transcript cost consumers.
Owned paths: `packages/yakka/internal/store/pricing.go`, `packages/yakka/internal/store/pricing_table.json`, `packages/yakka/internal/store/pricing_test.go`, `tools/transcript/pricing.json`, transcript pricing tests, and `docs/plans/23-llm-review-shadow/reports/4-01-shared-haiku-pricing.md`. Touch nothing else.
Commits: Commit implementation and report when done evidence passes, with a plain-summary title.
Report: Before committing, write the report named above (rubric: `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing.
Runs alongside: 4-02 and 4-03; keep changes to pricing-owned files and tests only.
Budget: 8 files to read, about 350 lines to change, 25 tool turns. Past the budget, stop and report an actionable handoff.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Domain: Review record and tracking, Cost; Phase 4 Outcome.
2. `packages/yakka/internal/store/pricing.go` and `pricing_test.go` — current Go pricing behavior and equality contract.
3. `tools/transcript/pricing.json` and its pricing tests — shared source and consumers.
4. `packages/yakka/internal/review/build.go` — policy and review package boundaries only.

## Goal

Extend the existing shared pricing source and calculators so Phase 4 can price the exact configured Haiku model and provider-reported usage, including the published input-size tiers.

## Contract

Binding design text:

> “Phase 4 adds the missing `claude-haiku-5-5` entry and tier-aware pricing to the shared store/transcript pricing surfaces: master has only flat rates and lacks this id. Validate the provider’s published tier boundary below, at and above it; reservations use the higher tier whenever uncertain. No second review-specific price list; `unpriced` is impossible because an unpriced model is `unavailable`.” (Domain: Review record and tracking, Cost)

> “shared pricing fixtures below/at/above the published tier boundary prove settlement and conservative reservations (including a retry) and existing flat-model costs remain unchanged” (Phase 4 Outcome)

The reviewer model remains the exact `claude-haiku-5-5` id. Preserve current behavior for every existing model and preserve the equality test between Go's embedded table and `tools/transcript/pricing.json`.

## Changes

- Add the exact model pricing data to the shared table/source, and support its published tier boundary in the shared pricing API without creating review-only pricing logic.
- Make the conservative reservation rate selectable at the higher tier when usage or size is uncertain; keep settled usage tier-aware.
- Record the source and table identity needed by the review record. Do not update unrelated pricing entries.
- Confirm the exact current tier boundary and rates from the provider-published pricing source; capture the source and date in code metadata/tests as the existing pricing format supports.

### Keep untouched

- Keep all existing model rates, pricing semantics, and flat-model costs unchanged.
- Do not add a provider call, credential, deployment, or alternate price list.

## Done evidence

- Add fixtures strictly below, exactly at, and strictly above the published boundary; prove selected settlement rates and conservative reservation rates.
- Existing pricing parity and cost tests continue to pass. Run focused Go and Python pricing tests under the repository's 8 GiB cap and `-p=3` where Go tests apply.
- `git diff --check` is clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include exact check commands and outputs, pricing source/boundary, deviations, contradictions, unfinished work, and known problems. No credentials, provider calls, deploys, Fly, Wrangler, or paid/live review steps.
