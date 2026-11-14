"""Layout contract check: plugins/yakka → packages; packages → packages; tools → anything."""

from __future__ import annotations

import json
import os
import re
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = ROOT / "plugins" / "yakka"
PACKAGES = ROOT / "packages"
MARKETPLACES = (
    ROOT / ".cursor-plugin" / "marketplace.json",
    ROOT / ".claude-plugin" / "marketplace.json",
)

README_FIELDS = ("Consumers", "Build", "Test", "Release")
CLAUDE_PLUGIN_SOURCE = "./plugins/yakka"
CURSOR_PLUGIN_SOURCE = {
    "source": "git-subdir",
    "url": "https://github.com/codyhamilton/yakka",
    "path": "plugins/yakka",
    "ref": "master",
}

TOOLS_SLASH = re.compile(r"tools/")


@dataclass(frozen=True)
class Violation:
    file: str
    path: str


def _rel(path: Path, root: Path) -> str:
    return str(path.relative_to(root))


def _strip_c_comments(text: str) -> str:
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = j + 2 if j >= 0 else n
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def _is_test_or_config_exempt(rel: str) -> bool:
    name = Path(rel).name
    if "/tests/" in rel.replace("\\", "/") or rel.replace("\\", "/").startswith("tests/"):
        return True
    if name.endswith("_test.go") or name.startswith("test_") and name.endswith(".py"):
        return True
    if ".test." in name:
        return True
    if name.startswith("playwright") and name.endswith(".config.ts"):
        return True
    return False


def _is_package_scan_exempt(rel: str) -> bool:
    if rel.endswith(".md"):
        return True
    if _is_test_or_config_exempt(rel):
        return True
    return False


def _tools_path_hits(text: str) -> list[str]:
    hits: list[str] = []
    for m in TOOLS_SLASH.finditer(text):
        tail = text[m.start() : m.start() + 32]
        if tail.startswith("tools/list") or tail.startswith("tools/call"):
            continue
        hits.append(tail.split()[0].rstrip("'\",);]"))
    for m in re.finditer(r'["\']tools["\']\s*/', text):
        hits.append("tools/")
    return hits


def _scan_plugin_executed_paths(repo: Path) -> list[Violation]:
    out: list[Violation] = []
    targets: list[Path] = []
    hooks = repo / "plugins" / "yakka" / "hooks"
    if hooks.is_dir():
        targets.extend(hooks.glob("*.json"))
    for name in (".mcp.json", ".cursor-mcp.json", ".codex-mcp.json"):
        p = repo / "plugins" / "yakka" / name
        if p.is_file():
            targets.append(p)
    wf = repo / "plugins" / "yakka" / "bin" / "yakka"
    if wf.is_file():
        targets.append(wf)

    forbidden = ("/tools/", "tools/", "/.claude/", ".claude/")
    for path in targets:
        text = path.read_text(encoding="utf-8", errors="replace")
        rel = _rel(path, repo)
        for token in forbidden:
            if token in text:
                out.append(Violation(rel, token))
                break
    return out


def _scan_packages_tools_paths(repo: Path) -> list[Violation]:
    out: list[Violation] = []
    pkg_root = repo / "packages"
    if not pkg_root.is_dir():
        return out
    for path in pkg_root.rglob("*"):
        if not path.is_file():
            continue
        rel = _rel(path, repo)
        if _is_package_scan_exempt(rel):
            continue
        raw = path.read_text(encoding="utf-8", errors="replace")
        if path.suffix in {".go", ".ts", ".js", ".py"}:
            raw = _strip_c_comments(raw)
        for hit in _tools_path_hits(raw):
            out.append(Violation(rel, hit))
            break
    return out


def _scan_skills_claude_paths(repo: Path) -> list[Violation]:
    out: list[Violation] = []
    skills = repo / "plugins" / "yakka" / "skills"
    if not skills.is_dir():
        return out
    needle = ".claude/skills/"
    for path in skills.rglob("*"):
        if path.is_file() and needle in path.read_text(encoding="utf-8", errors="replace"):
            out.append(Violation(_rel(path, repo), needle))
    return out


def _scan_package_readmes(repo: Path) -> list[Violation]:
    out: list[Violation] = []
    pkg_root = repo / "packages"
    if not pkg_root.is_dir():
        return out
    for child in sorted(pkg_root.iterdir()):
        if not child.is_dir():
            continue
        readme = child / "README.md"
        if not readme.is_file():
            out.append(Violation(_rel(child, repo), "missing README.md"))
            continue
        text = readme.read_text(encoding="utf-8", errors="replace")
        for field in README_FIELDS:
            if f"**{field}**" not in text:
                out.append(Violation(_rel(readme, repo), f"missing **{field}**"))
                break
    return out


