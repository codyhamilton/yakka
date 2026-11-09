# Phase 4 unit 4-01 — Shared Haiku pricing

Status: `done`

Added exact `claude-haiku-5-5` pricing to the shared JSON source and identical Go embedded table. Go settlement and transcript cost-window calculations select tiers per input size; the Go API exposes the selected tier and SHA-256 pricing-table identity. Reservations select the upper tier when size is uncertain, allowing each retry to reserve independently. Existing flat model rates and Go cost behavior remain unchanged.

Pricing source: [Anthropic Haiku 5.5 pricing](https://www.anthropic.com/claude-haiku-5-5), checked 2026-11-09. The published boundary is 100,000 input tokens: at or below, input/cache-write/cache-read/output are $0.10/$0.125/$0.01/$0.50 per million; above, $0.50/$0.625/$0.05/$2.50. Stable tier labels are `up_to_100k` and `over_100k`. Table SHA-256: `0c0dfc73d2cbe45eec340ff4eb596dfe1a2ddc88f4238ca78eadc45a2a3e88c7`.

Checks:

- `GOMEMLIMIT=8GiB GOMAXPROCS=3 go test -p=3 ./internal/store` (from `packages/yakka`): `ok github.com/codyhamilton/yakka/packages/yakka/internal/store 4.360s`; includes embedded/transcript byte parity and existing flat-model cost tests.
- `python3 -m unittest discover -s tests -p 'test_pricing.py'` (from `tools/transcript`): 2 tests passed (`OK`); validates below, at and above boundary and tier-aware aggregation.
- `git diff --check`: clean.
- `cmp packages/yakka/internal/store/pricing_table.json tools/transcript/pricing.json`: identical.

Deviation: `pytest` was unavailable (`No module named pytest`), so the focused Python fixtures use the standard-library `unittest` runner and remain pytest-compatible. No pricing entries besides the requested model were changed. No provider call, credential, deployment, Fly or Wrangler action was used. Unfinished work: none. Known problem: the local environment lacks pytest; standard-library tests pass.
