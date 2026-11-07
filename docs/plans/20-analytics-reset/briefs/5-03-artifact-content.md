# Brief: 5-03 — Bounded artifact content reads

Consumer: Plan 20 Phase 5 server worker; the Phase 12 artifact reader consumes this endpoint.
Owned paths: new packages/yakka/internal/serve/analytics_content.go and focused serving tests; bounded content read helpers in packages/yakka/internal/store/store.go (prefer a new focused store file where possible) and tests; packages/yakka/internal/serve/serve.go only to register the already-signed content route; docs/design/03-remote-service.md; this plan's report. This is sequential after 5-02 to keep route/schema and store integration edits isolated. Touch no UI or other plan.
Commits: Commit implementation and docs/plans/20-analytics-reset/reports/5-03-artifact-content.md together in one plain-summary unit commit.
Report: Use packages/yakka/catalogue/checks/execution-report.json; under 1,500 tokens.
Depends on: 5-02 and Phases 1–4. Runs alongside: nothing.

## Required reading

1. docs/plans/20-analytics-reset/DESIGN.md, Phase 5 and scope vocabulary.
2. docs/plans/20-analytics-reset/CONTRACTS.md, sections 3.4, 7, 12 and 17.4.
3. Existing artifact authorization/read and blob/screen/pending paths, route registration and fixture tooling.

## Goal

Implement tenant-bound, read-authorized retrieval of complete promoted artifact bytes, with exact identity/hash verification and the contract's refusal states.

## Contract and boundaries

Implement only GET /v1/analytics/content?repo_id=&path=&hash= as specified by CONTRACTS.md 17.4. Use the existing analytics tenant/read-scope authentication rules. Require the 64-hex hash to be referenced by the exact tenant-local (repo_id,path); unknown and other-tenant-only hashes are indistinguishable 404. Return complete bytes only, text/plain; charset=utf-8, X-Content-Type-Options: nosniff, and Cache-Control: private, no-store. Verify SHA-256 before response. Enforce schema-advertised budgets.content_bytes (16 MiB default); on oversize return 413 with full size and limit and no bytes. Missing bodies return contract reasons (removed_by_screen, pending, not_stored); pending paths are never served. Keep screened-pass and explicit unscreened states distinguishable in metadata. Only stored design/brief/report kinds are readable.

Bound file reads and hashing under the shared deadline/cancellation contract; avoid returning partial bytes after timeout, mismatch or oversize. Do not add write access, content for unstored files, server diff/HTML rendering, a new auth mode, route, dependency, migration or contract. Do not alter screening policy or expose pending/rejected bytes. No live credentials, production data or external system is required; prove behavior with fixtures/fakes. If existing auth middleware cannot provide the specified read scope without changing auth contract, bounce with the exact boundary gap.

## Done evidence

- Fixture HTTP tests cover allowed session and bearer read scopes, tenant isolation, exact repo/path/hash identity, unknown/other tenant indistinguishability, and expected content headers.
- Matching promoted blobs return complete bytes; an injected hash mismatch returns 500 content_integrity with no content.
- Oversized content returns 413 with full byte count/limit and no prefix. Missing, screened rejection, pending, not-stored and explicit unscreened cases follow the distinct contract states.
- Unstored artifact kinds cannot be fetched. Cancellation/deadline does not leak partial bytes.
- Schema advertises content only when route behavior is live, with its size budget. Existing artifact reads and auth semantics remain intact.
- Verify with bounded Go store/serve tests under the 8 GiB cap; Vitest if used max three workers. No animation/timing tests.

Record exact commands/results, any contract-level gap, and unresolved gate in the report. Do not deploy or use live secrets.
