# Brief: phase3-01 — Server adoption, the flag and the `unmarked` rename

Consumer: the build worker that implements this unit.
Owned paths: `packages/yakka/internal/serve/registry_lifecycle.go`, `packages/yakka/internal/serve/registry.go`, `packages/yakka/internal/serve/session.go`, `packages/yakka/internal/serve/serve.go`, `packages/yakka/internal/serve/review_cursor.go`, `packages/yakka/internal/serve/tenant_lifecycle.go`, `packages/yakka/internal/serve/device_grants.go`. Touch nothing else, and **do not edit `fly.toml`**.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/31-legacy-tenant-adoption/reports/phase3-01-product-adoption.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing (Phases 1 and 2 have landed).
Runs alongside: `phase3-03` (docs) — disjoint paths. Not `phase3-02`: the Go tests need this unit’s new symbols at run time.
Budget: 7 files to read, about 130 changed lines, 45 tool turns. Past the budget, stop: write a handoff under this brief’s name in `docs/plans/31-legacy-tenant-adoption/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/31-legacy-tenant-adoption/DESIGN.md` — “Phase 3 specification” §3.1–3.5 and §3.9 (B2, B5); the Phase 3 outcome under “Phases”; Assumption Ledger 2, 3, 4, 5, 8, 9, 12, 17 and 18. Binding: the exact comments, method bodies, field and env names, and log messages.
2. `packages/yakka/internal/serve/registry_lifecycle.go` — the whole file (235 lines): the state constants, `TenantLifecycleRecord`, `TenantLifecycle`, `TenantGeneration`, `beginTenantLifecycle` and the completion methods.
3. `packages/yakka/internal/serve/registry.go` — `createTenantLocked` (around 294–320), `TenantInfo` (364–369), `saveLocked`/`Persist` (165–195).
4. `packages/yakka/internal/serve/serve.go` — `Config` (36–49), `ConfigFromEnv` (85–125) and `New` (288–327).
5. `packages/yakka/internal/serve/session.go` — `tenantsOwnedBy` (104–132).
6. `packages/yakka/internal/serve/review_cursor.go` 100–108, `packages/yakka/internal/serve/tenant_lifecycle.go` 22–27 and 160–170, `packages/yakka/internal/serve/device_grants.go` 30–38 and 100–110.
7. `fly.toml` — read only, to confirm you must not change it. Do not open it for editing.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Hard rules (apply to this unit)

