# Brief: phase2-03 — Trial README without the spend gate

Consumer: a documentation worker on `tools/shadow-review-trial/README.md`, dispatched by Plan 28 `execute`.
Owned paths: `tools/shadow-review-trial/README.md`; report `docs/plans/28-review-token-only-gating/reports/phase2-03-readme.md`. Touch nothing else.
Do not edit `cli.py`, `runner.py`, `report.py`, `manifest.py` or any test.
Commits: commit to `feat/28-review-token-only-gating` when done evidence passes, with a plain-summary title; include the report. Never push.
Depends on: unit 1 (`phase2-01-run-path`) — the flags and refusal behaviour the README must describe. Unit 2's report contract is already settled in DESIGN and needs no code from it.
Runs alongside: unit 2 (`phase2-02-report-cost`), with disjoint paths.
Budget: 1 file to read, about 80 lines to change, 25 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/28-review-token-only-gating/DESIGN.md` — Domain: Trial tooling (lines 42-64), Phase 2 (235-240), Assumption 12 (164-169), Architectural Implications line 78. Binding.
2. `tools/shadow-review-trial/README.md` — all 136 lines; this is the whole edit surface.
3. `tools/shadow-review-trial/cli.py` — only the `run` and `report` parser blocks (95-140) as unit 1 left them, to copy the surviving flags exactly.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Rewrite the operator README so it describes the trial as it now runs: no local spend record, no cap, no estimates; readiness is identity plus a dry-run with no `unavailable`; actual cost is recorded and reported; the remaining gates are full history, the deployed server, the server-held credential and the dedicated tenant, with the manual-browser walkthrough only for reset/delete.

## Contract

Cited from DESIGN.md; these decisions are settled:

- "**Spend gate removed**: `approval.py`, `--approval`, the approval-binding and ceiling checks, `--cap-usd` (run and report), `cap_comparison`, the runner's `_prior_spend`/`_unknown_reservations` exposure maths, `estimated_usd` projection and `refused_over_cap`/`approval_required_usd` readiness fields are deleted; `skipped_budget` is no longer a preflight block, and `skipped_busy` is transient and retried on resume, never a `preflight_blocked`. Device-login "approval" code is unrelated and untouched. `--execute` runs after its non-spending readiness checks (`whoami` tenant/scope match, dry-run POST with no `unavailable`, frozen-manifest/ledger binding). Actual cost per case, effort and run stays in the ledger and report. Full-history proof, deployed-server target, server-held credential and dedicated-tenant gates stay; the manual-browser gate stays for reset/delete only and is not a trial prerequisite."
- Phase 2 Outcome: "`tools/shadow-review-trial/README.md` lists no spend-approval gate and no removed variable".
- Phase 1 facts: the model is the code constant `claude-haiku-5-5`, effort is per call (`high`, `xhigh`, `max`, default `high`), any authenticated tenant's repo is reviewable with no allowlist, and the only review setting is the server-held `CLAUDE_API_TOKEN`.
- Non-goal: "a Yakka-side cost limit or approval of any kind; ... deleting the trial tenant (human-only, per Plan 23)."

Settled decisions:

- The README must contain no occurrence of the strings the phase-final grep forbids: `YAKKA_REVIEW_`, `refused_over_cap`, `cap_usd`, `cap-usd`, `estimated_usd`, `approval` (case-sensitive), and no stale `--approval`/`--cap-usd`/local-record wording.
- Keep the real gates: full-history clone/population proof, deployed-server readiness, provider credential server-side only, dedicated synthetic tenant, and the human-only reset/delete walkthrough.
- Do not document `--reviewer-model` as removable; it is still a required run flag (out of Phase 2 scope).

## Changes

- **Operator prerequisites and gates**: delete the spend-approval bullet. Keep the four other bullets. Change the manual-browser bullet to say it applies to reset/delete only and is not a trial prerequisite.
- **Operator preparation** (line 17): delete the sentence that adds a tenant/repo pair to the four-setting allowlist. Keep the dedicated-tenant creation, immutable id, `read_write` key and the `whoami` confirmation; state that with the server-held `CLAUDE_API_TOKEN` any authenticated tenant's repo is reviewable and no allowlist or per-repo setup exists.
- **Run block** (lines 47-56): remove `--cap-usd`; keep `--manifest`, `--ledger`, `--base-url`, `--auth-token`, `--reviewer-model`, `--run-id`, `--tenant-id`, `--dry-run`. Keep the explanation of `--run-id`, `--tenant-id`, the tenant binding and the `whoami` refusal.
- **Dry-run paragraph** (line 62): rewrite as the non-spending readiness probe. It posts one dry-run per case and effort, makes no provider call and needs no local record. Only `unavailable` blocks; `skipped_busy` and legacy `skipped_budget` are transient and never block. There are no estimates, projections, caps or exposure figures.
- **Execute paragraph** (line 64): `--execute` runs after the `whoami` tenant/scope check, a dry-run with no `unavailable`, and the frozen-manifest/ledger binding. It needs no local authorisation file or cap. The provider account governs spend; Yakka/the tool records actual cost from each receipt in the ledger. Resume reuses the same run id, tags and ledger, reposts work that returned `skipped_busy`, and never replays `started`/`started_unknown` work. Claim-before-I/O is unchanged.
- **Report block** (lines 68-80): remove `--cap-usd`; keep the deterministic-input and provenance description. State that the report shows actual cost per case, per effort and for the whole run from ledger run receipts; an unknown cost (`cost_usd` null with `cost_known: false`) is counted as unknown, never estimated; and `skipped_busy` plus legacy `skipped_budget` records are accepted.
- **Smoke** (line 88): keep it; state it needs no local spend record. Keep the warning against labelling fixtures as live trials.
- **Trial evidence format** (lines 90-100): delete the approval-reference bullet. Keep run identity, certified export, manifest evidence, run ledger, report and cleanup record; the ledger/report bullets may say they carry actual cost.
- **Layout contract** (lines 128-136): "Consumers" drops the gated-trial phrase; "Build" says "an explicitly invoked trial"; "Test" lists the surviving test files only (`test_phase7.py`, `test_manifest.py`, `test_runner.py`, `test_report.py`, `test_report_export.py`); "Release" says fetch full history, freeze the manifest, run the non-spending readiness probe, then run an explicitly enabled historical trial — with no spend-approval step.

### Keep untouched

- The manifest section's full-history certification description, comparator-evidence shape, certified-export/refusal description, tag contract, reset/delete owner-only section and all links.
- No new sections; this is a rewrite of the existing statements, not an expansion.

## Done evidence

Identify the failing matches first; report the command output before and after.

- `cd /home/codyh/workspace/yakka-build/28 && grep -nIE 'YAKKA_REVIEW_|refused_over_cap|cap_usd|cap-usd|estimated_usd|approval' tools/shadow-review-trial/README.md` → no matches.
- `grep -nI -e '--cap-usd' -e '--approval' -e 'readiness' -e 'projection' tools/shadow-review-trial/README.md` → no matches.
- `python3 tools/shadow-review-trial/cli.py run --help` and `python3 tools/shadow-review-trial/cli.py report --help` → show exactly the flags the README names and none removed.
- `python3 tools/shadow-review-trial/cli.py smoke` → prints the loopback fixture receipt (including `cost_usd`) and needs no network or credential.
- `git diff --stat` → only `tools/shadow-review-trial/README.md` and this report.

The tool-wide phase grep also covers `report.py` and its tests; run it after unit 2 lands if it has not yet, and report the result rather than fixing another unit's files.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
