# Report: phase2-02 — Phase 2 real-browser acceptance (C1–C6)

Status: done

## What changed

Owned paths only; no product code touched.

- `packages/yakka-analytics/tests/operable-chrome/phase3-harness.mjs`
  - Header now says the lifecycle helper stubs `/v1/me`, the destructive reset/delete calls, and the lifecycle page's own `GET /v1/analytics/event-counts` read, and nothing else analytics.
  - `installLifecycleStub` state adds `countRequests: []` and the DESIGN default `counts` (`status: 200`, zeroed `matched`/`tenant_total`, `unit: 'retained_record'`, `abort: false`, `gate: null`). `reset()` restores that default, clears `countRequests`, and nulls `gate`.
  - New `page.route(/\/v1\/analytics\/event-counts/, countsHandler)` (the existing `API_ROUTE` does not match it). It records into `state.countRequests` via `capture(state.countRequests, request, '')` — never `state.requests` — snapshots `status`/`body`/`abort` before the gate, awaits `state.counts.gate(entry)` when set, then aborts or fulfils. `state.requests`, `hold`, `/v1/me`, destructive semantics and `initialLifecycleTenants` are unchanged.
- `packages/yakka-analytics/tests/operable-chrome/phase3-acceptance.test.mjs`
  - Added `openDialogReady()` and call it after each A6 dialog open (all four existing flows) before typing/asserting `#confirm-action`.
  - Added C1–C6 real-browser groups after `analytics.splice(plan31Start)` and before F7, with local `defaultActive`, `countsBody`, `openDefaultLifecycle`, `openDefaultOp`, `scaleText`, `phraseLabelText` helpers. `default` is assigned per group after `lifecycle.reset()`, never to the shared fixture lists. The splice, row counts, A1–A7 flows, and the final `assert.deepEqual(analytics, [])` guard are untouched.

## Check output

Baseline with `phase2-01` landed and this unit's edits absent (HEAD test files, same command): the real page now loads counts, so the unguarded A6 flows race:

```
A6: Expected values to be strictly equal: true !== false
A6: locator.click: Timeout 30000ms exceeded.
  - locator resolved to <button disabled ... id="confirm-action">Confirm</button>
  - element is not enabled
# fail 1
```

Final pass (note: TMPDIR canonical absolute path — see departures):

```
cd packages/yakka-analytics
TMPDIR=/home/codyh/workspace/yakka-build/31/.scratch/t PUBLIC_CANVAS_TEST_MODE=true \
  NODE_OPTIONS=--max-old-space-size=8192 node --test tests/operable-chrome/phase3-acceptance.test.mjs
ok 1 - plan30 phase 3 acceptance
# tests 1  # pass 1  # fail 0
```

`results.json` evidence (all `failures: []`):

```
P2-C1 pass | C1 delete/reset name the exact scale, effect and phrase labels
P2-C2 pass | C2 Confirm gated on the loaded count, exact id and exact phrase both ways
P2-C3 pass | C3 Cancel sends nothing; Confirm sends exactly one unchanged DELETE
P2-C4 pass | C4 zero counts hide the phrase and ask only for the id
P2-C5 pass | C5 network error, 500 and non-numeric body all assume data and require the phrase
P2-C6 pass | C6 a cancelled dialog's late count never touches the next dialog
A6 pass | A6 profile default Active/—, Use tenant enabled and stores default, resetting Use tenant disabled, none-selectable token copy
A7 pass | A7 lifecycle default selected, unmarked/unsupported state, not-assigned generation, exact note, no buttons, foreign keeps selection note
C1 pass | C1 lifecycle deep link highlights the row and selection replaces the tenant URL
```

C7 integration rerun only (owned by `phase2-01`, not claimed here):

```
cd packages/yakka && go test ./internal/serve -run LifecycleProfile -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.011s
```

## Departures

- **Group ids `P2-C1`…`P2-C6`, not `C1`…`C6`.** The file already reports Plan 30 `C1` at lines ~749 and ~879; the new groups run earlier, so reusing `C1` would be overwritten in `results.json` by those later groups and the Phase 2 evidence would be lost. The checks themselves are DESIGN C1–C6 exactly, and the five earlier `C1` results are preserved.
- **TMPDIR canonical path.** `TMPDIR="$PWD/../../.scratch/t"` makes Chromium abort with `FATAL ... Socket path too long`; `/home/codyh/workspace/yakka-build/31/.scratch/t` is the same gitignored directory without `..` segments. No `/tmp` used.

## Unfinished / gates

- `gate: signed-in production check — not attempted (not automatable)`
- C7 remains `phase2-01`'s close; rerun above is integration evidence only. C1–C6 are closed by this unit's real-Chromium checks against the real Go lifecycle template.
