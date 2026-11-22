# Report: phase3-03 — Dated policy amendment and lifecycle docs

Status: done

## What changed

Owned docs only, per DESIGN §3.7 and brief contract:

- `docs/plans/23-llm-review-shadow.md` — appended the final section `## Policy amendment — 22 Nov 2026 (Plan 31)` with the verbatim amendment text after `## Follow-ups`. No earlier record text edited.
- `docs/design/03-remote-service.md` — added the `YAKKA_ADOPT_UNMARKED_TENANTS` row verbatim after the `CLAUDE_API_TOKEN` row; rewrote the cleanup wording to `tenants that have no lifecycle marker yet (flag off or adoption failed)` while keeping `409 legacy_tenant_cleanup_unsupported`; enum to `unmarked`; `null only while unmarked`; `Pending`→`In-progress`; remembered-selection sentence replaced; added the dated adoption sentence before `### Owner tenant lifecycle API`.
- `docs/design/07-analytics-site.md` — enum to `unmarked`; `null only while unmarked`; `Pending`→`In-progress`; remembered-selection sentence replaced.
- `docs/design/09-analytics-workspace-contracts.md` — `first active`→`first selectable`; foreign/deleted/pending wording replaced; appended the `Selectable means not resetting or deleting; a tenant with no lifecycle marker is selectable.` sentence.

`fly.toml` untouched per the signed-off 22 Nov override. No Go/JS/HTML/test/mockup file edited by this unit.

## Check output

Before (docs subset of B2):

```
docs/design/03-remote-service.md:246:checks, legacy tenants without a trustworthy ownership/creation marker return
docs/design/03-remote-service.md:259:(`active`, `resetting`, `deleting`, `unsupported`) and `lifecycle_generation` (opaque string, null
docs/design/03-remote-service.md:260:for unsupported legacy). Read from registry/journal metadata without lazy-open; disable lifecycle actions while recovery is
docs/design/07-analytics-site.md:72:(`active`, `resetting`, `deleting`, `unsupported`) and `lifecycle_generation` (opaque, null for
docs/design/07-analytics-site.md:73:unsupported legacy), read from registry/journal metadata without lazy-open. Disable lifecycle
```

After (all done evidence):

```
grep -niE 'lifecycleStateUnsupported|unsupported legacy|`unsupported`|legacy tenants' <03,07,09> → (no output)
grep -c 'Policy amendment — 22 Nov 2026 (Plan 31)' docs/plans/23-llm-review-shadow.md → 1
grep -c 'Cody, 22 Nov 2026, decided that an owned tenant with no lifecycle record is a normal tenant.' docs/plans/23-llm-review-shadow.md → 1
grep -c 'YAKKA_ADOPT_UNMARKED_TENANTS' docs/design/03-remote-service.md → 1
grep -n 'first active owned tenant\|foreign, deleted or pending' docs/design/09-analytics-workspace-contracts.md → (no output)
git diff --check → (no output)
```

## Departures

None from the brief's docs contract. The brief's `fly.toml` line is deferred by the 22 Nov override; the config-table row was reproduced verbatim as instructed.

## Unfinished / gate

`gate: the full B2 combined grep is closed only after phase3-01's product files land; this unit reports the docs subset clean.`

`gate: B5 is complete only with phase3-01's dated registry_lifecycle.go comment; this unit writes the Plan 23 amendment.`

`gate: YAKKA_ADOPT_UNMARKED_TENANTS stays off in fly.toml until Phase 2 has shipped (22 Nov override).`