- `docs/plans/31-legacy-tenant-adoption/DESIGN.md` is authoritative and literal. Implement every binding contract exactly as written, including the Phase 3 specification (3.1–3.9), the Phase 3 outcome, and acceptance check IDs B1–B5. Do not reopen any decision in the Assumption Ledger (notably Assumptions 2, 3, 4, 5, 8, 9, 12, 13, 14, 15, 17, 18). No invented scope: no manual adopt API, no per-tenant confirmation, no inferring a marker from the id, no migrating only `default`.
- **OVERRIDE signed off 22 Nov (Solution Designer / Executor standing rule):** do **not** set `YAKKA_ADOPT_UNMARKED_TENANTS = "true"` in `fly.toml` and do **not** add the `fly.toml` comment. DESIGN.md §3.6 is skipped entirely for this plan. **No brief may edit `fly.toml`.** Phase 3 implements `AdoptUnmarkedTenants`, the env flag with the code default off, the docs and the tests. The orchestrator records `gate: YAKKA_ADOPT_UNMARKED_TENANTS stays off in fly.toml until Phase 2 has shipped`.
- Never push, never merge, never force-push, never rebase, never touch `master` or other branches, other plans’ build branches, `/home/codyh/workspace/yakka-wt/` (including the design worktree `yakka-wt/31-legacy-tenant-adoption`) or other `/home/codyh/workspace/yakka-build/` directories. Leave `/home/codyh/workspace/.briefs/yakka/HOLD` alone.
- Never run `fly` or `wrangler`, never deploy, never set/read/print secrets or the trial token (`YAKKA_TRIAL_TENANT_TOKEN`). Never reset or delete a live tenant. Never use Cody’s live `default` tenant in any test, probe or live check. Fixture objects named `default` in unit or Go tests, exactly as DESIGN.md specifies, are allowed. If a live read is needed, use only the trial tenant test from `/home/codyh/.config/yakka/trial.env` (source into the command env; never print the token). This unit needs no live read.
- Tests: 8 GiB memory cap. No vitest, Playwright or Chromium in this unit (this Go package has no such runner). No animation or timing tests. No `/tmp`: use a gitignored directory under the worktree (`.scratch/`) for any temp registry copy; run Go commands with `TMPDIR=<worktree>/.scratch/t`. Run `gofmt` on every changed Go file.
- Signed-in production checks are not automatable (Yakka has no automated sign-in): do not attempt them; record `gate: signed-in production check <what>`. Record anything needing Cody or an external system as a line `gate: <what>`.
- Sub-runs are launched by the orchestrator with `~/workspace/.briefs/q/hlaunch.sh KIND [pick args] -- LOGFILE PROMPT`; do not pick or launch separate sub-runs yourself. Do not spawn agents beyond read-only research helpers; if this unit needs one, it was mis-sized — report `blocked`.
- Mockups are **not applicable** to this unit. Phase 3 touches no screen, no HTML, no web UI and no mockup. Do not edit or copy `mockups/tenant-selector.png`, `mockups/profile-tenants.png`, `mockups/lifecycle-confirm.png` or anything under `mockups/src/`. If you believe a screen is touched, stop and report why; otherwise there is none.

## Goal

Make the server, at startup and only when `YAKKA_ADOPT_UNMARKED_TENANTS` is truthy, give every owned tenant that has no lifecycle marker a fresh random marker and generation with `state=active`, saving once and doing nothing on a second run; rename the derived `/v1/me` value from `unsupported` to `unmarked`; and add the dated policy comments that reverse the Plan 23 rule. This unit closes the product half of B2 and the dated-comment half of B5. B1/B3/B4 are `phase3-02`; the docs half of B2 and the Plan 23 half of B5 are `phase3-03`.

## Contract

Cited from DESIGN.md §3.1–3.5 and §3.9; settled, not to be re-derived.

- §3.1 state block: replace lines 10–18 with exactly:

  ```go
  // Lifecycle states reported for an owned tenant. Only active, resetting and
  // deleting are persisted; unmarked is derived for a tenant that has an owner
  // entry but no lifecycle record yet (see AdoptUnmarkedTenants).
  const (
  	lifecycleStateActive    = "active"
  	lifecycleStateResetting = "resetting"
  	lifecycleStateDeleting  = "deleting"
  	lifecycleStateUnmarked  = "unmarked"
  )
  ```

