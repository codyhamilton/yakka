#!/usr/bin/env python3
"""Residual legacy workflow names in tracked files (stdlib only)."""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

PHASE5_PREFIXES = (
    "packages/yakka/",
    "packages/hooklog/",
    "packages/yakka-analytics/",
    "packages/opencode-yakka-hooks/",
    "plugins/yakka/bin/",
    "plugins/yakka/hooks/",
    "plugins/yakka/script/",
    "tools/release/",
)

PHASE5_FILES = (
    "plugins/yakka/.mcp.json",
    "plugins/yakka/.cursor-mcp.json",
    "plugins/yakka/.codex-mcp.json",
)

PHASE6_PREFIXES = (
    "plugins/yakka/skills/",
    ".claude/skills/",
    "tools/",
)

PHASE6_FILES = (
    "install.sh",
    ".gitignore",
    "plugins/yakka/.claude-plugin/plugin.json",
    "plugins/yakka/.cursor-plugin/plugin.json",
    "plugins/yakka/.codex-plugin/plugin.json",
    ".cursor-plugin/marketplace.json",
    ".claude-plugin/marketplace.json",
)

GLOBAL_SKIP_PREFIXES = (
    "docs/plans/",
    "docs/lab/",
    "docs/analysis/",
    "evals/results/",
    "tools/quality/",
)

TRAILER_EXCEPTION_PREFIXES = (
    "tools/driver/",
    "evals/scenarios/trailer-completeness/",
)

DATE_SECTION = re.compile(r"^#{1,6}\s+.*\d{4}-\d{2}-\d{2}")
RENAME_CHANGELOG_HEADING = re.compile(r"^##\s+.*\brename\b", re.I | re.M)


def _w() -> str:
    return "work" + "flow"


def _wf_prefix() -> str:
    return "W" + "ORK" + "FLOW_"


def _patterns() -> list[tuple[str, re.Pattern[str]]]:
    w = _w()
    wf = _wf_prefix()
    return [
        (wf + "(?!QUALITY_)", re.compile(wf + r"(?!QUALITY_)")),
        (r"\bbin/" + w + r"\b", re.compile(r"\bbin/" + w + r"\b")),
        (r"\bcmd/" + w + r"\b", re.compile(r"\bcmd/" + w + r"\b")),
        (r"\bpackages/" + w + r"\b", re.compile(r"\bpackages/" + w + r"\b")),
        (
            r"\b" + w + r"-(plugin|analytics|tuning|lab|signals|quality-placeholder)\b",
            re.compile(r"\b" + w + r"-(?:plugin|analytics|tuning|lab|signals|quality-placeholder)\b"),
        ),
        (r"\bopencode-" + w + r"-hooks\b", re.compile(r"\bopencode-" + w + r"-hooks\b")),
        ("Workflow" + "SignalsPlugin", re.compile("Workflow" + "SignalsPlugin")),
        (r"\b" + w + r"-(darwin|linux)-", re.compile(r"\b" + w + r"-(?:darwin|linux)-")),
        (
            w + " (version|<version>) at --version",
            re.compile(r"^" + w + r" (?:version|\S+)"),
        ),
        (
            r"\b" + w + r":(design|refine|execute|close-out|comprehensive-review|post-build|plan|setup)\b",
            re.compile(
                r"\b"
                + w
                + r":(?:design|refine|execute|close-out|comprehensive-review|post-build|plan|setup)\b"
            ),
        ),
        (
            r"(.local/(share|state)|.config|.cache)/" + w,
            re.compile(r"(?:\.local/(?:share|state)|\.config|\.cache)/" + w + r"\b"),
        ),
        (
            r".cursor/(plugins/local|skills)/" + w,
            re.compile(r"\.cursor/(?:plugins/local|skills)/" + w + r"\b"),
        ),
        ('"' + w + '"\\s*: in JSON', re.compile(r'"' + w + r'"\s*:')),
        (r"\[mcp_servers\." + w + r"\]", re.compile(r"\[mcp_servers\." + w + r"\]")),
        ("mcp__plugin_" + w + "_", re.compile("mcp__plugin_" + w + "_")),
        ("Work" + "flow-(Phase|Plan)", re.compile("Work" + "flow-(?:Phase|Plan)\b")),
        (w + "-report", re.compile(w + r"-report\b")),
    ]


def _trailer_patterns() -> tuple[re.Pattern[str], ...]:
    w = _w()
    return (
        re.compile("Work" + "flow-(?:Phase|Plan)\b"),
        re.compile(w + r"-report\b"),
    )


PATTERNS = _patterns()
TRAILER_PATTERNS = _trailer_patterns()
TRAILER_PATTERN_TEXTS = frozenset(p.pattern for p in TRAILER_PATTERNS)


