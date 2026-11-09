# Brief: 3-01 — Criteria resolution from the artifact store

Consumer: Plan 23 Phase 4 review handler; Phase 6 trial manifest also pins criteria versions.
Owned paths: `packages/yakka/internal/review/`, `packages/yakka/internal/store/` (artifact version reads only), tests beside those packages, this brief's report, and the Plan 23 implementation record. Touch no other paths.
Commits: Commit implementation and report when done evidence passes, with a plain-summary title. The phase-closing record gets its own commit with `Yakka-Phase: 23-llm-review-shadow:3`.
Report: Before the implementation commit, write `docs/plans/23-llm-review-shadow/reports/3-01-criteria-resolution.md`, using `packages/yakka/catalogue/checks/execution-report.json`.
Depends on: Phase 2 `internal/review` packet types and Phase 1 capture representation; resolver takes the captured repo id as input and does not import the Python client.
Runs alongside: nothing; this is the only unit in Phase 3.
Budget: one resolver, a bounded version-read API and fixture coverage; about 12 files to read, 1,000 lines to change, 40 tool turns. If the budget is exceeded, record a specific handoff in `IMPLEMENTATION.md` and report `over budget`.

## Required reading, in order

1. `docs/plans/23-llm-review-shadow/DESIGN.md` — “Domain: Criteria resolution (server)”, Phase 3 Outcome and Surfaces, and the relevant ledger decisions.
2. `docs/plans/23-llm-review-shadow/IMPLEMENTATION.md` and Phase 1/2 briefs and reports — current interfaces and carried items.
3. `packages/yakka/internal/review/build.go` — criterion and policy types; keep the resolver output compatible with `Build`.
4. `packages/yakka/internal/store/store.go` — `Tenant.Artifact`, screen/rejection state, `ReadBlob`, `HasBlob`; add only the artifact-version read needed to retrieve versions and bodies for one `(repo_id,path)`.
5. `packages/yakka/internal/keys/keys.go` — canonical artifact kind classifier.
6. `packages/yakka/internal/ingest/ingest.go` and store/ingest fixture patterns — fixtures must populate the store through ingest and screening APIs.

## Goal

Implement a deterministic criteria resolver in `packages/yakka/internal/review` that uses only the authenticated tenant's artifact store, parses the exact criteria sections from stored design/brief content, selects and records a content version, and returns explicit refusal codes instead of silently reviewing without criteria.

## Contract

Binding: the cited “Domain: Criteria resolution (server)” and “Phase 3 — Criteria resolution from the artifact store” Outcome. In particular:

- Support exactly one of: `plan` plus `phase`, `brief` path, or explicit `criteria_text`; no reference and no text returns the explicit `criteria: none` marker. A reference wins over simultaneous `criteria_text`, and output reports `ignored: criteria_text` without resolving/sending that text.
- Restrict every lookup to the supplied repo id. A plan may be the complete `<NN>-<slug>` folder name or a bare slug; multiple matches are `criteria_ambiguous`. Plan criteria include Intent, requested phase Outcome and Surfaces, and the ledger entries; brief criteria include Goal, Contract, Done evidence and Owned paths. Each emitted criterion has a stable packet-local id (`I1`, `O1`, `D1`, `A1`, etc.) and deterministic ordering.
- Only `DESIGN.md` and valid `briefs/*.md` artifacts resolve. Reports, `briefs/remediation-*`, and paths corresponding to REVIEW.md, IMPLEMENTATION.md, QA.md or PLAN.md do not resolve. Use `internal/keys.Kind` and further reject remediation briefs.
- For each path, select the newest stored version not rejected by screening; pending/unscreened or flagged screening states remain eligible and are recorded. If no eligible version/body is available, return `criteria_unavailable`. Record source, repo id, path, hash, and screen state. A requested hash absent at the path is `criteria_version_unknown`; a pinned eligible older version is `criteria_stale` unless `allow_superseded`, and when allowed the extracted text comes only from that exact historical content.
- Return the exact design refusal codes: `criteria_not_found`, `criteria_ambiguous`, `phase_not_found`, `criteria_version_unknown`, `criteria_stale`, `criteria_unavailable`. Every refusal returns no criteria. Error values must be suitable for Phase 4 to record as `refused_criteria` with the code.
- Parse phase headings exactly and reject duplicate matching phase headings as `criteria_ambiguous`. Do not infer missing criteria, use git, read paths outside the store, or resolve across repositories.

## Done evidence

- Add fixture tests using two independent tenant stores populated through `ingest.Ingest`, with multiple design/brief versions and pass, pending, flagged and rejected states. Cover all Phase 3 Outcome cases, exact extracted text/version metadata, stable ids, ambiguity, no cross-tenant resolution, and no-criteria marker.
- Store-version retrieval tests prove historical bodies are available by hash only when held and rejection/screen metadata is surfaced accurately; do not alter unrelated store behavior.
- `prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review ./internal/store ./internal/ingest` passes from `packages/yakka`.
- `git diff --check` is clean.

## Report back

Under 1,500 tokens. Status: `done` | `done with concerns` | `blocked` | `needs context` | `over budget`. Include exact check commands and outputs, deviations, contradictions, unfinished work, and known problems; explicitly say when each is none. No credentials, provider calls, deploys, Fly, Wrangler, or paid/live review steps.
