# Phase 4 unit 7: report output surface, CLI and README

Status: **done**.

## What changed

- `tools/shadow-review-trial/summary.py` (new): pure `render(report) -> str`
  producing deterministic Markdown with the fixed section order Population;
  Comparisons (a)-(g); Validation controls; Reproducibility; Reconciliation.
  It formats only the numbers the report already carries (no metric recompute,
  no I/O), shows each recall beside its shuffled null, paired deltas, method
  counts, kappa, shuffled-null seed, leak-check aggregates/scope and the
  reproducibility hashes. Fixed precision (4 dp rates, 6 dp cost), sorted keys,
  no HTML/ANSI/trailing spaces, no path, commit SHA, diff line, outcome
  excerpt, finding title or case list.
- `tools/shadow-review-trial/test_summary.py` (new): three offline tests — the
  fixed headings appear in order with recall/null numbers; two renders are
  byte-identical with no timestamp or absolute-path content; a
  `report.build_report` Phase 3-shaped fixture renders.
- `tools/shadow-review-trial/cli.py`: imports `summary` and `evidence_check`;
  `report` writes the JSON with `_write_json`, writes the rendered sibling
  `output.with_suffix(".md")` and prints `report`, `summary`,
  `manifest_sha256`, `report_sha256`, `arms` and `usage`; new
  `evidence-check --folder` subcommand prints the pass receipt and lets a
  `ValueError` reach `parser.error` (non-zero, offender names).
- `tools/shadow-review-trial/test_phase7.py`: `RehearsalHandler` now returns a
  finding per review derived from the fixture case's recorded review finding
  (`id`, `severity`, `path`, `line_start`, `line_end`, `title`, `evidence`); the
  adjudication file carries a review decision per finding with `second_label`
  and both labeler models; assertions cover the report sections, nulls beside
  every recall, method tags on every match, non-null kappa, passing leak check,
  two byte-identical report/summary runs with equal `report_sha256`, and the
  evidence check refusing the export while passing a metric-only folder.
- `tools/shadow-review-trial/test_manifest.py`: the stale `'"eligible": 2'`
  assertion now expects the committed `'"frozen": 2'` summary key (and asserts
  `summary["frozen"] == 2`); `cli.py` was not changed back.
- `tools/shadow-review-trial/README.md`: documents the summary sibling,
  `report_sha256`, the population/comparisons/validation/cost_latency/
  reproducibility/reconciliation sections, the adjudication version 1
  extension, the `evidence-check --folder` command and the verbatim leak-check
  scope wording.

## Done evidence

Before (tests first):

```
$ python3 -m unittest tools/shadow-review-trial/test_summary.py
ERROR: test_summary (unittest.loader._FailedTest.test_summary)
ModuleNotFoundError: No module named 'summary'
Ran 1 test in 0.001s
FAILED (errors=1)

$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 146 tests in 14.728s
FAILED (failures=1)
FAIL: test_cli_freezes_fixture_repository
  AssertionError: '"eligible": 2' not found in '{"candidates": 4, ..., "frozen": 2, ...}'
```

After:

```
$ python3 -m unittest tools/shadow-review-trial/test_summary.py tools/shadow-review-trial/test_phase7.py
Ran 6 tests in 7.496s
OK

$ python3 -m unittest discover -s tools/shadow-review-trial -p 'test_*.py'
Ran 149 tests in 14.856s
OK

$ grep -nE 'population|comparisons|validation|cost_latency|reproducibility|reconciliation|report_sha256' tools/shadow-review-trial/README.md
80: ... report_sha256 ... Population ... Comparisons (a)–(g) ... Validation controls ... Reproducibility ... Reconciliation
82: ... population ... comparisons ... validation ... cost_latency ... reproducibility ... report_sha256 ... reconciliation
120: ... eligible population/shortfalls

$ git diff --check
(clean)

$ git status --porcelain tools/shadow-review-trial
 M tools/shadow-review-trial/README.md
 M tools/shadow-review-trial/cli.py
 M tools/shadow-review-trial/test_manifest.py
 M tools/shadow-review-trial/test_phase7.py
?? tools/shadow-review-trial/summary.py
?? tools/shadow-review-trial/test_summary.py
```

The rehearsal exercises the outcome through the CLI: `cli.py report` twice to
two output paths yields byte-identical JSON and summary files and an equal
printed `report_sha256`; `cli.py evidence-check` refuses a folder containing the
saved export (`SystemExit`) and passes a folder holding only the report JSON and
summary.

No network, provider call or live server was used; the only HTTP traffic is the
rehearsal's loopback fixture. Tests use repo-local temporary directories under
`tools/shadow-review-trial/test-fixtures/` (cleaned in teardown). No
`.trial-data/` content was read or committed.

## Deviations and contradictions

- Brief line 93 says `git status` should show "only this unit's five files", but
  the Owned paths on line 4 list six (the five code/test files plus
  `README.md`). The six owned paths are what changed; recorded, not silently
  resolved.
- Brief line 50 says the summary must never print a SHA, while line 42 and the
  Done evidence require printing `report_sha256` and the other hashes. Resolved
  by printing only the report's reproducibility hashes (`manifest_sha256`,
  `ledger_sha256`, `export_sha256`, `report_sha256`) and never a commit/case SHA
  or path.
- Brief line 69 says the report JSON has `comparisons` with "all a–g keys", but
  `report.py` places (a)-(f) in `comparisons` and (g) cost/latency in the
  top-level `cost_latency`. Resolved by rendering (g) from `cost_latency` and
  asserting `comparisons` a-f plus top-level `cost_latency` in the rehearsal.
- No non-trivial bug was found outside this unit's done evidence.
