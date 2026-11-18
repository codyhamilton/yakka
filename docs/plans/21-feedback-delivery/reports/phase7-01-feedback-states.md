# Execution report — Phase 7, unit 1 (7-01 feedback states)

Brief: `docs/plans/21-feedback-delivery/briefs/phase7-01-feedback-states.md`
Branch: `feat/21-feedback-delivery`. Changes left uncommitted in the working tree.

## Status

`done with concerns` — the skill edit is made and all repo evidence is green. The concerns are a
reading-phase tool-call overrun against the brief's nominal budget and a latent contradiction in
the brief's over-budget clause (both below). No code outcome is affected.

## What changed

`plugins/yakka/skills/design/SKILL.md`, line 18, one sentence inside the `## Outcome` feedback
bullet — exactly the brief's substitution:

- Old: `` `queued`, `unreachable` or `bad config` is reported in one line and the work continues. ``
- New: `` `queued`, `not tracked`, `not delivered`, `stale`, `unreachable` or `bad config` is reported in one line and the work continues; a `queued` answer means call once more after a few seconds. ``

The three server states the design names (`not tracked`, `not delivered`, `stale`) are added, the
`queued` repeat-call clause is added, and `unreachable` / `bad config` are kept as the Phase 1
shim errors (Assumption 19). `delivered` and `rejected` are deliberately not added: `delivered` is
the success path the surrounding sentences cover and `rejected` is covered by "A rejection is
fixed before moving on". No other sentence, skill, server handler, shim, declaration, golden or
test was touched.

## Deterministic check

Before the edit (exit 1):

```
Traceback (most recent call last):
  File "<stdin>", line 5, in <module>
AssertionError: missing `not tracked`
EXIT: 1
```

After the edit (exit 0):

```
feedback states present
EXIT: 0
```

## Server-wording confirmation (read-only, no edit)

`cd packages/yakka && go test ./internal/serve/ -run 'TestMCPArtifactFeedbackCorpus|TestMCPArtifactFeedback' -count=1`:

```
ok  	github.com/codyhamilton/yakka/packages/yakka/internal/serve	0.857s
TEST EXIT: 0
```

`git grep -n "Fix: rewrite the file; the new write is the repair." -- packages/yakka/internal/serve`:

```
packages/yakka/internal/serve/mcp_feedback.go:15:const mcpFeedbackFix = "Fix: rewrite the file; the new write is the repair."
packages/yakka/internal/serve/mcp_feedback.go:135:		return "a covering rejection is already queued for this file, so nothing new was queued. Fix: rewrite the file; the new write is the repair."
packages/yakka/internal/serve/testdata/mcp-golden/artifact-feedback.json:373:      "text": "state: rejected\npath: docs/plans/x/DESIGN.md\nrepo: root:repo\ncontent_hash: abc\n\nsecret: aws_access_key at line 3 in docs/plans/x/DESIGN.md\nFix: rewrite the file; the new write is the repair.",
```

Reading the code confirms `mcpFeedbackFix` is appended at the rejected path
(`mcp_feedback.go:274`) and the screen-flagged path (`:401`). This matches DESIGN.md Phase 7 and
the Feedback tool domain (rejected and a screen-flagged line carry "rewrite the file; the new
write is the repair"), with no wording change.

`git diff --check`: clean (exit 0). `git diff --stat`: only
`plugins/yakka/skills/design/SKILL.md | 2 +-` (1 insertion, 1 deletion); with this report added,
the two owned paths and nothing else. Observable: the line-18 bullet reads the new sentence and no
other line of any skill changed.

## Gates (not run, not claimed)

- Phase 7 outcome — one fresh Claude session and one fresh Codex session, each in a scratch repo,
  with their transcripts showing `delivered` + `screen:`/`scoring:` and the flagged-check fix — is
  a Cody live/egress gate. **gate:** not run here; no Claude or Codex session opened, no
  `artifact_feedback` call made. A green repo check is not the phase outcome.
- No live, network or egress call, no deploy, no secret read, no tenant operation.

## Carried (not chased)

- Pre-existing `tools/release/test_layout.py::test_repo_passes_layout_check` failure on ignored
  `packages/yakka-analytics/node_modules/**` — not run, per the brief.

## Deviations

- None from the change itself; the edit is verbatim the brief's substitution.
- Reading phase used 12 range reads across the 5 required files (plus verification calls), at or
  above the brief's nominal "12 tool turns" budget. The unit was already complete and green when
  this was apparent, so I finished rather than stopping mid-verification.

## Contradictions

- The brief's budget clause says that past the budget I should "write a handoff under this brief's
  name in `IMPLEMENTATION.md`", while its Owned paths line says "Touch nothing else" beyond
  `SKILL.md` and this report. Those cannot both hold if the budget is exceeded. I resolved it by
  keeping strictly to the owned paths and recording the handoff here; flagging it rather than
  editing `IMPLEMENTATION.md`.
- No contradiction found between the brief and the DESIGN.md contracts it cites: the pre-edit
  line 18 names only rejection, flagged checks, `queued`, `unreachable` and `bad config`, as the
  brief states; the server fix wording is unchanged and matches Phase 7 and the Feedback tool
  domain.

## Unfinished / actionable

- Cody gates above (fresh Claude and Codex transcripts). Nothing else unfinished.
