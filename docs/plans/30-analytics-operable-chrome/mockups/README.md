# Plan 30 visual references

All data is synthetic. These are design documents, never product fixtures. The written DESIGN.md is authoritative. Each HTML file is independently openable and shares local CSS/JS; no production API requests or account writes exist. Analytics preview filters update the local URL/count text on Apply, All history and Reset; Tenant and Theme work locally. Account forms merely show a design-preview notice.

The PNGs are 1440×900 viewport captures, device scale 1, using headless Chromium. Long screens continue below the viewport. Real token declarations are copied verbatim from packages/yakka-analytics/web/css/charts.css at this design's starting tree. References use 112px plots to show more regions in one image; production chart minimum is 160px as DESIGN.md requires. Table rows are 30px in both.

From repository root:

```bash
python3 docs/plans/30-analytics-operable-chrome/mockups/src/generate.py
node docs/plans/30-analytics-operable-chrome/mockups/src/capture.mjs
```

capture.mjs uses the existing analytics test browser loader (playwright-core and the local Chromium cache), captures every HTML listed in src/screens.json, and checks dimensions, row density, surface colour, console errors and local filter interactions. No dependency installation is needed on this machine. It does not validate product implementation.
