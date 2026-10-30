# Provenance: Local to remote sync

Interactive posture only. Headless runs carry intent, the assumption ledger, and decisions in `DESIGN.md` alone.

## Session

- Session: Initial design (October 19, 2026)
- Timestamp: 2026-10-19T00:00:00Z
- CWD: /home/codyh/workspace/workflow-plugin

## Initial Request (verbatim)

> Now that we have the yakka service running on fly, I want to be able to migrate the local tenancy to the remote one. There's a few things to consider here. First I think we should establish this as a supported pattern, allowing local to remote sync, which we use our cli for. This doesn't change remote much - it just permits a sync method, and it's up to the local to decide when and if they want to. The matching criteria is the local user is authenticated and sets the target tenancy they want to sync to. The second issue is what actually is stored, and this should be assessed - what are the forms of artifacts, how much space do they need, what's the value of each. We should have the set of object types aligned in local and remote.

## Design Conversation

### Turn 1

**User responded:** The initial request, above.

**Agent decisions:**

- Measured the local tenant's storage by form (see the DESIGN.md table).
- Found that the existing `read_write` token from `yakka login` already meets the matching criteria.
- Proposed `yakka sync` over the existing `/v1/ingest`.

### Turn 2

**User responded:** "So if we drop the diff how much is left"

**Agent decisions:**

- Measured removing `info.summary.diffs`: 4,893 → 3,396 MB uncompressed, and 442 → 320 MB as single-stream zstd.

### Turn 3

**User responded:** "Yes let the tenant decide in configuration, this is a data retention setting. /design a plan for implementation, including both the sync mechanism and the discussed archive." The user said the plan could be split into separate designs.

**Agent decisions:**

- Split into this plan and plan 17 (archive retention), with no dependency between them.

### Turn 4

**Agent asked:** What the steady state should be after sync, and whether to trim the OpenCode diffs.

**User responded:** Both mirror and one-shot migration. Trim at the edge and in sync.

**Agent decisions:**

- Put the trim in server ingest policy, before the row hash, and mirror it in the plugin.

### Adversarial review

**Agent decisions:**

- Sync calls the exported `ingest.Trim` before sending, to save about 1.5 GB of upload and stay under the 16 MiB body cap. This supersedes "sync needs no trim code".
- The cursor is a single `rowid`, and hook bodies come through `archive.Read`. This replaces per-file byte offsets, which go stale when files are rewritten or sealed.
- Sync is coupled to plan 17 only through the fail-closed rule for a source tenant that has used `cold`.

## Agent Decisions

- **Separate sync credential**: `yakka login --sync` writes `sync.toml`, and `client.toml` is never touched. Rationale: one shared `client.toml` would switch the drain to the remote at login, making mirror impossible and refusing the first migrate sync as local mode.
- **`--to` must equal the token's tenant**: Sync confirms the target through a new bearer-only `GET /v1/whoami`. Rationale: the token already picks the tenant, but syncing a whole history is large enough to need an explicit, checked statement of intent.
- **Gate on the route, not the version**: The remote reports `dev`, so sync checks for `/v1/whoami` rather than comparing versions.
