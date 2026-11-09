---
name: comprehensive-review
description: Independent review of a change against its design's phase outcomes. Use when reviewing a PR (plan folder from the `Yakka-Plan:` marker) or after local execution. Fixes mechanical findings in place, briefs structural ones for remediation, reconstructs intent for a PR with no design.
---

# Comprehensive Review

You did not build this; that independence is the value. Your output is read by a pipeline stage that branches on the verdict without interpretation and routes your briefs untranslated to fixers.

## Inputs

- The plan folder: from the PR body's `Yakka-Plan: docs/plans/<NN>-<slug>/` line, or given directly. Never found by scanning or sorting folders. Legacy git history and older agent output may use `Workflow-Phase`, `Workflow-Plan`, or a `workflow-report` fence instead; treat those forms equivalently when present.
- `DESIGN.md` (verbatim intent, phase outcomes, assumption ledger) and the diff. A folder from before the rename carries `PLAN.md` instead; its acceptance criteria stand in for phase outcomes.
- No plan folder on a functional change: create one on the path convention, reconstruct intent from the PR, linked issue, and commits into `RECOVERED-INTENT.md`, say the intent is reconstructed, and review at reduced confidence.

## Outcome

- Every phase outcome is assessed met, partial, or not met, with evidence.
- The intent-and-assumptions lens has run: does the implementation match the verbatim intent, and does each ledger entry still hold? A failed assumption is a finding sized by blast radius.
- Further lenses as the change warrants: contract and correctness; failure modes and operability; real usefulness, including whether a deeper design issue hides behind local fixes; security, performance, migration, or docs only when the shape calls for them. A cross-cutting change gets two or three focused parallel reviewers, at most half the agent count the build used. Never "check everything".
- Every finding took exactly one path:
  - **Fixed in place** — mechanical, localized, obviously correct against the contract. Applied, verified, recorded with its resolution. Closed: no brief, no re-review.
  - **Briefed** — needs design judgment, or touches surfaces beyond the finding: `briefs/remediation-<NN>.md`, complete enough for a clean agent (defect, location, why it matters, fix approach, done evidence). Not attempted here.
  - **Follow-up** — real, not worth blocking on. Listed as non-blocking.
- A plan-sufficiency judgment is recorded: was the design enough to determine intent, place the findings, and derive QA? Read later by `yakka-tuning`; never invoke it.
- `REVIEW.md` is in the plan folder, committed to the PR branch when reviewing a PR.

## REVIEW.md

- Verdict: `PASS` | `PASS_WITH_FOLLOWUPS` | `REMEDIATE` — the post-fix state. `REMEDIATE` only while a briefed finding stands.
- Reviewed SHA, for PR reviews.
- Phase outcome assessment.
- Findings by severity (`blocker`, `high`, `medium`, `low`), each marked resolved in review, briefed with its path, or follow-up.
- Intent and ledger assessment; plan-sufficiency judgment; residual risks.
- Accumulates: later verdicts append against the new SHA. Findings are never erased or rewritten.

## Rules

Alongside this independent review, at its settled reviewed head after any in-place fixes and review artifacts are committed, make exactly one non-gating advisory `review_change` call:

```json
{"mode":"range","base":"<default-branch merge-base SHA>","head":"<reviewed head SHA>","kind":"pr","plan":"<NN>-<slug>","build_models":["unknown"],"detail":"full"}
```

Resolve `base` and `head` to explicit commit SHAs, including for local execution, and add the numeric `pr` when available. Substitute the actual plan folder name to use all stored phase outcomes as criteria. Omit `plan` for a recovered intent or legacy plan without a stored design and let the receipt expose missing criteria. Take contributor model IDs only from the run record for `build_models`; retain `unknown` for unavailable provenance, never guess. Send no `trial` argument.

This call uses `read_write` scope and a server-declared 150-second timeout to spend and record on the server; it has no local actions. If the tool is absent, unavailable or failed, continue. Summarize the receipt ID, status, coverage/limitations and returned findings only in session output, outside the review handoff; a `skipped_duplicate` receipt refers to an earlier review and is not new independent evidence. Never feed the result into a gate, verdict, commit, trailer, exit code or any plan-folder file (including `REVIEW.md`); never fix or dispatch work from it. Your independent findings and verdict remain the only review handoff.

- Focus beats breadth; underlying risk before easy nits.
- Fix in place only what is mechanical and verifiable now. Never start a structural fix you would finish by guessing intent.
- A briefed finding's fixer must never need this conversation.
