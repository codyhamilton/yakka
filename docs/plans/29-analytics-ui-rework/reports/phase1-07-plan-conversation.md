# Phase 1 unit 07: plan identity/associated cost/events and conversation tool kinds

Status: **done with concerns**.

## What changed

- `packages/yakka/internal/store/plan_entities.go`
  - `PlanAssociatedCost` now clears both identity `Repos` and `Plans` from the
    usage filter before pricing. The explicit `repo`/`plan` arguments still
    select the associated `conversation_id`s, and genuine usage filters
    (`harness`, `model`, `kind`, window, etc.) remain.
  - `PlanEntitiesPage` applies the same identity clearing to the usage source
    used by the associated-cost/`unpriced_calls` sort expressions; plan
    population still comes from in-window artifact facts under the requested
    repo/plan.
  - `PlanDetailCount` and `PlanDetailPage` build one event filter with identity
    `Repos`/`Plans` cleared and use it in both the count and the page. The extra
    outer `repo_id=?` restriction is removed; event facts are selected by
    `conversation_id IN (SELECT DISTINCT conversation_id FROM facts a WHERE
    a.type='artifact_version' AND a.repo_id=? AND a.plan=?)`. Genuine event
    filters and the existing keyset/order are unchanged. Artifact/session/
    execution collections are untouched.
- `packages/yakka/internal/store/conversation.go` — added `ToolKind` to
  `ConversationEvent`, selected the existing `toolKindExpr` in the conversation
  SQL, and scanned it. Caps, dedupe, totals and `Truncated` are unchanged.
- `packages/yakka/internal/serve/analytics_conversation.go` — every event map
  now carries `"tool_kind": e.ToolKind`, including `""` for a no-tool event.
  Taxonomy values come from `store/toolkind.go`; no browser-only mapping.
- `packages/yakka/internal/store/plan_entities_association_test.go` (new) —
  `TestPlanAssociatedCostUsesAssociatedSessions`.
- `packages/yakka/internal/serve/analytics_plan_conversation_parity_test.go`
  (new) — `TestPlanDetailEventIdentity`, `TestConversationToolKind`.

No migrations, schema, pricing-table or client-panel changes.

## Done evidence

Tests were run first against the pre-change sources by reverting only the three
source files to `HEAD` (new test files stayed), then restored. No branch/worktree
change, no commit.

Before:

```
$ GOTOOLCHAIN=auto GOMEMLIMIT=8GiB TMPDIR=<worktree>/.scratch/tmp go test ./internal/store \
    -run '^TestPlanAssociatedCostUsesAssociatedSessions$' -count=1
--- FAIL: TestPlanAssociatedCostUsesAssociatedSessions (0.04s)
    plan_entities_association_test.go:39: associated cost with identity repo filter = <nil> unpriced=0 calls=0, want 0.10/0/1
FAIL
```

```
$ GOTOOLCHAIN=auto GOMEMLIMIT=8GiB TMPDIR=<worktree>/.scratch/tmp go test ./internal/serve \
    -run '^TestPlanDetailEventIdentity$|^TestConversationToolKind$' -count=1
--- FAIL: TestPlanDetailEventIdentity (0.04s)
    analytics_plan_conversation_parity_test.go:34: plan event count 1 != paged total 1
--- FAIL: TestConversationToolKind (0.03s)
    analytics_plan_conversation_parity_test.go:63: event 0 missing tool_kind: ...
FAIL
```

After:

```
$ GOTOOLCHAIN=auto GOMEMLIMIT=8GiB TMPDIR=<worktree>/.scratch/tmp go test ./internal/store \
    -run '^TestPlanAssociatedCostUsesAssociatedSessions$' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/store  0.040s

$ GOTOOLCHAIN=auto GOMEMLIMIT=8GiB TMPDIR=<worktree>/.scratch/tmp go test ./internal/serve \
    -run '^TestPlanDetailEventIdentity$|^TestConversationToolKind$' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.075s
```

Regression:

```
$ GOTOOLCHAIN=auto GOMEMLIMIT=8GiB TMPDIR=<worktree>/.scratch/tmp go test ./internal/store \
    -run 'TestPlan|TestConversation' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/store  0.969s

$ GOTOOLCHAIN=auto GOMEMLIMIT=8GiB TMPDIR=<worktree>/.scratch/tmp go test ./internal/serve \
    -run 'TestAnalyticsPlan|TestAnalyticsConversation' -count=1
ok  github.com/codyhamilton/yakka/packages/yakka/internal/serve  0.406s
```

`gofmt -l` on the five files printed nothing; `go vet ./internal/store ./internal/serve`
passed.

Harness observable (phase1-01 real-Go harness, direct HTTP, waits on the ready
line, no sleeps; data under ignored `.scratch/`):

Before (`plan29-a`, `repo_id=repo-a`):

```
{"planAssociatedCost":0,"planUnpriced":0,"eventCount":2,"eventPopulation":2,
 "eventTypes":["artifact_version"],"toolKinds":{}}
```

After:

```
{"planAssociatedCost":0.1,"planUnpriced":0,"eventCount":4,"eventPopulation":4,
 "eventTypes":["artifact_version","commit","hook_event"],
 "toolKinds":{"Read":"read","Bash":"shell"}}
```

The plan event population equals the paged total and includes the empty-raw-repo
usage hook; `sess-gamma` lane events carry the taxonomy kinds.

## Deviations

- The brief says to commit the unit with the report. The orchestrator directive
  for this run says not to commit and to leave all changes plus the report in the
  working tree; the orchestrator commits. Nothing was committed.
- Production parity was not attempted: the run forbids reading
  `/home/codyh/.config` secrets and touching the Plan 28 trial. Recorded as a
  gate.
- The harness fixture associates `plan-a` under `repo-a` only with `sess-alpha`
  (`sess-beta`'s plan-a artifact is repo-b), so the observable's event set is
  `sess-alpha`'s four facts, not six. This follows the `(repo_id, plan)`
  association contract and is not a defect.

## Unfinished work

- Production parity read (verification-time): read a plan detail and a
  conversation for trial tenant `test` with the authorized credentials, and
  confirm associated cost `$0.10`, both artifact and usage events, and
  `tool_kind` on the conversation rows.
- Phase 1 verifier: confirm the client's session-lanes panel groups
  `sess-gamma`'s `Read`/`Bash` under `read`/`shell` on `plan29-a`.

## Known problems

- None found in this unit's scope. The conversation SQL builds `toolKindExpr` by
  string concatenation after `fmt.Sprintf`, because the expression contains `%`
  in its `LIKE` patterns; putting it in the format string corrupts the SQL. The
  current construction is correct.

## Gates

- `gate: production parity not attempted — run forbids reading `/home/codyh/.config` secrets and touching the Plan 28 trial`
