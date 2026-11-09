---
name: execute
description: Build one phase of a signed-off design from `docs/plans/` — refine it if needed, route briefs to rightsized workers, verify the phase outcome, record it with its closing trailer, then stop and report. Runs terminal review and close-out after the last phase. Use when the user wants designed work built.
---

# Execute

One phase per orchestrator. The orchestrator holds control state and routes; it does not implement while workers run, and it does not read what a worker wrote beyond the worker's report.

Read `DESIGN.md`, `IMPLEMENTATION.md`, and the briefs cold from the committed artifacts, even when the previous stage ran in this session. A design that no longer matches the architecture or the intent stops the run and goes back to `design`.

## Outcome of a phase

- `IMPLEMENTATION.md` exists before any work starts, with run identity at the top: tool, session or run ID or URL, start time.
- The phase has units. `refine`'s where it ran. Where the phase has no Units list and is more than one worker's work, `refine` is dispatched for it as a separate context and the run continues from its verdict; a bounce stops the run. Where the phase is one unit, one brief is authored inline from the design's contracts, with the same anatomy as `refine`'s, written to `briefs/` and committed before dispatch.
- Each worker writes `docs/plans/<plan>/reports/<brief-name>.md` before its commit and includes it in that commit. The report is a handoff for the next phase: what was done against the brief, verifiably (commits, test results); every departure from the brief and why; unfinished or deferred work, specific enough to act on; known problems, plainly; nothing derivable (commits, model, cost, files touched). `packages/yakka/catalogue/checks/execution-report.json` is the rubric. The runner reads reports and does not rewrite them; a runner note is a separate file. Before closing a phase the runner calls `artifact_feedback` on each report and on the phase's briefs and records flagged checks in `IMPLEMENTATION.md`; an unreachable service is recorded there too and the run continues.
- Commit titles are plain summaries. A phase-closing commit may list its units in the body.
- Every worker got its brief by path, plus repo, branch, and how to report back. Nothing restated, nothing inlined.
- Dependencies were honoured; only units declared alongside each other ran in parallel.
- Each unit's outcome is recorded in `IMPLEMENTATION.md` against its brief name as it lands, never batched: what was built, surfaces touched, deviations, and per agent the turns and final context where the harness reports them.
- Contradictions a worker reported amended the brief file. The amended brief is what any re-dispatch reads.
- The phase outcome in `DESIGN.md` has been verified against real behaviour by a cheap-tier check: the outcome's own entry point → action → result or observable statement, plus each unit's done evidence. Reports are not verification.
- The phase record in `IMPLEMENTATION.md` closes with the verification result and a **Carried** section: deferred bugs, non-blocking findings, and brief amendments the next refinement must place. Ordered, no status column, "None" when empty.
- Everything is committed. The branch resumes from `DESIGN.md` plus `IMPLEMENTATION.md` alone: units with a recorded outcome are done, the rest are the remaining work.
- The commit that closes the phase record carries the git trailer `Yakka-Phase: <slug>:<n>` (the plan folder's slug, `<n>` the phase's 1-based index in `DESIGN.md`) — the sole durable signal that phase `<n>` is closed. It appears on no other commit. A re-dispatched agent that finds the record closed and verified but no trailer closes with a trailer-only commit.

## Boundary

After the phase's closing commit, make exactly one non-gating advisory `review_change` call alongside the existing verification:

```json
{"mode":"range","base":"<previous phase closing SHA, or default-branch merge-base SHA>","head":"<phase closing SHA>","kind":"phase","plan":"<NN>-<slug>","phase":1,"build_models":["unknown"],"detail":"full"}
```

Resolve `base` and `head` to explicit commit SHAs, with `head` the commit carrying this phase's `Yakka-Phase:` trailer. Substitute the actual plan folder name and numeric phase. Take contributor model IDs only from the run record for `build_models`; retain `unknown` for unavailable provenance, never guess. The plan and phase reference supplies the stored criteria. Send no `trial` argument.

