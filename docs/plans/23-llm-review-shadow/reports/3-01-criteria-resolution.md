# 3-01 Criteria resolution — execution report

Status: done with concerns

## Done against the brief

- Added `ResolveCriteria` in `packages/yakka/internal/review`. It resolves one tenant-scoped plan/phase or brief reference, explicit text with its SHA-256, or the `criteria: none` marker; stored references win over explicit text and record `ignored: criteria_text`. Stored criteria use stable IDs and exact Intent, phase Outcome/Surfaces/Assumption Ledger, or Goal/Contract/Done evidence/Owned paths sections. Refusals return a `CriteriaError` carrying the required code and an empty resolution.
- Added bounded `Tenant.PlanDesignPaths` and `Tenant.ArtifactVersions` reads in `internal/store`. They scope paths by repo id and versions by `(repo_id,path)`, return newest-first held blob or pending bodies, and expose screen and rejection metadata. The resolver accepts pending, unscreened and flagged content, excludes rejected versions, enforces hash pinning/staleness, and never falls back from an eligible version whose body is missing.
- Added ingest-populated fixtures for two tenants, multiple design and brief versions, pass/pending/unscreened/flagged/rejected states, deterministic IDs and extraction, slug and duplicate-phase ambiguity, all refusal codes, exact historical pins, ignored explicit text, no cross-tenant access, no-criteria marker, forbidden paths, and missing bodies.

## Checks

- From `packages/yakka`, `TMPDIR="$PWD/internal/review/.test-tmp" prlimit --as=8589934592 -- go test -count=1 -p=3 ./internal/review ./internal/store ./internal/ingest` — passed. Output: `ok github.com/codyhamilton/yakka/packages/yakka/internal/review 0.872s`; `ok github.com/codyhamilton/yakka/packages/yakka/internal/store 6.676s`; `ok github.com/codyhamilton/yakka/packages/yakka/internal/ingest 0.306s`. The temporary directory was inside the owned review package and removed after the run; no `/tmp` was used.
- The first run failed only because the `phase_not_found` fixture had no design artifact, so lookup correctly returned `criteria_not_found`. The fixture now stores the design before asking for a missing phase; the final exact suite command above passed.
- `git diff --check` — clean (exit 0).

## Deviations, contradictions, unfinished work, problems

- Deviation: added a bounded `PlanDesignPaths` query alongside the version/body read. Bare-slug matching and ambiguity detection require enumerating this repo's stored design paths; the query is limited to `DESIGN.md` artifact paths and the supplied repo id.
- Contradiction: the Phase 3 design outcome lists ambiguity when two repositories match, while this brief requires the captured repo id to scope every lookup and forbids cross-repository resolution. The implementation follows the brief; it does not search other repositories or report cross-repo ambiguity.
- Unfinished work: none.
- Known problems: none.
- No credentials, provider calls, deploys, Fly, Wrangler, paid/live review steps, or external filesystem paths were used.