- §3.1(2) `TenantLifecycleRecord` comment, exactly: `// TenantLifecycleRecord is the persistent lifecycle/ownership record for one tenant. Policy change, 22 Nov 2026 (Cody): a tenant with an owner/name entry but no record is not legacy-unsupported. It is adopted once at startup (AdoptUnmarkedTenants, behind YAKKA_ADOPT_UNMARKED_TENANTS) with a fresh random marker and generation and state active. This reverses the Plan 23 follow-up rule (#219, 10 Nov 2026) that such tenants "must not be migrated, guessed at or have a marker inferred from its id". The marker is never derived from the id.`
- §3.1(3) `TenantLifecycle` comment: `It is false for absent tenants and for tenants not yet adopted.`
- §3.1(4): add `AdoptUnmarkedTenants` and `newActiveLifecycleRecord` **exactly as printed in DESIGN.md §3.1(4)**. Add `"sort"` to the import block. `AdoptUnmarkedTenants`: under `r.mu.Lock`, collect every id in `r.owners` whose `r.lifecycle[id]` is absent or has `Marker == ""`; return `nil, nil` without writing when none; otherwise build every fresh record first, set them all, set `r.dirty`, call `saveLocked` once, restore the prior in-memory records (and delete entries that did not exist) and the prior `r.dirty` on a save error, then return the error; return the adopted ids sorted ascending. The record has no `Operation`.
- `newActiveLifecycleRecord` is the one place a fresh marker and generation are made: a fresh 32-hex marker and generation and `State: lifecycleStateActive`.
- §3.2: `createTenantLocked` uses `rec, err := newActiveLifecycleRecord()` and `r.lifecycle[id] = rec` instead of the two `newLifecycleValue` calls and the literal. Behaviour is identical.
- §3.3: `session.go` line 120 emits `lifecycleStateUnmarked`.
- §3.4(1): add to `Config` after `ReviewModel`: `// AdoptUnmarkedTenants is YAKKA_ADOPT_UNMARKED_TENANTS: when true, New gives every owned tenant with no lifecycle marker a fresh marker and generation (state active) once at startup. Plan 31.` and `AdoptUnmarkedTenants bool`.
- §3.4(2): in `ConfigFromEnv`, after `c.ReviewModel = …` and before `if c.Addr == "" {`, add `c.AdoptUnmarkedTenants = envTruthy(getenv("YAKKA_ADOPT_UNMARKED_TENANTS"))`. Below the function add `envTruthy` exactly as §3.4(2) prints it: trimmed, lower-cased, true for exactly `1`, `true`, `yes`, `on`; false otherwise. The read is before the loopback early return so it works in every mode.
- §3.4(3): in `New`, after the `OpenRegistry` error check and before `s := &Server{…}`, insert exactly:

  ```go
  if cfg.AdoptUnmarkedTenants {
  	adopted, aerr := reg.AdoptUnmarkedTenants()
  	switch {
  	case aerr != nil:
  		fmt.Fprintf(os.Stderr, "yakka serve: adopt unmarked tenants: %v\n", aerr)
  	case len(adopted) > 0:
  		fmt.Fprintf(os.Stderr, "yakka serve: adopted %d unmarked tenants as active: %s\n", len(adopted), strings.Join(adopted, ","))
  	}
  }
  ```

  It logs and continues on error; it never panics. Tenant ids are not secrets. `fmt`, `os` and `strings` are already imported.
- §3.5 comments, exactly:
  - `review_cursor.go:105–106`: `Keyed/local tenants and unmarked tenants (flag off, or adoption failed) have no trustworthy record, so their generation is empty and a reset cannot apply to them.`
  - `tenant_lifecycle.go:23–24`: `Legacy tenants do;` → `Unmarked tenants do;`
  - `tenant_lifecycle.go:168`: `legacy marker` → `missing marker`
  - `device_grants.go:104–105`: `A tenant without a record (not yet adopted) accepts only an empty approval while it still has none.`
  - `device_grants.go:35`: `empty for tenants without a record`
  - `device.go:204` and `:277` need no edit.
- §3.6 is **skipped** per the override: no `fly.toml` line and no `fly.toml` comment.

## Changes

Line numbers are as of this branch after Phase 2 landed; search the named strings because your edits shift them.

### `packages/yakka/internal/serve/registry_lifecycle.go`

1. Replace the state comment and constants with the §3.1 block; replace the `TenantLifecycleRecord` and `TenantLifecycle` comments with the exact §3.1(2)–(3) text.
2. Add `AdoptUnmarkedTenants` and `newActiveLifecycleRecord` exactly as §3.1(4) prints them, and add `"sort"` to the imports. Do not simplify away the two-phase `next`-then-apply construction or the save-failure restoration.
3. Leave `beginTenantLifecycle`, `ErrLegacyTenantCleanupUnsupported`, `incompleteLifecycles`, the completion methods and the purge helpers unchanged apart from the comment already covered.

### `packages/yakka/internal/serve/registry.go`

Replace the two `newLifecycleValue` calls and the `TenantLifecycleRecord{…}` literal in `createTenantLocked` with `newActiveLifecycleRecord()`, keeping the existing error return and the eight-attempt id loop.

