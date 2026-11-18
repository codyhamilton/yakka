#!/usr/bin/env python3
"""Check that unattended core skills are on disk for the detected harness.

No network. Exit 0 only when the six core skill directories each contain
SKILL.md at the install root install.sh would use for this harness.
Lab skills are not required.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
from pathlib import Path
from typing import Mapping

CORE_SKILLS: tuple[str, ...] = (
    "design",
    "refine",
    "execute",
    "comprehensive-review",
    "close-out",
    "post-build",
)

# Maintainer project skills at .claude/skills/. Unattended install must not copy these.
MAINTAINER_SKILLS: tuple[str, ...] = (
    "iterate",
    "jev-variants",
    "setup",
    "transcript-parser",
    "white-paper",
    "yakka-tuning",
)

WORKSPACE_SKILLS_NAME = "yakka"
HARNESS_CLAUDE = "claude-code"
HARNESS_CURSOR = "cursor-cloud"
HARNESS_INTERACTIVE = "interactive"


def hostname_from(env: Mapping[str, str]) -> str:
    """Match bash: exported HOSTNAME wins; otherwise the machine name.

    Bash sets HOSTNAME even when the variable is absent from the environment.
    An explicit empty value stays empty.
    """
    if "HOSTNAME" in env:
        return env.get("HOSTNAME") or ""
    try:
        return socket.gethostname()
    except OSError:
        return ""


def claude_code_signals(env: Mapping[str, str]) -> bool:
    if env.get("CLAUDECODE") == "1":
        return True
    if env.get("CLAUDE_CODE_ENTRYPOINT"):
        return True
    if env.get("CLAUDE_CODE_REMOTE") == "true":
        return True
    return False


def cursor_cloud_signals(env: Mapping[str, str], *, manifest_present: bool) -> bool:
    if env.get("CURSOR_AGENT") == "1":
        return True
    if hostname_from(env) == "cursor":
        return True
    return manifest_present


def detect_harness(
    env: Mapping[str, str],
    *,
    manifest_present: bool,
    can_prompt: bool,
) -> str:
    """Same precedence as install.sh resolve_install_route.

    ``can_prompt`` is install.sh ``can_prompt_interactively`` (stdin TTY or
    /dev/tty). This checker is not itself a piped installer; piped ``curl | bash``
    is decided inside install.sh. On Claude remote and Cursor cloud, stdin is
    not a TTY, which is the case this function is for.
    """
    mode = env.get("YAKKA_INSTALL_MODE") or ""
    if mode == "claude-code":
        return HARNESS_CLAUDE
    if mode == "cloud":
        return HARNESS_CURSOR
    if mode == "interactive":
        return HARNESS_INTERACTIVE
    if claude_code_signals(env):
        return HARNESS_CLAUDE
    if cursor_cloud_signals(env, manifest_present=manifest_present) or not can_prompt:
        return HARNESS_CURSOR
    return HARNESS_INTERACTIVE


def can_prompt_interactively(stdin_is_tty: bool | None = None) -> bool:
    if stdin_is_tty is None:
        stdin_is_tty = sys.stdin.isatty()
    if stdin_is_tty:
        return True
    try:
        fd = os.open("/dev/tty", os.O_RDONLY)
    except OSError:
        return False
    os.close(fd)
    return True


def manifest_path(home: Path) -> Path:
    return home / ".cursor" / "plugins" / "cache" / ".cloud-plugin-manifest.json"


def find_workspace_root(env: Mapping[str, str], *, cwd: Path | None = None) -> Path | None:
    override = env.get("YAKKA_WORKSPACE") or ""
    if override:
        path = Path(override).expanduser()
        if path.is_dir():
            return path.resolve()
        return None
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=str(cwd or Path.cwd()),
            check=True,
            capture_output=True,
            text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        out = None
    if out is not None:
        text = out.stdout.strip()
        if text:
            return Path(text)
    fallback = Path("/workspace")
    if (fallback / ".git").exists():
        return fallback
    return None


def skills_root_for(
    harness: str,
    *,
    home: Path,
    workspace: Path | None,
    skills_name: str = WORKSPACE_SKILLS_NAME,
    cursor_user: bool = False,
) -> Path | None:
    if harness == HARNESS_CLAUDE:
        return home / ".claude" / "skills"
    if harness == HARNESS_CURSOR:
        if cursor_user:
            return home / ".cursor" / "skills"
        if workspace is None:
            return None
        return workspace / ".cursor" / "skills" / skills_name
    return None


def scan_core_skills(root: Path | None) -> tuple[list[str], list[str]]:
    if root is None:
        return [], list(CORE_SKILLS)
    found: list[str] = []
    missing: list[str] = []
    for name in CORE_SKILLS:
        skill_md = root / name / "SKILL.md"
        if skill_md.is_file():
            found.append(name)
        else:
            missing.append(name)
    return found, missing


def build_report(
    *,
    harness: str,
    root: Path | None,
) -> dict[str, object]:
    found, missing = scan_core_skills(root)
    ok = harness in (HARNESS_CLAUDE, HARNESS_CURSOR) and root is not None and not missing
    return {
        "ok": ok,
        "harness": harness,
        "skills_found": found,
        "missing": missing,
        "skills_root": str(root) if root is not None else None,
    }


def home_from(env: Mapping[str, str]) -> Path:
    raw = env.get("HOME") or str(Path.home())
    return Path(raw).expanduser()


def report_for_env(
    env: Mapping[str, str],
    *,
    can_prompt: bool,
    cwd: Path | None = None,
    harness_override: str | None = None,
    cursor_user: bool = False,
) -> dict[str, object]:
    home = home_from(env)
    manifest_present = manifest_path(home).is_file()
    harness = harness_override or detect_harness(
        env,
        manifest_present=manifest_present,
        can_prompt=can_prompt,
    )
    workspace = find_workspace_root(env, cwd=cwd)
    skills_name = env.get("YAKKA_WORKSPACE_SKILLS_NAME") or WORKSPACE_SKILLS_NAME
    root = skills_root_for(
        harness,
        home=home,
        workspace=workspace,
        skills_name=skills_name,
        cursor_user=cursor_user,
    )
    return build_report(harness=harness, root=root)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Exit 0 when the six core skill directories exist at the unattended "
            "install location for the detected harness. No network."
        ),
    )
    parser.add_argument(
        "--workspace",
        type=Path,
        default=None,
        help="Repository root (default: YAKKA_WORKSPACE, git toplevel, or /workspace)",
    )
    parser.add_argument(
        "--home",
        type=Path,
        default=None,
        help="Home directory for ~/.claude/skills and the cloud plugin manifest",
    )
    parser.add_argument(
        "--harness",
        choices=[HARNESS_CLAUDE, HARNESS_CURSOR],
        default=None,
        help="Skip detection and check this harness's install root",
    )
    parser.add_argument(
        "--cursor-user",
        action="store_true",
        help="Check ~/.cursor/skills/<skill>/SKILL.md (user-level Cursor skills)",
    )
    args = parser.parse_args(argv)

    env = dict(os.environ)
    if args.home is not None:
        env["HOME"] = str(args.home)
    if args.workspace is not None:
        env["YAKKA_WORKSPACE"] = str(args.workspace)

    harness_override = args.harness
    if args.cursor_user and harness_override is None:
        harness_override = HARNESS_CURSOR
    report = report_for_env(
        env,
        can_prompt=can_prompt_interactively(),
        harness_override=harness_override,
        cursor_user=args.cursor_user,
    )
    json.dump(report, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
