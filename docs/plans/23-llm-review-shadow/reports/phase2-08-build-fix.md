# Report: phase2-08 — post-commit build fix

Status: `done`

Branch: `feat/23b-review-controls-trial`

## Defect

`packages/yakka-analytics/src/lib/session-gate.svelte.ts` imported
`tenantLifecycleState` and `isLifecycleTracked` from `./session-gate`, but both
symbols are exported by `./api`. `./session-gate` re-exports neither, so the
build failed to resolve them.

## Fix

Minimal import correction in `src/lib/session-gate.svelte.ts`:

- Import `isLifecycleTracked` and `tenantLifecycleState` from `./api`
  (added to the existing `ApiError, fetchMe, type Tenant` import list).
- Removed the two names from the `./session-gate` import list.

No behavioral change: both symbols resolve to the same functions defined in
`api.ts` (`tenantLifecycleState` api.ts:33, `isLifecycleTracked` api.ts:38),
and the call sites in `chooseTenant` are untouched.

Changed lines: 1 production file, +1/-2.

## Check output

`npm run build` (offline installed deps), in `packages/yakka-analytics`:

```
TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp \
NODE_OPTIONS=--max-old-space-size=4096 npm run build
...
✓ built in 6.83s
> Using @sveltejs/adapter-static
  Wrote site to "build"
  ✔ done
```

Targeted tests, in `packages/yakka-analytics`:

```
TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp \
NODE_OPTIONS=--max-old-space-size=4096 \
npx vitest run src/lib/session-gate.test.ts src/lib/api.test.ts --maxWorkers=3

 ✓ src/lib/session-gate.test.ts (28 tests) 11ms
 ✓ src/lib/api.test.ts (24 tests) 23ms

 Test Files  2 passed (2)
      Tests  52 passed (52)
   Duration  347ms
```

`git diff --check`: no output (exit 0).

## Scope

Only `src/lib/session-gate.svelte.ts` changed plus this report. No network,
deploy, secrets, other paths/plans, or `/tmp`. Phase 3 not edited; review and
close-out not run.
