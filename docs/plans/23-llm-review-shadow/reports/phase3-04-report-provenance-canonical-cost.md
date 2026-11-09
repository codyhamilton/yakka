# Report: phase3-04 — Report provenance, completeness and canonical-cost isolation

Status: `done`

Branch: `feat/23b-review-controls-trial`

## What changed

- `tools/shadow-review-trial/report.py`
  - `build_report(manifest, export, ledger, comparator_evidence, adjudications, cap)` now consumes the 3-03 certified saved export plus the frozen run ledger, not a bare reviews list.
  - `validate_inputs` now validates the manifest (including certified 3-01 history), the export and the ledger before any calculation. `_validate_export` requires `schema_version`, manifest hash, run id, tenant id, `detail=full`, frozen trial filter tags, a valid page-size limit, no error/truncation marker, `complete=true`, a page chain with continuous progressing cursors (no cycles), exactly one terminal page (`complete=true,next_cursor=null`), unique row identities, and page `row_count`/`row_ids_sha256` agreement with the flat reviews. A bare `{"reviews":[...]}`, legacy 500-row response, missing/unknown completion field, partial, looping, truncated/hashed-mismatch or error page is refused.
  - Trial records are selected from ledger `canonical_review_id`s and validated against the canonical tags (`manifest:<sha>`, `trial:<run>`, `effort:<level>`, `case:<sha256>`), plus tenant/effort/case agreement when those fields are present. New rows need no `profile`/`manifest_hash`/`case_id`.
  - Completion, `attempts_by_arm` and total usage/cost now come only from canonical records; duplicate receipts, unrelated tenant/run rows, wrong-model and non-trial rows are counted as exclusions and add no completed case or cost. Missing usage is still `null`, not zero.
  - `record_limit_may_truncate` is replaced by a `provenance` object (export identity, filters, limit, page count/evidence, row count, terminal state, canonical/completed counts). `denominators.canonical_records` was added. Existing arm/paired/shortfall, comparator, adjudication and deterministic-output semantics remain.
- `tools/shadow-review-trial/cli.py` — `report` gained required `--ledger`; `--records` is now a certified-export path and the whole object is passed through. Existing `--manifest`, `--adjudication`, `--comparators`, `--output`, `--cap-usd` remain.
- `tools/shadow-review-trial/test_report.py` — fixtures now build certified exports and ledgers; 50/49, asymmetric, comparator/adjudication, missing-usage and determinism tests retained against the new input shape.
- `tools/shadow-review-trial/test_report_export.py` (new) — >500-record certified export provenance/counts; partial, loop, missing completion, truncated, digest-mismatch, error-page and legacy bare-export refusals; canonical-cost isolation with unrelated tenant/run rows and duplicate receipts; ledger uniqueness/run/tenant/manifest refusal and uncertified-manifest refusal.
- `tools/shadow-review-trial/test_phase7.py` — only the saved-records/report section now writes the paged export and passes the run ledger; it asserts report provenance.

## Checks

Before (new checks run against `HEAD`'s `report.py` in a brief temp copy):

```
TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest test_report.py test_report_export.py
Ran 9 tests in 0.007s
FAILED (failures=3, errors=6)
```

After (exact done-evidence command):

```
cd /home/codyh/workspace/yakka-build/23b && mkdir -p /home/codyh/workspace/.briefs/yakka/23b-test-tmp && \
TMPDIR=/home/codyh/workspace/.briefs/yakka/23b-test-tmp python3 -m unittest \
  tools/shadow-review-trial/test_report.py tools/shadow-review-trial/test_report_export.py tools/shadow-review-trial/test_phase7.py
Ran 12 tests in 7.387s
OK
$ git diff --check
(no output)
```

The first implemented run had 10/12 pass; two fixture-construction failures (an unfrozen history edit and a too-small truncated `row_count`) were corrected to the 12/12 above.

## Deviations

- `build_report`'s parameter order is `(manifest, export, ledger, comparators, adjudications, cap)`; all owned callers updated. No other caller exists.
- `--records` was kept as the export path (a bare list/legacy object is refused at validation) rather than renamed, because the brief only named `--ledger` as the addition.
- Page row-id digests are re-derived by slicing the flat `reviews` in page `row_count` order, because 3-03 stores only per-page hashes, not per-page row lists. This relies on the runner's documented append order.
- Usage/cost counts canonical completed records. 3-02 only writes `canonical_review_id` for resolved completions, so in a real ledger this does not drop trial spend; a hypothetical canonical failed row with usage would not contribute.
- `attempted_records` in `denominators` remains total export rows; canonical row count is reported separately in `denominators.canonical_records` and `provenance`.

## Contradictions

- DESIGN Decision 22 says saved exports carry "high-water identity". The 3-03 export exposes high-water only inside the opaque cursor (already surfaced by 3-03); this unit validates cursor continuity, not a stand-alone high-water field.
- The brief says "canonical attempts/usage" in one line and "canonical completed records' attempts" in the Changes. I followed the latter; the distinction only matters for a canonical failed attempt carrying cost.
- The brief's `test_phase7.py` line range (162–176) does not match the current file; the saved-records/report section is near 227–246 and was the only part edited.

## Problems / unfinished

- No live paged read, provider call or report over real evidence; the exported shape is proven with fixtures only.
- `tools/shadow-review-trial/README.md` still describes `--records` as a bare reviews response and does not mention `--ledger`; it is outside this unit's owned paths.

## Gates

- gate: live paged reads and a real report need the deployed Yakka server, a dedicated `wk_` key with matching `/v1/whoami` tenant and `read_write` scope.
- gate: a real certified full-history manifest and dedicated-tenant provisioning are operator acts (3-01/Phase 2).
- gate: any paid execution, retry or resumed live work requires Cody's explicit spend approval (3-05); none was attempted.
