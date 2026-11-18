# 13-03 Identity and routes handoff

Status: done with one named departure (see Departures). The Pages-faithful account rig, the full-mux route proof and the exact brief commands pass.

## What changed

- `packages/yakka-analytics/tests/identity/browser.test.mjs`: a Pages/API host-mapped Chromium rig (`yakka.build` and `api.yakka.build` to loopback on one ephemeral TLS port, throwaway certificate) with a contract-faithful stub and eight named account-flow subtests. It uses the existing Chromium 1243 cache and `playwright-core`, an in-worktree `TMPDIR`, and no fixed sleeps. The init script seeds the API base only on the Pages origin.
- `packages/yakka/internal/serve/site_test.go`: `TestOAuthCallbackRouteIsShellLocallyAndJSONRemotely` now asserts the full local mux returns the built shell for `/device`, `/oauth/callback`, `/login`, `/profile` and `/settings`, and still asserts the remote callback is the API's JSON response.
- `packages/yakka-analytics/web/js/app.js`: one-line shell wiring fix, a departure from the owned paths (reason below). No identity flow, OAuth/device request contract or production route policy changed.

## Evidence

Before (exact Node command): 10 passed / 5 failed. Failures were signed-out deep-link redirect, device approval (button permanently disabled), profile token form missing, Settings sign-out, and the parent diagnostics assertion.

After the exact brief commands:

```
TMPDIR=.scratch/p13 NODE_PATH=... PUBLIC_CANVAS_TEST_MODE=true \
NODE_OPTIONS=--max-old-space-size=8192 node --test --test-concurrency=1 \
packages/yakka-analytics/tests/identity/*.test.mjs
# tests 15  pass 15  fail 0  cancelled 0  skipped 0
```

That is seven `contracts.test.mjs` tests (the brief's six-or-higher) plus the eight browser subtests. The parent browser test passes its diagnostics gate (only the fixture's exact 401/403/500 `Failed to load resource` entries are allowed; any page error, CSP violation or refused connection still fails) and its `maxInFlight <= 4` gate.

```
TMPDIR=... GOMAXPROCS=3 GOMEMLIMIT=8GiB go test -p=3 ./internal/serve \
-run 'TestSiteBuiltMode|TestOAuthCallbackRouteIsShellLocallyAndJSONRemotely' -count=1
# PASS, 2/2 named tests
```

`git diff --check` is clean.

## Account-flow subtests (8/8 pass, zero skips)

1. signed-out deep link keeps `user_code` through `/login` and builds the API login href; 2. callback success forwards `code`/`state` and returns to `/profile`; 3. callback denial stays on callback with the message; 4. callback API error stays on callback with the message; 5. device code normalises to `ABCD-EFGH`, the host is shown, approval posts `{user_code,tenant,scope,lifetime}`; 6. device denial posts `{user_code,action:"deny"}`; 7. profile creates a tenant, mints the one-time token once, and revokes the listed token; 8. Settings saves the base (port retained) and bearer, then signs out through the API and lands on `/login`.

## Callback and route result

No mux gap remains. Local mode serves the shell for all five account paths; remote mode serves `/oauth/callback` as JSON (`401 unauthorized` here because the fixture code is not exchanged), matching CONTRACTS 10.1. `serve.go` was not modified.

## Departure

`packages/yakka-analytics/web/js/app.js` is outside this unit's owned paths. It was changed because the browser proof found a real regression: the Phase 9 router refactor (`eaaf5b5f`) replaced the Phase 2 list of session-exempt account paths with `isAccountRoute(path)`, so `/device` and `/profile` stopped loading `/v1/me`. CONTRACTS 5.2.1 exempts only `/login`, `/oauth/callback` and `/settings`; without `me`, signed-out `/device` does not redirect, device approval stays disabled with zero known tenants, and profile cannot offer token minting. The fix restores the documented gate and changes no contract or route. It is shell wiring, not an identity module (`web/js/identity/`, `web/contract/` are untouched).

## Carried items

None for this unit. If the departure is rejected, the account rig will fail on the five `me`-dependent subtests until an owner fixes `app.js`; the rig itself is correct.

## Gates

`gate: none`.
