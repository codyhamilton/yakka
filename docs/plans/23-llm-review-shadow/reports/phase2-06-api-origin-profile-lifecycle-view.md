# Report: phase2-06 — API-origin bounded profile lifecycle view

Status: `done`

Branch: `feat/23b-review-controls-trial`

## What changed

- `internal/serve/lifecycle_profile.go` (new): `//go:embed lifecycle_profile.html` plus `handleLifecycleProfile`, serving `text/html; charset=utf-8` with `Cache-Control: no-cache`. It reads no files at runtime and does not depend on `siteFS`, Node, npm or the analytics bundle.
- `internal/serve/lifecycle_profile.html` (new): self-contained page (inline CSS/JS) for `GET /profile/lifecycle`.
  - Loads `/v1/me` with `credentials: 'include'` and no credential header; shows owner login/id and each owned tenant's name, immutable id, `lifecycle_state` and `lifecycle_generation`.
  - Unauthenticated (401) shows a `/oauth/login` sign-in link; failed `/me` shows "completion unknown" and disables actions; `unsupported` shows the legacy reason with no actions; `resetting`/`deleting` show in-progress and disable actions.
  - Separate Reset/Delete confirmations named by operation and tenant; both show the mandatory human-owner sentence and the exact reset/delete effect copy; the confirm button enables only when the typed text equals the immutable id.
  - Destructive request: `POST /v1/tenants/<id>/reset` or `DELETE /v1/tenants/<id>`, JSON `{"confirm_tenant_id":"<id>"}`, `Content-Type: application/json`, `X-Yakka-UI: tenant-lifecycle`, `credentials: 'include'`, no credential header.
  - On `204`: clears remembered selection/generation and cached read/cursor keys, posts a `BroadcastChannel` message plus a storage invalidation event for same-origin tabs, re-fetches `/me`, shows an explicit re-selection/create note and never auto-selects.
  - On ambiguous network failure: shows "completion unknown", re-fetches `/me`, and never replays the destructive call. Non-204 responses map the required error codes to messages.
  - Links to the Pages profile (`https://yakka.build/profile`) for token creation after reset.
- `internal/serve/serve.go`: one route registration `GET /profile/lifecycle` immediately before the `/` site fallback.
- `internal/serve/lifecycle_profile_test.go` (new): placeholder-mode serving, content/route/header assertions, unauthenticated and recovery-state assertions, and script contract assertions.

## Check output

Failing checks first (route registration temporarily reverted; new production/test files present):

```
$ TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'LifecycleProfile|ProfileView'
--- FAIL: TestLifecycleProfileServedInPlaceholderMode
    lifecycle_profile_test.go:41: GET /profile/lifecycle = 404 "{\"error\":\"analytics bundle not embedded\"}\n"
--- FAIL: TestLifecycleProfileUnauthenticatedAndRecoveryStates
    lifecycle_profile_test.go:83: lifecycle view has no API-origin sign-in path
--- FAIL: TestLifecycleProfileScriptContract
panic: runtime error: slice bounds out of range [-1:]
FAIL	github.com/codyhamilton/yakka/packages/yakka/internal/serve	0.010s
```

After:

```
$ TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve -run 'LifecycleProfile|ProfileView'
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/serve	0.012s

$ TMPDIR=... prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/serve
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/serve	15.644s

$ go vet ./internal/serve && go build ./...
(no output)

$ git diff --check
(no output)
```

The placeholder-mode test also confirms `/quality` still returns the original "analytics bundle not embedded" 404, so the site fallback is unchanged.

## Deviations

- Browser verification: I did not execute a real browser. The modal/typed-id flow, recovery and invalidation behaviour are asserted as page-content checks (required strings, header/credential construction, no scheduling/loop construct and no pre-confirmation mutation call). The observable browser flow should be checked manually where a browser is available.
- No other departures. The route, embed, confirmation copies, error surfacing, header and no-bearer rules match the brief.

## Problems / unfinished

- None for this unit. The page is intentionally not a frontend build and does not clear Pages/cross-origin storage; Pages revalidates at its next `/me` read per the contract.
- The signing-in link targets the API-origin `/oauth/login`; on production that route begins the existing OAuth flow, while the Pages profile remains the token-creation surface.

## Contradictions

- None found between the brief and the cited contracts. The exact human-owner sentence is included verbatim; the API's own 403 message additionally appends "Open the profile UI." as designed in `03-remote-service.md`, which is not part of the page copy.
