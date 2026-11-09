# Yakka — Architecture

The seams: what each skill owns, what passes between them, and the invariants that hold across all of them. Each `SKILL.md` is the authority on its own behaviour.

## Component Map

```
(repo root)
├── plugins/yakka/             → yakka plugin install root (skills, hooks, script/, bin/)
├── packages/                  → yakka, hooklog, yakka-analytics, opencode-yakka-hooks
├── tools/                     → driver, release, quality, transcript, … (maintainer/automation)
├── .claude-plugin/marketplace.json  → source: plugins/yakka
├── .cursor-plugin/marketplace.json  → git-subdir https://github.com/codyhamilton/yakka, path plugins/yakka, ref master
├── .claude/skills/            → maintainer project skills (not installed by install.sh)
│   └── {setup,iterate,jev-variants,transcript-parser,white-paper,yakka-tuning}/
├── docs/{OVERVIEW,ARCHITECTURE}.md, docs/automation/, docs/plans/, docs/analysis/
└── evals/{scenarios,results}/
```

Runtime state and config use the `YAKKA_*` environment family (for example `YAKKA_CHECKS_DIR`, `YAKKA_INSTALL_MODE`) and XDG paths under `~/.local/share/yakka/`, `~/.cache/yakka/`, `~/.local/state/yakka/`, and `~/.config/yakka/` — see `docs/design/` contract sections for the full path table.

A skill directory holds only what an agent loads while working: `SKILL.md`, `templates/`, `briefs/`, `scripts/`. Rationale lives in `yakka-tuning/principles.md`; operator guides under `docs/`.

## The Loop

```
design ──sign-off──▶ ┌ per phase, in the design's order ┐ ──▶ review ──▶ close-out
                     │ refine → execute → verify → close │
                     └─── stop + report (Yakka-Phase:) ┘
                                                   terminal:  comprehensive-review in-run, close-out, PR
                                                   pipeline:  PR → post-build → merge → close-out
```

`execute` always stops at its closing commit and reports; whether the next phase runs is a property of the invocation (a bare call, a coordinator, or the driver), never a flag read back from `execute` — see [plans/06-phase-driver/DESIGN.md](plans/06-phase-driver/DESIGN.md).

| Skill | Owns | Writes |
|---|---|---|
| `design` | Intent, problem, solution shape, contracts, phases with provable outcomes | `DESIGN.md`, optional `PROVENANCE.md` |
| `refine` | Decomposing one phase into briefed units; the coarse all-phase check; the verdict | `briefs/<phase>-<NN>-<slug>.md`; the phase's Units list in `DESIGN.md` |
| `execute` | One phase: routing, verification, the phase record; after the last phase, review posture and the PR | `IMPLEMENTATION.md` (progressive, per unit and per phase, with Carried); `REVIEW.md` in terminal posture |
| `comprehensive-review` | Independent assessment against phase outcomes; in-place fixes; remediation briefs | `REVIEW.md`, `briefs/remediation-<NN>.md`, `RECOVERED-INTENT.md` |
| `post-build` | The pipeline stage against a PR | Nothing itself; workers write `QA.md` and `REVIEW.md` updates; the report is external |
| `close-out` | Ending a plan | `docs/plans/<NN>-<slug>.md`; deletes the folder |
| `setup` (maintainer) | Bootstrapping stable docs | `docs/OVERVIEW.md`, `docs/ARCHITECTURE.md` |
| `iterate` (maintainer) | Divergent exploration; approach-open phases | `OUTCOMES.md`, per-cycle artifacts |
| `transcript-parser` (maintainer) | Transcript → cost metrics | a `cost-comparison.md` section |
| `yakka-tuning` (maintainer) | The workflow itself | `principles.md`, `reference.md` |

## Cross-Skill Contracts

**design → refine**: `DESIGN.md` with contracts precise enough to cite and phases each stating an outcome, surfaces, an approach flag, and dependencies. `refine` reads it cold. The first refinement coarse-checks every phase; each refinement briefs one phase. A missing contract, boundary, or provable outcome is recorded in Open Questions and bounced to `design`.

**execute → refine → execute**: `execute` builds the next phase without a Units list by dispatching `refine` as a separate context, then routing its briefs. A one-unit phase is briefed inline by `execute`. The handoff into the next phase is `IMPLEMENTATION.md`'s closed phase record, including its Carried section, which the next `refine` must place or bounce.

