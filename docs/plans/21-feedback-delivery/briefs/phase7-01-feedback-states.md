# Brief: 7-01 — Name the server states in the design skill's feedback step

Consumer: the execute worker for Plan 21 Phase 7.
Owned paths: `plugins/yakka/skills/design/SKILL.md`, `docs/plans/21-feedback-delivery/reports/phase7-01-feedback-states.md`. Touch nothing else.
Commits: Leave changes in the working tree.
Report: write `docs/plans/21-feedback-delivery/reports/phase7-01-feedback-states.md` (a handoff; rubric in `packages/yakka/catalogue/checks/execution-report.json`) and leave it in the working tree with the change.
Depends on: nothing inside the phase (design phases 3, 4 and 5 are closed in `IMPLEMENTATION.md`; their live closures remain Cody gates).
Runs alongside: nothing.
Budget: 5 files to read (ranges only), about 1 line changed, 12 tool turns. Past the budget, stop: write a handoff under this brief's name in `IMPLEMENTATION.md` (done, not done, what you learned), leave the changes in the working tree, and report `over budget`.

## Required reading, in order

1. `docs/plans/21-feedback-delivery/DESIGN.md` — "Phase 7 — Agents act on feedback" (lines 500-505) and the Feedback tool domain states and contracts (lines 114-155); Assumptions 15, 18, 25 and 28 (lines 304-309, 325-330, 378-383, 408-418). Binding.
2. `plugins/yakka/skills/design/SKILL.md` — the `## Outcome` bullet at line 18. This is the only file changed.
3. `packages/yakka/internal/serve/mcp_feedback.go` — `mcpFeedbackFix` (line 15) and its append sites (line 274 rejected, line 401 screen flagged). Confirmation only; do not change it.
4. `packages/yakka/internal/serve/testdata/mcp-golden/artifact-feedback.json` — the `state: rejected` call. Confirmation only.
5. `docs/plans/21-feedback-delivery/IMPLEMENTATION.md` — Carried (lines 194-201, 270-288) for the gates and carried item placement.

Read ranges and grep; do not read a whole file to find one section, do not re-read a file already in context, and truncate long tool output.

## Goal

Make the design skill's feedback step name every terminal `artifact_feedback` answer an agent can receive, so a `not tracked`, `not delivered` or `stale` answer is not silently skipped and a `queued` answer is followed by one more call. The server's flagged/rejected fix wording is already correct and stays unchanged.

## Contract

- DESIGN.md, Phase 7 surfaces: "the `yakka:design` skill's feedback step (`plugins/yakka/skills/design/SKILL.md:18`, which names only rejection, flagged checks, `queued`, `unreachable` and `bad config`, and is updated to name `not tracked`, `not delivered` and `stale`, and to say a `queued` answer means call once more after a few seconds)".
- DESIGN.md, Phase 7 outcome: "The flagged line carries the fix instruction ("rewrite the file; the new write is the repair"), worded by the server's tool." That wording is fixed; Phase 7 does not reword it.
- DESIGN.md, Feedback tool domain, states: the set is `not tracked`, `delivered`, `rejected`, `queued`, `not delivered`, `stale`; `rejected` and a screen-flagged line carry "the fix: rewrite the file, the new write is the repair".
- Assumption 18: the `queued` line "says the version is on its way and to call again in a few seconds"; the agent action is to call again.
- Assumption 28: the two fresh sessions are live evidence run only where the build has access, otherwise by Cody; repo evidence is separate and does not close the phase.
- Settled: the change is the one sentence in line 18. No other skill, server handler, shim, declaration or tests change.

## Changes

In `plugins/yakka/skills/design/SKILL.md`, replace exactly this substring inside the line-18 bullet:

- Old: `` `queued`, `unreachable` or `bad config` is reported in one line and the work continues. ``
- New: `` `queued`, `not tracked`, `not delivered`, `stale`, `unreachable` or `bad config` is reported in one line and the work continues; a `queued` answer means call once more after a few seconds. ``

That is the whole change. It adds the three server states the design names and the `queued` repeat-call clause, and keeps `unreachable` and `bad config` because they remain the Phase 1 shim errors (Assumption 19). Do not add `delivered` or `rejected` to that list: `delivered` is the success path the surrounding sentences already cover, and `rejected` is covered by "A rejection is fixed before moving on". Do not reword any other sentence.