### `packages/yakka/internal/serve/session.go`

Change only the derived marker-less value in `tenantsOwnedBy` from `lifecycleStateUnsupported` to `lifecycleStateUnmarked`. Keep the non-null generation for marker-backed records and the sort order.

### `packages/yakka/internal/serve/serve.go`

1. Add the `Config` field and comment exactly as §3.4(1).
2. Add the `ConfigFromEnv` line and the `envTruthy` function exactly as §3.4(2).
3. Add the `New` adoption block exactly as §3.4(3), between the `OpenRegistry` error check and `s := &Server{…}`.

### Comments

Apply the five exact §3.5 strings in `review_cursor.go`, `tenant_lifecycle.go` and `device_grants.go`. Touch `device.go` only if you find a compile error; the design says it needs no edit.

### Keep untouched

- `TenantLifecycle` still returns `false` for an absent tenant or a record with `Marker == ""`; `TenantGeneration` is unchanged; `incompleteLifecycles` still skips marker-less records.
- `beginTenantLifecycle` still returns `ErrLegacyTenantCleanupUnsupported` for a tenant with no marker (flag off, or adoption failed), and `CompleteTenantReset`/`CompleteTenantDelete`/`PurgeTenantTokens` keep their behaviour.
- The error identifier `ErrLegacyTenantCleanupUnsupported` and the wire code `legacy_tenant_cleanup_unsupported`, and every reset/delete server gate.
- No test file and no design doc: `phase3-02` and `phase3-03` own those. Do not edit `registry_lifecycle_test.go` even though it still references the removed constant.
- No `fly.toml`.

## Done evidence

State the checks before and after. The package’s **tests will not compile between this unit and `phase3-02`** because `registry_lifecycle_test.go` still names `lifecycleStateUnsupported`; that rename is `phase3-02`’s and B1 is closed there. Do not edit the test to make it compile and do not run `go test` as your pass evidence.

- `cd packages/yakka && go build ./...` → success (this compiles non-test code only).
- `cd packages/yakka && gofmt -l internal/serve/registry_lifecycle.go internal/serve/registry.go internal/serve/session.go internal/serve/serve.go internal/serve/review_cursor.go internal/serve/tenant_lifecycle.go internal/serve/device_grants.go` → no output.
- `grep -c 'func (r \*Registry) AdoptUnmarkedTenants()' packages/yakka/internal/serve/registry_lifecycle.go` → `1`.
- `grep -c 'func newActiveLifecycleRecord()' packages/yakka/internal/serve/registry_lifecycle.go` → `1`.
- `grep -c 'func envTruthy' packages/yakka/internal/serve/serve.go` → `1`; `grep -c 'AdoptUnmarkedTenants bool' packages/yakka/internal/serve/serve.go` → `1`.
- `grep -n 'lifecycleStateUnsupported' packages/yakka/internal/serve/registry_lifecycle.go packages/yakka/internal/serve/session.go` → no output.
- B2 product subset (run exactly):

  ```sh
  grep -niE 'lifecycleStateUnsupported|unsupported legacy|`unsupported`|legacy tenants' packages/yakka/internal/serve/registry_lifecycle.go packages/yakka/internal/serve/session.go packages/yakka/internal/serve/review_cursor.go packages/yakka/internal/serve/device_grants.go
  ```

  → no output. (The docs half of B2 is `phase3-03`; do not claim B2 alone.)
- B5 date half: `grep -c '22 Nov 2026' packages/yakka/internal/serve/registry_lifecycle.go` → at least `1`.
- `git diff --check` → no output.
- `gate: B1 (go test ./internal/serve, go vet ./...) is closed by phase3-02, which renames the test constant after this unit.`
- `gate: B5’s Plan 23 amendment is closed by phase3-03; this unit writes only the dated code comment.`

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently. A non-trivial bug outside your done evidence: report symptom, location, and root cause if found; do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