def git_ls_files() -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(ROOT), "ls-files", "-z"],
        check=True,
        capture_output=True,
    )
    return [p.decode() for p in out.stdout.split(b"\0") if p]


def rename_changelog_cutoff() -> bool:
    try:
        text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    except OSError:
        return False
    return bool(re.search(r"(?m)^##\s+.*\brename\b", text, re.I))


def in_phase5_scope(rel: str) -> bool:
    if rel in PHASE5_FILES:
        return True
    return any(rel.startswith(p) for p in PHASE5_PREFIXES)


def in_phase6_scope(rel: str) -> bool:
    if rel in PHASE6_FILES:
        return True
    return any(rel.startswith(p) for p in PHASE6_PREFIXES)


def globally_excluded(rel: str) -> bool:
    if any(rel.startswith(p) for p in GLOBAL_SKIP_PREFIXES):
        return True
    return False


def changelog_sections_to_skip(text: str) -> list[tuple[int, int]]:
    if not text:
        return []
    match = RENAME_CHANGELOG_HEADING.search(text)
    if not match:
        return []
    return [(match.start(), len(text))]


def design_sections_to_skip(text: str) -> list[tuple[int, int]]:
    if not text:
        return []
    lines = text.splitlines(keepends=True)
    spans: list[tuple[int, int]] = []
    i = 0
    while i < len(lines):
        if DATE_SECTION.match(lines[i]):
            start = sum(len(lines[j]) for j in range(i))
            j = i + 1
            while j < len(lines) and not (lines[j].startswith("#") and DATE_SECTION.match(lines[j])):
                j += 1
            end = sum(len(lines[k]) for k in range(j))
            spans.append((start, end))
            i = j
        else:
            i += 1
    return spans


def offset_in_spans(offset: int, spans: list[tuple[int, int]]) -> bool:
    return any(start <= offset < end for start, end in spans)


def is_reading_skill_legacy_line(line: str) -> bool:
    w = _w()
    low = line.lower()
    wf = "Work" + "flow-"
    if "legacy" not in low and (w + "-") not in line and wf not in line:
        return False
    return bool(
        re.search(
            wf + "Phase|" + wf + "Plan|"
            + w
            + r"-report|Yakka-Phase|Yakka-Plan|yakka-report",
            line,
        )
    )


def trailer_exception(rel: str, line: str) -> bool:
    if any(rel.startswith(p) for p in TRAILER_EXCEPTION_PREFIXES):
        return True
    if rel.startswith("plugins/yakka/skills/") and is_reading_skill_legacy_line(line):
        return True
    if rel.startswith("packages/yakka/") and rel.endswith("_test.go"):
        return True
    return False


def scan_file(rel: str, raw: bytes) -> list[tuple[int, str]]:
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return []
    design_spans = (
        design_sections_to_skip(text) if rel.startswith("docs/design/") and rel.endswith(".md") else []
    )
    changelog_spans = (
        changelog_sections_to_skip(text) if rel == "CHANGELOG.md" and rename_changelog_cutoff() else []
    )
    skip_spans = design_spans + changelog_spans
    hits: list[tuple[int, str]] = []
    w = _w()
    offset = 0
    for lineno, line in enumerate(text.splitlines(keepends=True), 1):
        if skip_spans and offset_in_spans(offset, skip_spans):
            offset += len(line)
            continue
        line_body = line.rstrip("\r\n")
        json_only = rel.endswith(".json")
        for label, pat in PATTERNS:
            if label.endswith(": in JSON") and not json_only:
                continue
            if pat.search(line_body):
                if pat.pattern in TRAILER_PATTERN_TEXTS and trailer_exception(rel, line_body):
                    continue
                hits.append((lineno, label))
                break
        offset += len(line)
    return hits


def files_for_scope(scope: str) -> list[str]:
    all_files = git_ls_files()
    if scope == "phase5":
        return sorted(f for f in all_files if in_phase5_scope(f) and not globally_excluded(f))
    if scope == "phase6":
        return sorted(f for f in all_files if in_phase6_scope(f) and not globally_excluded(f))
    if scope == "all":
        return sorted(f for f in all_files if not globally_excluded(f))
    raise SystemExit("unknown scope: %s" % scope)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scope", choices=("phase5", "phase6", "all"), default="phase5")
    args = ap.parse_args()
    failures: list[str] = []
    for rel in files_for_scope(args.scope):
        path = ROOT / rel
        if not path.is_file():
            continue
        for lineno, label in scan_file(rel, path.read_bytes()):
            failures.append("%s:%d:%s" % (rel, lineno, label))
    for line in sorted(failures):
        print(line)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
