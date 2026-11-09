# Report: phase1-01 — Call controls and execution identity

Status: `done with concerns`

Branch: `feat/23b-review-controls-trial`

## What changed

`internal/review/orchestrator.go`:

- `Request` gains `Effort string`, `Tags []string`, `Store *bool` plus `UnmarshalJSON`. The decoder keeps omitted/null/wrong-type distinct: omitted effort resolves to `high`, omitted tags to `[]`, omitted store to `true`; explicit `null`, empty effort, and wrong types are argument errors. Programmatic requests leave `Effort==""` and `Store==nil`, preserving old callers' defaults.
- `resolveCallControls` validates and canonicalizes all three before any effect: submitted tag count ≤16 (counted before dedupe), 1–96 ASCII bytes matching `[A-Za-z0-9][A-Za-z0-9._:/=-]{0,95}`, `secrets.Scan`, sorted-unique canonical set. Legacy `trial` keeps range-mode/64-hex/non-empty-case/effort validation with no env gate, rejects conflicting top-level effort, unions `effort:`, `manifest:`, `case:<sha256>` adapter tags, and rejects a merged set >16. Requested effort defaults to `high`; configured is `Availability.Effort` else `high`; effective equals requested.
- Execution identity: empty canonical tag set calls `legacyExecutionKey`, byte-identical to the pre-upgrade `executionKey`. Nonempty sets use `"review-execution-tags-v1"` plus the sorted tag set. Exported `PreUpgradeExecutionKey` for phase1-03's restricted fallback.
- `persistRecord` now writes canonical `tags`, `configured_effort`, `requested_effort`, `effective_effort`, and skips all persistence when store is false. Tags never enter `Build` or prompt content.
- `store=false` skips `WriteReviewInput`, `persistedClaim`, and claim persistence; it still validates availability, reserves spend/in-flight via a fresh `id`, calls the provider, and returns the full result regardless of `detail`. Capture/criteria refusals under store=false also return without writing.

`internal/review/availability.go`: removed `TrialEnabled`; `CheckAvailability(c, tenant, repo, effectiveEffort)` keeps local/token/model/effort-config/cap/priced-model/allowlist checks, requires configured effort `""`/`high`, and accepts effective `high|xhigh|max`. Added `Reservations.beginEphemeral`, which reserves spend/in-flight under a fresh key without adding a claimed entry.

`internal/serve/serve.go`: dropped `ReviewTrialEnabled`, its env parse, and the availability field.

`internal/serve/mcp_review.go`: schema/allowlist add `effort` (enum), `tags` (array, maxItems 16), `store` (boolean); `validateReviewMCPArgs` rejects wrong types/overcount; `review_change` now advertises `idempotentHint:false`. Capture-reader keys are filtered before the strict `Request` decode because MCP arguments are flat.

Tests: new coverage in `orchestrator_test.go` for refusal-before-effects, all efforts in both modes, legacy adapter mapping/union/conflict/overflow, pre-upgrade key preservation and tag separation, and store=false cache/persistence bypass. `reviews_test.go` drops trial env fixtures; `mcp_review_test.go` adds schema/validation checks.

## Check output

New tests were written before the implementation; they could not compile until the new fields/helpers/signatures existed (e.g. `Request.Effort/Tags/Store`, `canonicalTags`, `executionKey`'s tag argument, `beginEphemeral`).

After:

```
$ cd packages/yakka && prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review ./internal/serve -run 'Review|Run|Effort|Trial|MCP'
ok  .../internal/review  0.818s
ok  .../internal/serve   3.142s

$ prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review ./internal/serve
ok  .../internal/review  1.517s
ok  .../internal/serve   9.436s

$ prlimit --as=8589934592 -- go test -count=1 -p=3 ./...
(all 16 packages ok)

$ rg -n "TrialEnabled|YAKKA_REVIEW_TRIAL_ENABLED|trial_disabled" packages/yakka/internal
(no matches)

$ git diff --check
(no output)
```

## Deviations

- `Store` is `*bool`, not `bool`. The contract needs omitted→true, explicit false→false, and null rejected; a plain bool plus an unexported "set" flag would be unsettable from `internal/serve` and other packages. `*bool` keeps old Request literals on `true` while allowing explicit false.
- Changed-line budget: ~718 insertions / 102 deletions (~616 changed) against the ~380 guidance, mostly the six required new tests (~360 lines) plus the strict decoder and persisted-field changes.

## Problems / unfinished

- `Request.UnmarshalJSON` now rejects unknown fields itself. Any future flat-payload caller (beyond the MCP path, which filters capture-reader keys) must not pass `mode`/`view`/`base`/`head`/`merge_base` at the top level.
- `store=false` refusals (capture/criteria) intentionally return no record; phase1-04's `review_usage` work should confirm whether failed ephemeral calls also need a content-free usage fact.
- Phase1-03 still uses the 500-row `persistedClaim` scan; this unit did not change it.

## Contradictions

None found. The brief's `store=false` "never writes review records" and the design's refusal taxonomy are consistent: refusals return directly without persistence.
