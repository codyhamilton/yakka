# yakka-analytics

**Consumers** — the `yakka` binary embeds `web/` (release builds, via `tools/release/build.sh`); Pages serves the same static directory. The Docker image does not embed the site and keeps serving the placeholder.

**Build** — no build step, no Node or npm. `web/` is the static no-build output: `index.html`, `_headers`, `css/`, `js/`, `contract/` and `vendor/uplot-1.6.32/`, with absolute asset URLs and no `404.html`. `tools/release/build.sh` copies `web/` (except `_headers`) into `packages/yakka/internal/serve/site/`, compiles the binaries and restores the committed placeholder on exit, success or failure. It never uploads.

**Test** — run `node --test packages/yakka-analytics/tests/*.test.mjs packages/yakka-analytics/tests/e2e/*.test.mjs`; browser checks use Chromium in the phase harness. Release checks (`python3 -m unittest tools.release.test_release`, `python3 tools/release/test_layout.py`, `python3 tools/release/test_scan_residual_names.py`) cover the embed, placeholder restore and residual names; `tests/static-shell.test.mjs` scans the shipped `web/` for bearer-token literals.

**Release** — static files are embedded in `packages/yakka` and hosted by Pages from `web/` (`wrangler.toml`: `pages_build_output_dir = "./web"`). Pages deploys automatically on merge to master through an external automation job that is not visible from this repo; that job must accept `./web` as its output directory. The API is a separate release on Fly and is not deployed by this package. The browser detects API capability from `/v1/analytics/schema` and shows an unsupported state for features an older server lacks. No manual deploy, configuration or secrets step is part of this package's release.
