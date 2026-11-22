# Report: phase1-03 — Phase 1 real-browser acceptance (A2–A7, A9)

Status: done

## What changed

Owned paths only.

- `packages/yakka-analytics/tests/operable-chrome/phase3-harness.mjs`
  - `initialAccountTenants`: `tenant-p` fixture `Pending`/`pending` → `Resetting`/`resetting`.
  - `initialLifecycleTenants`: `t-p` fixture `Pending`/`pending` → `Resetting`/`resetting`.
  - Shared lists are otherwise unchanged; no `default` fixture was added to them.
- `packages/yakka-analytics/tests/operable-chrome/phase3-acceptance.test.mjs`
  - Analytics request log entries now carry `{ path, search }`, so A2–A4 can assert the `tenant=default` query.
  - Renamed fixtures in the A1 row assertion and the two C1 option tuples; `pending` → `resetting` in the C1 evidence label. Row counts and all other assertions are unchanged.
  - Added real-browser groups A2–A7 against the existing Chromium, account stub and real Go lifecycle template:
    - A2/A3: a single `default` fixture (`unsupported`, `unmarked`, and no `lifecycle_state` key) is enabled/selected as `default · default`, the URL gains `tenant=default`, no `.tenant-unavailable`, and every analytics request carries `tenant=default`.
    - A4: remembered and deep-linked `default` both select it; selecting `t-new` then `default` updates the URL each time.
    - A5: the shared `resetting` option is disabled with `Resetting · tenant-p · resetting`; the cleanup copy and the foreign-tenant copy are exact.
    - A6: `/profile` shows `default` Active with generation `—`, Use tenant enabled and storing `yakka-analytics-tenant=default`, token line `Selected tenant: default · default` with `create-token` enabled, `tenant-p` Use tenant disabled; a no-selectable list shows `Choose a tenant to issue a token.`
    - A7: the Go lifecycle page selects `default`, hides `#selection-note`, shows state `unsupported`/`unmarked`, generation `not assigned yet`, the exact §1.4(6) note and no Reset/Delete buttons; a foreign `?tenant=` keeps the selection note.
  - The `default` fixture is assigned per test (`account.state.tenants` / `lifecycle.state.tenants`), never to the shared lists.

## Check output

Baseline before this unit's edits (both product units landed, harness still `pending`):

```
PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/operable-chrome/phase3-acceptance.test.mjs
# fail 1
  A1 row:      actual 'Resetting' vs expected 'Pending'
  C1 profile:  actual 'Resetting · tenant-p · resetting' vs expected 'Pending · tenant-p · pending'
  C1 lifecycle: actual 'Resetting · t-p · resetting' vs expected 'Pending · t-p · pending'
```

That failure is the product change landing before the fixture rename, so the brief's "current passing baseline" did not exist at this commit. The rename-only failure was also captured by stashing the acceptance edits (harness renamed, old expectations present):

```
actual 'Resetting · tenant-p · resetting' vs expected 'Pending · tenant-p · pending'
# fail 1
```

Final pass:

```
cd packages/yakka-analytics
PUBLIC_CANVAS_TEST_MODE=true NODE_OPTIONS=--max-old-space-size=8192 node --test tests/operable-chrome/phase3-acceptance.test.mjs
ok 1 - plan30 phase 3 acceptance
# tests 1   # pass 1   # fail 0
```

A2–A7 evidence from `results.json`:

```
A2 pass  marker-less default (unsupported) selected, enabled, URL tenant=default, every analytics read carries tenant=default
A3 pass  unmarked and absent lifecycle_state behave exactly like the unsupported default
A4 pass  remembered and deep-linked default, then select t-new and default updates the URL each time
A5 pass  resetting option disabled, cleanup and foreign unavailable copy exact
A6 pass  profile default Active/—, Use tenant enabled and stores default, resetting Use tenant disabled, none-selectable token copy
A7 pass  lifecycle default selected, unmarked/unsupported state, not-assigned generation, exact note, no buttons, foreign keeps selection note
```

A8 integration rerun (owned by `phase1-01`, not claimed here):

```
cd packages/yakka && go test ./internal/serve -run LifecycleProfile -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.009s
```

A9 grep:

```
grep -rn "activeTenants\|lifecycle !== 'active'\|lifecycle !== \"active\"\|=== 'active'" packages/yakka-analytics/web packages/yakka/internal/serve/lifecycle_profile.html
(no output, exit 1)
```

## Departures

- **Final analytics guard.** The test ends with `assert.deepEqual(analytics, [], 'an account route performed an analytics read')`. A2–A4 must navigate `/b/pulse`, which necessarily records analytics requests. After the A2–A7 section the test removes exactly the reads recorded since the section start (`analytics.splice(plan31Start)`), so the final guard keeps its original meaning for every other route. A6 separately asserts its `/profile` navigation recorded no analytics read. Reason: the brief requires the `/b/pulse` reads and also says to keep every other assertion; without this the two cannot both hold.
- **Baseline ordering.** The brief's done-evidence sequence assumes a passing baseline, but after `phase1-02` the un-renamed `pending` fixture is already selectable, so the baseline fails on the three stale expectations. Both that state and the rename-only failure are recorded above.

## Unfinished / gate

None. No signed-in production check was attempted and no live tenant was touched.

## Problems

None found in this unit's surface. No product code was changed.