**phase boundary**: `execute` always stops at its closing commit — the one carrying the git trailer `Yakka-Phase: <slug>:<n>` — and reports; it never dispatches its own successor. Whether another phase runs is a property of the invocation (a bare call, a coordinator instructed to run to completion, or the driver), never a posture declared to or read from `execute`. The open phase resolves cold, from `<default>..HEAD`'s trailers against `DESIGN.md`'s phase count: the lowest phase with no trailer; **wrap-up** when every phase has one and there is no `Yakka-Phase: <slug>:done`; **done** once that trailer lands too. A cheap-tier verification of the phase outcome gates the closing commit. A fresh orchestrator per phase. Termination is the design's phase count; more phases than signed off is a design change.

**approach-open phases**: `execute` reports `unsuccessful` and stops unless the invoker declared how they run. `iterate` (lab) is the intended method, with the phase outcome as a fixed yardstick; core never depends on it.

**cold read**: every stage reads the committed artifacts, never the previous stage's context, even in the same session.

**execute → comprehensive-review**: once, after the last phase, in terminal posture. Pipeline posture substitutes pre-flight self-verification because `post-build` exists downstream.

**execute → post-build**: the PR itself — branch, commits, `Yakka-Plan:` marker. No live call.

**post-build → comprehensive-review**: dispatched by name; `post-build` branches on the verdict without interpretation and routes remediation briefs by path.

**post-build ↔ adapter**: the adapter supplies repo mechanics; authority on conflict is repo limits → adapter → `post-build` → prompt. See [automation/post-build.md](automation/post-build.md).

**→ close-out**: consumes the whole folder. Terminal: the last commit before the PR. Pipeline: after merge, on the default branch, never inside the stage.

**setup → design**: filesystem presence only; `design` never blocks on stable docs.

**comprehensive-review → yakka-tuning**: one-way, artifact-only, via the plan-sufficiency judgment.

## Advisory change review

`review_change` is owned by the Go server: definition/schema, prompt and exclusion policy, stored
brief or plan/phase criteria resolution, provider call, validation, spend limits and tenant-local
records. It shares the `POST /v1/reviews` orchestrator. The Python shim alone captures a bounded,
secret-scanned local diff and omission manifest through the declared `change` reader, in
uncommitted or explicit Git range mode. The server rescans and alone holds the provider credential;
machines use their existing Yakka login and need no provider key. The tool is `read_write`,
`readOnlyHint:false`: its effect is server spend and record. Its declaration allows 150 seconds and
no local actions. Registration requires review model configuration and a sufficient MCP timeout
ceiling; source integration does not establish deployed availability. Per-call `effort`, `tags` and
`store` are validated on the server; `YAKKA_REVIEW_EFFORT` is a high-only default that never caps a
valid override. A completed `store=true` duplicate returns the earlier review in full, with
`cached`, `original_review_id` and `original_status`, not fresh evidence; `store=false` skips dedupe
and records, so `review_change` does not promise unconditional idempotency. The separate `read`-only
`list_reviews` tool returns the same tenant-bound cursor pages as `GET /v1/reviews` and declares no
local readers or actions.

