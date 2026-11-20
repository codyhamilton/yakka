# Research index — agent & workflow systems

Curated bibliography for optimising workflow-plugin. Each entry: **takeaway** → **implication for this repo** → **confidence** (how sure we are the mapping applies).

**Jev research entry point (2026-10-02):** [tested results](../JEV-RESULTS.md) → [parent hypotheses](../JEV-HYPOTHESES.md) → [active methodology](../JEV-METHODOLOGY.md). Dated packs below preserve experiments and historical protocols. Their older proposed next steps are not automatically the current research order.

Deep dive for synthesis: [`2026-09-30-workflow-systems.md`](2026-09-30-workflow-systems.md).

**Dated research packs** (inputs to evidence-backed `PROPOSALS/` white papers; see the [`white-paper` skill](../../../.claude/skills/white-paper/SKILL.md)):

| Pack | Question | Proposal (if any) |
|------|----------|-------------------|
| [`2026-11-21-shadow-review-trial/`](2026-11-21-shadow-review-trial/README.md) | Plan 28 Phase 5 real-server trial of `review_change` on garcia-music history: HIGH effort only (owner-dropped xHIGH/MAX), 329 of 360 completed against the 300 floor, failure reasons, actual receipt cost and leak-check/export validation. Metric-only aggregate. | None; Phase 5 evidence. Adjudication labelling remains a gate. |
| [`2026-10-02-interception-steer-to-stop/`](2026-10-02-interception-steer-to-stop/INDEX.md) | Multi-framing research pack for Coding Harness Manager **interception / steer-to-stop** (H1–H5; H6 rejected as gold). **Soft Standard HOLD** blocks behaviour ship only. Evidence path: continuous large-n TypeSafe / Flash / Luna waves (thousands of trials per driver on real right-sized transcripts). Opus R1 and R3 fixed in `interception-trials/batch-002`; R2 protocol and 20 labels landed, with joins still provisional. batch-001 quarantined; batch-002 remains a thin diagnostic. Adversarial-gap next-wave designs: [`interception-trials/batch-003/`](2026-10-02-interception-trials/batch-003/INDEX.md). **2026-10-02:** H1 rating → fire is contrast for the next signal loop ([`SIGNAL-CLOSENESS-CONTRAST.md`](2026-10-02-interception-steer-to-stop/SIGNAL-CLOSENESS-CONTRAST.md)); that pointer does not re-rank the bake-off. | [`../PROPOSALS/2026-10-02-interception-steer-to-stop.md`](../PROPOSALS/2026-10-02-interception-steer-to-stop.md) (`status: resolved-soft` — provisional primary H1, H3/H4 live, H2 null baseline, H5 component rows; build after large-n estimates and Cody’s accept) |
| [`2026-10-02-local-session-inventory/`](2026-10-02-local-session-inventory/INDEX.md) | Where local conversation histories live across harnesses on Cody’s Ubuntu, and which sessions are long enough as *provisional* inputs when comparing offline/replay Jev lever-test **session-selection lenses** (length, shape, thrash, diversity, recency, harness-balance). Soft Standard HOLD; stats + Flash shortlist evidence only. | Shortlist stays provisional. Corpus rule is in [`../PROPOSALS/2026-10-02-interception-steer-to-stop.md`](../PROPOSALS/2026-10-02-interception-steer-to-stop.md) (as many right-sized real transcripts as exist; length lens as baseline; 40% caps; 24 sessions is the first slice). No behaviour ship. |
| [`2026-10-01-session-analysis-open-field/`](2026-10-01-session-analysis-open-field/INDEX.md) | Competing ways to summarise Maps sessions, mark shape from the first ~120 turns, and search TypeSafe framings, without a single mandated pipeline. Sibling of the cheap-analysis harness. **Phase 1a–1c** closed (0 calls; 1c mount `refused`) — [`cycles/CYCLE-LOG.md`](2026-10-01-session-analysis-open-field/cycles/CYCLE-LOG.md). Additive wave cost tiers: [`RESOURCE-BUDGET-AGGRESSIVE.md`](2026-10-01-session-analysis-open-field/RESOURCE-BUDGET-AGGRESSIVE.md) (estimate; soft until Cody). | None. Five candidates in [`CANDIDATE-APPROACHES.md`](2026-10-01-session-analysis-open-field/CANDIDATE-APPROACHES.md). No behaviour ship. |
| [`2026-10-01-cheap-analysis-typesafe-opencode/`](2026-10-01-cheap-analysis-typesafe-opencode/INDEX.md) | Offline harness design: Flash summaries, local `:8080` volume labels on the first 120 `api_turn`s, and cached TypeSafe framing trials. Sibling of the progressive pack. Does not score against `A0`. **Confidence: not high** (specified, not run). | None. Recommendations in the pack [`DESIGN.md`](2026-10-01-cheap-analysis-typesafe-opencode/DESIGN.md). Bounding plan [`../../plans/07-cheap-analysis-harness/DESIGN.md`](../../plans/07-cheap-analysis-harness/DESIGN.md). Open-field sibling: [`2026-10-01-session-analysis-open-field/`](2026-10-01-session-analysis-open-field/INDEX.md). |
| [`2026-10-01-progressive-jev-session-gates/`](2026-10-01-progressive-jev-session-gates/INDEX.md) | Progressive in-session Jev checkout every 15 turns after a first checkpoint near 75, tuned offline against multi-model gold exits. Extends cheap-Jev use case 1. **Confidence: not high** (H5 failed, α 0.1189; A0 null; A_maj and A_gc documented, not a fit target). **2026-10-02 measurement grammar** (unsigned, not a sweep): float closeness — [`DESIGN-signal-closeness-v0.md`](2026-10-01-progressive-jev-session-gates/DESIGN-signal-closeness-v0.md). | [`../PROPOSALS/2026-10-01-progressive-jev-session-gates.md`](../PROPOSALS/2026-10-01-progressive-jev-session-gates.md) (`status: researching`) |
| [`2026-09-30-jev-cheap-judgement-signals/`](2026-09-30-jev-cheap-judgement-signals/INDEX.md) | Cheap conditional Jev judgements (hooks + refine/unit/phase soft signals) | [`../PROPOSALS/2026-09-30-jev-cheap-judgement-signals.md`](../PROPOSALS/2026-09-30-jev-cheap-judgement-signals.md) (`status: resolved` — recommendations accepted pending product wiring; proofs `112ccfe`) |
| [`2026-09-30-durable-analytics-sink/`](2026-09-30-durable-analytics-sink/INDEX.md) | Durable observability sink for local + cloud agents (dual-write JSONL + HTTP) | [`../PROPOSALS/2026-09-30-durable-analytics-sink.md`](../PROPOSALS/2026-09-30-durable-analytics-sink.md) (`status: resolved` — recommendations accepted pending product wiring; proofs `1bff769`) |
| [`2026-09-30-opencode-hooks-plugin/`](2026-09-30-opencode-hooks-plugin/INDEX.md) | OpenCode-native plugin for PostToolBatch-like soft signals (separate npm package; no Claude/Cursor drop-in) | [`../PROPOSALS/2026-09-30-opencode-hooks-plugin.md`](../PROPOSALS/2026-09-30-opencode-hooks-plugin.md) (`status: resolved` — recommendations accepted pending product wiring; proofs `d4c4da1`, LCD 4/4) |

