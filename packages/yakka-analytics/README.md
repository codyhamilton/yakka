# yakka-analytics

**Consumers** — the `yakka` binary embeds `web/`; Pages serves the same static directory.

**Build** — no build step. The release script embeds `web/` directly.

**Test** — run `node --test packages/yakka-analytics/tests/*.test.mjs packages/yakka-analytics/tests/e2e/*.test.mjs`; browser checks use Chromium in the phase harness.

**Release** — static files are embedded in `packages/yakka` and hosted by Pages from `web/`.
