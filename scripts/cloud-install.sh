#!/usr/bin/env bash
# Full user-level Yakka install for cloud environment builds (no plugin marketplace).
# Installs client under ~/.local/share/yakka/install and yakka on PATH, then
# merges harness config for --target cursor (default) or --target claude.
#
# Cursor: ~/.cursor/mcp.json, ~/.cursor/hooks.json, ~/.cursor/skills/<name>/.
# Claude: ~/.claude.json mcpServers, ~/.claude/settings.json hooks, ~/.claude/skills/<name>/.
#
# Same install tree for client, hooks, MCP and skills. Credentials come from the
# environment (YAKKA_KEY, optionally YAKKA_ENDPOINT); this script never prints,
# logs, or writes the key into MCP or hook config.
set -euo pipefail

DEFAULT_REPO_HTTPS_URL="https://github.com/codyhamilton/yakka"
INSTALL_BRANCH="${YAKKA_INSTALL_BRANCH:-master}"
PLUGIN_CACHE="${YAKKA_PLUGIN_CACHE:-$HOME/.cache/yakka/src}"
INSTALL_ROOT="${YAKKA_INSTALL_ROOT:-$HOME/.local/share/yakka/install}"
LOCAL_BIN="${YAKKA_LOCAL_BIN:-$HOME/.local/bin}"
TARGET="cursor"

usage() {
  cat <<'EOF'
Usage: cloud-install.sh [--target cursor|claude]

Full user-level Yakka install for cloud environment builds.

  --target cursor  Merge ~/.cursor/mcp.json, hooks.json, and skills (default)
  --target claude  Merge ~/.claude.json MCP, ~/.claude/settings.json hooks,
                   and ~/.claude/skills

The yakka key is read at runtime from the environment variable YAKKA_KEY.
It is never printed, logged, or copied into MCP/hook config. Set YAKKA_ENDPOINT
(https://api.yakka.build) as well so drain is not left with a partial override.

Examples:
  bash scripts/cloud-install.sh
  curl -fsSL https://raw.githubusercontent.com/codyhamilton/yakka/master/scripts/cloud-install.sh | bash -s -- --target claude
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --target=*)
      TARGET="${1#--target=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$TARGET" in
  cursor|claude) ;;
  *)
    echo "ERROR: --target must be cursor or claude (got: $TARGET)" >&2
    exit 1
    ;;
esac

