# Brief: 6-01 — Frozen historical manifest and comparator evidence

Consumer: Plan 23 Phase 7 trial-run and alignment-report worker.
Owned paths: `tools/shadow-review-trial/`, `tools/README.md`. Touch nothing else except this brief's report and the phase implementation record.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: Before committing, write `docs/plans/23-llm-review-shadow/reports/6-01-historical-manifest-comparators.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: Phase 1.
Runs alongside: nothing.
Budget: 18 files to read, about 1,200 lines to change, 45 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — Phase 6 outcome and surfaces; Assumptions 11, 20–22; Open Questions and Phase 7 outcome.
2. `plugins/yakka/client/yakka.py` — `CaptureChange` range arguments and returned resolved SHAs and `diff_sha256`; use as a read-only Phase 1 dependency.
3. `docs/plans/23-llm-review-shadow/reports/1-01-local-change-capture.md` — landed range-capture behavior and limits.
4. `tools/release/test_layout.py` — README required fields and tool-directory layout expectations.
5. `tools/README.md` — existing tool index style.

## Goal

Build the offline `tools/shadow-review-trial manifest` command that freezes the eligible historical case set and the separately linked comparator evidence Phase 7 consumes.

## Contract

Binding: `docs/plans/23-llm-review-shadow/DESIGN.md`, Phase 6 outcome: “writes a frozen, hashed manifest listing every candidate with its eligibility result and reason”; records “eligible counts per stratum (phase, PR, unaccompanied) and each of `high`, `xhigh`, `max` against ≥50 reviewed changes per level with explicit shortages”; and keeps “one shared case set, fixed non-effort settings and seeded persisted run order for all arms.” Each case records “the base and head, the capture's `diff_sha256`, the criteria used (a pinned `content_hash` or explicit text built from the blob at `head`, marked by source), the build models as curated evidence or `unknown`, and comparator pointers as `path@sha:blobhash`.”

The same outcome requires proving that a case capture contains no object created after its head and never its comparator; validating and hashing curated findings with blob/line citations; accepting a local PR-review export keyed by head SHA with its own hash; and keeping phase and PR comparators separately linked. Assumption 20 defines phase and PR comparator sources; Assumption 21 chooses one curated schema and a frozen hashed comparator file. Assumption 22 fixes the ≥50-per-effort target, paired common case set, and separate eligible/completed shortfalls; no failed or duplicate run can pad attainment.

## Changes

- Implement manifest enumeration, eligibility/reason recording, strata and shortage counts, deterministic shared case selection, and persisted seeded order. Make the shallow-history boundary explicit in the frozen output.
- For each selected case, resolve and record full base/head identities; obtain the range capture through the Phase 1 `CaptureChange` API; pin criteria from a stored content hash or explicit text read from the repository blob at that case's head, marking the source; retain curated build-model evidence or `unknown`; and bind comparator pointers to their Git path, commit and blob hash.
- Implement the curated comparator file and its citation validation and hash binding to the manifest. Keep phase and PR evidence linked to their respective cases/strata. Accept a local PR-review export as separately hashed evidence keyed by head SHA.
- Add the `manifest` command and document the tool. Its `README.md` must include the four required fields `Consumers`, `Build`, `Test`, and `Release` checked by `tools/release/test_layout.py`.
- Preserve frozen outputs: report shallow history, candidate eligibility and explicit shortfalls; do not silently refresh or pad an already frozen case set.
- Keep the duplicate-receipt concern with the Phase 7 runner: preserve Phase 4's landed `skipped_duplicate` response and reference. It does not alter this manifest contract. Keep the Phase 5 `_capture_blob` memory issue assigned to a future Phase 1 refinement. Preserve the static no-network/environment guarantee scoped to `internal/review/build.go`; do not broaden or reassign it here.
- No live/paid review calls, credentials, deploys, or server changes.

### Keep untouched

Do not modify Phase 1 capture, review server/API behavior, Phase 4 idempotency, Phase 5 wiring, stable docs, or other plan folders. Do not make Phase 7 runner/report/smoke behavior part of this unit. Restrict implementation changes to `tools/shadow-review-trial/` and the `tools/README.md` index.

## Done evidence

Identify or write the failing check before changing code and report its output before and after.

- An offline fixture invokes `manifest` on local history and proves candidate inclusion plus explicit eligibility reasons, phase/PR/unaccompanied counts, per-effort target shortages, a common frozen case set, fixed non-effort settings, deterministic persisted seeded order, and the shallow-history boundary.
- A range-capture fixture proves each selected case uses its recorded base/head and `diff_sha256`, cannot include an object created after its head, and excludes comparator files from captured input.
- Fixtures prove pinned stored criteria and explicit head-blob criteria record their source; build model curation retains `unknown` when provenance is unavailable; comparator citations validate against path/commit/blob/line evidence and contribute to the frozen hash; PR exports are independently hashed and keyed by head SHA; phase and PR comparator links remain separate.
- The generated tool README passes the relevant `tools/release/test_layout.py` layout check, and `tools/README.md` indexes it.
- The tool and its fixture tests pass without external services or provider credentials; `git diff --check` is clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, exact check commands and outputs, any deviation and why, any contradiction between this brief and cited contracts, and any unfinished work specific enough for Phase 7 to act on. Never resolve a contradiction silently.
