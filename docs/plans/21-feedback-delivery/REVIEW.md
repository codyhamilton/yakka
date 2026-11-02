# Review — feedback delivery (design)

Verdict: **PASS_WITH_FOLLOWUPS**

Reviewed SHA: `1049941de47aac798d31b21658e773e972ec963c` (includes citation fix and this review file).

Plan sufficiency: the design is enough to judge intent, phase outcomes, ledger entries, and downstream QA. Build phases 4, 5, and 6 correctly carry **open** approach flags where live deployment, Codex harness behaviour, or staging mechanics must be settled against the code.

## Phase outcomes (design acceptance)

Each phase outcome is stated as an observable check (config table, process list, scratch-repo transcripts, admin page, backlog manifest). The union matches issue #174 expected items 1–5 and Cody’s ordered decisions (remote-or-fail, legacy retirement, final-write recovery, scoring honesty, Codex instruction, one-time backlog, end-to-end agent behaviour).

| Phase | Assessment |
| --- | --- |
| 1 — Remote-or-fail client configuration | **met** (as design). Resolve contract, failure contract, and conformance-table requirement are precise; surfaces and doc drift (design 02) are named. |
| 2 — Retire legacy MCP and launcher | **met** (as design). Outcome is verifiable on Cody’s machine; explicitly excludes touching the stranded queue. |
| 3 — Every written file reaches the remote | **met** (as design). Snapshot + Stop sweep + feedback reconciliation cover the traced Bash heredoc gap; secret-scan `rejected` path is explicit. |
| 4 — Delivered means screened and scored | **met** (as design). `scoring:` line contract and deployment read/fix step match assumption 1; live service state is correctly out of scope for the design run. |
| 5 — Codex calls feedback | **met** (as design). Open question 1 and ledger 4–5 gate path resolution; fallback instruction path if MCP instructions are insufficient is ledgered. |
| 6 — Upload legacy backlog once | **met** (as design). Staged copy, hook-events-only, idempotent verification, and tenant count cross-check address the destructive in-place drain risk. |
| 7 — Agents act on feedback | **met** (as design). Depends on 3–5; closes issue done-when with two harness transcripts. |

## Intent and ledger

The verbatim intent block is preserved. Root causes in the Problem section align with code paths checked in this repo (`_write_tools`, `LocalEndpoint` / missing-file local mode, `feedback.go` screen lines, clientconfig). The assumption ledger covers scorer state, backlog tenant, Codex cwd, probe restart, and wait ceilings; downstream build is explicitly invited to challenge ledger entries.

## Findings

### Resolved in review

- **low** — Problem section cited `main.go:86-110` for serve scorer startup messages; those lines are `runServe` listen/setup. Updated to reference `runServe` / `screenStep` instead of stale line numbers.

### Follow-up (not blocking design sign-off)

- **low** — PR body does not start with `Yakka-Plan: docs/plans/21-feedback-delivery/` (convention in the design skill). Updated on the PR via `gh pr edit` during review; future design PRs should set the marker before open.
- **medium** — Phase 4 and 7 outcomes require live remote and harness sessions (same class as plan 19 Phase 4). The design states this; execute/post-build must not treat repo-only tests as sufficient for those phases.
- **low** — Open question 3 (other `yakka mcp` processes) is recorded but not phased; acceptable deferral unless recon shows they still hit loopback.

## Residual risks

- Explicit local users without `client.toml` must add `mode = "local"` after phase 1; breakage is intentional and documented in the error text.
- Backlog upload (~168 MB) depends on admin headroom (assumption 8); pause/resume is specified.
- Plugin cache lag: outcomes are defined against released plugin versions, not a dev checkout.
