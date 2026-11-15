# Cloud Agent environment bootstrap

Cursor Cloud Agents discover **project** skills under `.cursor/skills/` when the agent process starts. Marketplace plugin installs under `~/.cursor/plugins/` are not enough on cloud VMs — core yakka skills must be copied into the consuming repo workspace.

## Script

[`bootstrap-yakka-skills.sh`](bootstrap-yakka-skills.sh):

1. Clones or updates `https://github.com/codyhamilton/yakka` on **`master`** in a cache directory (default `~/.cache/yakka/src`) via `git fetch` and `git reset --hard origin/master`.
2. Runs `install.sh` with `YAKKA_INSTALL_MODE=cloud`, syncing the six core skills into `<workspace>/.cursor/skills/yakka/`.
3. Is idempotent and non-interactive — safe on every environment setup run.

Legacy alias: [`docs/lab/bootstrap/cursor-cloud-setup.sh`](../../docs/lab/bootstrap/cursor-cloud-setup.sh) execs this script.

## Cloud install (hooks, CLI)

For hook capture in Cursor Cloud Agents (where plugin hooks do not run), use
[`scripts/cloud-install.sh`](../../scripts/cloud-install.sh). It installs the client under
`~/.local/share/yakka/install`, adds `yakka` to `~/.local/bin`, and writes workspace
`.cursor/hooks.json` with absolute paths to the installed spool script at environment build time.
MCP is not registered by this script (use the Cursor plugin).

The yakka repo commits [`.cursor/environment.json`](../../.cursor/environment.json) that chains
`cloud-install.sh` with the skills bootstrap below.

## Commit `.cursor/environment.json` (recommended)

Product repos should commit [`.cursor/environment.json`](https://cursor.com/docs/cloud-agent/environments) so Cursor **environment builds** run yakka bootstrap before any agent starts. A committed file takes **precedence** over the same `install` string configured only in the Cursor dashboard.

Copy [`environment.json.example`](environment.json.example) to `.cursor/environment.json` in the consuming repo (or merge its `install` into an existing `install` command — run bootstrap and `check_skills.py` in the same shell chain):

```json
{
  "install": "export YAKKA_WORKSPACE=\"${YAKKA_WORKSPACE:-$(pwd)}\" && curl -fsSL https://raw.githubusercontent.com/codyhamilton/yakka/master/tools/cloud-env/bootstrap-yakka-skills.sh | bash && python3 \"$HOME/.cache/yakka/src/tools/driver/check_skills.py\""
}
```

On each **environment build** (including scheduled **daily rebuilds**), Cursor runs `install`, clones or updates yakka **master** in `~/.cache/yakka/src`, syncs core skills into `<workspace>/.cursor/skills/yakka/`, then verifies with `check_skills.py` (exit `0` when all six core skills are present). Skills are on disk before the agent process starts — no first-turn install gap.

Add `<repo>/.cursor/skills/yakka/` to `.gitignore`.

## Dashboard or shell fallback

If the repo has no committed `.cursor/environment.json`, set the environment **install** command in the Cursor dashboard (field name may vary):

```bash
export YAKKA_WORKSPACE="${YAKKA_WORKSPACE:-/workspace}"
bash -lc 'curl -fsSL https://raw.githubusercontent.com/codyhamilton/yakka/master/tools/cloud-env/bootstrap-yakka-skills.sh | bash'
```

If yakka is already vendored or cloned in the image:

```bash
export YAKKA_WORKSPACE="$(git rev-parse --show-toplevel)"
bash /path/to/yakka/tools/cloud-env/bootstrap-yakka-skills.sh
```

After setup (no network required):

```bash
python3 /path/to/yakka/tools/driver/check_skills.py
```

Unattended cloud bootstrap installs **core only**. Maintainer skills under `.claude/skills/` are not copied into the consuming repo. Legacy install-lab environment settings are not read (backward compatibility).

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `YAKKA_WORKSPACE` | git root or `/workspace` | Consuming repository |
| `YAKKA_PLUGIN_CACHE` | `~/.cache/yakka/src` | Git checkout cache |
| `YAKKA_REPO_URL` | yakka GitHub URL | Fork or mirror |
| `YAKKA_INSTALL_BRANCH` | `master` | Tracked branch |
| `YAKKA_INSTALL_SH` | — | Skip fetch; run alternate installer (tests) |

More context: [`docs/lab/CONSUMING_REPO.md`](../../docs/lab/CONSUMING_REPO.md).
