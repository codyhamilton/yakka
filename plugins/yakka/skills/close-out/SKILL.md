---
name: close-out
description: >-
  End a plan by collapsing its folder into one record file at
  docs/plans/<NN>-<slug>.md and deleting the folder in the same commit. Use when
  the work is finished, including after execute terminal review or a merged
  pipeline-posture PR.
---

# Close-Out

One plan, one file. `docs/plans/<NN>-<slug>/` becomes `docs/plans/<NN>-<slug>.md` — same number, same slug — and the folder is deleted in the same commit. The branch history and the PR are the archive; the record file is the record. Nothing deleted here is lost.

## When

- **Terminal**: after review settles, as the last commit before the PR.
- **Pipeline**: after the PR merges, on the default branch, as its own commit. Never on the PR branch: `REVIEW.md` and `QA.md` are live inputs to the stage, and a trailing commit would unbind the tested SHA.

Refuse and report when the work is unfinished (`IMPLEMENTATION.md` is the resume path), a `blocker` or `high` finding stands, the change has not landed and is not abandoned, or the artifacts do not support an honest record. Abandoned work is closed out as abandoned, saying how far it got and why; a folder where nothing was built is deleted outright.

## Outcome

- Everything about to be consumed was read first, as a set: `DESIGN.md`, `IMPLEMENTATION.md`, `REVIEW.md`, `QA.md`, `PROVENANCE.md`, the briefs.
- Contracts in `DESIGN.md` that outlive this change are promoted to `docs/design/`, reframed out of this change's tense, and pointed to from the record. Everything else in the folder is deleted.
- Each non-blocking follow-up went to a tracker issue or a `docs/design/` doc, and the record says where.
- The record exists in the structure below. The folder is gone, nothing under `docs/plans/<NN>-*` is a directory, and no path into the deleted folder survives in the repo.
- One commit.

## The record

Written for someone who has never seen the change and will not read the history. Typically 60 to 150 lines; past 200 you are transcribing.

```markdown
# <Title>

<One paragraph, past tense: what this was, what it did, whether it did what it set out to do.>

## Intent
User request, verbatim:
> <from DESIGN.md, unchanged>

## Why This Existed
## What Was Built
<The actual, not the design's wording. **Changed:** the surfaces touched.>
### Phase N — <name>
<Only when there was more than one phase: what it delivered and its deviations.>
## Deviations
## Review
## QA
## Residual Risks
## Follow-ups
## Decisions Worth Keeping
```

- Deviations, Review, Residual Risks, and Follow-ups always appear; "None" there is information. Other sections that do not apply are omitted, and Decisions Worth Keeping is omitted rather than manufactured.
- Carry, do not concatenate. A met outcome is described in What Was Built; an unmet one is a deviation, a risk, or a follow-up. Do not copy the phase list or the ledger forward.
- Strip dead conventions and every path into the deleted folder; rewrite the sentence.
- Intent is verbatim. Everything else is rewritten prose. No status, completion marker, date stamp, or version. No credentials or dumps.
