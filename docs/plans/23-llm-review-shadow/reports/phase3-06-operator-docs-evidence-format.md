# Report: phase3-06 — Operator documentation and trial evidence format

Status: `done`

Branch: `feat/23b-review-controls-trial`

## What changed

Documented the landed Phase 3 real-server trial workflow without claiming any run, deployment, credential or spend. Only owned docs changed; no code, tests, plugin/shim or stable design docs.

- `tools/shadow-review-trial/README.md`
  - Rewrote the intro to state this is operator tooling and gates, not a run record, and that a dry-run/fixture/preflight/docs-only run is never a completed live trial or deployed smoke.
  - Added **Operator prerequisites and gates**: full-history clone/population proof, deployed-server readiness, server-held provider credential, Cody's separate explicit spend approval, and a manual browser walkthrough of reset/delete/re-selection. Documents the dedicated `shadow-trial`/`synthetic` tenant, `read_write` `wk_` key, immutable tenant id, `YAKKA_REVIEW_REPOS` entry and `whoami` (`GET /v1/whoami`) identity check.
  - **Manifest** now describes fetch/unshallow of the configured Git remote, remote identity (`--expected-repository`, default `codyhamilton/yakka`), nonshallow/object/count verification, count-vs-enumeration agreement, refusal before any output is opened, and the create-only certified manifest frozen with its history evidence.
  - **Run** documents required `--run-id`/`--tenant-id`, whoami tenant/scope verification, general `effort`/`store:true`/canonical tags (`trial:`, `effort:`, `manifest:`, `case:`), dry-run default with per-case/per-effort retry-inclusive estimates and readiness, and the local Cody approval artifact (`--approval`: fields, preflight digest, ceiling, expiry, resume/prior-spend treatment). States `--execute` alone is not authorization.
  - **Report** documents the certified cursor-paged full-detail export (`--records`) and required `--ledger`, validation of page chain/high-water/counts, canonical-cost isolation and exclusions.
  - **Smoke** keeps the loopback fixture, notes it needs no approval, and states it is not a deployed smoke.
  - Added **Trial evidence format** for a later run under `docs/lab/RESEARCH/<date>-shadow-review-trial/`: certified export, manifest hash/tip/count/history evidence, approval reference, run ledger, per-effort/paired counts and shortfalls, adjudication/alignment report, and the human cleanup record. No run folder or data created.
  - Preserved the mandatory human-owner sentence and Phase 2 lifecycle/Pages cleanup wording, including the spoofable-guardrail caveat.
- `tools/README.md` — terse `shadow-review-trial` row updated: full-history manifest, approval-gated trial run, certified export/report.

## Check output

Before: the README still described the pre-Phase-3 single-page run, bare `--records`, and no approval/history/evidence workflow; the tools row said "Offline historical review manifest and comparator evidence".

After:

```
$ git diff --check
(no output)  # DIFF_CHECK_OK

$ rg -n "gate:|YAKKA_REVIEW_REPOS|whoami|approval|dry-run|human owner|docs/lab/RESEARCH|create-only|cursor|complete" tools/shadow-review-trial/README.md
29 matches; every required topic present (gate: 5, YAKKA_REVIEW_REPOS 1, whoami 4,
approval 8, dry-run 5, human owner 1, docs/lab/RESEARCH 1, create-only 2, cursor 4, complete 12).

$ rg -n "completed live trial|deployed smoke|live trial ran|provider call" tools/shadow-review-trial/README.md
All matches are explicit prohibitions/negations (e.g. "never label ... a completed live trial or
deployed smoke", "makes zero provider calls", "makes no live or provider call"). No run is claimed.

$ git diff --stat
 tools/README.md                     |  2 +-
 tools/shadow-review-trial/README.md | 83 +++++++++++++++++++++++++++-----------
 2 files changed, 57 insertions(+), 28 deletions(-)
```

Only the two owned README paths changed.

## Gates (external/human/live prerequisites, not performed)

- gate: full-history clone/population proof from the live `codyhamilton/yakka` remote.
- gate: deployed-server readiness (real deployed Yakka server as trial target).
- gate: provider credential held only by the server (Fly-held); never on a local machine.
- gate: Cody's separate explicit spend approval before any live/paid execute, retry, resume or paid smoke.
- gate: manual browser walkthrough of reset/delete and re-selection before operator use.

## Deviations

- None from the brief. The README documents the runner's real surface, including that the preflight digest is the SHA-256 of the canonical dry-run summary the operator approved (there is no CLI flag that prints it), rather than inventing a flag.

## Problems / unfinished

- Docs only. No live run, deployed smoke, provider call, credential, deployment, Fly/Wrangler command or paid trial was used, and no run record was fabricated. Feasibility of reaching 50 completed cases per effort remains an operator question for the real run.

## Contradictions

- None between this brief and the cited `DESIGN.md` contracts. The greps for "completed live trial"/"deployed smoke" match only the required prohibitions.
