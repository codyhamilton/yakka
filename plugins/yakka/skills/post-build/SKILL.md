---
name: post-build
description: Pipeline stage that takes a PR from "build finished" to "provably ready to merge" — classify and right-size, independent review with in-place fixes, bounded remediation for briefed findings, conditional QA against an exact-SHA deployment, one end-of-work required-checks gate, and an uncommitted merge-readiness report. Use when picking up a PR after the build stage or when an automation triggers it.
---

# Post-Build

The downstream review stage that `execute`'s pipeline posture declares exists. While it runs, `REVIEW.md`, `QA.md`, and remediation briefs are its property.

The orchestrator coordinates: discovers, classifies, dispatches, checks handoffs, reports. It does not edit functional code, review functional changes, drive a browser, or prove a deploy itself. Exception: trivial or small non-functional changes may be absorbed whole.

## Adapter

Repo-specific mechanics come from a repo adapter skill loaded alongside this one: production boundaries, deploy-proof and health-check commands, required checks, QA environment and identities, worker routing. Authority on conflict: repo hard limits, then adapter, then this skill, then the triggering prompt. A missing adapter capability skips the dependent phase explicitly in the report; never fake a proof.

## Dispatch

A worker prompt is an absolute path to its standing brief in this skill's `briefs/` (resolved against this skill's own directory) plus the situational lines only this run knows. Never open, inline, or restate a brief. Independent review is the exception: it is the `comprehensive-review` skill, named.

| Phase | Static direction | Dynamic context |
|---|---|---|
| Independent review | `comprehensive-review` | PR, plan folder or no-plan note |
| Remediation fix | `briefs/fixer.md` | branch, plan folder, path to the reviewer's remediation brief |
| Remediation verification | `briefs/verifier.md` | branch, plan folder, reviewed SHA, candidate SHA, findings claimed resolved |
| QA planning | `briefs/qa-planner.md` | branch, plan folder, adapter QA notes |
| Deployed QA | `briefs/qa-driver.md` | proven URL, candidate SHA, `QA.md` path, adapter identities and setup |

## Discovery and classification

- Plan folder: the PR body's `Yakka-Plan: docs/plans/<NN>-<slug>/` line. Legacy git history and older agent output may use `Workflow-Phase`, `Workflow-Plan`, or a `workflow-report` fence instead; treat those forms equivalently when present. Fallback for a markerless PR: the unique parent directory of a changed `IMPLEMENTATION.md` (else `DESIGN.md`, or a legacy `PLAN.md`) under `docs/plans/` since the merge base. Exactly one candidate or stop and ask; never tie-break by number, time, or order.
- No plan folder: non-functional trivial or small changes proceed ad hoc; functional changes get `comprehensive-review`, which reconstructs intent. Create a folder only when review or QA artifacts need a home.
- Preflight: clean worktree, non-default branch, diff plausibly covered by the plan. Unexplained material changes outside scope stop the stage.
- Classify from the diff and plan context, and record it: intent `planned` / `recovered` / `ad-hoc`; surface `functional` / `non-functional` / `mixed`; size `trivial` / `small` / `normal` / `large`. Over-classify when unsure; a docs majority never hides a behavioural hunk.

| Classification | Process |
|---|---|
| trivial or small, non-functional | Absorb: diff skim, checks read, report. No review dispatch, QA, deploy proof, or check fixing. |
| normal or large, non-functional | Light review; checks read; no QA or deploy proof; failing checks reported, not fixed. |
| functional or mixed, any size | Independent review; checks gate with one bounded fix cycle (non-trivial only); QA and deploy proof only when a driveable user-facing outcome or residual risk needs a live UI. |

Never absorb: review of functional or mixed change, verification of delegated remediation, browser QA, exact-SHA proof.

## Order

Review settles the code; QA tests only settled code; required checks are read once, after the last code-changing phase. A re-triggered run resumes: artifacts already bound to the current candidate SHA count as done, and recorded cycles count against the bounds.

