# Phase 2 brief — retire the legacy MCP and its launcher

## Context

Plan 21 Phase 2, `Retire the legacy MCP and its launcher`, in `docs/plans/21-feedback-delivery/DESIGN.md`. Work in `/home/codyh/workspace/yakka-build/21` on branch `feat/21-feedback-delivery`.

## Outcome

After restarting `codex-usage-probe.service`, no process whose command line contains `workflow-linux-amd64` remains after 60 seconds; `codex mcp list` in the probe environment shows only `yakka`; usage readings resume. Retire the launcher chain and archive or remove the old plugin copy and binary, and verify no process launches from them. Do not touch `~/.local/share/workflow/queue`; record its count before and after. Exclude the workflow key backup and unrelated `workflow-serve`/`workflow-quality` units unless evidence places one in the actual launcher chain.

## Work

- Reconcile the current process tree, probe unit/tmux launcher, Codex MCP configuration, and legacy plugin/binary paths before changing anything.
- Stop the launcher at its root and restart `codex-usage-probe.service` as specified by the design; verify process absence after 60 seconds, only `yakka` in the probe's Codex MCP list, and resumed usage readings.
- Archive or remove only confirmed legacy launcher-chain files named by the design. Preserve unrelated configuration and all queue contents.
- Record evidence and any gate that prevents a live operation. Do not call remote feedback or make an egress/classification call.

## Boundaries

- Do not push, merge, change branches, touch master, other Plans, or `/home/codyh/workspace/yakka-wt/`.
- Do not touch `~/.local/share/workflow/queue`, secrets, production configuration, Cloudflare or Fly settings.
- Do not implement local effects or any `enqueue_file_snapshot` behavior.
- Do not run the unrelated layout test; if encountered, record it without investigation.

## Evidence

Record the before/after process tree, unit state and restart, probe MCP list, resumed usage readings, archive/removal paths, and unchanged queue file count. This phase is operational; use the observable local process and unit state rather than adding application tests.

## Reporting

Write `docs/plans/21-feedback-delivery/reports/phase2-retire-legacy-mcp.md` before the phase-closing commit. Record what was done, exact evidence, deviations, gates, unfinished work, and known problems. Close with `Workflow-Phase: 21-feedback-delivery:2`.
