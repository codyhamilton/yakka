# Phase 3 unit 1 report — server artifact_feedback declaration v2 and handler

Status: done-with-concerns (uncommitted; live deployment and live observations are gated to Cody).

## What was built

Against `briefs/phase3-01-server-feedback-v2.md`:

- **Declaration v2** (`mcp_stateless.go`): `artifact_feedback` now sets `DeclarationVersion: 2`
  and declares the one `LocalActions` entry `{enqueue_file_snapshot, v1, path_from:resolved_path}`.
  The queue reader is v2, same `{of: git, path: resolved_path}` params, still required. Reader
  order remains `cwd` (optional), `project_dir` (optional), `resolved_path`, `file`, `git`,
  `queue`, `drain`. Description, schema, annotations, validation and handler wiring are unchanged;
  `mcp.go` was not touched.
- **State order** (`mcp_feedback.go`): facts and coverage first (missing/malformed coverage is
  `local context unavailable: queue (invalid_context)`, never a state); service read before any
  pending/rejected entry; `delivered` wins on hash match; `rejected` wins over a covering pending
  entry and uses covering diagnostic reasons or a "read queue/rejected" count line when the sample
  is truncated.
- **`queued` / 300 s bound**: answers at once from `coverage.pending_covering` and
  `oldest_covering_age_s` with count, oldest age and `drain.running`, plus "the version is on its
  way; call again in a few seconds" and the no-drain fix when no drain runs. Age > 300 answers
  `not delivered` (no service version) or `stale`, naming the age, drain state and `yakka status`.
  The 1.5 s poll on `drain.running` is removed.
- **Enqueue / continuation**: with no service match, empty covering coverage and no effects the
  handler returns `MCPLocalActionRequest` when the registry bound the action; no action (old shim)
  gets `not delivered`/`stale` with the enqueue-unsupported line. One effect fact is re-evaluated
  in the same order: refreshed covering coverage is `queued`, a refreshed matching hash is
  `delivered`, `enqueued`/`covered` with no coverage is `not delivered`/`stale` with the
  acknowledged-but-unconfirmed line, and every named failure code is shown with its exact fix and
  never masked by a false `queued`/`delivered`.
- **Wording**: added the design's save/Write-Edit sweep fix for `not delivered`/`stale`, both short
  hashes and the service timestamp on `stale`, and the nine effect fact/fix pairs verbatim.
- **No new effects**: no ingest, no local write, no drain start, no content scan, no scope check,
  no second directive.

Files changed (all owned paths):

- `packages/yakka/internal/serve/mcp_stateless.go`
- `packages/yakka/internal/serve/mcp_feedback.go`
- `packages/yakka/internal/serve/mcp_feedback_test.go`
- `packages/yakka/internal/serve/mcp_feedback_scoring_test.go`
- `packages/yakka/internal/serve/mcp_feedback_local_action_test.go` (new)
- `packages/yakka/internal/serve/testdata/mcp-golden/artifact-feedback.json`
- this report

## Tests

Before (HEAD `f0cbec9`, old v1 contract): the focused suite passed; it encoded the old wait and
wording, so the new contract had no failing check until the new cases were written.

```
$ cd packages/yakka && go test ./internal/serve/ -run 'TestMCPArtifactFeedback|TestMCPLocalAction|TestFeedbackScoring' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  2.749s
```

After (working tree):

```
$ cd packages/yakka && go test ./internal/serve/ -run 'TestMCPArtifactFeedback|TestMCPLocalAction|TestFeedbackScoring' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  1.070s

$ cd packages/yakka && go test ./internal/serve/ -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  10.830s

$ cd packages/yakka && go vet ./internal/serve/
(clean)
```

Verbose run shows the new product cases: `TestMCPArtifactFeedbackLocalActionDirective`,
`...Continuation/{refreshed covering coverage, refreshed matching hash, acknowledged but
unconfirmed, capture_off, effect_unknown}`, `...NoDirectiveWhenEvidenceExists/{delivered, covering
pending, covering rejected}`, `...ThreeHundredSecondBound` (300 -> queued, 301 -> not delivered
with age and `yakka status`) and `...DeclarationNegotiation` (v2 declaration/queue reader; a
`Yakka-Context: 1` `tools/list` omits the tool). The corpus test asserts `_meta` `v:2`, the one
`local_actions` entry and queue reader v2; the old 1.5 s wait tests were replaced by immediate
covering-pending and pre-call delivered cases. Plan 24's `TestMCPLocalAction*` still passes.
Adjacent `go test ./internal/mcp/` and `go test ./cmd/yakka/ -run TestAdvisory` also pass.

## Deviations

- Renamed `TestMCPArtifactFeedbackRunningDrainWaitsWithoutStartingOne` and
  `...RunningDrainSeesDelivery` to `...CoveringPendingAnswersAtOnce` and
  `...DeliveredBeforeQueueWait`, because the old names assert the removed wait.
- The brief's directory-wide `test -z "$(gofmt -l internal/serve)"` is not clean: `gofmt -l` lists
  `internal/serve/mcp_discovery_limits.go`, which is unformatted at HEAD `f0cbec9` and outside this
  brief's owned paths (touching it would exceed ownership). Every owned file is gofmt-clean.
- No commit was made, per the brief.

## Unfinished work

None in this unit.

## Known problems

- **Plan 24 v1 compatibility gap (recorded, not resolved).** Design 08:429-432 promises an old shim
  a v1 read-only variant with `not delivered`/`stale` plus `enqueue unsupported`. Plan 24's
  `mcpList` drops a tool whose `DeclarationVersion` exceeds `Yakka-Context`, and the registry
  allows one declaration per name, so declaring v2 makes `artifact_feedback` absent for a v1 shim
  rather than returning that variant. This needs a Plan 24 change; adding a second declaration or
  changing the registry is outside P3.
- **Shim spool metadata mismatch (recorded, not resolved).** Plan 24's built shim spools an E1
  pointer as a `PostToolUse`/`Write` entry using the call token as conversation ID
  (`yakka.py:2891-2959`), while the Phase 3 A1 wording says `artifact_snapshot` and
  `feedback-<repo_id>`. The shim and wording were left alone as instructed.
- No live service, network, or real `artifact_feedback` call was used; all evidence is fakes.
- The working tree also contains the companion phase3-02 (Python/docs) changes; they were not
  touched.

## Gates (Cody / live)

- Deploy the feedback declaration/handler change to the live service (ledger 28) before any live
  `delivered`/`queued` observation.
- The issue's budget-repo case and a live scratch-repo call showing `queued` then `delivered`
  (egress; run by Cody).
- `artifact_feedback` checks on this brief and this report (egress; not run here).
