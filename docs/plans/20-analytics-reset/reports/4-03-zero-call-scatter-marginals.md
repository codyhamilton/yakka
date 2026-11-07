# Phase 4 scatter marginal correction

Status: **fixed and verified**.

## Change

Session scatter now adds sessions with no model-call rows to the zero-value marginal bin, including when the usage distribution has no rows and therefore no bins. This applies to token measures and cost. A no-call session's zero cost remains eligible; cost from all-unpriced call sessions remains excluded by the existing distribution pricing rules. The regression fixture has 5,005 no-call sessions and checks deterministic point rows, full-population marginal totals for tokens and cost, and cost eligibility.

## Verification

From `packages/yakka`:

`GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve -run 'TestAnalyticsSessionScatterDeterministicSampleHasWholePopulationMarginals' -count=1` — **passed**.

`GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/store ./internal/serve -count=1` — **passed** (`internal/store` 8.577s; `internal/serve` 28.397s).

## Remaining Phase 4 gaps

- Session aggregate dimensions remain unsupported; aggregate results are whole-population scalars.
- Legacy-count reconciliation and the full fixed outcome are not established by these focused checks. The 4-01 and 4-02 reports also record unavailable pricing, catalogue, and tool-kind revision identifiers; schema coverage reports these as gaps.
