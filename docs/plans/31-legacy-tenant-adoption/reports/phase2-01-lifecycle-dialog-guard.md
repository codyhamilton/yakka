# Report: phase2-01 — Lifecycle dialog names the scale of loss and needs a second phrase

Status: done

## What changed

Owned paths only:

- `packages/yakka/internal/serve/lifecycle_profile_test.go` — updated `lifecycleProfileResetCopy` and `lifecycleProfileDeleteCopy` to the DESIGN §2.1(1) strings; `lifecycleProfileHumanCopy` and test structure unchanged.
- `packages/yakka/internal/serve/lifecycle_profile_phase3_test.go` — extended the first contract map with the §2.2 substrings: `op-scale`, `typed-phrase`, `phrase-label`, `PHRASES`, `loadScale`, `/v1/analytics/event-counts?tenant=`, `AbortSignal.timeout`, the three exact scale copy strings, `reset all data`, `delete all data`. Existing second-map checks (`confirm_tenant_id`, `X-Yakka-UI`, `tenant-lifecycle`) and the `setTimeout` prohibition are unchanged.
- `packages/yakka/internal/serve/lifecycle_profile.html`
  - Constants: new exact `RESET_EFFECT`/`DELETE_EFFECT`, added `PHRASES = { reset: "reset all data", delete: "delete all data" }`.
  - Style: added `dialog [hidden]{display:none}` directly after the `dialog label` rule; 600px width untouched.
  - Markup: `#op-scale` after `#op-effect`; `#phrase-label` (with `#phrase-text`, `#typed-phrase`) after the typed-id label.
  - `openConfirm`: sets the "Checking…" scale text, `scale = {status:"loading"}`, clears both inputs, hides the phrase label, keeps Confirm disabled, shows the dialog, then calls `loadScale`.
  - `loadScale`: DESIGN §2.1(4) verbatim — event-counts GET with `credentials:"include"`, `Accept: application/json`, `AbortSignal.timeout(15000)`, finite-number check on `tenant_total`, and the `state.pending !== pending` stale guard.
  - `paintScale`: exact §2.1(5) copy for `ok`/`empty`/`unknown`, `toLocaleString("en-US")`, `Resetting`/`Deleting` verb, phrase label toggled.
  - `updateConfirm`: exact enable rule (pending exists, not loading, id matches, phrase matches for `ok`/`unknown`, not busy/recovery-failed); registered on both `typed-id` and `typed-phrase` inputs.
  - `submitConfirmed`: added the ok/unknown phrase re-check before clearing `pending`; request URL/method/headers/body unchanged.
  - Added a `close` listener that drops `state.pending`, so Esc behaves like Cancel.

## Check output

Before the page change (test files updated first):

```
--- FAIL: TestLifecycleProfilePhase3Page (0.00s)
    lifecycle_profile_phase3_test.go:102: lifecycle page missing scale line ("op-scale")
    ... missing typed-phrase, phrase-label, PHRASES, loadScale, endpoint, AbortSignal.timeout, all three scale copy strings, reset/delete phrase ...
    lifecycle_profile_phase3_test.go:135: lifecycle page lost reset/delete effect copy
--- FAIL: TestLifecycleProfileServedInPlaceholderMode (0.00s)
    lifecycle_profile_test.go:67: lifecycle view missing reset/delete confirmation copy
FAIL
```

After the page change:

```
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/serve	0.033s
```

Other done evidence:

```
grep -cF '<new delete copy>' lifecycle_profile.html → 1
grep -cF 'dialog [hidden]{display:none}' lifecycle_profile.html → 1
grep -cF 'AbortSignal.timeout(15000)' lifecycle_profile.html → 1
grep -n 'setTimeout' lifecycle_profile.html → (no output)
```

## Departures

None. Work followed the brief's change list literally. Where the mockup differed (scale above effect, mockup-only danger/bold styling), DESIGN §2.1(2) was followed: `#op-scale` after `#op-effect`, no scale-colour rule.

## Unfinished / gate

`gate: C1–C6 real-browser dialog checks are closed by phase2-02` — C1–C6 are real-browser checks owned by `phase2-02`; this unit wrote only the markup and copy they exercise and does not claim them closed.
