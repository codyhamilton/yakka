"""Deterministic synthetic workflow histories for manifest fixtures.

The builder writes a plan folder with ``DESIGN.md``, ``REVIEW.md`` and
``IMPLEMENTATION.md``, commits phases carrying the workflow trailers, adds unit
handoff reports under ``reports/``, a squash-merge PR marker and later commits.
Commit timestamps and identities are fixed, so the same call produces the same
SHAs. Fixtures must pass a repository-local directory (never ``/tmp``).
"""
from __future__ import annotations

import os
import pathlib
import subprocess

_IDENTITY = {
    "GIT_AUTHOR_NAME": "Fixture",
    "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
    "GIT_COMMITTER_NAME": "Fixture",
    "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
}


def _git(repo: pathlib.Path, *args: str, env: dict[str, str] | None = None) -> str:
    merged = dict(os.environ)
    merged.update(_IDENTITY)
    if env:
        merged.update(env)
    result = subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, env=merged)
    return result.stdout.decode("utf-8", "replace").strip()


def _commit(repo: pathlib.Path, index: int, message: str) -> str:
    stamp = f"2000-01-01T00:{index:02d}:00+0000"
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", message, env={"GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp})
    return _git(repo, "rev-parse", "HEAD")


def _write(path: pathlib.Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def build_history(root: pathlib.Path, *, plan: str = "docs/plans/demo", phases: int = 2,
                  pr_number: int = 23, remote: pathlib.Path | None = None) -> dict:
    """Build the fixture repository at ``root`` and return its commit map."""
    root = pathlib.Path(root)
    root.mkdir(parents=True, exist_ok=True)
    _git(root, "init", "-q")
    _git(root, "config", "user.email", "fixture@example.invalid")
    _git(root, "config", "user.name", "Fixture")
    plan_root = root / plan
    _write(root / "code.py", "value = 0\n")
    _write(plan_root / "DESIGN.md", "# Fixture criteria\nReview the changed value.\n")
    _write(plan_root / "IMPLEMENTATION.md", "# Verification\n")
    _write(plan_root / "REVIEW.md", "# Historical review\n")
    base = _commit(root, 0, "base")
    phase_heads: list[str] = []
    unit_heads: list[str] = []
    index = 1
    for number in range(1, phases + 1):
        _write(root / "code.py", f"value = {number}\n")
        phase_heads.append(_commit(root, index, f"phase {number}\n\nWorkflow-Plan: {plan}\nWorkflow-Phase: {plan}:{number}"))
        index += 1
        _write(plan_root / "reports" / f"unit-{number}-1.md", f"# Unit handoff {number}\n")
        _write(root / "code.py", f"value = {number}.5\n")
        unit_heads.append(_commit(root, index, f"land unit {number}.1"))
        index += 1
    _write(root / "code.py", "value = 'pr'\n")
    pr_head = _commit(root, index, f"squash PR\n\nWorkflow-Plan: {plan}\nPull-Request: {pr_number}")
    index += 1
    _write(root / "code.py", "value = 'later'\n")
    later_head = _commit(root, index, "later change")
    if remote is not None:
        remote = pathlib.Path(remote)
        remote.parent.mkdir(parents=True, exist_ok=True)
        _git(remote.parent, "init", "--bare", "-q", str(remote))
        _git(remote, "symbolic-ref", "HEAD", "refs/heads/main")
        _git(root, "remote", "add", "origin", str(remote))
        _git(root, "push", "-q", "origin", "HEAD:refs/heads/main")
        _git(root, "fetch", "-q", "origin")
    return {"base": base, "phase_heads": phase_heads, "unit_heads": unit_heads,
            "pr_head": pr_head, "later_head": later_head, "head": _git(root, "rev-parse", "HEAD"),
            "pr_number": pr_number, "plan": plan, "remote": str(remote) if remote else None}
