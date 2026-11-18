# Brief: 13-04 — Release checks and stable documentation

Consumer: the Phase 13 acceptance worker and maintainers preparing the implementation PR.
Owned paths: `packages/yakka-analytics/README.md`, `docs/design/03-remote-service.md`, `docs/plans/20-analytics-reset/CONTRACTS.md`, `tools/release/scan_residual_names.py`, `tools/release/test_scan_residual_names.py`, `docs/plans/20-analytics-reset/reports/13-04-release-docs.md`. Touch nothing else.
Commits: Commit to the current branch when done evidence passes, with a plain-summary title.
Report: before committing, write `docs/plans/20-analytics-reset/reports/13-04-release-docs.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and include it in the commit.
Depends on: Nothing.
Runs alongside: 13-01 browser matrix, 13-02 pageset smoke and 13-03 identity/routes.
Budget: 13 files to read, about 350 lines to change, 12 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), commit if this brief commits, and report `over budget`.

## Required reading, in order

1. `docs/plans/20-analytics-reset/DESIGN.md` — Phase 13; Serving/release/Pages domain; Phase 1 release outcome; phase scope vocabulary.
2. `docs/plans/20-analytics-reset/CONTRACTS.md` — 10.1–10.2; 11.1–11.6; 12; 13; 14; 17.6–17.7.
3. `docs/plans/20-analytics-reset/IMPLEMENTATION.md` — Phase 12 carried list, Phase 1 release record and Pages gate.
4. `packages/yakka-analytics/README.md` — four package instruction fields.
5. `docs/design/03-remote-service.md` — current site/release, OAuth callback, device and API deployment statements; update only stale analytics release statements.
6. `tools/release/{build.sh,test_release.py,test_layout.py,scan_residual_names.py,test_scan_residual_names.py}` — checks and no-upload/build behavior, read ranges/grep.
7. `tools/release/scan_residual_names.py` and `test_scan_residual_names.py` — current Phase 12 false positive and scanner regression coverage.
8. `packages/yakka-analytics/web/{index.html,_headers}` and `wrangler.toml` — inspect state only; the Pages project/config is out of bounds.

## Goal

Make package instructions and stable release documentation accurately describe the finished no-build output, Pages automation-on-merge and separate API release. Run the existing release-layout, placeholder, residual-name and bundle-secret checks. Record the external automation acceptance and ready-PR marker as gates; no manual deploy/configuration/secrets action is a phase outcome.

## Contract

DESIGN.md Phase 13: “Stable route/docs and package instructions describe the final no-build output, automation-on-merge Pages deployment and separate API release. The ready implementation PR carries the plan marker; no manual deploy/configuration/secrets action is a phase outcome.”

CONTRACTS.md 17.6: “Pages deploys by merge, outside this repo”; “nothing in this plan deploys, changes the job or touches a secret”; “Server deploy is separate and not automatic.” CONTRACTS.md 14: “This plan does not touch `fly.toml`, wrangler secrets, the Pages project, the Pages automation job or any deploy setting, and does not deploy.” CONTRACTS.md 11.5 defines the public-bundle secret scan.

Settled: update only the README, design 03 and stale Phase 13-owned statements in CONTRACTS sections 14/17.6. Keep the Phase 1 `./web` no-build output, embedded local routes and Pages paths. Do not edit `docs/design/07-analytics-site.md` (archival Svelte narrative remains behind its Plan 20 banner), `wrangler.toml`, `fly.toml`, automation or a secret.

## Changes

Update docs with concrete current facts: `web/` is the static no-build output; `tools/release/build.sh` embeds it and never uploads; Pages deploy is owner-stated to occur on merge and the external job/output acceptance cannot be verified here; Fly/API release is separate; the browser detects API capability; no new manual config/deploy/secrets step is requested. Package README retains `**Consumers**`, `**Build**`, `**Test**`, `**Release**`.

For the ready implementation PR, state the required `Yakka-Plan: docs/plans/20-analytics-reset` marker as a preparation gate in this unit's report. Do not edit/publish a PR or claim the marker was applied. Report the Pages automation output-directory acceptance as `gate:`; do not attempt a deploy or contact the external job.

The current residual-name suite fails `test_phase5_clean_in_repo` and `test_all_clean_in_repo` on legitimate Phase 12 symbols `WORKFLOW_PANEL_IDS`, `WORKFLOW_PRESET_ID` and `WORKFLOW_SPECS`; `test_phase6_clean_in_repo` and `test_fixture_hit` pass. Narrow that specific scanner false positive and add regression evidence that other stale `WORKFLOW_` names still fail. Do not weaken or globally skip the `packages/yakka-analytics` tree. This targeted scanner repair is in scope because Phase 13 explicitly requires the residual-name check to pass.

Run repository checks: `python3 -m unittest tools.release.test_release`, `python3 tools/release/test_layout.py`, `python3 tools/release/test_scan_residual_names.py`, and the existing bundle-secret scan asserted by release/layout checks. These checks authorize only the two named scanner files as script/test changes. Use in-worktree `TMPDIR`, Go memory cap 8G where relevant.

### Keep untouched

Do not edit `build.sh`, `test_release.py`, `test_layout.py`, `wrangler.toml`, `fly.toml`, Pages project/job, secrets, Docker configuration, `docs/design/07-analytics-site.md`, IMPLEMENTATION.md, product code or live data. The only checker change allowed is the specific residual-name false-positive refinement, with positive and negative regression evidence.

## Done evidence

Identify or write the failing check before changing code. Report its output before and after.

- `mkdir -p /home/codyh/.cache/plan20p13` → scratch directory exists outside `/tmp`.
- `TMPDIR=/home/codyh/.cache/plan20p13 python3 -m unittest tools.release.test_release` → 11/11 pass; release check finished in 16.225 s in refinement recon.
- `python3 tools/release/test_layout.py` → 7/7 checks pass.
- `python3 tools/release/test_scan_residual_names.py` → 5/5 pass after adding the targeted false-positive regression; scanner still detects the stale-name fixture.
- Bundle/placeholder evidence → existing release checks prove no secret-pattern or forbidden e2e literal in shipped `web/`, the build embeds `web/` without Node/npm, and the committed placeholder is restored after success/failure; report exact test names/counts. No separate secret-reading step.
- Documentation audit → README has all four required fields; README, docs/design/03 and CONTRACTS say no-build `./web`, Pages on merge/external automation gate, separate API release, and no deploy/secrets action. `gate:` external Pages automation acceptance; `gate:` ready PR must carry `Yakka-Plan: docs/plans/20-analytics-reset`.
- `git diff --check` → clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then files changed, each check's exact output/count, doc facts updated, deviations, contradictions, carried items, and every `gate:` line (including Pages automation and PR marker).

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
