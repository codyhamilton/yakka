# Plan 31 mockups

Design references for `../DESIGN.md`. Where they differ, the written spec is authoritative.

| PNG | Shows |
| --- | --- |
| `tenant-selector.png` | Shell with the Tenant select drawn open: `default · default` chosen and enabled, `Old build … · resetting` greyed. Page text names a tenant with no lifecycle marker as selectable. |
| `profile-tenants.png` | Profile tenants table: `default` is Active with generation `—` and Use tenant enabled; the resetting row's Use tenant is disabled. |
| `lifecycle-confirm.png` | `/profile/lifecycle` delete dialog for `default`: scale line, effect copy, immutable-id box and the second phrase box. |

Method (same as Plan 30): static HTML, synthetic data, 1440x900 dark theme. `src/generate.py` copies the product CSS verbatim from `packages/yakka-analytics/web/css/` into `src/css/`, extracts the header markup from `web/index.html` and the lifecycle page `<style>` from `packages/yakka/internal/serve/lifecycle_profile.html`. `src/capture.mjs` uses the repository's Playwright/Chromium loader and checks width, 28-32px rows, no white surface and no page errors.

```
python3 docs/plans/31-legacy-tenant-adoption/mockups/src/generate.py
node docs/plans/31-legacy-tenant-adoption/mockups/src/capture.mjs
```

All counts, ids and times are synthetic. The tenant `default` is shaped like Cody's real tenant (large ledger); the numbers are not read from production.
