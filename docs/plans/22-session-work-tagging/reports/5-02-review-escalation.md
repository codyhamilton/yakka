# Phase 5 review escalation — Codex conversation identity

Status: `done` for the blocking finding in `22-rv-p5.md`.

The previous fix (`2f09bbc`) handles normal `session_meta` IDs, but leaves a filename fallback when the metadata is absent or invalid. It also overlooks a valid direct payload ID when an unrelated `meta` object exists. This escalation removes those paths to misattribution.

Codex identity now comes only from `session_meta.payload.id`, with `payload.meta.id` as the wrapped form. Message/tool IDs and caller-supplied filename stems cannot replace it. Missing, invalid, empty or unparseable metadata produces an inspectable unresolved label with an empty session ID and the transcript path in `source_file`. Such a label cannot enqueue, even if a later pass mistakenly marks it complete. The README records this behavior.

## Evidence

- The added regressions failed against `2f09bbc`: seven failing subcases showed the direct-ID lookup failure and unresolved metadata being completed from filename-matched queue truth.
- `python3 -m unittest discover -s tools/session_backfill/tests -v`: 10 passed. The canonical-ID path is verified through discovery, labeling, local enqueue, parsing and `Build` into exactly one `session_action` fact. Additional cases cover wrapped metadata, unrelated IDs, direct-ID precedence, missing/invalid IDs, and unparseable rollouts.
- `PATH=/home/codyh/go/pkg/mod/golang.org/toolchain@v0.0.1-go1.27.1.linux-amd64/bin:$PATH GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local python3 -m unittest test_facts` from `plugins/yakka/client`: 15 passed. Initial offline attempts using the default Go 1.24.2 toolchain failed the Go bridge requirements; the cached Go 1.27.1 binary ran the suite without downloads.
- Python compilation and `git diff --check` passed.

resolved: yes | HIGH — Codex labels used rollout filename stems instead of transcript conversation IDs | No filename fallback remains; regression fixtures prove canonical identity in the built fact and zero emissions for unresolved identity.
resolved: no | MEDIUM — Count-only snapshot cannot report server-fact overlap (#190) | Already filed; outside this blocking-finding escalation and unchanged.

## Limits and carried work

gate: Cody to authorize the codyh-ubuntu four-store dry run and any real enqueue/drain verification.

All escalation verification used synthetic transcripts and temporary queues. No production stores, real classification, network egress, drain, ingest service, or human review were used. Remote artifact feedback was not requested under the no-egress gate. The pre-existing unrelated layout test failure remains recorded, uninvestigated and outside this fix. This resolves the review finding; it does not claim the gated operational Phase 5 outcomes or later phases are complete.
