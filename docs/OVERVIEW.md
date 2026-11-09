# Yakka — Overview

## What It Is

A yakka plugin for Claude Code, Cursor, and (with documented limits) OpenCode — six core skills shipped with the plugin, plus maintainer project skills at `.claude/skills/` — for a design → phased refine/execute → review → close-out workflow. The loop is the same in intent; harness integration is not: unattended multi-phase driver, Claude `SessionStart`, and live `PostToolBatch` signals are Claude/Cursor today. OpenCode installs skills via symlinks under `~/.config/opencode/skills/` (see `README.md` § OpenCode); there is no OpenCode driver provider yet. **Codex** is a separate CLI harness (not an OpenCode provider): pin Sol/Luna; soft effort×fit routing (ask CHM when unsure) — [`docs/lab/GUIDANCE-codex-harness.md`](lab/GUIDANCE-codex-harness.md).

## Who Uses It

Teams and individual developers who want:
- A bounding design with verbatim intent, domain contracts, and phases each closed by a provable outcome
- Work refined one phase at a time, against the code the previous phase actually left, so late discoveries land in refinement rather than in the build
- Delegated implementation via authored briefs, not orchestrator paraphrase
- Independent review keyed to the design's phase outcomes, right-sized to whether a downstream pipeline stage exists
- Plans that end — a single durable record per change, not an accreting folder of interim artifacts
- A local lab for bootstrapping repo docs, running divergent-candidate exploration, and tuning the workflow itself from real outcomes

## The Skills

**Core plugin (`yakka`)** — cloud-safe, no interactive dead-ends, installable in build and pipeline environments:

1. **design** — Produces `DESIGN.md`: verbatim intent, problem, solution shape as domain boundaries and contracts, and phases each with a provable outcome, its surfaces, and an approach flag (known or open). Ground is delegated to cheap recon agents. Interactive (checkpoint held) or headless (assumption ledger), by explicit declaration. Phase count is fixed at sign-off.
2. **refine** — Refines the next phase only: reads the design, `IMPLEMENTATION.md`, and the previous phase's carried items, decomposes the phase into units with disjoint ownership and budgets, writes one complete brief per unit, and adds the phase's Units list to `DESIGN.md`. The first refinement also coarse-checks every phase. Bounces to `design` when a contract, boundary, or outcome is missing. Skipped for a one-unit phase.
3. **execute** — Builds one phase per orchestrator: dispatches `refine` when the phase has no units, routes briefs by path to rightsized workers, records each unit in `IMPLEMENTATION.md` as it lands, verifies the phase outcome with a cheap-tier check, and closes the phase record with the git trailer `Yakka-Phase: <slug>:<n>` — then always stops and reports, never dispatching a successor itself. After the last phase: terminal review and close-out, or pipeline pre-flight; lands the PR carrying the `Yakka-Plan:` marker. Readers still accept legacy `Workflow-Phase` / `Workflow-Plan:` markers and the legacy report fence (see [ARCHITECTURE.md](ARCHITECTURE.md#trailer-dual-read)).
4. **comprehensive-review** — Independent review keyed to the design's phase outcomes. Fixes mechanical findings in place, briefs structural ones for remediation, writes `REVIEW.md` with a machine-actionable post-fix verdict, includes the intent-and-assumptions lens and a plan-sufficiency judgment. Reconstructs intent for a PR with no design.
5. **close-out** — Collapses the plan folder into one record file, `docs/plans/<NN>-<slug>.md` (what was built per phase, deviations, review, QA, risks, follow-ups), promotes contracts that outlive the change to `docs/design/`, deletes the folder in one commit.
6. **post-build** — The pipeline stage against a PR: classify and right-size, `comprehensive-review`, bounded remediation and fresh verification for briefed findings, conditional `QA.md` and exact-SHA deploy proof and browser QA, one end-of-work required-checks gate, an uncommitted merge-readiness report. Workers run from standing briefs in the skill's `briefs/`; repo mechanics come from a per-repo adapter skill.

**Maintainer project skills** (`.claude/skills/`, not installed by `install.sh`) — for repo maintainers working in this checkout:

7. **setup** — Bootstraps `docs/OVERVIEW.md` and `docs/ARCHITECTURE.md` for repos that lack them.
8. **iterate** — Long-horizon exploration for goals whose criteria are not knowable up front: sequential divergent candidates, a divergence gate, synthesis, consolidation, a hardening relay. Also the method for a design phase flagged approach-open, with that phase's outcome as the fixed yardstick.
9. **jev-variants** — Jev Stage A variant registry and matrix expansion (`tools/jev-variants/`).
10. **transcript-parser** — Extracts cost metrics from a session transcript into eval cost-comparison format.
11. **white-paper** — Evidence-backed research loop for hypotheses that deserve a consolidated paper.
12. **yakka-tuning** — Holds the design principles and the lessons corpus; runs evals; harvests retros and merged PRs' pipeline outcomes.

**Workflow Optimiser docs** (`docs/lab/`) — durable research and ops notebook (goals, dated findings, proposals, analysis index, external research library). The Workflow Optimiser agent maintains this tree; maintainer skills live under `.claude/skills/`.

**Driver tool** (`tools/driver/`) — an optional way to run the refine/execute loop across phases, beside human-orchestrated `execute`. Not an agent context: a process, provider-abstracted over the Claude Agent SDK and Cursor's headless agent, chosen by whichever key is present in the environment, run by a person or by an agent holding that key. Agent-orchestrated is the default and works without it — either a human dispatching each phase, or, where the harness has two levels of subagent nesting, a naive coordinator dispatching `execute` per phase in series. The driver exists to test and validate that economics and to reach harnesses agent-orchestration can't: a single-level-nesting harness can run one `execute` invocation but can't also wrap a coordinator around it, and routes to the driver instead (`docs/plans/06-phase-driver/DESIGN.md`). OpenCode is out of scope for the driver until a provider exists; use human/`execute` coordination or Claude/Cursor for unattended loops.

**Codex (separate harness)** — OpenAI `codex` CLI alongside Claude; Sol/Luna pins and soft routing guidance — [`docs/lab/GUIDANCE-codex-harness.md`](lab/GUIDANCE-codex-harness.md). Not a driver provider; no BDK wiring in-tree yet.

**OpenCode (partial)** — skills only: `./install.sh --opencode-skills` or `YAKKA_INSTALL_MODE=opencode` symlinks `skills/*` into `~/.config/opencode/skills/`. Phase running maps to the `execute` skill; harness persona name `orchestrate` is separate from skill names. Built-in OpenCode `plan` is not workflow `design`. **DeepSeek Flash** is encouraged for brief/unit work when rationing capacity; sign-off only is gated in [`docs/lab/GUIDANCE-flash-review-gate.md`](lab/GUIDANCE-flash-review-gate.md) (Sonnet 5.5 review of Flash work, then Claude Code or Grok phase sign-off — no Flash auto close-out).

## Advisory change review

The server-owned `review_change` MCP tool supplies a single-call shadow review beside existing
reviews. `execute` calls once after each phase closes; `comprehensive-review` and `post-build` each
call once at their reviewed/candidate PR head. Each call uses an explicit Git range, available
stored brief or plan criteria, and contributor `build_models` from the run record or `unknown`.
Stages send no `trial` argument. This is non-gating advisory evidence: receipt summaries and findings
stay in session output and never enter gates, verdicts, commits, trailers, exit codes or plan-folder
files, or trigger fixes. Absent, unavailable and failed calls leave existing decisions unchanged;
`skipped_duplicate` refers to earlier evidence rather than a new independent review.

The Go server owns the definition, prompt/policy, criteria resolution, provider call, validation,
spend limits and tenant-local records, through the same orchestrator as `POST /v1/reviews`. The
Python shim alone captures a bounded diff and omission manifest, scans before egress and forwards
declared local context; the server rescans. Machines use their existing Yakka login and need no
provider key. `read_write` scope and `readOnlyHint:false` disclose the server spend-and-record
boundary; the tool declares 150 seconds and no local actions. Receipts omit captured diff content;
`detail=full` includes validated findings. Registration depends on server review model configuration
and a sufficient MCP timeout ceiling; deployment and live availability require separate evidence.
See [architecture](ARCHITECTURE.md#advisory-change-review) and
[the advisory surface](design/04-advisory-surface.md#review_change).

## Core Intent

Optimize for outcome quality per token. Prevent:
- Silent architectural pivots
- Lost intent through paraphrase — orchestrators route context verbatim
- Implementation without explicit contracts
- Drift absorbed by the build orchestrator instead of by the next refinement
- Review that finds easy nits instead of underlying problems
- Documentation cascades that restate the code
- A repo-as-backlog model — status lives in the PR and the tracker

## Key Design Decisions

- Plan artifacts are submitted deliberately by skills to the workflow-quality service. File-write hooks backstop missing design/brief submissions to that same HTTP ledger, bind the current conversation, and report success or failure without blocking writes or injecting frontmatter. See [Hook backstop](lab/QUALITY-SERVICE.md#hook-backstop).
- Design, refine, and execute are separate contexts composed at the run level, never fused. Each stage reads the committed artifacts cold.
- A phase is defined by a provable outcome, not by a surface. Outcomes close phases; surfaces define units inside them. The phase count is fixed at design sign-off, so the refine/execute loop is bounded by construction.
- Refinement is per phase, against real code. Carried items live in the closed phase's record in `IMPLEMENTATION.md`, consumed by the next refinement — never in a backlog file.
- Verification per phase is cheap-tier; premium independent review runs once, against the whole design.
- Coordination travels as authored briefs routed verbatim. Briefs carry a budget, verification-first done evidence, and a bounded report.
- Posture is declared by the invoker, never inferred: interactive/headless for design; terminal/pipeline review for execute; close-out's placement follows. Whether another phase runs after one closes is deliberately not this kind of posture — `execute` always stops and reports; it is a property of the invocation instead (a bare call, a coordinator, or the driver).
- Nothing in the repo carries status. Every plan ends in one record file.
- Skills state outcomes and the constraints an agent could not infer; they do not narrate steps an agent can derive. Design rationale lives in `yakka-tuning/principles.md`.

## Stability Boundaries

**Stable**:
- The core/lab partition and each skill's purpose
- The design → phased refine/execute → review → close-out loop, and the PR artifact seam (`Yakka-Plan:` marker, `docs/plans/<NN>-<slug>/`; readers accept legacy `Workflow-Plan:`)
- The artifact taxonomy: durable carries intent and outcome, run-scoped is consumed at close-out, nothing carries status
- Verbatim intent in `DESIGN.md`'s Intent section
- No commit follows the tested commit

**Under improvement**:
- The operating hypotheses in `README.md`
- Eval infrastructure and the pipeline-outcomes harvest
- Whether a phase's brief set needs its own adversarial pass beyond `refine`'s verdict
- Per-harness model allocation, provisional by design
