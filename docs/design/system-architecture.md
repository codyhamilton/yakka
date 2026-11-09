# Design Intent: System Architecture

How the workflow skills, harness hooks, edge capture and the remote quality service fit together,
and the principles that hold across them.

This is a **design-intent doc**, not a plan. It fixes the shape and the seams so each part can take
its own design. Skill behaviour stays in each `SKILL.md`; the skill-level seams stay in
[../ARCHITECTURE.md](../ARCHITECTURE.md). This doc covers everything around the skills.

## Layers

```
 Workflow skills        design · refine · execute · post-build · close-out · comprehensive-review
        │ write files (designs, briefs, execution reports)
 Harness adapters       Claude Code hooks · Codex hooks.json · OpenCode plugin   (cheap, local, no network)
        │ spool envelopes
 Edge capture           spool → drain (scrub, archive, deliver)                  (capture transport)
        │ ingest
 Remote service         ingest API · ledger · scorer client · review orchestrator (replaceable backends)
        │ reads
 Agent advisory tools   MCP reads + advisory review (server spend and record)
 Maintainer skills      .claude/skills/ — jev-variants · held-out set · white paper (not part of the pipeline)
```

The scorer is **Jev via TypeSafe System One**, behind a client interface. The model behind it is
TypeSafe's choice and is not part of any contract here.

## Principles

1. **Writes are captured, never requested.** Nothing the system needs depends on an agent calling a
   tool to report state. State is derived from facts: hook events, files, git.
2. **Advisory reads help the agent decide; shadow review supplies comparison evidence.** The
   original advisory tools retain read scope. Server-owned `review_change` is the explicit
   `read_write` exception: it spends on a provider call and stores a tenant-local review record,
   with `readOnlyHint:false`. It never feeds a workflow gate or decision.
3. **Capture never mutates what the agent wrote.** No hook edits a file, a commit message or any
   other agent output. Correlation lives in the envelope, not in the artifact.
4. **Relationships are edges, not fields.** A conversation, an artifact version, a commit and an
   event are linked by recorded edges. An artifact touched by three conversations has three edges.
5. **Content and its hash are read together, at drain time.** A hash without its content is
   unverifiable. Intermediate drafts overwritten before the drain are lost; this is accepted.
6. **Ingest is dumb and idempotent.** Deduplication, move resolution and joins happen when building
   derived views, so they can be improved and re-run over existing data. All data is kept.
7. **An output exists only if something consumes it as input.** This is why the execution report is
   a handoff for the next phase, not an admin record.
