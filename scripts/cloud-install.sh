#!/usr/bin/env bash
# Full user-level Yakka install for Cursor Cloud environment builds (no plugin).
# Installs client under ~/.local/share/yakka/install, yakka on PATH, merges
# ~/.cursor/mcp.json and ~/.cursor/hooks.json, and syncs ~/.cursor/skills/<name>/.
# Same install tree for client, hooks, MCP and skills. See cursor.com/docs/skills.
set -euo pipefail

DEFAULT_REPO_HTTPS_URL="https://github.com/codyhamilton/yakka"
INSTALL_BRANCH="${YAKKA_INSTALL_BRANCH:-master}"
PLUGIN_CACHE="${YAKKA_PLUGIN_CACHE:-$HOME/.cache/yakka/src}"
INSTALL_ROOT="${YAKKA_INSTALL_ROOT:-$HOME/.local/share/yakka/install}"
LOCAL_BIN="${YAKKA_LOCAL_BIN:-$HOME/.local/bin}"
USER_SKILLS="${YAKKA_USER_SKILLS:-$HOME/.cursor/skills}"

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

merge_user_cursor_configs() {
  local spool="$INSTALL_ROOT/script/spool.sh"
  local template="$INSTALL_ROOT/hooks/cursor.json"
  local skills_src="$INSTALL_ROOT/skills"
  local mcp_dest="$HOME/.cursor/mcp.json"
  local hooks_dest="$HOME/.cursor/hooks.json"
  mkdir -p "$HOME/.cursor" "$USER_SKILLS"
  python3 - "$mcp_dest" "$hooks_dest" "$USER_SKILLS" "$INSTALL_ROOT" "$spool" "$template" "$skills_src" <<'PY'
import json
import os
import shutil
import sys

mcp_dest, hooks_dest, user_skills, install_root, spool, template, skills_src = sys.argv[1:8]
client = os.path.abspath(os.path.join(install_root, "client", "yakka.py"))
spool = os.path.abspath(spool)
skills_src = os.path.abspath(skills_src)

def load_json(path, default):
    if not os.path.isfile(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

def is_yakka_hook_cmd(cmd: str) -> bool:
    if not cmd:
        return False
    if spool in cmd:
        return True
    if "/.local/share/yakka/install/script/spool.sh" in cmd and "--harness cursor" in cmd:
        return True
    return False

mcp = load_json(mcp_dest, {})
servers = mcp.setdefault("mcpServers", {})
servers["yakka"] = {"command": "python3", "args": [client, "mcp"]}
write_json(mcp_dest, mcp)
print(f"  MCP config merged (yakka): {mcp_dest}")

with open(template, encoding="utf-8") as f:
    yakka_hooks = json.load(f)
for entries in yakka_hooks.get("hooks", {}).values():
    for entry in entries:
        cmd = entry.get("command", "")
        if "./script/spool.sh" in cmd:
            entry["command"] = cmd.replace("./script/spool.sh", spool)

merged = load_json(hooks_dest, {"version": 1, "hooks": {}})
if "version" not in merged:
    merged["version"] = yakka_hooks.get("version", 1)
dest_hooks = merged.setdefault("hooks", {})
for event, new_entries in yakka_hooks.get("hooks", {}).items():
    old = dest_hooks.get(event, [])
    kept = [e for e in old if not is_yakka_hook_cmd(e.get("command", ""))]
    dest_hooks[event] = kept + new_entries
write_json(hooks_dest, merged)
print(f"  hooks config merged: {hooks_dest}")

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
  return "$errors"
}

main() {
  local checkout
  checkout="$(ensure_source_tree)"
  install_client_tree "$checkout"
  install_path_shim

  export PATH="$LOCAL_BIN:$PATH"
  merge_user_cursor_configs
  verify_install
  echo "  Cloud install complete (install_root=$INSTALL_ROOT)" >&2
}

main "$@"