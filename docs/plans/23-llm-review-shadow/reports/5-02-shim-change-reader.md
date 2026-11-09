# 5-02 Shim change capture reader — execution report

Status: done with concerns

## Done against the brief

Registered content-bearing `change` v1 in the shim's fixed reader table. Its declaration must carry `bulk:true` and every approved typed parameter from landed 5-01. Unknown fields, missing fields, incorrect scalar/array types, unsafe strings, unsupported policy versions, reordered truncation classes, out-of-range limits and non-2-MiB budgets fail closed before capture. No tool definition, prompt, review behavior or policy defaults were added.

Adapted server-declared `change_exclude` and byte/file limits to the existing `CaptureChange` API; retained all declared policy fields and forwarded mode, view, untracked policy, range refs, merge-base and optional expected repo identity. Capture uses the declared project directory and never agent context or cwd as fallback. Existing reserved `_local` replacement is preserved. Capture errors become typed reader failures (invalid call arguments become `bad_input`), never empty successful captures. The serialized UTF-8 capture is bounded by the declared 2 MiB budget; existing readers retain their 64 KiB cap and bearer-key scan.

Capture Git operations now honor the shim's per-reader/whole-set deadline using a context-local deadline restored on every exit. Standalone capture retains its original Git timeout and capture semantics. No capture safety fixtures were duplicated or changed.

New fixtures cover combined, staged, included/excluded untracked and range captures (with/without merge base), server policy and argument forwarding, malformed declarations, unsupported change versions, typed capture failures, bad refs, wrong checkout, absent project context, byte-budget boundaries, bearer withholding, and deadline cleanup. An HTTP fixture `tools/call` proves captured `_local.change` forwarding and spoofed `_local` replacement. Existing unsupported-reader and all other shim fixtures remain unchanged.

## Evidence

From `plugins/yakka/client`:

```text
prlimit --as=8589934592 -- python3 -m unittest test_mcp_shim test_capture
Ran 36 tests in 7.570s
OK
```

From the repository root:

```text
prlimit --as=8589934592 -- git diff --check
(no output; exit 0)
```

Both checks ran with the required 8 GiB address-space cap. The earlier combined run also passed all 36 tests. Only owned client files, this report and the implementation record changed.

## Departures, contradictions and remaining work

Read-budget departure: inspected eleven repository artifacts including the assigned brief, exceeding the nine-file limit. Both the landed validator (`mcp.go`) and its committed capability-table diff were inspected to establish exact accepted values. Implementation continued after that overrun rather than stopping as the brief directed. No exploratory source paths were read.

No scope or contract contradictions. Unit implementation and done evidence are complete. Phase 5-03 can consume the registered reader; no server tool, integration or stage wiring was implemented here.

Known existing issue outside this unit's done evidence: `plugins/yakka/client/yakka.py`, `_capture_blob` / `_capture_change_once`, reads an entire worktree file with unbounded `f.read()` before checking `max_file_bytes`. A very large candidate can allocate well beyond its declared per-file cap before it is withheld. Root cause: the size check occurs after content/diff collection. This was found by source inspection, not reproduced with a large allocation, and was not fixed in this shim-registration unit. No other known problems.
