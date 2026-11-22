# Brief: phase3-03 — Dated policy amendment and lifecycle docs

Consumer: the build worker that writes the docs.
Owned paths: `docs/plans/23-llm-review-shadow.md`, `docs/design/03-remote-service.md`, `docs/design/07-analytics-site.md`, `docs/design/09-analytics-workspace-contracts.md`. Touch nothing else, and **do not edit `fly.toml`**.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/31-legacy-tenant-adoption/reports/phase3-03-docs-amendment.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: nothing to make the edits. B2’s combined grep also needs `phase3-01`’s product files landed; if it has not landed when you finish, report the docs subset clean and say the combined B2 is the orchestrator’s to run.
Runs alongside: `phase3-01` and `phase3-02` — disjoint paths.
Budget: 4 files to read, about 45 changed lines, 25 tool turns. Past the budget, stop: write a handoff under this brief’s name in `docs/plans/31-legacy-tenant-adoption/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/31-legacy-tenant-adoption/DESIGN.md` — “Phase 3 specification” §3.7 and §3.9 (B2, B5); the Phase 3 outcome under “Phases”; Assumption Ledger 2, 5, 7, 17 and 18. Binding: the exact replacement sentences and the Plan 23 amendment text.
2. `docs/plans/23-llm-review-shadow.md` — the last section `## Follow-ups` (the file’s final section, around line 147).
3. `docs/design/03-remote-service.md` — the configuration table (around 60–75), the lifecycle paragraph after the Plan 23 amendment (around 210–220), and the `/v1/me` lifecycle paragraph (around 255–268).
4. `docs/design/07-analytics-site.md` — the lifecycle paragraph (around 66–80).
5. `docs/design/09-analytics-workspace-contracts.md` — the “Authorized tenant scope” bullet (line 168).

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Hard rules (apply to this unit)

- `docs/plans/31-legacy-tenant-adoption/DESIGN.md` is authoritative and literal. Implement every binding contract exactly as written, including the Phase 3 specification (3.1–3.9), the Phase 3 outcome, and acceptance check IDs B1–B5. Do not reopen any decision in the Assumption Ledger (notably Assumptions 2, 3, 4, 5, 8, 9, 12, 13, 14, 15, 17, 18). No invented scope: no manual adopt API, no per-tenant confirmation, no inferring a marker from the id, no migrating only `default`.
- **OVERRIDE signed off 22 Nov (Solution Designer / Executor standing rule):** do **not** set `YAKKA_ADOPT_UNMARKED_TENANTS = "true"` in `fly.toml` and do **not** add the `fly.toml` comment. DESIGN.md §3.6 is skipped entirely for this plan. **No brief may edit `fly.toml`.** The orchestrator records `gate: YAKKA_ADOPT_UNMARKED_TENANTS stays off in fly.toml until Phase 2 has shipped`.
- Never push, never merge, never force-push, never rebase, never touch `master` or other branches, other plans’ build branches, `/home/codyh/workspace/yakka-wt/` (including the design worktree `yakka-wt/31-legacy-tenant-adoption`) or other `/home/codyh/workspace/yakka-build/` directories. Leave `/home/codyh/workspace/.briefs/yakka/HOLD` alone.
- Never run `fly` or `wrangler`, never deploy, never set/read/print secrets or the trial token (`YAKKA_TRIAL_TENANT_TOKEN`). Never reset or delete a live tenant. Never use Cody’s live `default` tenant in any test, probe or live check. Fixture objects named `default` in Go or unit tests, exactly as DESIGN.md specifies, are allowed. If a live read is needed, use only the trial tenant test from `/home/codyh/.config/yakka/trial.env` (source into the command env; never print the token). This unit needs no live read.
- Tests: there is no test runner for docs. No vitest, Playwright, Chromium, animation or timing test. No `/tmp`; if you make any temporary copy, use the gitignored `.scratch/` under the worktree. `gofmt` is not applicable (no Go change).
- Signed-in production checks are not automatable (Yakka has no automated sign-in): do not attempt them; record `gate: signed-in production check <what>`. Record anything needing Cody or an external system as a line `gate: <what>`.
- Sub-runs are launched by the orchestrator with `~/workspace/.briefs/q/hlaunch.sh KIND [pick args] -- LOGFILE PROMPT`; do not pick or launch separate sub-runs yourself. Do not spawn agents beyond read-only research helpers; if this unit needs one, it was mis-sized — report `blocked`.
- Mockups are **not applicable** to this unit. Phase 3 touches no screen, no HTML, no web UI and no mockup. Do not edit or copy `mockups/tenant-selector.png`, `mockups/profile-tenants.png`, `mockups/lifecycle-confirm.png` or anything under `mockups/src/`. If you believe a screen is touched, stop and report why; otherwise there is none.

## Goal

Record Cody’s 22 Nov 2026 decision durably: add the dated Plan 23 amendment and bring the three design docs in line with the new lifecycle vocabulary (`unmarked`, no `pending`, no `unsupported`, selectable by deny-list). This unit closes the Plan 23 half of B5 and the docs half of B2. The dated `registry_lifecycle.go` comment is `phase3-01`’s; B5 is complete only when both land.

## Contract

Cited from DESIGN.md §3.7; settled, not to be re-derived. Use these strings verbatim, including punctuation and backticks. Line numbers are as of this branch after Phase 2; search for the quoted text.