_SCRIPT_SRC="${BASH_SOURCE[0]:-}"
if [[ -n "$_SCRIPT_SRC" && "$_SCRIPT_SRC" != "-" && -f "$_SCRIPT_SRC" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$_SCRIPT_SRC")" && pwd -P)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
else
  SCRIPT_DIR=""
  REPO_ROOT=""
fi

refresh_git_checkout() {
  local dir="$1"
  [[ -d "$dir/.git" ]] || return 0
  git -C "$dir" remote get-url origin &>/dev/null || return 0
  echo "  Updating $dir (origin/$INSTALL_BRANCH)" >&2
  if ! git -C "$dir" fetch --depth 1 origin "$INSTALL_BRANCH" &>/dev/null; then
    git -C "$dir" fetch origin "$INSTALL_BRANCH" >&2
  fi
  if git -C "$dir" show-ref --verify --quiet "refs/heads/$INSTALL_BRANCH"; then
    git -C "$dir" checkout "$INSTALL_BRANCH" >&2
    git -C "$dir" merge --ff-only "origin/$INSTALL_BRANCH" >&2
  else
    git -C "$dir" checkout -B "$INSTALL_BRANCH" "origin/$INSTALL_BRANCH" >&2
  fi
}

ensure_source_tree() {
  local url="${YAKKA_REPO_URL:-$DEFAULT_REPO_HTTPS_URL}"
  case "$url" in
    git@github.com:*) url="https://github.com/${url#git@github.com:}" ;;
    git@github.com:/*) url="https://github.com/${url#git@github.com:/}" ;;
  esac

  if [[ -n "$REPO_ROOT" && -d "$REPO_ROOT/plugins/yakka" ]]; then
    echo "$REPO_ROOT"
    return 0
  fi

  mkdir -p "$(dirname "$PLUGIN_CACHE")"
  if [[ -d "$PLUGIN_CACHE/.git" ]]; then
    refresh_git_checkout "$PLUGIN_CACHE"
  else
    [[ -e "$PLUGIN_CACHE" ]] && rm -rf "$PLUGIN_CACHE"
    echo "  Cloning yakka to $PLUGIN_CACHE" >&2
    git clone --depth 1 --branch "$INSTALL_BRANCH" "$url" "$PLUGIN_CACHE"
  fi
  echo "$PLUGIN_CACHE"
}

install_client_tree() {
  local src="$1/plugins/yakka"
  [[ -d "$src" ]] || { echo "ERROR: missing $src" >&2; exit 1; }
  mkdir -p "$(dirname "$INSTALL_ROOT")"
  rm -rf "$INSTALL_ROOT"
  mkdir -p "$INSTALL_ROOT"
  echo "  Installing client to $INSTALL_ROOT" >&2
  cp -a "$src"/. "$INSTALL_ROOT"/
  chmod +x "$INSTALL_ROOT/script/spool.sh" "$INSTALL_ROOT/bin/yakka" 2>/dev/null || true
}

install_path_shim() {
  mkdir -p "$LOCAL_BIN"
  local shim="$LOCAL_BIN/yakka"
  cat >"$shim" <<EOF
#!/usr/bin/env bash
export YAKKA_ROOT='$INSTALL_ROOT'
exec bash "\$YAKKA_ROOT/bin/yakka" "\$@"
EOF
  chmod +x "$shim"
  echo "  yakka shim: $shim" >&2
}

# Warn when env overrides would break drain, without printing values.
warn_partial_yakka_env() {
  local ep_set=0 key_set=0
  if [[ -n "${YAKKA_ENDPOINT:-}" && "${YAKKA_ENDPOINT}" != '${env:YAKKA_ENDPOINT}' ]]; then
    ep_set=1
  fi
  if [[ -n "${YAKKA_KEY:-}" && "${YAKKA_KEY}" != '${env:YAKKA_KEY}' ]]; then
    key_set=1
  fi
  if (( ep_set != key_set )); then
    echo "  WARNING: YAKKA_KEY and YAKKA_ENDPOINT must both be set or both unset." >&2
    echo "  MCP defaults a missing endpoint to https://api.yakka.build, but drain does not." >&2
    echo "  Set YAKKA_ENDPOINT=https://api.yakka.build in the environment." >&2
  fi
}

merge_user_configs() {
  local spool="$INSTALL_ROOT/script/spool.sh"
  local skills_src="$INSTALL_ROOT/skills"
  local hook_template mcp_dest hooks_dest user_skills hook_format

  if [[ "$TARGET" == "claude" ]]; then
    hook_template="$INSTALL_ROOT/hooks/hooks.json"
    mcp_dest="${YAKKA_CLAUDE_MCP:-$HOME/.claude.json}"
    hooks_dest="${YAKKA_CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
    user_skills="${YAKKA_USER_SKILLS:-$HOME/.claude/skills}"
    hook_format="claude"
    mkdir -p "$HOME/.claude" "$user_skills"
  else
    hook_template="$INSTALL_ROOT/hooks/cursor.json"
    mcp_dest="${YAKKA_CURSOR_MCP:-$HOME/.cursor/mcp.json}"
    hooks_dest="${YAKKA_CURSOR_HOOKS:-$HOME/.cursor/hooks.json}"
    user_skills="${YAKKA_USER_SKILLS:-$HOME/.cursor/skills}"
    hook_format="cursor"
    mkdir -p "$HOME/.cursor" "$user_skills"
  fi

  python3 - "$mcp_dest" "$hooks_dest" "$user_skills" "$INSTALL_ROOT" "$spool" "$hook_template" "$skills_src" "$hook_format" <<'PY'
import json
import os
import re
import shutil
import sys

(
    mcp_dest,
    hooks_dest,
    user_skills,
    install_root,
    spool,
    template,
    skills_src,
    hook_format,
) = sys.argv[1:9]
client = os.path.abspath(os.path.join(install_root, "client", "yakka.py"))
spool = os.path.abspath(spool)
skills_src = os.path.abspath(skills_src)
install_root = os.path.abspath(install_root)


def load_json(path, default):
    if not os.path.isfile(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def is_yakka_hook_cmd(cmd: str) -> bool:
    if not cmd:
        return False
    if spool in cmd:
        return True
    if "/.local/share/yakka/install/script/spool.sh" in cmd and "--harness" in cmd:
        return True
    if "script/spool.sh" in cmd and "--harness" in cmd:
        if "CLAUDE_PLUGIN_ROOT" in cmd or "PLUGIN_ROOT" in cmd:
            return True
        if "./script/spool.sh" in cmd:
            return True
    return False


def rewrite_cursor_cmd(cmd: str) -> str:
    if "./script/spool.sh" in cmd:
        return cmd.replace("./script/spool.sh", spool)
    return cmd


_CLAUDE_ROOT_RE = re.compile(
    r"\$\{CLAUDE_PLUGIN_ROOT:-\$PLUGIN_ROOT\}|\$\{CLAUDE_PLUGIN_ROOT\}|\$\{PLUGIN_ROOT\}"
)


def rewrite_claude_cmd(cmd: str) -> str:
    return _CLAUDE_ROOT_RE.sub(install_root, cmd)


# --- MCP (never write an env block; YAKKA_KEY stays in the process environment)
mcp = load_json(mcp_dest, {})
if not isinstance(mcp, dict):
    raise SystemExit(f"ERROR: {mcp_dest} is not a JSON object")
servers = mcp.setdefault("mcpServers", {})
if not isinstance(servers, dict):
    raise SystemExit(f"ERROR: mcpServers in {mcp_dest} is not a JSON object")
entry = {"command": "python3", "args": [client, "mcp"]}
if hook_format == "claude":
    entry["type"] = "stdio"
servers["yakka"] = entry
write_json(mcp_dest, mcp)
print(f"  MCP config merged (yakka): {mcp_dest}")

# --- Hooks
with open(template, encoding="utf-8") as f:
    yakka_hooks = json.load(f)

rewrite = rewrite_claude_cmd if hook_format == "claude" else rewrite_cursor_cmd
raw_events = yakka_hooks.get("hooks", {})
new_hooks = {}
for event, entries in raw_events.items():
    rewritten = []
    for entry in entries or []:
        if hook_format == "claude":
            inner = entry.get("hooks") or []
            new_inner = []
            for hook in inner:
                cmd = rewrite(hook.get("command", ""))
                hook = dict(hook)
                hook["command"] = cmd
                new_inner.append(hook)
            if new_inner:
                entry = dict(entry)
                entry["hooks"] = new_inner
                rewritten.append(entry)
        else:
            entry = dict(entry)
            entry["command"] = rewrite(entry.get("command", ""))
            rewritten.append(entry)
    if rewritten:
        new_hooks[event] = rewritten

default_hooks = {"hooks": {}}
if hook_format == "cursor":
    default_hooks["version"] = 1
merged = load_json(hooks_dest, default_hooks)
if not isinstance(merged, dict):
    raise SystemExit(f"ERROR: {hooks_dest} is not a JSON object")
if hook_format == "cursor" and "version" not in merged:
    merged["version"] = yakka_hooks.get("version", 1)
dest_hooks = merged.setdefault("hooks", {})
if not isinstance(dest_hooks, dict):
    raise SystemExit(f"ERROR: hooks in {hooks_dest} is not a JSON object")

for event, new_entries in new_hooks.items():
    old = dest_hooks.get(event, [])
    if not isinstance(old, list):
        old = []
    kept = []
    for entry in old:
        if hook_format == "claude":
            if not isinstance(entry, dict):
                kept.append(entry)
                continue
            inner = entry.get("hooks") or []
            kept_inner = [
                h
                for h in inner
                if not is_yakka_hook_cmd(h.get("command", "") if isinstance(h, dict) else "")
            ]
            if kept_inner:
                entry = dict(entry)
                entry["hooks"] = kept_inner
                kept.append(entry)
            elif not inner:
                # Preserve unrelated empty or unknown shapes that are not yakka.
                if not any(
                    is_yakka_hook_cmd(h.get("command", "") if isinstance(h, dict) else "")
                    for h in inner
                ):
                    kept.append(entry)
        else:
            cmd = entry.get("command", "") if isinstance(entry, dict) else ""
            if not is_yakka_hook_cmd(cmd):
                kept.append(entry)
    dest_hooks[event] = kept + new_entries
write_json(hooks_dest, merged)
print(f"  hooks config merged: {hooks_dest}")

# --- Skills
yakka_skill_names = []
if os.path.isdir(skills_src):
    for name in sorted(os.listdir(skills_src)):
        src = os.path.join(skills_src, name)
        if not os.path.isdir(src) or not os.path.isfile(os.path.join(src, "SKILL.md")):
            continue
        yakka_skill_names.append(name)
        dest = os.path.join(user_skills, name)
        if os.path.isdir(dest):
            shutil.rmtree(dest)
        shutil.copytree(src, dest)
        print(f"  skill installed: {dest}/SKILL.md")

# Drop stale yakka skills from prior installs (same name set only).
for name in yakka_skill_names:
    legacy = os.path.join(user_skills, "yakka", name)
    if os.path.isdir(legacy):
        shutil.rmtree(legacy)
legacy_parent = os.path.join(user_skills, "yakka")
if os.path.isdir(legacy_parent) and not os.listdir(legacy_parent):
    os.rmdir(legacy_parent)

marker = os.path.join(user_skills, ".yakka-managed-skills.json")
write_json(marker, {"install_root": install_root, "skills": yakka_skill_names})
print(f"  skills synced ({len(yakka_skill_names)}): {user_skills}")
PY
}

verify_install() {
  local errors=0
  command -v yakka >/dev/null 2>&1 || { echo "ERROR: yakka not on PATH" >&2; errors=$((errors + 1)); }
  [[ -x "$INSTALL_ROOT/script/spool.sh" ]] || { echo "ERROR: missing spool.sh" >&2; errors=$((errors + 1)); }
  [[ -f "$INSTALL_ROOT/client/yakka.py" ]] || { echo "ERROR: missing client" >&2; errors=$((errors + 1)); }
  (unset YAKKA_BIN; yakka version) >/dev/null 2>&1 || { echo "ERROR: yakka version failed" >&2; errors=$((errors + 1)); }
  if [[ "$TARGET" == "claude" ]]; then
    local settings="${YAKKA_CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
    local mcp="${YAKKA_CLAUDE_MCP:-$HOME/.claude.json}"
    local skills="${YAKKA_USER_SKILLS:-$HOME/.claude/skills}"
    [[ -f "$settings" ]] || { echo "ERROR: missing $settings" >&2; errors=$((errors + 1)); }
    [[ -f "$mcp" ]] || { echo "ERROR: missing $mcp" >&2; errors=$((errors + 1)); }
    [[ -f "$skills/design/SKILL.md" ]] || { echo "ERROR: missing Claude skills" >&2; errors=$((errors + 1)); }
  else
    [[ -f "$HOME/.cursor/mcp.json" ]] || { echo "ERROR: missing ~/.cursor/mcp.json" >&2; errors=$((errors + 1)); }
    [[ -f "$HOME/.cursor/hooks.json" ]] || { echo "ERROR: missing ~/.cursor/hooks.json" >&2; errors=$((errors + 1)); }
  fi
  return "$errors"
}

main() {
  local checkout
  checkout="$(ensure_source_tree)"
  install_client_tree "$checkout"
  install_path_shim

  export PATH="$LOCAL_BIN:$PATH"
  merge_user_configs
  warn_partial_yakka_env
  verify_install
  echo "  Cloud install complete (target=$TARGET install_root=$INSTALL_ROOT)" >&2
}

main "$@"