Beside existing reviews, `execute` makes one non-gating range call after each phase closing commit;
`comprehensive-review` and `post-build` each make one at their reviewed/candidate PR head. Explicit
base/head SHAs select the change, available stored criteria references select the rubric, and
`build_models` comes from the run record or `unknown`; stages send no `trial` argument. Only session
output carries receipt summaries and validated findings (`detail=full`), never captured diff content.
Results never enter gates, verdicts, commits, trailers, exit codes or plan-folder files, and never
trigger fixes or dispatch. Absent, unavailable or failed calls leave existing decisions unchanged.
Repeated `store=true` captures return the earlier review in full as `skipped_duplicate`, not fresh
evidence; `store=false` calls are never deduplicated.
See [the advisory surface](design/04-advisory-surface.md#review_change) and
[MCP contract](design/08-server-mcp-contract.md#the-shipped-tools).

## Trailer dual-read

Writers and readers for phase trailers, plan markers, and execution-report fences:

> Writers emit `Yakka-Phase: <slug>:<n>`, `Yakka-Phase: <slug>:done`, a PR body starting `Yakka-Plan: docs/plans/<NN>-<slug>/`, and a `yakka-report` fence. Readers accept `Workflow-Phase` / `Yakka-Phase`, `Workflow-Plan:` / `Yakka-Plan:`, and both fences, permanently, through one shared key list in `tools/driver/`.

## PR Artifact Seam

Skills own deliberate design/brief `post_*` calls, patches, ratings review and
identity frontmatter. After plan file writes, the shared artifact-submit hook
backstops submission to the same workflow-quality HTTP ledger, checking the latest
body hash and current conversation evidence. It never mutates plan files or blocks
writes; outcomes flow through hooklog. See [Hook backstop](lab/QUALITY-SERVICE.md#hook-backstop).

- **Location**: `docs/plans/<NN>-<slug>/` on the PR branch. The PR body's first line, `Yakka-Plan: docs/plans/<NN>-<slug>/`, is the only mechanical locator (readers also accept `Workflow-Plan:`). `NN` is best-effort ordering; the slug is the key.
- **Build-stage contents**: `DESIGN.md` (required; phases carry their Units lists once refined), `briefs/` (amended in place on reported contradictions), `IMPLEMENTATION.md` (required; per-unit outcomes, per-phase verification and Carried sections), optional `PROVENANCE.md`.
- **Pipeline-stage contents**, committed before the candidate SHA: `REVIEW.md`, `QA.md` (matrix only, omitted when QA does not apply), `briefs/remediation-<NN>.md`.
- **External-only**: classification, checks outcomes, SHA-specific QA results and media.
- **Post-merge**: `close-out` collapses the folder into `docs/plans/<NN>-<slug>.md`; the marker resolves to the folder's history and the record that took its name.
- **Fallback**: a PR with no plan folder reconstructs intent into `RECOVERED-INTENT.md` when functional, or is absorbed when trivial and non-functional.

Folders created before this version carry `PLAN.md` in place of `DESIGN.md`; skills read whichever exists.

## Artifact Taxonomy

- **Durable**: the close-out record; contracts promoted to `docs/design/`.
- **Consumed**: `DESIGN.md`, `PROVENANCE.md`, `IMPLEMENTATION.md`, `REVIEW.md`, `QA.md`, `briefs/`, `RECOVERED-INTENT.md` — the whole folder, deleted at close-out, recoverable from history.
- **Promoted**: follow-ups that became tracker issues or design-intent docs.
- **Status**: carried by nothing. Carried items in a phase record are work not yet refined, with one consumer; they are not a tracker.

## Postures

Declared by the invoker, never inferred. Every posture has a safe default.

| Skill | Postures | Default |
|---|---|---|
| `design` | interactive (checkpoint held) / headless (assumption ledger) | interactive |
| `execute` review | terminal / pipeline | terminal |
| `close-out` | terminal (before the PR) / pipeline (after merge) | follows `execute` |

`execute`'s phase boundary is not in this table: whether a next phase runs is a property of the invocation, not a declared posture (see The Loop, above).

## Key Invariants

1. Intent is captured verbatim in `DESIGN.md`'s Intent section.
2. Context authors write once, addressed to the consumer; orchestrators route verbatim.
3. Nothing in the repo carries status.
4. Review is never silent: terminal runs independent review; pipeline substitutes pre-flight because a downstream stage is declared.
5. A phase closes on a provable outcome, verified against real behaviour. Outcomes define phases; surfaces define units.
6. Refinement is per phase, against the code as it stands; the design's phase count bounds the loop.
7. Core never depends on maintainer skills; maintainer skills may compose core.
8. `yakka-tuning` never auto-runs.
9. No commit follows the tested commit. Nothing in this plugin merges.
10. Every plan ends in one record file.

## Stable References

- [OVERVIEW.md](OVERVIEW.md)
- [../README.md](../README.md)
- [automation/post-build.md](automation/post-build.md)
- [../.claude/skills/yakka-tuning/principles.md](../.claude/skills/yakka-tuning/principles.md)
- [../.claude/skills/yakka-tuning/reference.md](../.claude/skills/yakka-tuning/reference.md)
- [analysis/2026-09-08-workflow-vs-field.md](analysis/2026-09-08-workflow-vs-field.md) — the review this shape came from
