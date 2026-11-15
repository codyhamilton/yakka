# Cloud Agent environment bootstrap

## Full install (recommended)

Yakka is **not** installed as a Cursor plugin in cloud. Use
[`scripts/cloud-install.sh`](../../scripts/cloud-install.sh) from the repo's
[`.cursor/environment.json`](../../.cursor/environment.json) (or curl it at build time).

The script installs in one tree (`~/.local/share/yakka/install`):

| What | Where |
|------|--------|
| CLI / drain client | `~/.local/bin/yakka` → install copy |
| MCP (no `env` block) | merged into `~/.cursor/mcp.json`, server `yakka` |
| Hooks | merged into `~/.cursor/hooks.json` |
| Skills | `~/.cursor/skills/<name>/SKILL.md` ([Cursor Agent Skills](https://cursor.com/docs/skills)) |

Reruns refresh yakka skills and replace yakka hook commands without duplicating them or touching unrelated user skills. Verify with:

```bash
python3 tools/driver/check_skills.py --cursor-user
```

Delete any stale **account-level** Yakka MCP in the Cursor dashboard that still references `${CLAUDE_PLUGIN_ROOT}`.

## Legacy workspace skills bootstrap

[`bootstrap-yakka-skills.sh`](bootstrap-yakka-skills.sh) still copies skills into `<workspace>/.cursor/skills/yakka/` for repos that have not switched to the user-level installer. Prefer `cloud-install.sh` for new setups.

## Commit `.cursor/environment.json`

Product repos should commit [`.cursor/environment.json`](https://cursor.com/docs/cloud-agent/environments) so environment builds run install before agents start.

Yakka's committed install:

```json
{
  "install": "export PATH=\"$HOME/.local/bin:$PATH\" && export YAKKA_BIN=\"$HOME/.local/share/yakka/install/bin/yakka\" && bash scripts/cloud-install.sh && python3 tools/driver/check_skills.py --cursor-user"
}
```

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `YAKKA_INSTALL_ROOT` | `~/.local/share/yakka/install` | Installed plugin tree |
| `YAKKA_USER_SKILLS` | `~/.cursor/skills` | User skill sync root |
| `YAKKA_BIN` | — | Drain kick target (`install/bin/yakka`) |
| `YAKKA_PLUGIN_CACHE` | `~/.cache/yakka/src` | Git checkout when not running from a repo |
| `YAKKA_REPO_URL` / `YAKKA_INSTALL_BRANCH` | GitHub `master` | Source pin |

More context: [`docs/lab/CONSUMING_REPO.md`](../../docs/lab/CONSUMING_REPO.md).