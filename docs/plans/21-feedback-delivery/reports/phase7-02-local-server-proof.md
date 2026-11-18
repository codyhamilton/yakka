# Phase 7 live proof — local server built from this branch

Times are Australia/Brisbane (AEST, UTC+10), 19 Nov 2026.
Branch: `feat/21-feedback-delivery` at `9cf20699` when the server was built.
Scratch repo (not committed): `/home/codyh/workspace/yakka-build/21-p7-local-20261119-084124`.
This evidence is from a **local** `yakka serve` built from this branch, bound at
`127.0.0.1:8770`, with its store under the scratch dir (`serve-data-p7b/`), not
`~/.local/share/yakka/serve` and not production. The live check on
`api.yakka.build` happens after merge and deploy: Phase 4's `scoring:` line and
Phase 5's relative-path resolution are not on `origin/master`.

Secrets are redacted. Tokens and keys were never printed. The default Yakka
tenant was not used. No tenant reset or delete, fly, wrangler, or force-push
was run.

## Client wiring (not a product patch)

Hook and drain processes used `YAKKA_MODE=local` with `YAKKA_ENDPOINT` and
`YAKKA_KEY` unset. The MCP shim process used a scratch-plugin wrapper that set
`YAKKA_ENDPOINT=http://127.0.0.1:8770`, left `YAKKA_KEY` unset, and did **not**
set `YAKKA_MODE`. `~/.config/yakka/client.toml` was not edited.

`yakka status` under those two environments, before the sessions:

- Drain/hook env: `config: none (local mode)`, `endpoint: http://127.0.0.1:8770 reachable`.
- MCP env: `mcp: http://127.0.0.1:8770 no-credential`.

(The drain-env `mcp:` line still named `https://api.yakka.build`, which is the
`LoadMCP()` gap below; the MCP process itself was pointed at loopback.)

Local serve whoami: `tenant=local`, `scope=read_write`. A scorer key already
present in the runner environment was passed only as the serve process env
(never printed, never read from a secrets file). Startup log:
`scorer jev-1.13.0; checks design=11 brief=11 report=5`.

## Claude (harness pick research --harness claude, haiku-5-5)

Session `a4599859-9f95-4206-add8-6152b1fc741a`, ~08:59–09:00 AEST.
Plugin loaded from a scratch copy via `--plugin-dir`. First
`artifact_feedback` on the relative path `docs/plans/01-hello-helper/DESIGN.md`
returned `queued`; a second call after a short wait returned `delivered` with
`screen:` and `scoring:` lines. No check was flagged, so there was no rewrite.
The final message stated the pass and quoted the score lines.

First tool result:

```
state: queued
path: docs/plans/01-hello-helper/DESIGN.md
repo: root:af21ffa561c91bb1a281e8aa0320e18a1f5aea09
content_hash: 225d3b7c4e0ae3d40d26279457cd3ef204904e7de85f4b202dda048d6b4e0bcc

1 events for this file still queued, oldest 1s, draining
the version is on its way; call again in a few seconds
```

Second tool result:

```
state: delivered
path: docs/plans/01-hello-helper/DESIGN.md
repo: root:af21ffa561c91bb1a281e8aa0320e18a1f5aea09
content_hash: 225d3b7c4e0ae3d40d26279457cd3ef204904e7de85f4b202dda048d6b4e0bcc

screen: pass by jev-1.13.0
scoring: on
d.surfaces_specific 1.00 (baseline n=1, too few to flag)
d.risks_open_marked 0.57 (baseline n=1, too few to flag)
d.problem_covered 0.86 (baseline n=1, too few to flag)
d.outcomes_checkable 1.00 (baseline n=1, too few to flag)
d.nongoals_real 0.97 (baseline n=1, too few to flag)
d.contracts_citable 0.99 (baseline n=1, too few to flag)
d.bounding_altitude 0.86 (baseline n=1, too few to flag)
d.alternatives_recorded 1.00 (baseline n=1, too few to flag)
d.ac_why 0.41 (baseline n=1, too few to flag)
d.ac_proven_required 0.80 (baseline n=1, too few to flag)
d.ac_judgement_labelled 0.69 (baseline n=1, too few to flag)
versions: 1
```

