# Plan 20 implementation

Tool: Codex execute skill
Run ID: feat/20-analytics-reset phase 1 execution
Start time: 2026-11-08 04:48 Australia/Brisbane (2026-11-07 18:48 UTC)

## Phase 1 — Reset and shell

Refinement commit: `d570de6` (`docs: refine Plan 20 Phase 1 briefs`). It records three units and their dependencies in `DESIGN.md` and adds the three dispatchable briefs. The fixture and shell units are independent; release/serving depends on both. The first-design coarse check found the phase surfaces, contracts, observable outcomes and dependency order in place. `artifact_feedback` on each brief returned `delivered` / awaiting screen, with no rejection. No product work has landed yet.

### `1-02-framework-free-shell.md`

- Outcome: committed as `505360a`; replaced SvelteKit with the static shell, URL codec, schema-driven transport, scheduler, theme bootstrap and vendored uPlot; added the test-only harness and package README.
- Surfaces: `packages/yakka-analytics/`.
- Verification: Node suite 13/13; `python3 tools/release/test_layout.py` 7/7; system Chrome confirmed deep-route shell rendering, fixture-summary probe, unknown-route fallback and verbatim legacy `range too wide` without retry. No animation/timing assertions.
- Deviations and carried items: Playwright-core is unavailable, so its Chromium acceptance remains outstanding. The worker left `wrangler.toml` unchanged per the brief although DESIGN/CONTRACTS specify `./web`; the release/serving unit must resolve this. Release embedding and headers remain unverified.
- `artifact_feedback`: delivered, screen pass (`jev-1.13.0`).
- gate: provide Playwright-core in the phase test environment and run the Chromium shell harness.

### `1-01-fixture-ledger.md`

- Outcome: committed as `2b4d2c3a7a0c3690982e7131d9fae7fbe2744ee2`; added the non-shipping deterministic ledger generator and manifest covering the populations, relations, chronology and resource boundaries in the brief.
- Surfaces: `packages/yakka/internal/analyticsfixture/`.
- Verification: `GOMEMLIMIT=8GiB go test ./internal/analyticsfixture -count=1 -v` passed; generated-ledger assertions cover exact manifest counts, timestamp bounds, shared bodies, scorer-specific scores, session repo cardinalities, three execution shapes, rejection stages and the unpriced tail. Candidate comparison selected batch append: same 5,015-event oracle, 196 ms versus 11.855 s for single-row append.
- Deviations and carried items: none. The 32,767-hash fixture takes about 187 seconds to generate and verify; later tests should construct it once per setup and reuse it.
- `artifact_feedback`: delivered, screen pass (`jev-1.13.0`).
