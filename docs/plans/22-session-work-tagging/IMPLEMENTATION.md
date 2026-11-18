Run: OpenCode execute skill (`deepseek-v4.1-flash`); run ID 22-p5-2026-11-19-rebuild; started 2026-11-19 00:42 UTC; branch `feat/22-session-work-tagging`. The amended Phase 5 rebuild is recorded at the end of the Phase 5 sections; the pre-amendment `Workflow-Phase: 22-session-work-tagging:5` trailer (`3f131c6`) does not close it.

# Amendment — simple back-fill (19 Nov 2026)

Docs-only amendment, landed on this branch and draft PR #184 (Solution Designer, 19 Nov 2026). No application code was touched; every change below is for a later build. DESIGN.md Decisions (5) and Assumptions 40-49 are the authority; this section is the build-side record.

Cody, 19 Nov 12:09-12:11 AM AEST (the first two messages verbatim in DESIGN.md Decisions (5); the 12:11 scope tightening is the amendment brief's paraphrase): back-fill is a one-off and stays simple. A plan agent loads the plan skill, a phase agent loads the execute skill, a build agent is given a brief path; a single signal labels the session; sessions that loaded several are left for a follow-up review with Cody after the counts are reported.

## Phases: kept, changed, obsolete

| Phase | Status | What it means for the build |
|---|---|---|
| 1 Action record path | Kept, built | Unchanged. The `typesafe` and `human` method values and the `review` source and precedence stay as built and are unused by the back-fill. |
| 2 Session-start capture | Kept, built (documented-limit close) | Unchanged. |
| 3 Cost by work | Kept, built | Unchanged. Its real-data items (subagent `conversation_id`, message vs import time) are still Cody's. |
| 4 MCP tools | Kept as designed, not built | Unchanged; still held on Plan 24 (#177). The amendment does not touch it. |
| 5 Back-fill | Kept in part; method and outcome change | Rebuild to the simple skill and brief-path pass with the count report (below). |
| 6 TypeSafe kind pass | Obsolete | Drop its code (below). Nothing depends on it. |
| 7 Human review (accuracy import and export) | Obsolete as a gate | Replaced by a follow-up review with Cody after Phase 5 reports counts. Not a build phase; no code. |

## Phase 5: what is kept, what changes on rebuild

Kept from the built tool (`tools/session_backfill/backfill.py`, `plugins/yakka/client/yakka.py`, units `5-01`, `5-02` and fixes `44a743a`):

- Discovery of the four stores (claude, codex, cursor, opencode) from explicit roots.
- The Codex session identity rule (id only from `session_meta`; absent or invalid stays unresolved and cannot enqueue).
- Unreadable transcripts as unresolved rows; at most one enqueue per conversation id; secret scrubbing of evidence; the local label file; dry run as the default.
- The enqueue writer and `Build` (tag-only `yakka.session_action` event; method, confidence and evidence carried into the fact).
- Fallback subject and phase extraction (`PLAN_RE`, `PHASE_RE`, issue and PR numbers), now only at confidence 0.65.

Changes on rebuild:

1. **Kind from the signal.** Add per-store recognisers: Claude `Skill` tool call and `<command-name>` slash command; Cursor `<manually_attached_skills>`; Codex and OpenCode shapes found by a read-only look at real transcripts (shapes and counts only). Skill id table in one place: `design`, `plan`, `planning` mean planning (kind `design`); `refine` (kind `refine`); `execute`, `plan-execution` (kind `build`); matched on the part after the last `:`. Brief path `docs/plans/<plan>/briefs/<file>.md` in the **first user prompt** gives kind `build` and the phase from the file name. The built tool's "prompt" is the first non-empty line of all concatenated transcript strings (a recon finding), so it is not the first user prompt and must be replaced.
2. **Single signal labels.** Count by kind class; repeats of one skill collapse. More than one signal is `multi_signal`, none is `no_signal`, one signal with no subject is `no_subject`; none of these enqueues. No rule for several signals.
3. **Remove** queue-log parsing (`QUEUE_FILE_RE`, `parse_queue_logs`, `--queue-logs`), queue truth in `label_session`, gold collection and `score_gold`, the gold fields of the result, the Flash predicate (`FLASH_RE`) and the OpenCode-only gate, and the 0.55 confidence tier. "Complete" no longer needs queue truth: a label is `labelled` when it has a single signal and a subject.
4. **Skip Claude subagent transcripts** (`subagents/` path part, as Cursor already does). Add the missing test for the Cursor skip, which the fixtures never exercised (a recon finding).
5. **Report.** Print the count report of DESIGN.md Domain "Back-fill" per store and in total, with the skipped-subagent, skipped-child and duplicate-id counts beside the rows, and record it under `reports/` for the follow-up review. The phase closes on the fixtures and this dry-run report; the real enqueue is a separate step gated on Cody. These counts do not exist yet.
6. README Pass 1 section rewritten to the simple rule; the Pass 2 section removed. Tests: the synthetic fixtures listed in DESIGN.md Phase 5's outcome replace the gold and Flash tests.

Still gated on Cody, unchanged: authorising a real enqueue and drain check. Resolved by the amendment, no longer carried: the queue-log join, the Flash rule and count, the subagent treatment, the 95% gold agreement.

## Phase 6: obsolete, what to do with its code

Drop on rebuild (delete; they are Phase 6's alone): `tools/session_backfill/typesafe_kind.py`, `tools/session_backfill/kind_pass.py`, `tools/session_backfill/tests/test_kind_pass.py`, the README Pass 2 section. This removes the live-egress path (`--live --confirm-egress`, the `TYPESAFE_API_KEY` check) and the private `_scrub_evidence` import from `backfill`. Leave unused, untouched: `tools/transcript/lib/jev_client.py` (another tool's), and the server's `typesafe` method value. The brief `briefs/6-01-typesafe-kind-pass.md`, report `reports/6-01-typesafe-kind-pass.md` and the Phase 6 section below stay as history, marked obsolete. The Phase 6 carried gates (live TypeSafe authorisation, accuracy bars, gold join) are withdrawn.

## Phase 7: replaced

The formal human-review accuracy import and export is not built. After Phase 5 reports its counts, Cody and the Solution Designer review the counts and decide what to do with the unlabelled and multi-signal remainder, and whether `execute` should be its own kind. Record the outcome here.

## Phase 5 live dry run: evidence behind the amendment

From `reports/5-03-live-dry-run.md` (codyh-ubuntu, 8 Nov 2026, 1:04-1:06 AM AEST). This is the cheapest existing evidence; the raw label file is gone and no new store scan was run for the amendment. Under the old rules 0 of 3,623 sessions were complete (kind never filled), so every session would have waited on TypeSafe or review.

| Store | Sessions | Complete | Partial | Unresolved |
|---|---|---|---|---|
| claude | 1,239 | 0 | 1,156 | 83 |
| codex | 1,962 | 0 | 1,409 | 553 |
| cursor | 409 | 0 | 78 | 331 |
| opencode | 13 | 0 | 0 | 13 |
| total | 3,623 | 0 | 2,643 | 980 |

Also: 2,321 plan subjects, 322 GitHub-issue subjects, 2,236 rows with a phase, 893 with a PR; 1,058 sessions match a Flash-analysis predicate (224 Claude, 824 Codex, 10 Cursor) but were labelled as ordinary work because exclusion was OpenCode-only; Claude discovery included about 361 subagent transcripts and Cursor discovery excluded 619; queue logs cannot join to sessions (1,158 `par-*.log` files, 9 with session-id-like text, 0 usable joins); inventory 3,623 against the design's ~6,463. These explain why the queue-log gold set, the accuracy bars and the Flash gate failed. They are not skill-load counts: skill-load and multi-signal counts are an outcome of the rebuilt simple pass.

Landing: committed on `feat/22-session-work-tagging` and pushed to PR #184. No rebase onto master was done (the branch is 25 ahead and 24 behind `origin/master`; the PR was dirty before this amendment and is not repaired by it).

---

Run: Claude Code execute skill (Haiku 5.5), run ID 22-p6-2026-11-08
Started: 2026-11-07 15:12 UTC
Branch: feat/22-session-work-tagging

Previous run: 22-p5-2026-11-07

Run: Codex execute skill, run ID 22-p5-2026-11-07
Started: 2026-11-07 10:59:45 UTC
Branch: feat/22-session-work-tagging

Brief: `5-01-deterministic-backfill.md` committed as `4105c24`; `artifact_feedback` delivered, screen pass by jev-1.13.0 (version 1).
Baseline: `cd plugins/yakka/client && python3 -m unittest test_facts` passed (14 tests).

Run: Codex execute skill, run ID 22-p3-2026-11-07
Started: 2026-11-07 10:41:49 UTC
Branch: feat/22-session-work-tagging

Previous run: 22-p2-2026-11-07

Run: Codex execute skill, run ID 22-p2-2026-11-07
Started: 2026-11-07 10:25:59 UTC
Branch: feat/22-session-work-tagging

Previous run: 22-p1-2026-11-07

## Phase 1 — Action record path

### Unit outcome — `1-01-action-record-path.md`

Built the server action contract and fixture test; structural-only ingest; migration-backed projection state, normalized action rows, and deterministic conversation segments; independent retrying projection; bearer-scoped `/v1/actions`; and admin action counts plus their typed API field. Legacy conversation, hook-event, and facet results exclude `session_action` facts. Surfaces: `packages/yakka/internal/actions`, `internal/ingest`, `internal/store`, `internal/serve`, `packages/yakka-analytics/src/lib/api.ts`, and `docs/design/01-event-model-and-ingest.md`, `docs/design/03-remote-service.md`. Unit commit: `a32e3dc`; runner verification fix: `dc28c4d`.

Evidence from the unit report and runner verification:

- Baseline and final `cd packages/yakka && go test ./...` passed. The final run after the segment-boundary fix passed all packages; `cmd/yakka` took 61.962s.
- Targeted action-path, ingest, store, serve, retry, and API tests passed. In particular, fake-backed serve tests pass with scoring disabled, enabled, and unreachable; projection retries stop at three; a failed projection does not block screening; duplicate ingest is detected; invalid action values project as rejected; and the admin and legacy analytics checks pass.
- Runner verification found that later live rows lacked `segment_start`. The first new assertion failed; the projection now records each subsequent segment's start from its action timestamp. Focused `go test ./internal/store ./internal/serve -run 'Test(Action|SessionAction)' -count=1` and the full suite passed after the fix. Added checks also prove accepted live action over backfill and the latest review replacing the earlier review.
- `artifact_feedback`: the amended brief (version 2) and worker report are `delivered`, each `pass` by jev-1.13.0; no flagged checks.

Departure: the original brief listed `packages/yakka/docs/design/` paths, which do not exist; the corresponding server docs were updated under `docs/design/`. The brief was amended to name the actual paths and its second artifact feedback passed. No other departure. Worker report states no unfinished work. The runtime did not provide per-agent turn/final-context counts.

### Phase verification

Verified the phase outcome through `POST /v1/ingest` → asynchronous projection → bearer-scoped `GET /v1/actions` using the local fake-backed serve tests, and checked the returned normalized accepted/rejected rows and pending count. Store and serve tests prove duplicate handling, deterministic segments (including equal and out-of-order timestamps), source precedence, retry isolation, unchanged legacy analytics, and action status counts. The final full Go suite passed. No live classification, egress, or human review was performed or needed for Phase 1.

### Carried

- User-noted unrelated layout test failure: not reproduced by the baseline or final Go suite; not investigated. Preserve as a known external/unreproduced issue, and do not chase it in later Plan 22 phases unless it blocks their own checks.
- None of the implementation or test contracts needs amendment for the next refinement.

## Phase 2 — Session-start capture on all four harnesses

### Unit outcome — `2-01-session-start-capture.md`

Implemented Claude, Codex, OpenCode and Cursor session-start capture; robust action envelope encoding and the UTF-8 transport guard; tolerant parsing and `session_action` fact construction, including tag-only files; fixtures and tests; docs and plugin version metadata. Cursor's existing `sessionStart` registration was verified and left unchanged. Unit report: `reports/2-01-session-start-capture.md`.

The spool tests passed (7), client fact/config tests passed (22), OpenCode hook tests passed (11), and `git diff --check` was clean. The brief's test names needed correction: the client module is `test_clientconfig` and the npm script is `test:hooks`; the amended brief is delivered and passed artifact feedback (version 2). The worker report is delivered and passed artifact feedback (version 1), with no flagged checks.

### Phase verification

Verified the Phase 2 entry point through the fake queue fixtures and behavior tests: a session-start envelope carrying action fields reaches the Python `Build` step and produces a `session_action` fact alongside normal session facts; an action-only `yakka.session_action` event produces only one action fact; absent, malformed and non-object action values do not reject the queue file; the spool process exits zero and preserves JSON escaping and the over-length UTF-8 guard; OpenCode records one raw action at `session.created`; and setting only `YAKKA_ACTION_*` leaves client config resolution unchanged. Independent reruns passed: `python3 plugins/yakka/script/test_kick.py` (7), `cd plugins/yakka/client && python3 -m unittest test_facts test_clientconfig` (22), `cd packages/opencode-yakka-hooks && npm run test:hooks` (11), and `git diff HEAD^ HEAD --check` (clean).

The real headless probes (`claude -p`, `codex exec`, `opencode run`, `cursor-agent -p`) and per-harness server projection were not run because they can invoke classification or external egress. No real classification, egress or human review call was made. Under the documented-limit path allowed by Phase 2's outcome, the report records all four runtime observations as unverified and makes no runtime support claim. Local fake-backed behavior is verified; safe runtime probes remain a release precondition before CHM relies on launch-time tags from any harness.

Phase 2 closes via its documented-limit alternative; runtime support is not claimed for any harness.

### Carried

- Before CHM relies on launch-time tags from any harness, record hook/plugin execution and exported-variable visibility using a safe, non-classifying and non-egress probe; verify action projection if possible without real egress. Each harness currently has a documented limit in the Phase 2 report.
- The unrelated layout-test failure documented in the design was not rerun or investigated; do not chase it unless it blocks later Plan 22 work.

## Phase 3 — Cost by work

### Unit outcome — `3-01-cost-by-work-query.md`

Extended the in-memory usage query to attribute cost-bearing calls to the projected action segment at each call timestamp. Added the six `action_*` dimensions and filters, distinct-conversation `sessions`, special buckets for untagged and rejected-only conversations, top-N preservation, and HTTP validation for up to three all-action dimensions. Updated `docs/design/03-remote-service.md`. Unit commit: `72531ecd1f80ef29fe335ab98d3b295bcab7438f`.

Seeded coverage exercises action segment boundaries, rejected actions between accepted actions, reconciliation and top-N survival for `(untagged)` and `(rejected)`, `(none)` dimensions, unpriced calls, distinct sessions, filter and measure validation, and the HTTP dimension limit. The no-action HTTP golden remains byte-identical. The unit report's pre-change regression failed because `cost_usd` rejected `action_kind`; after implementation, the complete store and serve suites passed.

`artifact_feedback` for brief `3-01-cost-by-work-query.md` and report `3-01-cost-by-work-query.md` returned `delivered`, screened `pass` by jev-1.13.0 (version 1) for each. The service was initially called with relative paths and returned a path error; the corrected absolute-path calls passed. The runtime did not provide per-agent turn or final-context counts.

### Phase verification

Verified seeded tenant behavior through the `/v1/analytics/query` handler into the usage aggregation and projected action segments. Runner rerun `cd packages/yakka && go test -count=1 ./internal/store ./internal/serve` passed (`store` 5.710s, `serve` 10.658s). `git diff HEAD^ HEAD --check` was clean. These checks cover action bucket attribution and reconciliation, the mid-session timestamp split, special bucket visibility, rejected segment continuity, unpriced calls, distinct sessions, action-field validation, three-dimension HTTP behavior, and unchanged no-action JSON.

Phase 3's fake-backed query implementation is verified. No live classification, egress, private tenant data, real endpoint, or real `harness pick` launch was used.

### Carried

- Cody: verify Phase 3 real-data item 4 in an authorized environment. Message-time versus import-time timestamps for each harness, Phase 2 session cost, and subagent and Cursor counts remain unverified.
- Cody/CHM: after CHM's change lands, verify Phase 3 item 5 with one `harness pick` build launch per harness, accepted `source=env` action rows, and an `action_plan` cost query.
- The unrelated layout-test failure noted in the design remains unreproduced and uninvestigated; do not chase it unless it blocks later Plan 22 work.

Run: Codex execute skill, run ID 22-p5-2026-11-07
Started: 2026-11-07 10:59:45 UTC
Branch: feat/22-session-work-tagging

## Phase 5 — Back-fill pass 1: deterministic extraction

**Amended 19 Nov 2026:** the method and outcome change to the simple skill and brief-path pass; this section records the first build. See the amendment above for what is kept and what changes on rebuild.

### Unit outcome — `5-01-deterministic-backfill.md`

Implemented an explicit-root, offline back-fill tool for Claude JSONL, Codex rollout JSONL, OpenCode session/message/part JSON, and Cursor agent transcript JSONL. It emits complete, partial, unresolved, and excluded labels; extracts plan/phase/issue/PR evidence; joins nested queue logs; writes scrubbed local label files; reports coverage and masked gold-set agreement; and optionally writes complete labels through the client queue writer. The Yakka writer creates tag-only events with an empty payload and a conversation id at the envelope level; its stable content-derived event id makes repeated writes idempotent. `Build` emits source, method, confidence and scrubbed evidence in the resulting `session_action` fact. No network call is present in the tool.

Brief `5-01-deterministic-backfill.md` was committed first as `4105c24`, then its documentation path was corrected against the repository (`docs/design/02-edge-capture.md`) in `a86c83e`. `artifact_feedback`: amended brief delivered, screen pass by jev-1.13.0, version 2.
Report `5-01-deterministic-backfill.md`: `artifact_feedback` delivered, screen pass by jev-1.13.0, version 1; no flagged checks.

Evidence:

- Synthetic tool tests: `python3 -m unittest discover -s tools/session_backfill/tests -v` passed (6), covering all four store shapes, nested queue logs, masked gold scoring (1/1), the CLI dry-run output, secret scrubbing, exclusion, and repeatable local enqueue.
- Client tests: `cd plugins/yakka/client && python3 -m unittest test_facts` passed (15), including tag-only parse/build and preservation of method, confidence and evidence.
- `python3 -m py_compile tools/session_backfill/backfill.py plugins/yakka/client/yakka.py` and `git diff --check` passed.
- A read-only local full-store dry run completed. It found 3,582 sessions: Claude 1,230 (1,148 partial, 82 unresolved), Codex 1,930 (1,378 partial, 552 unresolved), Cursor 409 (78 partial, 331 unresolved), OpenCode 13 (13 unresolved). It found zero complete labels, zero gold matches (reported agreement 0/0), and zero Flash exclusions. The design inventory estimates ~6,463 sessions and 890 Flash runs. Metadata-only inspection found 1,154 nested queue logs but no session ID fields in them, so this environment cannot establish the gold set or reach the 95% bar. No facts were enqueued, no drain/ingest or egress call was made, and no human review was performed. The temporary label file was cleaned up.

Departure: the brief initially referred to a nonexistent `docs/design/02-client-and-hooks.md`; it was amended to the existing `docs/design/02-edge-capture.md` and its second artifact feedback passed. No other scope departure.

Known problem and carried work:

- Cody: reconcile the intended codyh-ubuntu store inventory and the queue-log-to-transcript join; rerun the dry run and establish the 95% masked gold agreement and actual per-store counts before relying on the labels.
- Cody: after reviewing dry-run output, authorize the real local queue enqueue and network drain/ingest check; itemize any secret-scan refusals and compare projected counts. No such call was made in this phase.
- Preserve the unrelated layout-test failure documented by the user/design; it remains unreproduced and uninvestigated and was not chased.

### Phase verification

The command-line dry-run entry point was exercised on the local four-store roots and produced an observable per-store report without touching the queue or network. Its result did not meet the design's intended inventory or gold-coverage outcome: all 3,582 observed sessions were partial or unresolved, no gold session was linked, and the expected Flash exclusions were absent. Synthetic end-to-end CLI and queue tests prove the designed behavior against fixtures, including idempotent action creation and parse/build into a single `session_action` fact. The real enqueue/drain check is held for Cody as it entails network egress.

### Carried *(superseded where it names gold agreement, the queue-log join, Flash, TypeSafe or accuracy bars: see the 19 Nov 2026 amendment above)*

- Cody: confirm the codyh-ubuntu data roots and add/approve a deterministic queue-log-to-session association supported by those logs; rerun the dry run and verify the Phase 5 95% gold agreement and planned Flash exclusions.
- Cody: authorize a later real enqueue/drain verification; compare projected rows to emitted actions and itemize secret-scan refusals.
- The unrelated layout-test failure documented in the design remains unreproduced and uninvestigated; do not chase it unless it blocks later Plan 22 work.

### Phase 5 review escalation — Codex conversation identity

Completed the remaining blocking identity fix after `2f09bbc`. Codex labels use only the transcript's `session_meta` ID; absent or invalid identity remains inspectable as unresolved and cannot enqueue under a rollout filename. Direct payload IDs take precedence over wrapped metadata. The regression now verifies the canonical ID through the queue and fact builder, and missing/invalid/unparseable cases cannot emit actions. Report: `reports/5-02-review-escalation.md`.

Verification: 10 synthetic backfill tests and all 15 client fact tests passed, with the latter using cached Go 1.27.1 and disabled module/checksum network access. Python compilation and `git diff --check` passed. New regressions first reproduced seven failing subcases against the previous fix. No real classification, egress, production-store read, drain, or human review occurred; remote artifact feedback was omitted under the no-egress gate.

Carried: the non-blocking count-only snapshot issue #190 is unchanged. The documented unrelated layout failure was not rerun or investigated. Existing operational gates remain: Cody must authorize the codyh-ubuntu four-store dry run and any real enqueue/drain verification. This escalation closes the blocking review finding only and does not close another phase.

### Live dry run — `5-03-live-dry-run.md`

Ran the back-fill tool in dry-run mode (no `--enqueue`) over the four real stores on codyh-ubuntu, under Cody's 8 Nov 2026 label-only authorisation. Nothing was enqueued, drained, ingested, classified or sent over the network, and `~/.local/share/workflow/queue` was not read or moved. Exit 0, empty stderr.

Counts (run 2, 3,623 sessions, every session has one label row): Claude 1,239 (1,156 partial, 83 unresolved), Codex 1,962 (1,409 partial, 553 unresolved), Cursor 409 (78 partial, 331 unresolved), OpenCode 13 (13 unresolved). Complete 0, excluded 0. Partial labels: 2,043 with subject and phase (0.65), 600 with subject only (0.55); method `deterministic` throughout. Unreadable transcripts 1; duplicate conversation IDs 10.

Two mechanical fixes, committed separately as `44a743a`, with tests: unreadable transcripts were dropped silently and are now unresolved rows; a conversation ID appearing in two transcript files could enqueue twice and now enqueues at most once. Back-fill tests pass 12 (two new, both failing on the previous code); client `test_facts` passes 15.

Not measured or not met:

- Gold agreement is 0/0. The queue logs carry no usable session join (one real ID in 1,158 logs, absent from the store).
- Server overlap is not measured: it needs a `GET /v1/actions` snapshot, which this no-egress step did not make.
- Flash exclusion is 0. The exclusion is gated to OpenCode, which has none; the predicate matches 1,058 sessions across Claude, Codex and Cursor against the design's 890. Cody to decide the gate and the count.
- Claude discovery includes its subagent transcripts (about 361) while Cursor excludes its own (619). Open design question.

Phase 5 stays open. Carried: Cody to choose the queue-log-to-session join and the Flash rule, decide the subagent treatment, and separately authorise the real enqueue and drain check. The unrelated layout-test failure was not run in this step and was not chased.

## Phase 5 rebuild — simple skill and brief-path pass (19 Nov 2026)

Closes the amended Phase 5 (Decisions (5), Assumptions 40-49). The pre-amendment trailer `3f131c6` does not close the amended phase; this rebuild does.

Refine commit `c0c0707` decomposed the phase into two sequential units after read-only recon of the Codex and OpenCode stores (shapes and counts only, no content): no recoverable skill-load form was found in either, so both label by brief path only. Assumption 47 and the phase Approach record that. Both briefs passed `artifact_feedback` (delivered, screen pass).

### Unit outcome — `5-04-signal-rule-rebuild.md`

Rebuilt `tools/session_backfill/backfill.py` to the DESIGN signal rule: per-store Claude (`Skill` tool call, `<command-name>`) and Cursor (`<manually_attached_skills>` `Skill name <id>`) recognisers in one table matched after the last `:`; the brief path read from the real first user prompt; class counting (planning/refining/executing/brief) with `labelled`, `multi_signal`, `no_signal`, `no_subject`, `unreadable`; subject at confidence 1.0 from skill args or brief path and 0.65 from fallback only; the per-store and total count report with `skipped_subagent`, `skipped_child`, `duplicate_ids`, `duplicate_transcripts` and `transcripts_discovered`; Claude and Cursor `subagents/` skipped and counted; one enqueue per conversation id for `labelled` only. Removed queue-log parsing and truth, gold scoring, the Flash predicate/gate, the `excluded` status and the 0.55 tier. Deleted `typesafe_kind.py`, `kind_pass.py`, `tests/test_kind_pass.py` and the README Pass 2 section; rewrote the README Pass 1 section. Enqueue writer and `Build` unchanged; dry run stays the default. Commit `70cc6f7`; report `reports/5-04-signal-rule-rebuild.md`.

Evidence: new fixture tests first failed against the old tool (24 tests, 31 failures/9 errors); after the rebuild `python3 -m unittest discover -s tools/session_backfill/tests` passed 24, `test_facts` passed 15, `py_compile` and `git diff --check` clean, removed-symbol grep empty, synthetic four-store dry run exit 0 with brief/build/phase-5 labels and no enqueue.

### Unit outcome — `5-05-four-store-dry-run.md`

Ran the rebuilt tool dry over the four real stores on codyh-ubuntu (2026-11-19T01:20:04-01:21:38+10:00), exit 0, empty stderr, no `--enqueue`/`--queue-dir`, no drain, no network. Commit `7552218`; report `reports/5-05-four-store-dry-run.md`.

| Store | Sessions | Labelled | multi_signal | no_signal | no_subject | unreadable | planning | refining | executing | brief |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| claude | 1,098 | 369 | 13 | 715 | 0 | 1 | 127 | 21 | 61 | 160 |
| codex | 2,870 | 0 | 0 | 2,869 | 0 | 1 | 0 | 0 | 0 | 0 |
| cursor | 568 | 70 | 0 | 498 | 0 | 0 | 0 | 0 | 0 | 70 |
| opencode | 13 | 0 | 0 | 13 | 0 | 0 | 0 | 0 | 0 | 0 |
| **total** | **4,549** | **439** | **13** | **4,095** | **0** | **2** | **127** | **21** | **61** | **230** |

Beside the rows (total): `transcripts_discovered` 5,566, `skipped_subagent` 376, `skipped_child` 631, `duplicate_ids` 10, `duplicate_transcripts` 10. All three reconciliation identities held per store and in total. Codex and OpenCode have no skill-load form, so their skill-based remainder appears as `no_signal`; the report says so. The inventory is larger than the 8 Nov run (3,623) because the stores have grown since; it is recorded as drift, not a contradiction.

### Phase verification

Independent orchestrator rerun after both units: `python3 -m unittest discover -s tools/session_backfill/tests` passed 24; `cd plugins/yakka/client && python3 -m unittest test_facts` passed 15; `py_compile` exit 0; `git diff --check` clean; removed-symbol grep empty. A fresh four-store dry run exited 0 with empty stderr, no `emitted` key, and total 4,550 sessions (one more than the recorded 4,549; the Claude and Codex stores are still being written), and every reconciliation identity held per store and in total. `~/.local/share/yakka/queue` held 0 `session-action-*.evt` files before and after. The phase closes on the fixtures and the dry-run count report.

`artifact_feedback`: both briefs and both reports are `delivered`; screen `pass` by jev-1.13.0; no flagged checks.

### Carried

- gate: Cody to authorise the real back-fill enqueue and drain; not run here.
- gate: the advisory `review_change` boundary call was not made (no live API calls are authorised for this rebuild).
- Phase 7 (follow-up review with Cody) reads `reports/5-05-four-store-dry-run.md`.
- The unrelated layout-test failure remains unreproduced and uninvestigated; not chased.

## Phase 6 — Back-fill pass 2: TypeSafe kind classification

**Obsolete (19 Nov 2026 amendment, above).** Kept as history; its code is to be dropped on rebuild and its carried gates are withdrawn.

### Unit outcome — `6-01-typesafe-kind-pass.md`

Built the TypeSafe kind schema and client (`tools/session_backfill/typesafe_kind.py`) and the pass that computes the gold threshold, routes results and enqueues `method=typesafe` facts (`tools/session_backfill/kind_pass.py`). Surfaces: `tools/session_backfill/` (both modules, the fake-only test file, the README Pass 2 section), and the brief and report under this plan. Brief commit: `36ba83a`. Closing commit: this phase's commit.

Departures from the brief (detail in the report): an `empty_prompt` route; `SystemExit` caught in the transport path; overall accuracy counts `unclear` as a miss; the scrub runs on the whole first line before the 1000-character cut; a dry run writes nothing; the CLI checks `TYPESAFE_API_KEY`; a private `_scrub_evidence` import from `backfill`.

Evidence (synthetic fixtures and fake transports only):

- `python3 -m unittest discover -s tools/session_backfill/tests`: 34 OK (12 before; 22 new).
- `python3 -m unittest discover -s plugins/yakka/client -p test_facts.py`: 15 OK.
- `python3 -m unittest discover -s tools/transcript/tests`: 11 OK.
- `py_compile` on the three new Python files and `git diff --check`: clean.

### Phase 6 verification

The phase outcome's entry points were exercised by the tests above: `kind_pass.main` for the dry run and the CLI refusals, and `run_pass` with a fake transport for the live routing. The live path reaches TypeSafe only through `--live --confirm-egress`, and no live call was made. The real behaviour checks (a raw TypeSafe response, a gold threshold, the drain and analytics check) are not verified; each is gated below. `artifact_feedback` was not called because it sends the report to a remote screen.

### Carried *(superseded where it names gold agreement, the queue-log join, Flash, TypeSafe or accuracy bars: see the 19 Nov 2026 amendment above)*

- gate: Cody to authorise the live TypeSafe run and prompt egress (scrubbed 1000-character prefixes of partial and gold sessions), per Assumption 19 and Open Questions.
- gate: Cody to choose the queue-log-to-session join so the gold set is non-empty; until then the threshold is unset and no label completes.
- gate: Cody to confirm the accuracy bars (0.90 threshold bar and per-kind bar).
- gate: Cody to authorise the real enqueue and the drain and analytics check (`GET /v1/actions?source=backfill&max_confidence=<T>`).
- The live response shape is assumed from the jev-variants choice answer; inspect one raw response before trusting the parse.
- The unrelated layout-test failure (recorded above) was not run by these suites and was not chased.
- The private `_scrub_evidence` import from `backfill` should become a public function in a later refactor.