**Evidence threads** (offline Wave-0 lever trials; sibling of [`2026-10-02-interception-steer-to-stop/`](2026-10-02-interception-steer-to-stop/INDEX.md); no behaviour unlock):

| Thread | Log | Status |
|--------|-----|--------|
| Wave-0 offline lever trials | [`2026-10-02-interception-trials/EVIDENCE-LOG.md`](2026-10-02-interception-trials/EVIDENCE-LOG.md) · [`OUTCOME-SHEET.md`](2026-10-02-interception-trials/OUTCOME-SHEET.md) · [`2026-10-02-interception-steer-to-stop/ANALYSIS.md`](2026-10-02-interception-steer-to-stop/ANALYSIS.md) · [`batch-003 designs`](2026-10-02-interception-trials/batch-003/INDEX.md) | **batch-001** quarantined. **batch-002** decontam + **20** sidecar labels; **PROVISIONAL** join (not FP/miss board). TypeSafe scenario sweep and #109 preferred cut landed; batch-003 freezes the next multi-stratum trial design. Scale bar still open. Behaviour ship held. |

**Current control and measurement policy** (2026-09-30, later pass): [`../ANALYSIS/2026-09-30-grokbot-driver-reorient.md`](../ANALYSIS/2026-09-30-grokbot-driver-reorient.md). Implications in this index follow that pass: Grok Bot drives, Jev asserts steer, classify visualises.

---

## Foundations: reason + act