def _scan_marketplaces(repo: Path) -> list[Violation]:
    out: list[Violation] = []
    for mp in (
        repo / ".cursor-plugin" / "marketplace.json",
        repo / ".claude-plugin" / "marketplace.json",
    ):
        if not mp.is_file():
            out.append(Violation(_rel(mp, repo), "missing marketplace.json"))
            continue
        data = json.loads(mp.read_text(encoding="utf-8"))
        plugins = data.get("plugins") or []
        if len(plugins) != 1:
            out.append(Violation(_rel(mp, repo), f"plugins count {len(plugins)}"))
            continue
        src = plugins[0].get("source")
        expected = (
            CURSOR_PLUGIN_SOURCE
            if mp.parent.name == ".cursor-plugin"
            else CLAUDE_PLUGIN_SOURCE
        )
        if src != expected:
            out.append(Violation(_rel(mp, repo), f"source={src!r}"))
    return out


def _scan_cursor_hook_commands(repo: Path) -> list[Violation]:
    out: list[Violation] = []
    cursor = repo / "plugins" / "yakka" / "hooks" / "cursor.json"
    if not cursor.is_file():
        return out
    data = json.loads(cursor.read_text(encoding="utf-8"))
    hooks = data.get("hooks") or {}
    for _event, entries in hooks.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            cmd = entry.get("command")
            if not isinstance(cmd, str):
                continue
            bad = (
                not cmd.startswith("./script/")
                or ".." in cmd
                or "${CURSOR_PLUGIN_ROOT}" in cmd
                or cmd.startswith("/")
            )
            if bad:
                out.append(Violation(_rel(cursor, repo), cmd))
    return out


def scan_layout(repo: Path | None = None) -> list[Violation]:
    root = (repo or ROOT).resolve()
    violations: list[Violation] = []
    violations.extend(_scan_plugin_executed_paths(root))
    violations.extend(_scan_packages_tools_paths(root))
    violations.extend(_scan_skills_claude_paths(root))
    violations.extend(_scan_package_readmes(root))
    violations.extend(_scan_marketplaces(root))
    violations.extend(_scan_cursor_hook_commands(root))
    return violations


class LayoutCheckTests(unittest.TestCase):
    def test_repo_passes_layout_check(self) -> None:
        violations = scan_layout(ROOT)
        if violations:
            lines = [f"{v.file}: {v.path}" for v in violations]
            self.fail("layout violations:\n" + "\n".join(lines))

    def test_fixture_plugin_path_into_tools(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            hook = repo / "plugins" / "yakka" / "hooks"
            hook.mkdir(parents=True)
            (hook / "cursor.json").write_text(
                '{"hooks":{"sessionStart":[{"command":"./script/ok.sh"}]}}',
                encoding="utf-8",
            )
            (repo / "plugins" / "yakka" / "hooks" / "bad.json").write_text(
                '{"hooks":{"x":[{"command":"tools/driver/x.sh"}]}}',
                encoding="utf-8",
            )
            v = _scan_plugin_executed_paths(repo)
            self.assertEqual(len(v), 1)
            self.assertEqual(v[0].file, "plugins/yakka/hooks/bad.json")
            self.assertIn("tools/", v[0].path)

    def test_fixture_package_tools_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            pkg = repo / "packages" / "demo"
            pkg.mkdir(parents=True)
            (pkg / "run.py").write_text('ROOT = "tools/driver/x"\n', encoding="utf-8")
            v = _scan_packages_tools_paths(repo)
            self.assertEqual(len(v), 1)
            self.assertEqual(v[0].file, "packages/demo/run.py")
            self.assertTrue(v[0].path.startswith("tools/"))

    def test_fixture_skills_claude_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            skill = repo / "plugins" / "yakka" / "skills" / "x" / "SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text("see .claude/skills/foo\n", encoding="utf-8")
            v = _scan_skills_claude_paths(repo)
            self.assertEqual(len(v), 1)
            self.assertEqual(v[0].file, "plugins/yakka/skills/x/SKILL.md")
            self.assertEqual(v[0].path, ".claude/skills/")

    def test_fixture_missing_readme_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            (repo / "packages" / "orphan").mkdir(parents=True)
            v = _scan_package_readmes(repo)
            self.assertEqual(len(v), 1)
            self.assertEqual(v[0].file, "packages/orphan")
            self.assertIn("README", v[0].path)

    def test_fixture_marketplace_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            mp = repo / ".cursor-plugin"
            mp.mkdir(parents=True)
            (mp / "marketplace.json").write_text(
                '{"plugins":[{"source":"./"},{"source":"other"}]}',
                encoding="utf-8",
            )
            v = _scan_marketplaces(repo)
            self.assertTrue(any("marketplace.json" in x.file for x in v))

    def test_fixture_cursor_command_not_script_relative(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            cur = repo / "plugins" / "yakka" / "hooks" / "cursor.json"
            cur.parent.mkdir(parents=True)
            cur.write_text(
                '{"hooks":{"sessionStart":[{"command":"${CURSOR_PLUGIN_ROOT}/script/x.sh"}]}}',
                encoding="utf-8",
            )
            v = _scan_cursor_hook_commands(repo)
            self.assertEqual(len(v), 1)
            self.assertEqual(v[0].file, "plugins/yakka/hooks/cursor.json")
            self.assertIn("CURSOR_PLUGIN_ROOT", v[0].path)


if __name__ == "__main__":
    unittest.main()
