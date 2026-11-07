status: done with concerns

## Changed

Added `packages/yakka/internal/analyticsfixture/`, a non-shipping fixture generator using store append, artifact promotion, score, and rejection APIs. It writes only to the caller's ledger directory. `manifest.json` is embedded and readable as a test summary; no product route or sample-data path is involved. The manifest and generated-ledger test pin 5,015 hook events, 5 model calls, all 3 artifact kinds and version counts, 3 derived execution shapes, both rejection stages, 32,767 distinct scored hashes, timestamp bounds (1500–2300), shared body identities, scorer rescoring, session repo relationships, and the unpriced call beyond the conversation cap.

## Check evidence

Before implementation, `git ls-tree HEAD packages/yakka/internal/analyticsfixture` returned no entry: the generator and manifest check were absent. The first new manifest run exposed a count mismatch (`model_calls=5 want 4`); the manifest now counts the unpriced tail as the fifth model-bearing fact. The final check passed:

`GOMEMLIMIT=8GiB go test ./internal/analyticsfixture -count=1 -v`

Result: PASS, 199.502 s. The generated-ledger and manifest check passed in 187.41 s; the candidate comparison and manifest example also passed. The run verifies exact counts and timestamps, shared content, scorer-specific scores, session repo cardinalities, all three execution shapes, both rejections, and the unpriced tail.

## Generator candidates

Both candidates used the same fixed 5,015-event oracle and `store.Tenant.Append` in temporary ledgers. Batched append wrote exactly 5,015 rows in 196 ms. Single-row append wrote exactly 5,015 rows in 11.855 s (about 60 times slower). Both preserve store rollups and produce the same population; batch append is selected. The full 32,767-hash fixture takes about 187 s to generate and verify, so consumers should create it once per test setup rather than once per browser case.

## Departures, gates, and remaining work

No scope departure or contract contradiction found. No live deploy, production data, credential, or human confirmation was needed; no `gate:` item remains. No unfinished action remains for this unit. No unrelated bug was found.