### `docs/plans/23-llm-review-shadow.md`

Add a final section after `## Follow-ups` (the file’s last section):

```markdown
## Policy amendment — 22 Nov 2026 (Plan 31)

Cody, 22 Nov 2026, decided that an owned tenant with no lifecycle record is a normal tenant. The Follow-up Phase 2 rule that such legacy tenants are not migrated, guessed at or given an inferred marker is reversed: at startup, behind `YAKKA_ADOPT_UNMARKED_TENANTS`, every unmarked tenant gets a fresh random marker and generation and state `active`, once. `/v1/me` no longer reports `unsupported`; the marker-less value is `unmarked`. Reset and delete keep every confirmation. See Plan 31.
```

Do not edit any earlier record text in the file.

### `docs/design/03-remote-service.md`

1. Add this row to the configuration table immediately after the `CLAUDE_API_TOKEN` row:

   ```markdown
   | `YAKKA_ADOPT_UNMARKED_TENANTS` | `1`, `true`, `yes` or `on` adopts every owned tenant that has no lifecycle marker once at startup (fresh marker and generation, state `active`); unset or any other value leaves them unmarked. Set in `fly.toml`. |
   ```

   The `fly.toml` line and comment are deferred by the 22 Nov override; use the row text exactly as §3.7 specifies and do not edit `fly.toml`.
2. Around line 246, replace `legacy tenants without a trustworthy ownership/creation marker` with `tenants that have no lifecycle marker yet (flag off or adoption failed)`; keep the surrounding sentence and the `409 legacy_tenant_cleanup_unsupported` code unchanged.
3. In the `/v1/me` lifecycle paragraph, change the enum text (`` `active`, `resetting`, `deleting`, `unsupported` ``) to (`` `active`, `resetting`, `deleting`, `unmarked` ``) and `null for unsupported legacy` to `null only while unmarked`.
4. Replace `Pending entries remain owner-visible until completion` with `In-progress entries remain owner-visible until completion`.
5. Replace `An eligible remembered selection lacking a generation requires explicit re-selection.` with `A remembered selection whose tenant has no marker yet stays valid; an empty generation is not a change.`
6. After the paragraph ending `described above.` (around line 218), before `### Owner tenant lifecycle API`, add this sentence as its own paragraph:

   ```markdown
   Since 22 Nov 2026 (Plan 31) tenants created before the follow-up are adopted at startup rather than left unsupported.
   ```

### `docs/design/07-analytics-site.md`

1. Change the enum text (`` `active`, `resetting`, `deleting`, `unsupported` ``) to (`` `active`, `resetting`, `deleting`, `unmarked` ``) and `null for unsupported legacy` to `null only while unmarked`.
2. Replace `Pending entries remain owner-visible` with `In-progress entries remain owner-visible`.
3. Replace `Eligible remembered selections lacking a generation require explicit re-selection.` with `A remembered selection whose tenant has no marker yet stays valid; an empty generation is not a change.`

### `docs/design/09-analytics-workspace-contracts.md`

In the “Authorized tenant scope” bullet (line 168):

1. Replace `the first active owned tenant` with `the first selectable owned tenant`.
2. Replace `A foreign, deleted or pending URL tenant stops reads` with `A foreign URL tenant, or one that is resetting or deleting, stops reads`.
3. Immediately after the `…never falls back silently.` sentence, add: `Selectable means not resetting or deleting; a tenant with no lifecycle marker is selectable.` The document has no lifecycle enum, so nothing else changes.

### Keep untouched

- Every earlier section of `docs/plans/23-llm-review-shadow.md`; the amendment is appended, not a rewrite.
- `docs/OVERVIEW.md` and `docs/ARCHITECTURE.md` (they do not mention tenant lifecycle).
- The retained wire code `legacy_tenant_cleanup_unsupported` and the error copy; only the docs wording around it changes.
- No Go, HTML, JS, test, `fly.toml` or mockup file.

## Done evidence

Report the grep output before and after each edit; the B2 docs subset must go from matching lines to none.

- Docs subset of B2:

  ```sh
  grep -niE 'lifecycleStateUnsupported|unsupported legacy|`unsupported`|legacy tenants' docs/design/03-remote-service.md docs/design/07-analytics-site.md docs/design/09-analytics-workspace-contracts.md
  ```

  → no output (the full B2 also spans `phase3-01`’s product files; run it only if that unit has landed).
- `grep -c 'Policy amendment — 22 Nov 2026 (Plan 31)' docs/plans/23-llm-review-shadow.md` → `1`.
- `grep -c 'Cody, 22 Nov 2026, decided that an owned tenant with no lifecycle record is a normal tenant.' docs/plans/23-llm-review-shadow.md` → `1`.
- `grep -c 'YAKKA_ADOPT_UNMARKED_TENANTS' docs/design/03-remote-service.md` → `1`.
- `grep -n 'first active owned tenant\|foreign, deleted or pending' docs/design/09-analytics-workspace-contracts.md` → no output.
- `git diff --check` → no output.
- `gate: the full B2 combined grep is closed only after phase3-01’s product files land; this unit reports the docs subset clean.`
- `gate: B5 is complete only with phase3-01’s dated registry_lifecycle.go comment; this unit writes the Plan 23 amendment.`

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently. A non-trivial bug outside your done evidence: report symptom, location, and root cause if found; do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
