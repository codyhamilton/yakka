# Phase 4 unit 4-02 — Review record persistence

Status: `done`

## Delivered

- `ingest.Ingest` accepts `review_run` facts, preserving generic raw fields while requiring `repo_id`, `kind`, `capture_id`, and a recognized design status. Existing recursive secret prechecks run before persistence. Duplicate canonical row hashes return `duplicate`.
- Review facts are written by the tenant's serialized writer to a tenant-local `review_runs` table. This keeps them outside conversation, hook-event, and facet aggregates and outside artifact screening.
- Captured input APIs are `(*Tenant).WriteReviewInput(hash string, content []byte) error` and `(*Tenant).ReadReviewInput(hash string) ([]byte, error)`. They use `review-inputs/<first-two-hash-chars>/<sha256>`, reject hash mismatches, verify reads, and write atomically.
- The Phase 4 reader API is `(*Tenant).ReviewRecords(ctx, ReviewRecordFilter) ([]ReviewRecord, error)`. Filters: `RepoID`, `Plan`, `Phase`, `Kind`, `Status`, `Effort` (effective effort), `Profile`, `ManifestHash`, inclusive Unix-seconds `Since`, and `Limit` (maximum 500). Results expose `ConversationID`, `RepoID`, `TS`, and canonical `Raw`; captured content is not returned.
- Focused fixtures cover valid/invalid/secret review facts, duplicate storage, aggregate exclusion, input round-trip/hash refusal, tenant isolation, review filtering, and absence from blob/pending inventory.

## Evidence

Command:

```sh
cd packages/yakka && ulimit -v 8388608 && TMPDIR="$PWD/.test-tmp" go test -p=3 ./internal/ingest ./internal/store
```

Output:

```text
ok  github.com/codyhamilton/yakka/packages/yakka/internal/ingest 0.306s
ok  github.com/codyhamilton/yakka/packages/yakka/internal/store 6.673s
```

`git diff --check` — clean (no output).

Departures: none. Unfinished work: none. Known problems: none. No credentials, provider calls, deployment, Fly, Wrangler, or paid/live review steps were used.
