status: done with concerns

## What changed

- `tools/release/build.sh` now embeds `packages/yakka-analytics/web/` without Node/npm, omits Pages-only `_headers`, rejects missing/placeholder indexes, and restores the committed placeholder on success or failure. `test_release.py` runs with an isolated PATH that has Go and required system tools but no Node/npm; it checks embedded app/uPlot assets, `_headers` exclusion, and placeholder restoration after validation and simulated compiler failures.
- The Go handler now gives the index and client-route fallback `no-cache`, immutable caching to versioned `vendor/<name>-<version>/` assets, and `no-cache` plus SHA-256 ETags/revalidation to other files. Embedded responses receive the policy in `web/_headers`; tests cover fallback routes, MIME, cache, 304 revalidation and policy parity.
- Pages now points to `./web`; cache ignores, Docker ignore rules and current-state docs were aligned. Docker remains placeholder-only. CONTRACTS.md records the updated test behavior and the callback integration boundary.

## Checks before and after

Before: `python3 -m unittest tools.release.test_release.BuildTests.test_7_build_sh` failed because the old release script ran `npm ci`, but the shell unit had removed the package lock. The old focused Go site tests passed against the previous Svelte-specific behavior.

After:

- `GOMAXPROCS=3 python3 -m unittest tools.release.test_release` — 11 tests passed. The release build used a PATH with neither Node nor npm; four binaries contained the app and uPlot assets, excluded `_headers`, and left the placeholder clean. Failure cases restored it too.
- `GOMAXPROCS=3 go test -p=3 ./internal/serve -run 'TestSite' -count=1` from `packages/yakka` — passed.
- `NODE_OPTIONS=--max-old-space-size=8192 node --test packages/yakka-analytics/tests/*.test.mjs packages/yakka-analytics/tests/e2e/*.test.mjs` — 13 passed.
- `python3 tools/release/test_layout.py` — 7 passed. `git diff --check` — passed. `wrangler.toml` reports `./web`; `Dockerfile` still copies only `packages/yakka/`, and `site/index.html` is the committed placeholder.

## Deviations, concerns and unfinished work

- **Brief/design conflict:** the brief says to leave `wrangler.toml` unchanged at `./build`; DESIGN.md and CONTRACTS.md 10.2, 14 and 17.6 require Phase 1 to set `./web`. The design/contract target was followed and the brief conflict is named here.
- `GOTOOLCHAIN=local` in the release script could not build this repo's `go 1.27.1` module with the installed Go 1.24 toolchain. The cross-build now uses `GOTOOLCHAIN=auto`; the release suite passed with that setting.
- The direct `/oauth/callback` fallback passes at `siteHandler` level. The full server mux currently registers the OAuth API callback before the site handler even in local mode, so a local full-server request returns 401 instead of the shell. This unit did not change route ownership; Phase 2 integration should reconcile the mux while preserving the remote API callback.
- Pages automation is outside this repository and was not run. No deployment, secrets or live data were used. There is no other unfinished work in this unit.

gate: verify the external Pages automation accepts the repository's `./web` output directory; this unit did not deploy or inspect the job.
