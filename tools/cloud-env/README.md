# Cloud Agent environment bootstrap

## Full install (recommended)

Yakka is **not** installed as a marketplace plugin in cloud. Use
[`scripts/cloud-install.sh`](../../scripts/cloud-install.sh) from the repo's
[`.cursor/environment.json`](../../.cursor/environment.json), or curl it as the
environment start/setup command. Pass `--target claude` for Claude Code cloud
environments (`claude --cloud`). The default `--target cursor` keeps the
existing Cursor behaviour.

The script installs in one tree (`~/.local/share/yakka/install`):

| What | Cursor (`--target cursor`, default) | Claude (`--target claude`) |
|------|-------------------------------------|----------------------------|
| CLI / drain client | `~/.local/bin/yakka` → install copy | same |
| MCP (no `env` block) | merged into `~/.cursor/mcp.json`, server `yakka` | merged into `~/.claude.json` `mcpServers.yakka` |
| Hooks | merged into `~/.cursor/hooks.json` | merged into `~/.claude/settings.json` |
| Skills | `~/.cursor/skills/<name>/SKILL.md` | `~/.claude/skills/<name>/SKILL.md` |

Reruns refresh yakka skills and replace yakka hook commands without duplicating them or touching unrelated user skills. The yakka API key is read at runtime from `YAKKA_KEY` (set this name in the environment). Also set `YAKKA_ENDPOINT=https://api.yakka.build` so drain is not left with a partial override. The script never prints, logs, or copies the key into MCP or hook config.

Verify with:

```bash
# Cursor
python3 tools/driver/check_skills.py --cursor-user

# Claude
python3 tools/driver/check_skills.py --harness claude-code
```

Claude Code cloud start command (paste into the environment start/setup field):

```bash
export PATH="$HOME/.local/bin:$PATH" && curl -fsSL https://raw.githubusercontent.com/codyhamilton/yakka/master/scripts/cloud-install.sh | bash -s -- --target claude
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
| `YAKKA_USER_SKILLS` | `~/.cursor/skills` or `~/.claude/skills` | User skill sync root (depends on `--target`) |
| `YAKKA_BIN` | — | Drain kick target (`install/bin/yakka`) |
| `YAKKA_PLUGIN_CACHE` | `~/.cache/yakka/src` | Git checkout when not running from a repo |
| `YAKKA_REPO_URL` / `YAKKA_INSTALL_BRANCH` | GitHub `master` | Source pin |
| `YAKKA_KEY` | — | Yakka API key (runtime env; not written to config) |
| `YAKKA_ENDPOINT` | — | Collector origin; set to `https://api.yakka.build` with `YAKKA_KEY` |

More context: [`docs/lab/CONSUMING_REPO.md`](../../docs/lab/CONSUMING_REPO.md).