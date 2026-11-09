# tools

Direction: **`plugins/yakka` → packages. Packages → packages. Tools → anything.** Maintainer and automation code lives here; runtime in the plugin and packages must not resolve into `tools/` (enforced by `tools/release/test_layout.py`).

| Directory | Purpose |
|-----------|---------|
| `cloud-env` | Cloud bootstrap of core skills |
| `driver` | Phase closure primitives |
| `interception` | TypeSafe lever and window-status joins |
| `jev-variants` | Variant-search registry |
| `quality` | Legacy quality service; catalogue lives in `packages/yakka` |
| `release` | Four-platform binary build |
| `shadow-review-trial` | Full-history manifest, approval-gated trial run, certified export/report |
| `transcript` | Session cost metrics |
