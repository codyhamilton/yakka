---
name: design
description: Turn a problem statement into a signed-off design — solution shape, domain boundaries, contracts, ownership, and phases each closed by a provable outcome. Use when a user asks for a plan or design, or to bound a work package before it is refined and built.
---

# Design

Produce `docs/plans/<NN>-<slug>/DESIGN.md`: the bounding document every later stage works within. It maps the problem to a solution shape and stops there. Detail below the phase level belongs to `refine`. The invoker has already decided this work deserves a design; do not relitigate that.

## Outcome

- The user's request is in the Intent section, verbatim.
- The stable docs (`docs/OVERVIEW.md`, `docs/ARCHITECTURE.md`, `docs/design/`) have been read. Any pivot or contract change they do not yet reflect is named and the scope widened to match. Missing or stale stable docs are reported and fixed where the design depends on them, never blocked on.
- The solution shape is stated as domain boundaries, the contracts between them, and who owns each. Contracts are precise enough for a brief to cite. Everything else stays at bounding altitude.
- The work is cut into phases, each closed by a provable outcome, each naming its surfaces and whether its approach is known or open. Phase count and order are fixed at sign-off.
- Every scope-shaping decision was asked (interactive) or ledgered (headless). Questions execution will answer by itself were not.
- A clean context has run one adversarial pass over value, intent alignment, scope, contracts, phase outcomes, ordering, and the ledger. Its findings are reported; those that improve the design are applied.
- Feedback is obtained: after writing the file, call `artifact_feedback(path)`. A rejection is fixed before moving on (the reason names a pattern and line, never the secret). A check flagged out of the tenant's norm is addressed or named. `queued`, `not tracked`, `not delivered`, `stale`, `unreachable` or `bad config` is reported in one line and the work continues; a `queued` answer means call once more after a few seconds. It is never skipped silently. Ratings are comparative and uninformative on their own; the outlier is the signal.
- Interactive: the checkpoint is held, with the design and any ledger presented before anything is built. Headless: waved through; downstream review challenges the ledger.

## Phases

A phase is defined by what becomes true, not by what changes.

- Each outcome is stated so it can be checked without asking: entry point → action → observable result for user-facing outcomes; a plain observable statement for internal contracts. The union of phase outcomes is the design's acceptance criteria; there is no separate list.
- A candidate phase whose outcome cannot be stated this way is not a phase. Fold it into the phase whose outcome it serves; a migration's outcome is the behaviour that runs on the migrated shape.
- Each phase names the surfaces it changes (files, modules, interfaces) as seen at Ground. `refine` checks them rather than rediscovering them.
- Each phase carries an approach flag. **Known**: refine and build straight through. **Open**: the outcome is provable but no approach is settled; it is built under a divergent-candidate method with this outcome as the fixed yardstick. Set the flag in the design conversation; it is where a human decides to spend a multiple on a phase.
- A design with one phase that one worker can carry skips `refine`. Say so in the design.
- A phase count that will not sign off is a design that is too big. Split it into a design-intent doc in `docs/design/` and a sequence of designs.

## Ground

Delegate Ground. Dispatch cheap recon agents with specific questions — where a contract lives, what a surface looks like, what already exists that the request assumes does not — and synthesize their answers. The design context holds the shape, not the code.

## Postures

Declared by the invoker, never inferred. Default: interactive.

- **Interactive**: ask scope-shaping questions as they arise; append each turn to `PROVENANCE.md` as it happens. Hold the checkpoint.
- **Headless**: each question becomes an Assumption Ledger entry in `DESIGN.md` — question, answer chosen, rationale, what changes if wrong — appended as decided. No `PROVENANCE.md`. Wave the checkpoint through.

## The folder

- `docs/plans/<NN>-<slug>/`, one per change or PR. The slug is the key; `NN` is best-effort ordering and nothing may locate a folder by it.
- The folder existing means the work is being built or was built. Deferred or speculative work is a `docs/design/` doc or a tracker issue.
- The PR will carry `Yakka-Plan: docs/plans/<NN>-<slug>/` as the first line of its body; the folder must exist at that path.
- `DESIGN.md` from `templates/DESIGN.md`; Intent is the first write. `PROVENANCE.md` from `templates/PROVENANCE.md`, interactive only.
- `close-out` collapses the folder into `docs/plans/<NN>-<slug>.md` and deletes it. Write `DESIGN.md` as the source that record is built from.

## Rules

- Intent is verbatim and untouchable.
- Contracts cannot stay indicative; anything below a phase outcome can. No briefs, file-level task lists, or implementation detail in `DESIGN.md`.
- Ask or ledger only what changes scope, boundaries, sequencing, compatibility, non-goals, or a phase outcome.
- Preserve the purpose of a section over its template shape.
- Provenance records substance in the user's words, not a transcript. No credentials, tokens, or dumps in any artifact.
- No status, progress, or version fields in any artifact. No frontmatter fields for identity, status, scores or progress; the artifact key is the repo and path.