This call uses `read_write` scope and a server-declared 150-second timeout to spend and record on the server; it has no local actions. If the tool is absent, unavailable or failed, continue. Summarize the receipt ID, status, coverage/limitations and returned findings only in session output, outside the report fence; a `skipped_duplicate` receipt refers to an earlier review and is not new independent evidence. Never feed the result into a gate, verdict, commit, trailer, exit code or any plan-folder file; never fix or dispatch work from it. The phase boundary and existing reviews stand independently.

`execute` always stops at its closing commit and reports; it never dispatches a successor itself. Whether another phase runs next is not a posture declared to `execute` — it is a property of what invoked it:

- A bare call stops and reports; nothing dispatches a successor.
- A **coordinator** — a context that has done no phase work, instructed to run the design through completion — dispatches `execute` for each phase in series as a subagent, holding only each report, and repeats on `closed`; on `incomplete` (after one re-dispatch) or `unsuccessful` it stops and relays the report, unresolved. This needs two levels of subagent nesting: one for the coordinator to dispatch `execute`, one for `execute`'s own `refine`/worker dispatch inside the phase. A harness with only one level still runs a single `execute` invocation fine, but cannot also wrap it in a coordinator — an unattended, multi-phase run there is out of scope for this path; use the driver (`tools/driver/`) instead.

The report is the run's final output: one fenced block tagged `yakka-report` holding a JSON object with `status` (`closed | incomplete | unsuccessful`), `phase` (`<n> | done`), and `reason` (free text, required for anything but `closed`). `closed` means the closing commit (or the done commit, after the last phase) exists on the branch; a run that closed and then stopped for any other reason still reports `closed`. Legacy git history and older agent output may use `Workflow-Phase`, `Workflow-Plan`, or a `workflow-report` fence instead; treat those forms equivalently when present.

A phase flagged **approach: open** is not built by this skill's default path. Report `unsuccessful` with the reason, unless the invoker declared how open phases run (for example `iterate` with the phase outcome as the fixed yardstick).

## After the last phase

Invoked once every phase is closed — resolvable cold from `Yakka-Phase:` trailers on `<default>..HEAD` against `DESIGN.md`'s phase count: the run is in wrap-up when every phase has a trailer and there is no `Yakka-Phase: <slug>:done` yet. Review posture is declared by the invoker; default **terminal**.

- **Terminal**: one independent review via `comprehensive-review` against the whole design, written to `REVIEW.md`. A `blocker` or `high` finding that is in scope and not architectural is resolved by a clean agent: one pass on the allocated model, then one retry on the next model tier, then stop for a human. Then `close-out`, as the last commit before the PR.
- **Pipeline**: pre-flight self-verification only — it builds, the phase outcomes hold, the folder is complete — recorded in `IMPLEMENTATION.md`. No `REVIEW.md`; close-out happens after merge.

"Skip review" is a pipeline declaration, not licence to skip verification.

The commit that ends this path — terminal's close-out commit, pipeline's pre-flight record commit — carries `Yakka-Phase: <slug>:done`, the same mechanism as a phase closing. Without it, a run that dies between the last phase and the PR is indistinguishable from one that finished cleanly.

Then push and open or update the PR with `Yakka-Plan: docs/plans/<NN>-<slug>/` as the first line of the body. Completion is the commits plus that marker.

## Workers

- One worker per unit, on the cheapest worker likely to succeed. Starting allocations, to tune: Claude Code — Haiku for research and small bounded changes, Sonnet for large or ambiguous ones, Opus only where directed. Cursor — Composer unless directed. Codex (separate harness, not OpenCode) — **sol** (`gpt-6.1-sol`) with elevated reasoning for high-thinking / rich mechanical units; **luna** (`gpt-6-luna`) for focused Codex volume; see `docs/lab/GUIDANCE-codex-harness.md`.
- A failed unit gets one retry on the next model tier, then a human.
- Implementing a small unit directly is a judgment call when no worker is running and the orchestrator's context is already hot with the design. Never while workers run.
- Never resume a stalled worker by message. End it, take its handoff, dispatch a fresh one.
- A worker's deferred bug gets a small fresh fixer after the reporting unit is complete, not a reopened worker.

## Rules

- Execute only from an existing design. Do not invent scope.
- Write `IMPLEMENTATION.md` as work lands, never at the end.
- No status files, schedule docs, or renamed folders.
