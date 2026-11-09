# Brief: phase3-06 — Operator documentation and trial evidence format

Consumer: a docs worker who can update the trial and tools READMEs without claiming an unshipped or unrun live trial.
Repo: `/home/codyh/workspace/yakka-build/23b`.
Branch: `feat/23b-review-controls-trial`.
Owned paths: `tools/shadow-review-trial/README.md`, `tools/README.md`. Touch nothing else.
Commits: commit to `feat/23b-review-controls-trial` when done evidence passes, with a plain-summary title, including the report.
Report: before committing, write `docs/plans/23-llm-review-shadow/reports/phase3-06-operator-docs-evidence-format.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: phase3-01, phase3-02, phase3-03, phase3-04 and phase3-05. Read their reports and the final code/README state.
Runs alongside: nothing.
Budget: read 8 files, about 200 lines changed, 30 tool turns. Past the budget, stop: write a handoff under this brief's name in `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — synthetic tenancy/operator preparation (131–166), trial preparation/execution/evidence (168–182), Decisions 20–24 (224–228), Phase 3 outcome and surfaces (291–296).
2. `tools/shadow-review-trial/README.md` — the whole current file; it still describes the pre-Phase-3 run/report/smoke flow.
3. `tools/README.md` — the directory inventory row for `shadow-review-trial`.
4. `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` — Phase 3 refine handoff and unit outcomes; do not edit it.
5. `docs/plans/23-llm-review-shadow/briefs/phase3-01-full-history-manifest-freeze.md` through `phase3-05-spend-approval-rehearsal.md` — the implemented command/contract names to document.
6. Phase 2 report `reports/phase2-09-stable-docs-operator-instructions.md` — the promotion style and the human-owner wording already landed in the README.
7. `docs/lab/RESEARCH/INDEX.md` and one existing `docs/lab/RESEARCH/*/INDEX.md` — the evidence-folder convention for the later operator record.
8. `packages/yakka/internal/review/policy.json` and `tools/shadow-review-trial/runner.py` — only to confirm the documented command names; do not edit code.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Document the real-server trial workflow end to end — full-history preparation, complete evidence, the explicit approval gate and human-only cleanup — without fabricating a run record or claiming a live/deployed result.

## Contract

Quoted from `DESIGN.md`; these win over this brief on conflict.

- Phase 3 outcome: "Operator documentation explicitly uses the deployed server and Fly-held provider credential, synthetic key/allowlist, human-only profile UI delete of the disposable tenant after evidence export (optional reset/rekey/reuse), full history, approval artifact and separate later smoke/live evidence. No fixture, preflight or docs-only PR is labeled a completed live trial."
- "The real deployed Yakka server remains the trial target; its provider credential stays server-side. Trial review tooling uses a dedicated Yakka `wk_` key. That key never authorizes reset/delete."
- "Operator preparation after implementation: sign into the owner profile, create a dedicated tenant named `shadow-trial` (or `synthetic`) through existing create/token routes, and issue a separate `read_write` key. Record the immutable tenant id, not just its name. Add `<synthetic-tenant-id>/<repo_id>` to `YAKKA_REVIEW_REPOS` through normal operator configuration. Confirm the key's identity with whoami before any capture; abort a real-work mismatch."
- "**Recommended synthetic-trial operator path:** after preserving needed trial exports/evidence, the human owner opens the API-origin profile UI, selects the disposable trial tenant, chooses **Delete**, types its id and confirms. The runner/agent never performs cleanup. Reset-then-reuse is optional when stable tenant identity is wanted; it requires new keys, refreshed generation/read state and deliberate re-selection. The header/session/same-origin gate is a **guardrail, not proof of a human**."
- "**Hard paid-spend gate:** Cody must explicitly authorize spend **before any live provider call** ... `--execute` alone is not authorization. The runner requires a local authorization record ... and it never creates approval itself."
- "A real-server `dry_run` preflight makes zero provider calls and is allowed before approval; test fixtures require no paid approval."
- "A dry-run-only or fixture-only run can never claim a completed live trial or deployed smoke."
- Phase 3 surfaces include "later operator evidence format under `docs/lab/RESEARCH/` (no fabricated run record in this amendment)."

## Changes

- Rewrite the trial README's Manifest/Run/Report/Smoke and cleanup sections to match the implemented Phase 3 commands and contracts:
  - full-history preparation from the configured Git remote with repository/tip/nonshallow/object/count verification, and a create-only certified manifest;
  - `run` with the dedicated tenant id/run id, whoami confirmation, tags/effort/store=true, dry-run default and per-case/per-level retry-inclusive estimates;
  - the local Cody approval artifact required for `--execute` (fields, ceiling, expiry, preflight digest, resume treatment) and the warning that `--execute` alone is not authorization;
  - certified cursor-paged full-detail exports and the ledger input to `report`;
  - the loopback-only `smoke` fixture (no provider call, no approval needed) and the prohibition on labeling it or any fixture/preflight/docs-only run as a completed live trial;
  - human-only API-origin profile UI delete of the disposable tenant after preserving/exporting evidence, optional reset/rekey/reuse, and the existing mandatory human-owner wording and guardrail caveat.
- State the operator prerequisites explicitly as gates: full-history clone/population proof, deployed-server readiness, provider credential held only by the server, Cody's separate explicit spend approval, and the manual browser walkthrough of reset/delete/re-selection before operator use.
- Specify the evidence format/location for a later real run under `docs/lab/RESEARCH/<date>-shadow-review-trial/`: saved certified export, manifest hash/tip/count/history evidence, approval artifact reference, run ledger, per-effort/paired counts and shortfalls, adjudication, alignment report, and the human cleanup record. Do not create a run folder or any fabricated run data in this unit.
- Update `tools/README.md`'s `shadow-review-trial` purpose row if the command inventory changed (for example preparation, approval-gated run, certified export/report). Keep the row terse.
- Do not edit code, tests, stable design docs, the plugin/shim or any Phase 1/2 contract. Do not claim a live run, deployment, provider call, credential or spend.

### Keep untouched

The implemented command/code contracts, all tests, the mandatory human-owner sentence and the Phase 2 lifecycle/Pages wording. Do not add a fabricated run record, scores, live results or deployment claims.

## Done evidence

- `git diff --check` → no whitespace errors.
- `rg -n "gate:|YAKKA_REVIEW_REPOS|whoami|approval|dry-run|human owner|docs/lab/RESEARCH|create-only|cursor|complete" tools/shadow-review-trial/README.md` → every required topic is present.
- `rg -n "completed live trial|deployed smoke|live trial ran|provider call" tools/shadow-review-trial/README.md` → any match is an explicit prohibition or gate, never a claim that the trial ran.
- `git diff --stat` → only `tools/shadow-review-trial/README.md` and `tools/README.md` changed.
- The report states that no live server, provider, credential, deployment, Fly/Wrangler command or paid trial was used, and that no run record was fabricated.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
