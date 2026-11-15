#!/usr/bin/env bash
# User-level Yakka install for Cursor Cloud Agent environment builds.
# Installs the plugin client under ~/.local/share/yakka/install, puts `yakka` on PATH,
# and writes workspace `.cursor/hooks.json` with absolute paths to the installed spool script.
# MCP is not configured here (expected from the Cursor plugin).
#
# Consuming repos: curl -fsSL …/scripts/cloud-install.sh | bash
# Or commit .cursor/environment.json with the same curl, or call this script from a checkout.
set -euo pipefail

DEFAULT_REPO_HTTPS_URL="https://github.com/codyhamilton/yakka"
INSTALL_BRANCH="${YAKKA_INSTALL_BRANCH:-master}"
PLUGIN_CACHE="${YAKKA_PLUGIN_CACHE:-$HOME/.cache/yakka/src}"
INSTALL_ROOT="${YAKKA_INSTALL_ROOT:-$HOME/.local/share/yakka/install}"
LOCAL_BIN="${YAKKA_LOCAL_BIN:-$HOME/.local/bin}"

_SCRIPT_SRC="${BASH_SOURCE[0]:-}"
if [[ -n "$_SCRIPT_SRC" && "$_SCRIPT_SRC" != "-" && -f "$_SCRIPT_SRC" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "$_SCRIPT_SRC")" && pwd -P)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
else
  SCRIPT_DIR=""
  REPO_ROOT=""
fi

find_workspace_root() {
  if [[ -n "${YAKKA_WORKSPACE:-}" ]]; then
    cd "$YAKKA_WORKSPACE" && pwd -P
    return 0
  fi
  if git rev-parse --show-toplevel &>/dev/null; then
    git rev-parse --show-toplevel
    return 0
  fi
  if [[ -d /workspace/.git ]]; then
    echo /workspace
    return 0
  fi
  return 1
}

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
export YAKKA_BIN='$shim'
exec bash "\$YAKKA_ROOT/bin/yakka" "\$@"
EOF
  chmod +x "$shim"
  echo "  yakka shim: $shim" >&2
}

write_hooks_json() {
  local dest="$1"
  local spool="$INSTALL_ROOT/script/spool.sh"
  local template="$INSTALL_ROOT/hooks/cursor.json"
  mkdir -p "$(dirname "$dest")"
  python3 - "$dest" "$spool" "$template" <<'PY'
import json, sys
dest, spool, template = sys.argv[1:4]
with open(template, encoding="utf-8") as f:
    hooks = json.load(f)
for entries in hooks.get("hooks", {}).values():
    for entry in entries:
        cmd = entry.get("command", "")
        if "./script/spool.sh" in cmd:
            entry["command"] = cmd.replace("./script/spool.sh", spool)
with open(dest, "w", encoding="utf-8") as f:
    json.dump(hooks, f, indent=2)
    f.write("\n")
print(f"  hooks config: {dest}")
PY
}

verify_install() {
  local errors=0
  command -v yakka >/dev/null 2>&1 || { echo "ERROR: yakka not on PATH" >&2; errors=$((errors + 1)); }
  [[ -x "$INSTALL_ROOT/script/spool.sh" ]] || { echo "ERROR: missing spool.sh" >&2; errors=$((errors + 1)); }
  [[ -f "$INSTALL_ROOT/client/yakka.py" ]] || { echo "ERROR: missing client" >&2; errors=$((errors + 1)); }
  yakka version >/dev/null 2>&1 || { echo "ERROR: yakka version failed" >&2; errors=$((errors + 1)); }
  return "$errors"
}

main() {
  local checkout workspace
  checkout="$(ensure_source_tree)"
  install_client_tree "$checkout"
  install_path_shim

  export PATH="$LOCAL_BIN:$PATH"

  workspace="$(find_workspace_root)" || {
    echo "ERROR: YAKKA_WORKSPACE or git root required for workspace hooks" >&2
    exit 1
  }
  write_hooks_json "$workspace/.cursor/hooks.json"

  verify_install
  echo "  Cloud install complete (install_root=$INSTALL_ROOT)" >&2
}

main "$@"