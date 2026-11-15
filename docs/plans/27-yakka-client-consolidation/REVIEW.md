# Review — yakka client consolidation (design)

Verdict: **PASS_WITH_FOLLOWUPS**

Reviewed SHA: `7d61514e9c8ab772c3172c573b8a8d97b67c4e43` (PR #245).

Plan sufficiency: the design is enough to judge intent, phase outcomes, the 17-entry assumption ledger, inventory coverage, and downstream QA. Domains (entry point, commands, libs, spool, callers, measurement), baseline numbers, and per-phase observable checks are explicit and grounded in the tree at `5c92cd7` / current `master`.

## Phase outcomes (design acceptance)

| Phase | Assessment |
| --- | --- |
| 1 — Entry point and fast hook path | **met** (as design). Spool parity, Python-free dedupe, config rewires, `bin/` cleanup, hooklog duplicate removal, and latency gates are provably stated; transitional routing to `client/yakka.py` is explicit. |
| 2 — Libs foundation and leaf commands | **met** (as design). Module map, DAG rule, import-closure contracts, and enumeration tests are complete enough for `refine`. |
| 3 — Drain and MCP, `client/` deleted | **met** (as design). Behavioural parity checks, MCP spool via `bin/yakka spool`, layout tests, and deletion surface list align with current callers. |
| 4 — Callers, cloud, docs, version | **met** (as design). `test_surfaces` extension, `test_cloud_install.py`, OpenCode spawn contract, doc grep gate, and 3.5.0 bump are stated; cloud PATH live check is correctly gated on open question 2. |

## Intent and ledger

Verbatim intent and Cody's layout quote are preserved. Problem analysis matches code checked on this review: `yakka.py` is 3,775 lines; `bin/VERSION` is `0.3.0` while manifests read `3.4.12`; `spool.sh` uses `python3` for dedupe; `.cursor/environment.json` sets `YAKKA_BIN` to the plugin wrapper (self-exec hazard); inventory table matches `grep` across hooks, MCP configs, cloud-install, hooklog, OpenCode, and release tests. Assumptions 1–17 are actionable with stated "if wrong" paths.

## Findings

### Follow-up (not blocking design sign-off)

- **medium** — Open question 2 (Cursor cloud hook/MCP processes inheriting `~/.local/bin`) only has a documented fallback; phase 4's live verification may fail on first execute pass until environment behaviour is confirmed.
- **low** — Assumption 9 latency thresholds are calibrated on one Linux/Python 3.14 session; macOS and older Python baselines remain hypotheses (open question 5).
- **low** — `libs` package import layout (`scripts/` on `sys.path`, `libs.*` vs stdlib shadowing) is directionally correct but name-level closure lists are indicative until `refine` pins modules.
- **low** — Claude `bin/` PATH vs claude.ai/Cowork `bin/` restriction (open question 1) is recorded; no regression today but entrenches an existing constraint.

## Security lens

Removing `YAKKA_BIN` reduces override-to-alternate-client risk on agent machines. No new network surfaces in the design; hook path stays local queue I/O. Cloud bare-`yakka` configs assume PATH integrity—installer `verify_install` mitigates mis-install, not PATH injection by other tools.

## Residual risks

- Single-release, no-compat cutover (assumption 10) concentrates blast radius; inventory breadth is the main mitigation.
- Four-phase implementation branch must keep `cloud-install.sh` green between phases (called out in phase 1).
- Ordering with Go client deletion #178 may drop some Go test edits from scope; design handles either order.