Local serve log (tenant=local): `initialize` / `tools/list` at 08:59:32;
`tools/call tool=artifact_feedback` at 08:59:55 and 08:59:57.

Transcript (host, not in this repo):
`~/.claude/projects/-home-codyh-workspace-yakka-build-21-p7-local-20261119-084124/a4599859-9f95-4206-add8-6152b1fc741a.jsonl`.

## Codex (harness pick research → R1 gpt-6-luna, sandbox off)

Session rollout `01a1f0f0-5c2e-73c1-8a2c-49c178a1a7fb`, ~09:14–09:15 AEST.
Isolated `CODEX_HOME` in the scratch dir, Plan 21 plugin, hooks trusted for the
invocation with `--dangerously-bypass-hook-trust`. A prior hook probe had
already shown `SessionStart` / `PostToolUse` / `Stop` Completed and a write
landing in `YAKKA_QUEUE`. Hooks in this session also Completed.

The required relative-path call failed with the Phase 5 error (no project
directory supplied; the shim would not treat its cwd as the project). A retry
with the absolute path first returned `queued`, then `delivered` with `screen:`
and `scoring:` lines. No check was flagged. The final message stated the pass
and quoted the score lines.

First completed tool result (absolute path):

```
state: queued
path: docs/plans/01-hello-helper/DESIGN.md
repo: root:af21ffa561c91bb1a281e8aa0320e18a1f5aea09
content_hash: 01a24c574825e40d58bc88aab633165c3751549c552de7c1abebe788ddd05d7d

1 events for this file still queued, oldest 0s, draining
the version is on its way; call again in a few seconds
```

Second completed tool result:

```
state: delivered
path: docs/plans/01-hello-helper/DESIGN.md
repo: root:af21ffa561c91bb1a281e8aa0320e18a1f5aea09
content_hash: 01a24c574825e40d58bc88aab633165c3751549c552de7c1abebe788ddd05d7d

screen: pass by jev-1.13.0
scoring: on
d.surfaces_specific 1.00 (baseline n=1, too few to flag)
d.risks_open_marked 0.85 (baseline n=1, too few to flag)
d.problem_covered 0.99 (baseline n=1, too few to flag)
d.outcomes_checkable 1.00 (baseline n=1, too few to flag)
d.nongoals_real 0.92 (baseline n=1, too few to flag)
d.contracts_citable 0.99 (baseline n=1, too few to flag)
d.bounding_altitude 0.94 (baseline n=1, too few to flag)
d.alternatives_recorded 0.11 (baseline n=1, too few to flag)
d.ac_why 0.04 (baseline n=1, too few to flag)
d.ac_proven_required 0.53 (baseline n=1, too few to flag)
d.ac_judgement_labelled 0.87 (baseline n=1, too few to flag)
versions: 2
```

Local serve log (tenant=local): `initialize` / `tools/list` at 09:14:07;
`tools/call tool=artifact_feedback` at 09:14:48, 09:14:57 and 09:15:05.

Rollout (scratch, not in this repo):
`codex-home/sessions/2026/11/19/rollout-2026-11-19T09-14-06-01a1f0f0-5c2e-73c1-8a2c-49c178a1a7fb.jsonl`.

## Product gap (not fixed in this plan)

`LoadMCP()` in `plugins/yakka/client/yakka.py` (lines 202–245) ignores
`YAKKA_MODE=local`. It selects `YAKKA_ENDPOINT` / `YAKKA_KEY`, else
`~/.config/yakka/client.toml`, else `https://api.yakka.build`. Drain and status
via `Load()` honour `YAKKA_MODE=local` and talk to `127.0.0.1:8770`, so a
session that only sets `YAKKA_MODE=local` will drain locally while
`artifact_feedback` still goes to the configured remote. This is a separate
product gap for Solution Designer to consider. It was not changed on this
branch; the proof used a process-level env split instead.

## Outcome

The Phase 7 done-when is met by these two transcripts: each session designed a
small feature in a scratch repo and showed `delivered` with `screen:` and
`scoring:` lines (after a `queued` retry). On `screen: pass`, each final
message stated the pass and quoted the score lines. The flagged-line fix
wording was not exercised (both screens passed).