### Keep untouched

- "A rejection is fixed before moving on (the reason names a pattern and line, never the secret).", "A check flagged out of the tenant's norm is addressed or named.", and "Ratings are comparative and uninformative on their own; the outlier is the signal." stay verbatim.
- Every other skill under `plugins/yakka/skills/`, and any installed copy under `~/.config/opencode/skills/`, `~/.claude/skills/` or `~/.cursor/skills/`, is not edited. Only the repo path above changes.
- `packages/yakka/internal/serve/mcp_feedback.go`, its tests and the golden corpus are read-only here. `mcpFeedbackFix` is already `"Fix: rewrite the file; the new write is the repair."` and is appended at the rejected and screen-flagged paths.
- The tool description/golden state list is a Phase 5 surface; the design does not ask Phase 7 to reword it and this brief does not.

## Done evidence

Identify the failing check before changing the file. Run this deterministic check from the repo root; it parses the feedback bullet and asserts the named states and the `queued` clause.

```
python3 - <<'PY'
from pathlib import Path
text = Path("plugins/yakka/skills/design/SKILL.md").read_text(encoding="utf-8")
bullet = text.split("- Feedback is obtained:", 1)[1].split("\n- ", 1)[0]
for token in ("`queued`", "`not tracked`", "`not delivered`", "`stale`", "`unreachable`", "`bad config`"):
    assert token in bullet, f"missing {token}"
assert "a `queued` answer means call once more after a few seconds" in bullet, "missing queued repeat-call clause"
print("feedback states present")
PY
```

- Before the edit: `AssertionError: missing \`not tracked\`` (or the first missing token), exit non-zero. Record the exact output.
- After the edit: `feedback states present`, exit 0. Record the exact output.

Server-wording confirmation (read-only; no edit):

```
cd packages/yakka && go test ./internal/serve/ -run 'TestMCPArtifactFeedbackCorpus|TestMCPArtifactFeedback' -count=1
git grep -n "Fix: rewrite the file; the new write is the repair." -- packages/yakka/internal/serve
```

- The Go test passes.
- `git grep` shows the constant in `mcp_feedback.go` and the rejected case in the golden. Reading the code confirms `mcpFeedbackFix` is appended at both the rejected path (`mcp_feedback.go:274`) and the screen-flagged path (`:401`). Record that this matches DESIGN.md Phase 7 and the Feedback tool domain, with no wording change.
- `git diff --check` is clean.
- `git diff --stat` shows only `plugins/yakka/skills/design/SKILL.md` and the report under `docs/plans/21-feedback-delivery/reports/`.
- Observable: the line-18 bullet reads the new sentence and no other line of any skill changed.

## Gates and constraints (do not cross)

- The phase outcome — one fresh Claude session and one fresh Codex session, each in a scratch repo, and their transcripts — is a Cody live/egress gate. This build does not open a Claude or Codex model session, does not call `artifact_feedback`, and records the transcript outcome as `gate:` in the report. A green repo check is not the phase outcome.
- Make no live, network or egress call. Do not read or print secrets or keys. Do not deploy; run no `fly` or `wrangler`. Do not reset or delete a tenant and run no paid call.
- Do not implement any local effect, enqueue, queue write, MCP shim change, server declaration change or Plan 24 extension. The server fix wording is confirmed, not edited.
- No `/tmp` for working artifacts. No animation or timing tests. Use the repo's normal Go invocation. Keep within the 8G memory cap.
- Never push, merge, rebase or force-push. Do not touch `master`, Plan 22 / PR #184, any other plan's build branch, or `/home/codyh/workspace/yakka-wt/`.
- Do not run or chase the pre-existing `tools/release/test_layout.py::test_repo_passes_layout_check` failure on ignored `packages/yakka-analytics/node_modules/**`; record it as carried.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Then what changed, the check output before and after, any deviation from this brief and why, and any contradiction between this brief and the contracts it cites. Never resolve a contradiction silently.

A non-trivial bug outside your done evidence: report symptom, location, and root cause if found. Do not fix it here.

Do not spawn agents beyond read-only research helpers. If this unit needs one, it was mis-sized: report `blocked` and say so.
