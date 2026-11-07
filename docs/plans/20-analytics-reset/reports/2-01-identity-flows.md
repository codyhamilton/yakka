status: done with concerns
reason: Identity flows and the local/remote callback seam are implemented and covered by contract/unit and Go route tests; a browser end-to-end identity run was unavailable because this static package has no Playwright runner or dependency.

## Changed

- Added safe return-path, OAuth target/login, and session-gate contracts. The app checks `/v1/me` once per document, respects exempt and local routes, blocks analytics requests until the gate allows them, carries the remembered tenant, and directs only zero-tenant `no such tenant` failures to Profile.
- Added cookie/bearer-aware account transport and Login, OAuth callback, Device approval, Profile, and Settings flows. Device codes are normalized and preserved; approval/denial bodies use only documented fields. Token plaintext is displayed only at mint time and is not persisted.
- Local `/oauth/callback` now falls through to the static shell; remote collector mode retains its JSON callback handler.

## Verification

- `node --test tests/identity/contracts.test.mjs tests/static-shell.test.mjs tests/request-scheduler.test.mjs` from `packages/yakka-analytics`: 12 passed.
- `GOMEMLIMIT=8GiB go test ./internal/serve -run 'TestOAuthCallbackRouteIsShellLocallyAndJSONRemotely|TestSiteHandlerDirectCallbackFallback' -count=1` from `packages/yakka`: passed.
- `node --check` on identity flows, app, and transport modules: passed.

## Concerns and remaining work

- Playwright UI coverage for full callback/device/profile/settings interactions was not run: the static package has no Playwright configuration/dependency. No live OAuth, production data, credentials, deploy, or human action was used.
- No contract contradiction or implementation departure identified. No known external gate.
