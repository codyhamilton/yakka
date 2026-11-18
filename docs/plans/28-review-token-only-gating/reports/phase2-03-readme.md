# Report: phase2-03 — Trial README without the spend gate

Status: done with concerns (one brief-internal contradiction, resolved as noted below; unit 2 not yet landed so the tool-wide phase grep still hits its files).

## What changed

`tools/shadow-review-trial/README.md` only (14 insertions, 17 deletions):

- Gates: deleted the spend-approval bullet; retitled `deployed-server readiness` to `deployed-server target`; marked the manual-browser walkthrough as reset/delete-only, not a trial prerequisite. The full-history, deployed-server and server-held-credential gates remain.
- Operator preparation: removed the `YAKKA_REVIEW_REPOS` allowlist sentence; states that with the server-held `CLAUDE_API_TOKEN` any authenticated tenant's repo is reviewable with no allowlist or per-repo setup. Dedicated tenant, immutable id, `read_write` key and `whoami` confirmation kept.
- Run block: dropped `--cap-usd`; kept the other run flags and the run-id/tenant-binding/`whoami` explanation.
- Dry-run: rewritten as the non-spending probe — one dry-run per case and effort, no provider call, no local spend record; only `unavailable` blocks; `skipped_busy` and legacy `skipped_budget` are transient; no estimates, caps or exposure.
- Execute: rewritten around the `whoami` tenant/scope check, a dry-run with no `unavailable`, and the frozen-manifest/ledger binding; no local authorisation file or cap; actual cost recorded from each receipt; resume reposts `skipped_busy`, never replays `started`/`started_unknown`; claim-before-I/O unchanged.
- Report block: dropped `--cap-usd`; added actual cost per case, per effort and per run from ledger run receipts, unknown cost (`cost_usd` null with `cost_known: false`) counted as unknown and never estimated, and acceptance of `skipped_busy` plus legacy `skipped_budget`.
- Smoke: kept; "no spend approval" became "no local spend record".
- Evidence format: deleted the approval-reference bullet; ledger/report bullets now say actual cost.
- Layout contract: Consumers no longer says "approval-gated"; Build says "explicitly invoked trial"; Test drops `test_approval.py`; Release is fetch history, freeze manifest, run the non-spending dry-run probe, then an explicitly enabled trial.

## Done evidence

Before (`grep -nIE 'YAKKA_REVIEW_|refused_over_cap|cap_usd|cap-usd|estimated_usd|approval' README`): 10 matches on lines 14, 17, 53, 62, 64, 75, 88, 97, 130, 134.
After: no matches (exit 1).

Before (`grep -nI -e '--cap-usd' -e '--approval' -e 'readiness' -e 'projection' README`): 5 matches on lines 12, 53, 62, 64, 75 (line 12 via the gate label "deployed-server readiness").
After: no matches (exit 1).

- `cli.py run --help` shows `--manifest --ledger --base-url --auth-token --reviewer-model --run-id --tenant-id [--dry-run|--execute] [--config-id]`; no `--cap-usd`, no `--approval`.
- `cli.py report --help` shows `--manifest --records --ledger --adjudication --output [--comparators]`; no `--cap-usd`.
- `cli.py smoke` printed the loopback fixture receipt with `cost_usd: 0.00042`, `model: claude-haiku-5-5`, `read_scope_refused: true`, no network or credential.
- `git diff --stat` shows only `tools/shadow-review-trial/README.md` (this report is added by the same commit).

## Deviations and contradictions

- Contradiction named, not resolved silently: the brief says "keep the four other bullets" (line 40), which includes the literal gate name `deployed-server readiness`, but done-evidence check B forbids the string `readiness` anywhere in the README. I kept the gate and used DESIGN.md's own term "deployed-server target" for its label. If the exact old label is required, check B cannot pass; one of the two must yield.
- Tool-wide phase grep (done-evidence line 65) still matches unit 2's files, not mine: `report.py` (`estimated_usd`, `cap_usd`, `cap_comparison`) and `test_report_export.py` (`estimated_usd`). Unit 2 had not landed at commit time; reported, not touched.
- No `gate:` skips needed; no network, provider call, live server, credentials, tenant reset/delete, `/tmp` or deploy was used.