8. **The drain and the remote are separate services.** The drain never starts or manages the
   quality service. The quality service is a remote; the drain is a client of it. The drain and
   ingest are separated by a module boundary, not a process boundary: a local service may host the
   drain in-process ([design 3](03-remote-service.md#local-serve-hosts-the-drain)).
9. **Secret checks are layered.** A light client scrub runs before anything leaves the machine, on
   every path that sends content. The server runs a deterministic precheck on arrival, and Jev is
   the last check before content is persisted.

## Seams

| Seam | Carries | Direction |
|---|---|---|
| Hook payload → spool envelope | raw event + `{ts, harness, event}` | harness → disk |
| Spool → remote ingest | scrubbed events and artifact versions, batched, idempotent by hash | drain → remote |
| Remote → advisory tools | scores, similar plans, cost estimates, queue state | remote → local MCP shim → agent |
| Shim → review orchestrator | secret-scanned bounded Git diff and omission manifest; explicit criteria references and build-model provenance | local `change` reader → remote `review_change` |
| Review orchestrator → provider | server-built prompt and filtered change; server-only credential | remote → Claude; validated receipt/findings back to the agent |
| Remote → scorer | scrubbed artifact text | remote → Jev |

`review_change` shares its server-owned orchestrator with `POST /v1/reviews`. The server owns the
definition, prompt/policy, criteria resolution, provider call, validation, spend limits and records.
Only the shim captures local content, in uncommitted or explicit range mode, using declared typed
policy values; it scans before egress and the server rescans. Machines need no provider key.
The tool declares a 150-second timeout and no local actions; local capture is read-only.
Registration depends on review model configuration and a sufficient MCP timeout ceiling, without
claiming deployment or live availability.

`execute` makes one non-gating range call after each phase closes; `comprehensive-review` and
`post-build` each make one at their reviewed/candidate PR head, beside existing reviews. Calls use
explicit base/head SHAs, available stored criteria references and `build_models` from the run record
or `unknown`, without `trial`. Receipt summaries and findings stay in session output, never gates,
verdicts, commits, trailers, exit codes or plan-folder files. Absence, unavailability and failure
leave stage decisions unchanged. A repeated capture may return `skipped_duplicate` referring to
earlier evidence, not a new review. Receipts never return captured diff content.

## What is retired

`start_execution`, `complete_execution`, `patch_execution`, `post_design`, `post_brief`,
`patch_design`, `patch_brief` and `link_artifacts` stop being agent-facing. Their jobs are done by
write hooks, derived state and the execution report. `define_checks`, `rate_artifact` and `rescore`
are maintainer operations and move to the REST API or CLI.

## Designs this splits into

| # | Design | Covers |
|---|---|---|
| 1 | [Event model and ingest contract](01-event-model-and-ingest.md) | join keys, artifact identity, derived execution view, execution report, envelope types |
| 2 | [Edge capture](02-edge-capture.md) | spool, drain daemon, client config, MCP shim plumbing, per-harness install and trust |
| 3 | [Remote service](03-remote-service.md) | runtime (Go `yakka` binary), API versioning, auth and tenancy, precheck, storage, screening and scoring, local drain hosting |
| 4 | [Agent advisory surface](04-advisory-surface.md) | MCP reads, advisory review's server spend-and-record boundary, hook feedback, behaviour when the remote is unreachable |
| 5 | [Distribution](05-distribution.md) | plugin layout, per-harness packaging, the pinned Codex copy |
| 6 | Lab and analysis | held-out set, white paper, check-to-cost revisit |
| 7 | [Analytics site](07-analytics-site.md) | person-facing `/v1/analytics` reads, browser CORS, the current static site, local and Pages hosting; [Plan20](../plans/20-analytics-reset/DESIGN.md) designs the native no-build replacement |
| 8 | [Server MCP contract](08-server-mcp-contract.md) | the `/v1/mcp` endpoint and tool registry, the declaration and `_local` carrier, the shim's reader table, and the bounded enqueue extension |

Order: 1 first, since the rest depend on its keys and envelope types. 2 and 3 can then proceed
together.

## Plan folder and phase closure

Plan artifacts live under `docs/plans/<NN>-<slug>/` on the PR branch. The PR body's first line is the
mechanical locator: `Yakka-Plan: docs/plans/<NN>-<slug>/` (`NN` is best-effort ordering; the slug is
the key). Build-stage contents are `DESIGN.md`, `briefs/`, and `IMPLEMENTATION.md` (plus optional
`PROVENANCE.md`); pipeline stages add `REVIEW.md`, `QA.md`, and remediation briefs before the
candidate SHA. Folders created before the rename may carry `PLAN.md` instead of `DESIGN.md`; readers
accept whichever exists.

Phase closure is a git trailer on the commit that closes a phase: writers emit `Yakka-Phase:
<slug>:<n>` and `Yakka-Phase: <slug>:done` when the design is finished. Readers accept
`Workflow-Phase` / `Yakka-Phase`, `Workflow-Plan:` / `Yakka-Plan:`, and both report fence tags,
permanently, through one shared key list in `tools/driver/`. Execution reports use a `yakka-report`
fence; the same dual-read rule applies there. Nothing in this section rewrites git history or old PR
bodies.