| Source | Takeaway | Implication (skills / evals / tooling) | Conf. |
|--------|----------|------------------------------------------|-------|
| [ReAct (Yao et al., ICLR 2023)](https://arxiv.org/abs/2210.03629) | Interleave reasoning traces and environment actions so plans update from observations. | **Grok Bot** reasons on status JSON and the phase report, then acts by triggering one phase. Workers inside `execute` act on briefs. The bot does not fuse every phase into its own context. | high |
| [Google Research blog — ReAct](https://research.google/blog/react-synergizing-reasoning-and-acting-in-language-models/) | Same paradigm; emphasises diagnosable trajectories. | The bot's diagnosable trail is **trailers + workflow-report + per-phase cost + assert log**. Briefs stay verbatim (README hypothesis #2). | high |

## Interfaces & coding agents

| Source | Takeaway | Implication | Conf. |
|--------|----------|-------------|-------|
| [SWE-agent (Yang et al., NeurIPS 2024)](https://arxiv.org/abs/2405.15793) | Custom **agent–computer interface (ACI)** materially changes success on repo tasks. | Two ACIs: skills/briefs/trailers for workers, and a **bot-callable CLI/MCP** (`status`, `trigger_phase`) for Grok Bot. Transcript tools show worker behaviour; they are not the bot's control surface. | high |
| [SWE-agent GitHub](https://github.com/SWE-agent/SWE-agent) | Inference vs evaluation split; Docker sandbox. | The driver runs inference one phase at a time. **Evals** grade with a verifier and cost, separate from the bot's prompt. | medium |
| [OpenHands SDK docs](https://docs.openhands.dev/sdk) | Modular agents: LLM + tools + workspace + conversation lifecycle. | Core skills are the cloud-safe workspace the bot installs. Lab skills stay off the unattended path. | medium |
| [OpenHands SDK paper (arXiv:2511.03690)](https://arxiv.org/html/2511.03690v2) | Event-sourced state, typed tools, security/confirmation before risky actions. | Events we keep: driver stdout, assert JSONL, git trailers. Headless assumption ledger is the bot's confirmation path; `unsuccessful` escalates. | medium |

## Multi-agent orchestration

| Source | Takeaway | Implication | Conf. |
|--------|----------|-------------|-------|
| [AutoGen (Wu et al., arXiv:2308.08155)](https://arxiv.org/abs/2308.08155) | **Conversation programming**: composable agent chats with humans/tools in the loop. | The bot's program is tool calls, not a human relay of briefs. `refine` → workers stays a static pattern inside one phase. | high |
| [AutoGen v0.4 (Microsoft Research)](https://www.microsoft.com/en-us/research/articles/autogen-v0-4-reimagining-the-foundation-of-agentic-ai-for-scale-extensibility-and-robustness/) | Actor/event model for scale. | Driver events (report, cost, assert) beat coordinator prose as the log the next session reads. | medium |
| [LangGraph multi-agent (LangChain blog, Jan 2024)](https://www.langchain.com/blog/langgraph-multi-agent-workflows) | Agents as graph nodes; supervisor and hierarchical teams. | **Grok Bot is the supervisor.** It does no phase work. Workers are brief-routed inside `execute`. Trailers are the checkpoints. | high |
| [LangGraph workflows & agents (LangChain docs)](https://docs.langchain.com/oss/python/langgraph/workflows-agents) | Named patterns: routing, parallelization, orchestrator–worker, **evaluator–optimizer**. | Evaluator–optimizer is phase verify + **Jev assert** + `comprehensive-review`. The bot applies the optimizer step by re-dispatching or escalating. | high |

## Evaluation & benchmarks

| Source | Takeaway | Implication | Conf. |
|--------|----------|-------------|-------|
| [SWE-bench overview](https://www.swebench.com/SWE-bench/) | Real issues + Dockerized test verification. | Outcome rows use a **verifier** (command, rubric, or trailer completeness) plus cost. The bot can re-run them. Session-kind charts are optional attachments. | high |
| [SWE-bench evaluation guide](https://www.swebench.com/SWE-bench/guides/evaluation/) | JSONL predictions; harness caches by `run_id`. | When eval automation lands, key results by `run_id` under `evals/results/<scenario>/<timestamp>/`. | high |
| [TypeSafe / Jev docs](https://docs.typesafe.ai/) | Typed questions (Choice, Score, Noul) over compact `state`. | **Assert hooks** on phase state (alignment, log, steer). Pin `jev-1.13.0`. `classify.py` remains a session-kind visualisation, not the measurement path. | high |
| [Jev context budgets (how-to-use)](https://www.jevtypesafeai.com/how-to-use) | Hard token limits on state+questions. | Assert `state` is headings, trailer, and the outcome line — far under the budget. Store `snapshot_hash` in the assert log. | high |

## Observability (industry)

| Source | Takeaway | Implication | Conf. |
|--------|----------|-------------|-------|
| [LangGraph workflows doc — LangSmith tracing note](https://docs.langchain.com/oss/python/langgraph/workflows-agents) | Trace per-step data flow in complex graphs. | The bot's trace is **status JSON, workflow-report, per-phase cost, assert JSONL**, plus git. Classify JSONL is a side chart. No LangSmith dependency. | medium |

## Weekly scan 2026-10-05

| Source | Takeaway | Implication | Conf. |
|--------|----------|-------------|-------|
| [DynSTEER, arXiv:2609.14637](https://arxiv.org/abs/2609.14637) | Splits agent rollouts into stages at key completed actions, judges each stage against a path-tolerant milestone graph, routes to cheap or expensive judges by tier, and halts unrecoverable runs early. Reports 85.2% better discriminability and 34.5% fewer steps on failed rollouts. | Our phase trailers are already stage anchors. A stage-level screen at phase close (not per tool call, not whole session) is the granularity the paper argues for. It also backs the tiered pattern: zero-call counters first, Jev only when counters are ambiguous. Matches Stage A, where counters matched Jev on most targets. | medium |
| [AgentGuard, arXiv:2609.16287](https://arxiv.org/abs/2609.16287) | Mines recurring failure patterns from 642 real coding-agent traces into instruction-level constraints, packaged as a skill that loads only the rules relevant to the current instruction. Abnormal execution fell from 69.0% to 26.7% with Claude Code on Haiku 4.5. | The executor-complaint and human-intervention mining already in `tools/quality` is the input side of this. A candidate output is a conditional "guardrail" section in the execute skill, generated from mined patterns, rather than hand-written rules. Proposal-grade only; needs our own before/after measurement. | medium |
| [MTAC-IFBench, arXiv:2609.14992](https://arxiv.org/abs/2609.14992) | Multi-turn agentic coding benchmark (about 7 turns, about 91 constraints per instance) with per-constraint checklists verified by scripts plus judge agents. Instruction-following degrades quickly as sessions grow. | Supports keeping briefs short and phase-scoped, and checking acceptance criteria per item at phase close. The checklist-plus-script verifier is the same shape as our acceptance-criterion rationale checks. | medium |
| [Process evaluation levels, arXiv:2608.22960](https://arxiv.org/abs/2608.22960) | Action, task, and step-level process evaluation measure different things. Execution uncertainty is mostly task-level, and full-trace judges show collider bias (they score semantic relevance, not causal contribution). | Caution for any full-transcript Jev judge: prefer task-level or phase-level targets and narrow state. Consistent with Stage A finding that judgement signals added nothing over counters on long traces. | medium |
| [OpenTelemetry GenAI agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md) | GenAI conventions moved to their own repo (2026-05) and stay Development status. `invoke_agent` is split into CLIENT (hosted) and INTERNAL (in-process) spans; `execute_tool` and `plan` spans exist; `invoke_workflow` covers multi-agent orchestration. | If the `workflow` service ever exports traces, map design/refine/execute to `invoke_workflow` and phases to `plan`, and pin a commit because names still move. No action now; the queue and ledger stay the source of truth. | high |
| [Codex hooks docs](https://developers.openai.com/codex/hooks) | Hook stdin carries `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`. Subagent hooks reuse the parent `session_id`. `SessionEnd` does not run for subagents. The rollout transcript format is explicitly not a stable hook interface. | Our Codex hook events should carry `harness=codex` (they were logged as `claude` in the 2.8.0 check). Parent-id reuse means subagent work can't be split by `session_id` alone. Any Codex transcript parser must read defensively. | high |
| [txcript Codex format notes](https://docs.rs/crate/txcript/latest/source/docs/formats/codex.md) | Codex rollouts live at `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`; each line is `timestamp` + `type` (`session_meta`, `turn_context`, `response_item`, `event_msg`) + `payload`. `response_item` is the model-facing log. | Reference for a Codex parser in `tools/transcript/parsers/`. See proposal `2026-10-05-transcript-codex-opencode-parsers.md`. | medium |

## Maintenance notes

- **AutoGen** is in maintenance mode; Microsoft points new production work to **Agent Framework** ([autogen README](https://github.com/microsoft/autogen)) — watch for patterns, not necessarily new dependencies.
- **SWE-agent** repo notes evolution toward mini-swe-agent; ACI lesson remains primary for us.

## How to add a row

1. Primary source URL (paper, official docs, or authoritative blog).
2. One-line takeaway grounded in that source.
3. Concrete mapping to the bot, a hook, a trailer, an assert, or an outcome verifier.
4. Confidence if the mapping is inferential.