1. **Review.** `comprehensive-review` against the PR. Its verdict is the post-fix state; findings it fixed in place are closed.
2. **Remediation**, on `REMEDIATE` only: one fixer per briefed finding, routed by brief path.
3. **Verification**, when remediation ran: a fresh verifier, never the reviewer or a fixer. One remediation cycle, one verification. A `blocker` or `high` still standing after that: one retry on the next model tier, then stop and hand off.
4. **QA planning**, when QA applies: `QA.md` derived from the phase outcomes and review residuals, committed before the candidate SHA exists. Otherwise `QA: SKIPPED (<reason>)`.
5. **Required checks**, once, on the candidate SHA, after every artifact and fix is committed. Wait for pending checks without poking. Failure on a non-trivial functional or mixed change this PR caused: one fix cycle, re-read on the new SHA, then `HUMAN_ACTION_REQUIRED`. Any other failure: report and leave it. Unknown checks are reported as unknown, never as green.
6. **Deploy proof**, when QA will run: a non-production deployment of exactly the candidate SHA, its exact URL, health-checked. Branch readiness and exit codes are not proof. Unprovable: stop before QA.
7. **Deployed QA** against the proven URL only. One QA remediation cycle for evidenced failures (fix, recommit, re-read checks, re-prove, rerun affected cases); a structural failure or anything remaining after the cycle stops the stage.
8. **Report**, to the PR or automation output. Never committed.

A worker that returns nothing usable is relaunched once with its partial output; a second failure stops for a human.

## Advisory range review

At the final candidate PR head, after every artifact and fix is committed, make exactly one non-gating advisory `review_change` call alongside the existing review work, including absorbed runs:

```json
{"mode":"range","base":"<default-branch merge-base SHA>","head":"<candidate SHA>","kind":"pr","plan":"<NN>-<slug>","pr":1,"build_models":[{"id":"unknown"}],"detail":"full"}
```

Resolve `base` and `head` to explicit commit SHAs. Substitute the actual PR number and plan folder name; the plan reference supplies all stored phase outcomes for PR criteria. Omit `plan` when no stored design exists and let the receipt expose missing criteria. Take contributor model IDs only from the run record for `build_models`; retain `unknown` for unavailable provenance, never guess. Send no `trial` argument. The independent reviewer owns its separate stage call; do not repeat either stage's call to force fresh findings.

This call uses `read_write` scope and a server-declared 150-second timeout to spend and record on the server; it has no local actions. If the tool is absent, unavailable or failed, continue. Summarize the receipt ID, status, coverage/limitations and returned findings only in session output, separate from the merge-readiness report; a `skipped_duplicate` receipt refers to an earlier review and is not new independent evidence. Never feed the result into a gate, verdict, commit, trailer, exit code or any plan-folder file; never fix or dispatch work from it. Required checks, remediation and QA keep their existing decision inputs.

## Invariants

- Never touch production targets or data; absent an adapter, every target is production.
- Never merge, force-push, or change merge state. Merge-readiness is reported.
- Never broaden the plan or discard unrelated work on the branch.
- No commit follows the tested commit. QA results and media stay external.
- `REVIEW.md` accumulates; findings are never erased.
- `medium` and `low` ride along as non-blocking follow-ups; `blocker` and `high` stop the stage.
- The stage never closes out the plan folder. Close-out belongs after merge, on the default branch.

## Report

```text
Status: PASS | PASS_WITH_FOLLOWUPS | HUMAN_ACTION_REQUIRED
Plan: <docs/plans/<NN>-<slug>/ | RECOVERED | NONE>
Classification: intent=<planned|recovered|ad-hoc>; surface=<functional|non-functional|mixed>; size=<trivial|small|normal|large>
Execution mode: orchestrated | absorbed
Branch / base / merge base: <values>
Tested SHA: <sha | NOT_TESTED>
Tested URL: <url | NOT_TESTED | N/A>
Review verdict: <verdict | ABSORBED_LIGHT | SKIPPED>; in-place fixes: <n>; remediation cycles: <0|1>; escalated retry: <yes|no>
Required checks: <check>: PASS|FAIL|PENDING (<evidence>) per line; fix cycle: <0|1|N/A>
Deploy proof: RUN | SKIPPED (<reason>)
QA: RUN | SKIPPED (<reason>)
QA cases: <id>: PASS|FAIL|NOT_RUN — <evidence> per line; QA remediation cycles: <0|1>
Remaining non-blocking findings: <ids | none>
Blocker / human action: <specific action | none>
After merge: close out <plan folder> via close-out | N/A
```

Never `PASS` while checks fail or pend, or while exact-SHA proof or an applicable QA case is missing. Skipped QA on non-functional or undriveable work is an honest skip, not a missing gate.

`docs/automation/post-build.md` in the plugin repo covers wiring this stage into an automation; it is not loaded here.
