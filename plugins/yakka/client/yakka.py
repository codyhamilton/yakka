#!/usr/bin/env python3
"""Yakka plugin client: config, keys, secrets, and command dispatch (stdlib only)."""

from __future__ import annotations

import argparse
import calendar
import fcntl
import fnmatch
import difflib
import hashlib
import http.client
import ipaddress
import json
import os
import random
import re
import shutil
import socket
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from queue import Empty, Queue
from typing import Any, Callable, List, Optional, Tuple

# --- clientconfig ---

LocalEndpoint = "http://127.0.0.1:8770"

_ENV_ENDPOINT = "YAKKA_ENDPOINT"
_ENV_KEY = "YAKKA_KEY"


class ErrPartialEnv(Exception):
    def __init__(self) -> None:
        super().__init__(
            "clientconfig: YAKKA_ENDPOINT and YAKKA_KEY must both be set or both unset"
        )


class Config:
    def __init__(self, Endpoint: str = "", Key: str = "", Local: bool = False) -> None:
        self.Endpoint = Endpoint
        self.Key = Key
        self.Local = Local

    def Mode(self) -> str:
        return "local" if self.Local else "remote"


_line_re = re.compile(
    r'^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$'
)


def _home() -> str:
    return os.environ.get("HOME", "") or os.path.expanduser("~")


def Path() -> str:
    p = os.environ.get("YAKKA_CLIENT_CONFIG", "")
    if p:
        return p
    return os.path.join(_home(), ".config", "yakka", "client.toml")


def SyncPath() -> str:
    """Where `yakka login --sync` stores the migration credential; the Go `yakka sync` reads it."""
    p = os.environ.get("YAKKA_SYNC_CONFIG", "")
    if p:
        return p
    return os.path.join(_home(), ".config", "yakka", "sync.toml")


def Load() -> Config:
    ep = os.environ.get(_ENV_ENDPOINT, "").strip()
    key = os.environ.get(_ENV_KEY, "").strip()
    ep_set = ep != ""
    key_set = key != ""
    if ep_set and key_set:
        return Config(Endpoint=ep, Key=key)
    if ep_set or key_set:
        raise ErrPartialEnv()
    path = Path()
    try:
        with open(path, encoding="utf-8") as f:
            data = f.read()
    except FileNotFoundError:
        return Config(Endpoint=LocalEndpoint, Local=True)
    except OSError as err:
        raise OSError(f"clientconfig: read {path}: {err}") from err
    return _parse_config(path, data)


def _parse_config(path: str, text: str) -> Config:
    vals: dict[str, str] = {}
    for i, line in enumerate(text.split("\n")):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = _line_re.match(line)
        if not m:
            raise ValueError(
                f'clientconfig: {path}: line {i + 1} is not a `name = "string"` line'
            )
        try:
            v = json.loads(m.group(2))
        except json.JSONDecodeError:
            raise ValueError(
                f"clientconfig: {path}: line {i + 1} has an invalid string"
            ) from None
        vals[m.group(1)] = v
    cfg = Config(Endpoint=vals.get("endpoint", ""), Key=vals.get("key", ""))
    if not cfg.Endpoint:
        raise ValueError(f"clientconfig: {path}: missing endpoint")
    if not cfg.Key:
        raise ValueError(f"clientconfig: {path}: missing key")
    return cfg


# --- keys ---


class _Number:
    __slots__ = ("s",)

    def __init__(self, s: str) -> None:
        self.s = s


def ContentHash(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _serialize_json_value(v: Any) -> str:
    if isinstance(v, dict):
        keys = sorted(v.keys())
        inner = ",".join(
            json.dumps(k, ensure_ascii=False) + ":" + _serialize_json_value(v[k])
            for k in keys
        )
        return "{" + inner + "}"
    if isinstance(v, list):
        return "[" + ",".join(_serialize_json_value(x) for x in v) + "]"
    if isinstance(v, _Number):
        return v.s
    if v is True:
        return "true"
    if v is False:
        return "false"
    if v is None:
        return "null"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    raise TypeError(f"keys: unsupported JSON value type {type(v)}")


def Canonical(raw: bytes) -> bytes:
    text = raw.decode("utf-8")
    dec = json.JSONDecoder(parse_float=lambda s: _Number(s))
    try:
        obj, end = dec.raw_decode(text)
    except json.JSONDecodeError as err:
        raise ValueError(f"keys: not a JSON object: {err}") from err
    if text[end:].strip():
        raise ValueError("keys: trailing data after JSON object")
    if obj is None:
        raise ValueError("keys: not a JSON object: null")
    if not isinstance(obj, dict):
        raise ValueError(f"keys: not a JSON object: {type(obj).__name__}")
    obj = dict(obj)
    obj.pop("id", None)
    obj.pop("content", None)
    return _serialize_json_value(obj).encode("utf-8")


def RowHash(raw: bytes) -> Tuple[str, Optional[BaseException]]:
    try:
        c = Canonical(raw)
    except (ValueError, TypeError) as err:
        return "", err
    return ContentHash(c), None


_scheme_re = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*://")


def NormalizeRemote(url: str) -> str:
    u = url.strip()
    loc = _scheme_re.match(u)
    if loc:
        u = u[loc.end() :]
    else:
        i = u.find(":")
        if i > 0 and "/" not in u[:i]:
            u = u[:i] + "/" + u[i + 1 :]
    end = u.find("/")
    if end < 0:
        end = len(u)
    authority = u[:end]
    at = authority.rfind("@")
    if at >= 0:
        u = u[at + 1 :]
        end -= at + 1
    u = u[:end].lower() + u[end:]
    u = u.rstrip("/")
    if u.endswith(".git"):
        u = u[: -len(".git")]
    return u.rstrip("/")


def _git(dir_path: str, *args: str) -> str:
    cmd = ["git", "-C", dir_path, *args]
    try:
        out = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as err:
        stderr = (err.stderr or "").strip()
        raise RuntimeError(
            f"git {' '.join(args)}: {err}: {stderr}"
        ) from err
    return out.stdout.strip()


def RepoID(dir_path: str) -> Tuple[str, Optional[Exception]]:
    try:
        out = _git(dir_path, "remote")
    except RuntimeError as err:
        return "", err
    remotes = out.split()
    if remotes:
        remotes.sort()
        name = remotes[0]
        for r in remotes:
            if r == "origin":
                name = r
        try:
            u = _git(dir_path, "remote", "get-url", name)
        except RuntimeError as err:
            return "", err
        return NormalizeRemote(u), None
    try:
        out = _git(dir_path, "rev-list", "--max-parents=0", "HEAD")
    except RuntimeError as err:
        return "", err
    roots = out.split()
    if not roots:
        return "", ValueError("keys: repository has no remote and no commits")
    roots.sort()
    return "root:" + roots[0], None


def RepoPath(file: str) -> Tuple[str, str, bool, Optional[Exception]]:
    try:
        abs_path = os.path.abspath(file)
        dir_path = os.path.realpath(os.path.dirname(abs_path))
    except OSError as err:
        return "", "", False, err
    if not shutil.which("git"):
        return "", "", False, FileNotFoundError("git not found")
    try:
        top = _git(dir_path, "rev-parse", "--show-toplevel")
    except RuntimeError:
        return "", "", False, None
    try:
        top = os.path.realpath(top)
    except OSError as err:
        return "", "", False, err
    full = os.path.join(dir_path, os.path.basename(abs_path))
    try:
        full = os.path.realpath(full)
    except OSError:
        pass
    try:
        rel = os.path.relpath(full, top)
    except ValueError:
        return "", "", False, None
    if rel == ".." or rel.startswith(".." + os.sep):
        return "", "", False, None
    return top, rel.replace(os.sep, "/"), True, None


_kind_rules = [
    (re.compile(r"^docs/plans/[^/]+/DESIGN\.md$"), "design"),
    (re.compile(r"^docs/plans/[^/]+/briefs/[^/]+\.md$"), "brief"),
    (re.compile(r"^docs/plans/[^/]+/reports/[^/]+\.md$"), "report"),
]


def Kind(rel: str) -> str:
    rel = rel.replace("\\", "/")
    rel = os.path.normpath(rel).replace("\\", "/")
    if rel == ".":
        rel = ""
    if rel.startswith("./"):
        rel = rel[2:]
    for pattern, kind in _kind_rules:
        if pattern.match(rel):
            return kind
    return ""


# --- secrets ---


class Hit:
    def __init__(self, Pattern: str, Line: int) -> None:
        self.Pattern = Pattern
        self.Line = Line

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Hit):
            return NotImplemented
        return self.Pattern == other.Pattern and self.Line == other.Line

    def __repr__(self) -> str:
        return f"Hit(Pattern={self.Pattern!r}, Line={self.Line})"


def _placeholder(v: str, length_rule: bool) -> bool:
    if length_rule and len(v) < 8:
        return True
    for p in ("$", "<", "{", "`", "…", "...", "*"):
        if v.startswith(p):
            return True
    if _x_run.match(v) or v.lower().startswith("xxxx"):
        return True
    if v.lower() in ("password", "pass", "pwd", "secret", "changeme"):
        return True
    return False


def _secret_like(v: str) -> bool:
    return len(v) >= 16 and any(c in v for c in "0123456789")


_x_run = re.compile(r"^[xX*.\-_]{3,}$", re.ASCII)

# ASCII word edges. Python's \b is Unicode, so a token glued to a
# non-ASCII letter would miss the scrubber and be uploaded.
_LB = r"(?<![A-Za-z0-9_])"
_RB = r"(?![A-Za-z0-9_])"

_patterns: List[Tuple[str, re.Pattern[str], int, Optional[Callable[[str], bool]]]] = [
    (
        "private_key_block",
        re.compile(
            r"-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)?"
        ),
        0,
        None,
    ),
    ("sk_key", re.compile(_LB + r"sk-[A-Za-z0-9_\-]{16,}"), 0, None),
    ("github_token", re.compile(_LB + r"gh[pousr]_[A-Za-z0-9]{20,}"), 0, None),
    ("github_pat", re.compile(_LB + r"github_pat_[A-Za-z0-9_]{20,}"), 0, None),
    ("aws_access_key", re.compile(_LB + r"AKIA[0-9A-Z]{16}" + _RB), 0, None),
    ("slack_token", re.compile(_LB + r"xox[abprs]-[A-Za-z0-9\-]{10,}"), 0, None),
    ("google_api_key", re.compile(_LB + r"AIza[0-9A-Za-z_\-]{35}"), 0, None),
    ("stripe_key", re.compile(_LB + r"[sr]k_live_[0-9A-Za-z]{16,}"), 0, None),
    ("workflow_api_token", re.compile(_LB + r"wk_[A-Za-z0-9_-]{32,}"), 0, None),
    (
        "jwt",
        re.compile(
            _LB + r"eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"
        ),
        0,
        None,
    ),
    (
        "bearer_token",
        re.compile("(?i)" + _LB + r"bearer[ \t]+[A-Za-z0-9._~+/\-]{20,}=*"),
        0,
        None,
    ),
    (
        "connection_string",
        re.compile(_LB + r"[A-Za-z][A-Za-z0-9+.\-]*://[^\s:/@]+:([^\s@/]+)@[^\s/]+"),
        1,
        lambda v: not _placeholder(v, False),
    ),
    (
        "env_assignment",
        re.compile(
            r"(?m)(?:^|[ \t\"'`(])(?:export[ \t]+)?[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[ \t]*=[ \t]*[\"']?([^\s\"']+)"
        ),
        1,
        lambda v: not _placeholder(v, True),
    ),
    (
        "env_assignment",
        re.compile(
            r"(?mi)(?:^[ \t]*(?:-[ \t]+)?|[\"'])[A-Za-z0-9_\-]*(?:KEY|SECRET|TOKEN|PASSWORD)[\"']?[ \t]*:[ \t]*[\"']?([^\s\"',]+)"
        ),
        1,
        lambda v: not _placeholder(v, True) and _secret_like(v),
    ),
]
# RE2 \b and \s are ASCII. Python's default \b is Unicode, so a token after
# a non-ASCII letter would be posted instead of scrubbed.
_patterns = [
    (name, re.compile(pat.pattern, re.ASCII), group, ok)
    for name, pat, group, ok in _patterns
]


class _Match:
    __slots__ = ("name", "start", "end")

    def __init__(self, name: str, start: int, end: int) -> None:
        self.name = name
        self.start = start
        self.end = end


def _matches(text: str) -> List[_Match]:
    all_m: List[_Match] = []
    for name, pattern, group, ok in _patterns:
        for m in pattern.finditer(text):
            if ok is not None and group:
                v = m.group(group)
                if v is None or not ok(v):
                    continue
            all_m.append(_Match(name, m.start(), m.end()))
    all_m.sort(key=lambda x: (x.start, -(x.end - x.start)))
    out: List[_Match] = []
    for m in all_m:
        if out and m.start < out[-1].end:
            continue
        out.append(m)
    return out


def Scan(text: str) -> List[Hit]:
    hits: List[Hit] = []
    for m in _matches(text):
        line = 1 + text[: m.start].count("\n")
        hits.append(Hit(m.name, line))
    return hits


def Redact(text: str) -> str:
    parts: List[str] = []
    last = 0
    for m in _matches(text):
        parts.append(text[last : m.start])
        parts.append(f"[REDACTED:{m.name}]")
        last = m.end
    parts.append(text[last:])
    return "".join(parts)


def Patterns() -> List[str]:
    names: List[str] = []
    for name, _, _, _ in _patterns:
        if not names or names[-1] != name:
            names.append(name)
    return names


# --- local change capture (kept independent of MCP registration) ---

class CaptureError(ValueError):
    """A structured refusal to capture a local change."""

    def __init__(self, code: str, argument: str = "") -> None:
        self.code = code
        self.argument = argument
        super().__init__(code + (":" + argument if argument else ""))


_CAPTURE_EXCLUDED = (
    re.compile(r"(^|/)(vendor|node_modules|third_party|dist|build|coverage)(/|$)"),
    re.compile(r"(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum)$"),
    re.compile(r"\.(min\.js|min\.css|map|png|jpe?g|gif|webp|ico|pdf|zip|gz|wasm)$", re.I),
    re.compile(r"(^|/)(snapshots?|__snapshots__)(/|$)"),
)
_CAPTURE_CLASSES = ("code", "tests", "config", "docs")


def _capture_class(path: str) -> str:
    if path.startswith("docs/") or path.lower().endswith((".md", ".rst", ".txt")):
        return "docs"
    if re.search(r"(^|/)(test|tests|__tests__)(/|$)|(^|/)test_[^/]+$", path):
        return "tests"
    if path.lower().endswith((".json", ".yaml", ".yml", ".toml", ".ini", ".cfg")):
        return "config"
    return "code"


def _capture_policy(policy: Optional[dict[str, Any]]) -> dict[str, Any]:
    if policy is not None and not isinstance(policy, dict):
        raise CaptureError("bad_argument", "policy")
    p = dict(policy or {})
    out = {
        "exclude": tuple(p.get("exclude", ())),
        "max_file_bytes": p.get("max_file_bytes", 256 * 1024),
        "max_total_bytes": p.get("max_total_bytes", 2 * 1024 * 1024),
        "max_files": p.get("max_files", 200),
        "context_lines": p.get("context_lines", 3),
    }
    for key in ("max_file_bytes", "max_total_bytes", "max_files", "context_lines"):
        if type(out[key]) is not int or out[key] < (0 if key == "context_lines" else 1):
            raise CaptureError("bad_argument", key)
    if not isinstance(out["exclude"], (list, tuple)) or any(not isinstance(x, str) for x in out["exclude"]):
        raise CaptureError("bad_argument", "exclude")
    return out


def _capture_env() -> dict[str, str]:
    env = {k: os.environ[k] for k in ("PATH", "HOME", "LANG", "LC_ALL") if os.environ.get(k)}
    env.update({"GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0", "GIT_PAGER": "cat"})
    return env


def _capture_git(root: str, *args: str, input_bytes: Optional[bytes] = None, limit: int = 8 * 1024 * 1024,
                 filter_names: Tuple[str, ...] = ()) -> bytes:
    # All callers below use a fixed verb/flag table. Agent values occupy only
    # validated ref operands or NUL-delimited literal pathspec stdin.
    cmd = ["git", "-c", "core.fsmonitor=false"]
    for name in filter_names:
        if re.fullmatch(r"[A-Za-z0-9_.-]+", name):
            cmd.extend(("-c", f"filter.{name}.clean="))
    cmd.extend(("-C", root, *args))
    try:
        p = subprocess.run(cmd, input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=10, env=_capture_env(), shell=False)
    except FileNotFoundError as exc:
        raise CaptureError("git_unavailable") from exc
    except subprocess.TimeoutExpired as exc:
        raise CaptureError("git_unavailable") from exc
    if len(p.stdout) > limit:
        raise CaptureError("over_budget")
    if p.returncode:
        raise CaptureError("not_a_repository")
    return p.stdout


def _capture_state(root: str, filter_names: Tuple[str, ...] = ()) -> tuple[str, bytes]:
    head = _capture_git(root, "rev-parse", "--verify", "HEAD^{commit}").decode().strip()
    status = _capture_git(root, "status", "--porcelain=v2", "-z", "--untracked-files=all", limit=1024 * 1024,
                          filter_names=filter_names)
    return head, status


def _capture_ref(root: str, value: Any, name: str) -> str:
    if not isinstance(value, str) or not value or value.startswith("-") or any(ord(c) < 32 or c.isspace() for c in value):
        raise CaptureError("bad_ref", name)
    try:
        return _capture_git(root, "rev-parse", "--verify", "--end-of-options", value + "^{commit}").decode().strip()
    except CaptureError as exc:
        if exc.code == "not_a_repository":
            raise CaptureError("bad_ref", name) from exc
        raise


def _capture_paths(root: str, mode: str, view: str, base: Optional[str], head: Optional[str], merge_base: bool,
                   filter_names: Tuple[str, ...] = ()) -> list[str]:
    if mode == "range":
        assert base is not None and head is not None
        left = _capture_ref(root, base, "base")
        right = _capture_ref(root, head, "head")
        if merge_base:
            left = _capture_git(root, "merge-base", left, right).decode().strip()
        raw = _capture_git(root, "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--name-only", "-z", left, right,
                           filter_names=filter_names)
    else:
        args = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--name-only", "-z"]
        if view == "staged":
            args.insert(1, "--cached")
        raw = _capture_git(root, *args, filter_names=filter_names)
        if view == "combined":
            staged = _capture_git(root, "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--cached", "--name-only", "-z",
                                  filter_names=filter_names)
            raw += staged
    return sorted({x.decode("utf-8", "surrogateescape") for x in raw.split(b"\0") if x})


def _capture_blob(root: str, path: str, mode: str, view: str, base: Optional[str], head: Optional[str]) -> bytes:
    # For range and staged views content comes from Git objects/index. Combined
    # view uses the working tree bytes, opened without following symlinks.
    if mode == "range":
        assert head is not None and base is not None
        try:
            return _capture_git(root, "show", head + ":" + path)
        except CaptureError:
            return _capture_git(root, "show", base + ":" + path)
    if mode == "uncommitted" and view == "staged":
        try:
            return _capture_git(root, "show", ":0:" + path)
        except CaptureError:
            return _capture_git(root, "show", "HEAD:" + path)
    full = os.path.join(root, path)
    try:
        st = os.lstat(full)
    except FileNotFoundError:
        return _capture_git(root, "show", "HEAD:" + path)
    if not stat.S_ISREG(st.st_mode):
        raise CaptureError("unsafe_file")
    fd = os.open(full, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    try:
        current = os.fstat(fd)
        if not stat.S_ISREG(current.st_mode) or (st.st_dev, st.st_ino) != (current.st_dev, current.st_ino):
            raise CaptureError("unsafe_file")
        with os.fdopen(fd, "rb") as f:
            return f.read()
    except BaseException:
        os.close(fd)
        raise


def _capture_diff(root: str, path: str, mode: str, view: str, base: Optional[str], head: Optional[str], context: int,
                  filter_names: Tuple[str, ...] = ()) -> bytes:
    args = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", f"--unified={context}"]
    if mode == "range":
        assert base is not None and head is not None
        args.extend((base, head))
    elif view == "staged":
        args.append("--cached")
    else:
        args.append("HEAD")
    args.extend(("--", ":(literal)" + path))
    return _capture_git(root, *args, filter_names=filter_names)


def _capture_has_filter(root: str, path: str) -> bool:
    raw = _capture_git(root, "check-attr", "-z", "filter", "--", path)
    fields = raw.split(b"\0")
    return len(fields) >= 3 and fields[-2] not in (b"unspecified", b"unset", b"")


def _capture_is_symlink(root: str, path: str, mode: str, view: str, head: Optional[str]) -> bool:
    if mode == "range":
        assert head is not None
        raw = _capture_git(root, "ls-tree", "-z", head, "--", ":(literal)" + path)
        return raw.startswith(b"120000 ")
    if view == "staged":
        raw = _capture_git(root, "ls-files", "--stage", "-z", "--", ":(literal)" + path)
        return raw.startswith(b"120000 ")
    try:
        return stat.S_ISLNK(os.lstat(os.path.join(root, path)).st_mode)
    except FileNotFoundError:
        return False


def _capture_filter_names(root: str) -> Tuple[str, ...]:
    tracked = _capture_git(root, "ls-files", "-z").split(b"\0")
    names = set()
    for raw_path in tracked:
        if not raw_path:
            continue
        raw = _capture_git(root, "check-attr", "-z", "filter", "--", raw_path.decode("utf-8", "surrogateescape"))
        fields = raw.split(b"\0")
        if len(fields) >= 3 and fields[-2] not in (b"unspecified", b"unset", b"") and fields[-2] != b"set":
            name = fields[-2].decode("ascii", "ignore")
            if re.fullmatch(r"[A-Za-z0-9_.-]+", name):
                names.add(name)
    return tuple(sorted(names))


def _capture_change_once(project_dir: Optional[str], mode: str = "uncommitted", view: str = "combined",
                  include_untracked: bool = False, base: Optional[str] = None, head: Optional[str] = None,
                  merge_base: bool = False, repo_id: Optional[str] = None,
                  policy: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Capture a bounded local Git change. Does not consult environment config or MCP."""
    if not isinstance(project_dir, str) or not project_dir or not os.path.isdir(project_dir):
        raise CaptureError("no_project_dir")
    if mode not in ("uncommitted", "range"):
        raise CaptureError("bad_argument", "mode")
    if view not in ("combined", "staged") or (mode == "range" and view != "combined"):
        raise CaptureError("bad_argument", "view")
    if type(include_untracked) is not bool or type(merge_base) is not bool:
        raise CaptureError("bad_argument", "boolean")
    p = _capture_policy(policy)
    try:
        root = _capture_git(os.path.realpath(project_dir), "rev-parse", "--show-toplevel").decode().strip()
    except CaptureError as exc:
        if exc.code == "not_a_repository":
            raise CaptureError("not_a_repository") from exc
        raise
    root = os.path.realpath(root)
    filter_names = _capture_filter_names(root)
    head_before, status_before = _capture_state(root, filter_names)
    remotes = _capture_git(root, "remote").decode().splitlines()
    remote = "origin" if "origin" in remotes else (sorted(remotes)[0] if remotes else "")
    if remote:
        url = _capture_git(root, "remote", "get-url", remote).decode().strip()
        captured_repo_id = NormalizeRemote(url)
    else:
        roots = _capture_git(root, "rev-list", "--max-parents=0", "HEAD").decode().splitlines()
        captured_repo_id = sorted(roots)[0] if roots else ""
    if repo_id is not None and repo_id != captured_repo_id:
        raise CaptureError("wrong_checkout")
    git_dir = os.path.realpath(_capture_git(root, "rev-parse", "--absolute-git-dir").decode().strip())
    linked = os.path.dirname(git_dir) != root and os.path.basename(git_dir) != ".git"
    branch_raw = _capture_git(root, "branch", "--show-current").decode().strip()
    branch = branch_raw or "detached"
    if mode == "range":
        if base is None or head is None:
            raise CaptureError("bad_argument", "base/head")
        resolved_base = _capture_ref(root, base, "base")
        resolved_head = _capture_ref(root, head, "head")
        if merge_base:
            resolved_base = _capture_git(root, "merge-base", resolved_base, resolved_head).decode().strip()
    else:
        resolved_base = resolved_head = None
    paths = _capture_paths(root, mode, view, base, head, merge_base, filter_names)
    manifest: list[dict[str, Any]] = []
    included: list[tuple[str, bytes]] = []
    untracked_raw = _capture_git(root, "ls-files", "--others", "--exclude-standard", "-z") if mode == "uncommitted" else b""
    untracked = [x.decode("utf-8", "surrogateescape") for x in untracked_raw.split(b"\0") if x]
    ignored_raw = _capture_git(root, "ls-files", "--others", "--ignored", "--exclude-standard", "-z") if mode == "uncommitted" else b""
    ignored = [x.decode("utf-8", "surrogateescape") for x in ignored_raw.split(b"\0") if x]
    if mode == "uncommitted" and view == "combined":
        # Staged paths are present in HEAD-to-index but not always in worktree diff.
        paths = sorted(set(paths) | set(x.decode("utf-8", "surrogateescape") for x in _capture_git(root, "diff", "--cached", "--name-only", "-z").split(b"\0") if x))
    if mode == "uncommitted" and include_untracked:
        paths = sorted(set(paths) | set(untracked))
    elif untracked:
        for path in untracked:
            manifest.append({"path": path, "reason": "untracked_not_included", "added": 0, "removed": 0, "blob_sha256": None})
    for path in ignored:
        manifest.append({"path": path, "reason": "ignored", "added": 0, "removed": 0, "blob_sha256": None})
    for path in paths:
        if path.startswith("docs/"):
            excluded = False
        else:
            excluded = any(rx.search(path) for rx in _CAPTURE_EXCLUDED) or any(fnmatch.fnmatchcase(path, x) for x in p["exclude"])
        is_untracked = path in untracked
        if not is_untracked and _capture_is_symlink(root, path, mode, view, resolved_head):
            manifest.append({"path": path, "reason": "symlink", "added": 0, "removed": 0, "blob_sha256": None})
            continue
        if mode == "uncommitted" and view != "staged" and _capture_has_filter(root, path):
            manifest.append({"path": path, "reason": "filter_driver", "added": 0, "removed": 0, "blob_sha256": None})
            continue
        try:
            if is_untracked:
                full = os.path.join(root, path)
                st = os.lstat(full)
                if stat.S_ISLNK(st.st_mode):
                    raise CaptureError("symlink")
                if not stat.S_ISREG(st.st_mode):
                    raise CaptureError("not_regular")
                content = _capture_blob(root, path, "uncommitted", "combined", None, None)
                lines = content.decode("utf-8", "replace").splitlines(keepends=True)
                patch_lines = list(difflib.unified_diff([], lines, fromfile="/dev/null", tofile="b/" + path))
                if len(patch_lines) >= 2:
                    patch_lines[0] = "--- /dev/null\n"
                    patch_lines[1] = "+++ b/" + path + "\n"
                diff = ("diff --git a/" + path + " b/" + path + "\nnew file mode 100644\n" + "".join(patch_lines)).encode()
            else:
                diff = _capture_diff(root, path, mode, view, resolved_base, resolved_head, p["context_lines"], filter_names)
                content = _capture_blob(root, path, mode, view, resolved_base, resolved_head)
        except CaptureError as exc:
            manifest.append({"path": path, "reason": exc.code, "added": 0, "removed": 0, "blob_sha256": None})
            continue
        except (OSError, UnicodeError):
            manifest.append({"path": path, "reason": "unsafe_file", "added": 0, "removed": 0, "blob_sha256": None})
            continue
        try:
            text = diff.decode("utf-8", "strict")
            content.decode("utf-8", "strict")
        except UnicodeError:
            text = diff.decode("utf-8", "replace")
        added = sum(1 for l in text.splitlines() if l.startswith("+") and not l.startswith("+++"))
        removed = sum(1 for l in text.splitlines() if l.startswith("-") and not l.startswith("---"))
        blob_hash = hashlib.sha256(content).hexdigest()
        reason = "excluded" if excluded else ""
        if not reason and len(content) > p["max_file_bytes"]:
            reason = "file_cap"
        try:
            diff.decode("utf-8", "strict")
            content.decode("utf-8", "strict")
        except UnicodeError:
            reason = reason or "encoding"
        hits = Scan(text + "\n" + content.decode("utf-8", "replace"))
        if hits:
            reason = "secret"
        if reason:
            entry = {"path": path, "reason": reason, "added": added, "removed": removed, "blob_sha256": blob_hash}
            if hits:
                entry.update({"pattern": hits[0].Pattern, "line": hits[0].Line})
            manifest.append(entry)
            continue
        included.append((path, diff))
    included.sort(key=lambda pair: (_CAPTURE_CLASSES.index(_capture_class(pair[0])), pair[0]))
    selected: list[tuple[str, bytes]] = []
    total = 0
    for path, diff in included:
        if len(selected) >= p["max_files"] or total + len(diff) > p["max_total_bytes"]:
            manifest.append({"path": path, "reason": "truncated_budget", "added": 0, "removed": 0,
                             "blob_sha256": hashlib.sha256(_capture_blob(root, path, mode, view, resolved_base, resolved_head)).hexdigest()})
        else:
            selected.append((path, diff)); total += len(diff)
    head_after, status_after = _capture_state(root, filter_names)
    if head_before != head_after or status_before != status_after:
        raise CaptureError("changed_during_capture")
    diff_bytes = b"".join(diff for _, diff in selected)
    counts = {"staged": 0, "unstaged": 0, "untracked": len(untracked)}
    for line in status_before.decode("utf-8", "replace").split("\0"):
        if line.startswith("1 ") or line.startswith("2 "):
            xy = line.split(" ", 2)[1]
            counts["staged"] += xy[0] != "."
            counts["unstaged"] += xy[1] != "."
    changed_locks = sorted(x["path"] for x in manifest if x["path"].endswith(("package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "go.sum")))
    return {"repo_id": captured_repo_id, "linked_worktree": linked, "branch": branch, "head": head_before,
            "dirty_counts": counts, "mode": mode, "view": view, "include_untracked": include_untracked,
            "base": resolved_base, "requested_base": base, "resolved_head": resolved_head, "requested_head": head,
            "merge_base": merge_base, "diff": diff_bytes.decode("utf-8", "replace"),
            "diff_sha256": hashlib.sha256(diff_bytes).hexdigest(), "manifest": manifest,
            "manifest_summary": {"changed_lockfiles": changed_locks},
            "complete": not bool(manifest), "files": [path for path, _ in selected]}


def CaptureChange(project_dir: Optional[str], mode: str = "uncommitted", view: str = "combined",
                  include_untracked: bool = False, base: Optional[str] = None, head: Optional[str] = None,
                  merge_base: bool = False, repo_id: Optional[str] = None,
                  policy: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Capture a bounded local Git change, retrying once if repository state moves."""
    for attempt in range(2):
        try:
            return _capture_change_once(project_dir, mode, view, include_untracked, base, head, merge_base, repo_id, policy)
        except CaptureError as exc:
            if exc.code != "changed_during_capture" or attempt:
                raise
    raise CaptureError("changed_during_capture")


# --- facts ---


@dataclass
class File:
    Name: str = ""
    Data: bytes = b""


@dataclass
class Output:
    Name: str = ""
    Facts: List[bytes] = field(default_factory=list)
    Reasons: List[str] = field(default_factory=list)


@dataclass
class _Parsed:
    name: str
    payload: dict[str, Any]
    conv: str = ""
    harness: str = ""
    event: str = ""
    ts: Any = 0
    base: str = ""
    refs: List["_Ref"] = field(default_factory=list)
    reasons: List[str] = field(default_factory=list)
    bad: bool = True


@dataclass
class _Ref:
    key: str
    abs: str
    rel: str
    repo: str


@dataclass
class _ReadResult:
    content: str = ""
    raw: bytes = b""
    ok: bool = False


def _fact_json(v: dict[str, Any]) -> bytes:
    return _serialize_json_value(v).encode("utf-8")


def Build(ctx: Any, files: List[File]) -> List[Output]:
    ps = [_parse_file(f) for f in files]
    reads: dict[str, _ReadResult] = {}
    last: dict[str, int] = {}
    for i, p in enumerate(ps):
        if p.bad:
            continue
        for abs_path in _write_paths(p):
            r = reads.get(abs_path)
            if r is None:
                r = _read_file(abs_path)
                reads[abs_path] = r
            if not r.ok:
                continue
            top, rel, in_repo, err = RepoPath(abs_path)
            if err is not None or not in_repo or Kind(rel) == "":
                continue
            repo_id, err = RepoID(top)
            if err is not None:
                continue
            k = p.conv + "\x00" + repo_id + "\x00" + rel
            p.refs.append(_Ref(key=k, abs=abs_path, rel=rel, repo=repo_id))
            last[k] = i
    out: List[Output] = []
    commits: set[str] = set()
    for i, p in enumerate(ps):
        o = Output(Name=p.name)
        if p.bad:
            o.Reasons = list(p.reasons)
            out.append(o)
            continue

        def add(v: dict[str, Any]) -> None:
            v["id"] = f"{p.name}#{len(o.Facts)}"
            o.Facts.append(_fact_json(v))

        def common(typ: str) -> dict[str, Any]:
            return {
                "type": typ,
                "conversation_id": p.conv,
                "harness": p.harness,
                "event": p.event,
                "ts": p.ts,
            }

        hv = common("hook_event")
        hv["payload"] = _redact_payload(p.payload)
        add(hv)
        seen: set[str] = set()
        for r in p.refs:
            if last[r.key] != i or r.key in seen:
                continue
            seen.add(r.key)
            rd = reads[r.abs]
            hits = Scan(rd.content)
            if hits:
                o.Reasons.append(
                    f"secret: {hits[0].Pattern} at line {hits[0].Line} in {r.rel}"
                )
                continue
            v = common("artifact_version")
            v["repo_id"] = r.repo
            v["path"] = r.rel
            v["content_hash"] = ContentHash(rd.raw)
            v["content"] = rd.content
            v["source"] = "worktree"
            add(v)
        _build_commits(ctx, p, commits, common, add, o)
        out.append(o)
    return out


def _parse_file(f: File) -> _Parsed:
    p = _Parsed(name=f.Name, payload={})
    if not f.Data:
        p.reasons = ["unparseable: envelope is not JSON"]
        return p
    line, rest = f.Data.split(b"\n", 1) if b"\n" in f.Data else (f.Data, b"")
    try:
        env = json.loads(
            line.decode("utf-8"),
            parse_float=lambda s: _Number(s),
        )
    except (json.JSONDecodeError, UnicodeDecodeError):
        p.reasons = ["unparseable: envelope is not JSON"]
        return p
    if not isinstance(env, dict):
        p.reasons = ["unparseable: envelope is not JSON"]
        return p
    try:
        payload = json.loads(
            rest.decode("utf-8"),
            parse_float=lambda s: _Number(s),
        )
    except (json.JSONDecodeError, UnicodeDecodeError):
        p.reasons = ["unparseable: payload is not JSON"]
        return p
    if not isinstance(payload, dict):
        p.reasons = ["unparseable: payload is not an object"]
        return p
    p.payload = payload
    p.harness = env.get("harness", "")
    p.ts = env.get("ts", 0)
    if p.ts == "":
        p.ts = 0
    for key in ("session_id", "conversation_id", "sessionID"):
        s = payload.get(key)
        if isinstance(s, str) and s:
            p.conv = s
            break
    if not p.conv:
        p.reasons = ["invalid: no conversation id"]
        return p
    p.event = env.get("event", "")
    if not p.event:
        hen = payload.get("hook_event_name")
        if isinstance(hen, str):
            p.event = hen
    cwd = payload.get("cwd")
    if isinstance(cwd, str) and cwd:
        p.base = cwd
    else:
        roots = payload.get("workspace_roots")
        if isinstance(roots, list) and roots:
            first = roots[0]
            if isinstance(first, str):
                p.base = first
    p.bad = False
    return p


def _redact_payload(v: Any) -> Any:
    if isinstance(v, str):
        return Redact(v)
    if isinstance(v, dict):
        return {k: _redact_payload(e) for k, e in v.items()}
    if isinstance(v, list):
        return [_redact_payload(e) for e in v]
    return v


def _read_file(abs_path: str) -> _ReadResult:
    try:
        with open(abs_path, "rb") as rf:
            b = rf.read()
    except OSError:
        return _ReadResult()
    try:
        text = b.decode("utf-8")
    except UnicodeDecodeError:
        return _ReadResult()
    return _ReadResult(content=text, raw=b, ok=True)


_write_tools = frozenset(
    {
        "write",
        "edit",
        "multiedit",
        "write_file",
        "edit_file",
        "create_file",
        "str_replace_editor",
        "apply_patch",
        "applypatch",
    }
)

_patch_re = re.compile(r"(?m)^\*\*\* (?:Add File|Update File|Move to): (.+)$")

_expected_event = {
    "claude": "PostToolUse",
    "codex": "PostToolUse",
    "cursor": "postToolUse",
    "opencode": "tool.execute.after",
}


def _write_paths(p: _Parsed) -> List[str]:
    raw: List[str] = []
    payload = p.payload
    event = p.event
    hen = payload.get("hook_event_name")
    if isinstance(hen, str) and hen:
        event = hen
    else:
        ev = payload.get("event")
        if isinstance(ev, str) and ev:
            event = ev
    if p.harness == "cursor" and event == "afterFileEdit":
        fp = payload.get("file_path")
        if isinstance(fp, str):
            raw = [fp]
    else:
        exp = _expected_event.get(p.harness, "")
        if event != exp or payload.get("source") == "bus":
            return []
        tn = payload.get("tool_name", "")
        if not isinstance(tn, str):
            tn = ""
        name = tn[tn.rfind(".") + 1 :].lower()
        if name not in _write_tools:
            return []
        is_patch = name in ("apply_patch", "applypatch")
        args: dict[str, Any] = {}
        ti = payload.get("tool_input")
        if isinstance(ti, dict):
            args = ti
        elif isinstance(ti, str):
            if ti:
                try:
                    v = json.loads(ti, parse_float=lambda s: _Number(s))
                except json.JSONDecodeError:
                    if is_patch:
                        args = {"patch": ti}
                    else:
                        return []
                else:
                    if not isinstance(v, dict):
                        return []
                    args = v
        elif ti is not None:
            return []
        for k in ("file_path", "path", "filePath", "target_file"):
            s = args.get(k)
            if isinstance(s, str):
                raw.append(s)
        edits = args.get("edits")
        if isinstance(edits, list):
            for e in edits:
                if isinstance(e, dict):
                    for k in ("file_path", "path", "filePath"):
                        s = e.get(k)
                        if isinstance(s, str):
                            raw.append(s)
        if is_patch:
            patch = args.get("patch", "")
            if not isinstance(patch, str) or not patch:
                patch = args.get("input", "")
            if isinstance(patch, str):
                for m in _patch_re.finditer(patch):
                    raw.append(m.group(1))
    out: List[str] = []
    seen: set[str] = set()
    for r in raw:
        abs_path = r
        if not os.path.isabs(r):
            if not p.base:
                continue
            abs_path = os.path.join(p.base, r)
        abs_path = os.path.normpath(abs_path)
        if abs_path not in seen:
            seen.add(abs_path)
            out.append(abs_path)
    return out


_git_commit_re = re.compile(
    r"(?:^|[\s;&|(])git((?:\s+(?:-C\s+(?:\"[^\"]*\"|'[^']*'|\S+)|-c\s+\S+|--[\w-]+(?:=\S+)?))*)\s+commit(?:[\s;&|)]|$)"
)
_dir_re = re.compile(r'-C\s+("[^"]*"|\'[^\']*\'|\S+)')
_sha_re = re.compile(r"(?m)^\[(?:[^\]]*\s)?([0-9a-f]{7,40})\]")
_post_events = frozenset(
    {
        "PostToolUse",
        "postToolUse",
        "afterShellExecution",
        "tool.execute.after",
    }
)


def _as_object(v: Any) -> Optional[dict[str, Any]]:
    if isinstance(v, dict):
        return v
    if isinstance(v, str):
        try:
            m = json.loads(v, parse_float=lambda s: _Number(s))
        except json.JSONDecodeError:
            return None
        if isinstance(m, dict):
            return m
    return None


def _command_text(payload: dict[str, Any]) -> str:
    c: Any = None
    ti = _as_object(payload.get("tool_input"))
    if ti is not None:
        c = ti.get("command")
    if c is None:
        c = payload.get("command")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        parts = [e for e in c if isinstance(e, str)]
        return " ".join(parts)
    return ""


def _non_zero(v: Any) -> bool:
    if isinstance(v, _Number):
        try:
            return float(v.s) != 0
        except ValueError:
            return False
    if isinstance(v, (int, float)):
        return v != 0
    return False


def _output_and_failed(payload: dict[str, Any]) -> tuple[str, bool]:
    failed = _non_zero(payload.get("exit_code")) or _non_zero(payload.get("exitCode"))
    texts: List[str] = []
    for k in ("tool_response", "tool_output", "output"):
        v = payload.get(k)
        if isinstance(v, str):
            m = _as_object(v)
            if m is not None:
                v = m
            else:
                texts.append(v)
                continue
        if isinstance(v, dict):
            failed = failed or _non_zero(v.get("exit_code")) or _non_zero(
                v.get("exitCode")
            )
            for f in ("stdout", "output", "stderr"):
                s = v.get(f)
                if isinstance(s, str):
                    texts.append(s)
    return "\n".join(texts), failed


def _unquote(s: str) -> str:
    if len(s) >= 2 and s[0] in ('"', "'") and s[-1] == s[0]:
        return s[1:-1]
    return s


def _facts_git(ctx: Any, dir_path: str, *args: str) -> bytes:
    cmd = ["git", "-C", dir_path, *args]
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    try:
        out = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            timeout=10,
            env=env,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise OSError("git failed")
    return out.stdout


def _build_commits(
    ctx: Any,
    p: _Parsed,
    done: set[str],
    common: Callable[[str], dict[str, Any]],
    add: Callable[[dict[str, Any]], None],
    o: Output,
) -> None:
    event = p.payload.get("hook_event_name", "")
    if not isinstance(event, str) or not event:
        event = p.event
    if event not in _post_events:
        return
    cmd_text = _command_text(p.payload)
    matches = list(_git_commit_re.finditer(cmd_text))
    if not matches:
        return
    text, failed = _output_and_failed(p.payload)
    if failed:
        return
    sm = _sha_re.search(text)
    if not sm:
        return
    for m in matches:
        dir_path = p.base
        for d in _dir_re.finditer(m.group(1)):
            c = _unquote(d.group(1))
            if os.path.isabs(c):
                dir_path = c
            elif dir_path:
                dir_path = os.path.join(dir_path, c)
            else:
                dir_path = ""
        if not dir_path:
            continue
        try:
            b = _facts_git(ctx, dir_path, "rev-parse", "--verify", sm.group(1) + "^{commit}")
        except OSError:
            continue
        sha = b.decode().strip()
        repo_id, err = RepoID(dir_path)
        if err is not None:
            continue
        dk = p.conv + "\x00" + repo_id + "\x00" + sha
        if dk in done:
            return
        try:
            b = _facts_git(
                ctx,
                dir_path,
                "diff-tree",
                "-M",
                "--name-status",
                "-r",
                "--root",
                "--no-commit-id",
                "-z",
                sha,
            )
        except OSError:
            continue
        done.add(dk)
        paths: List[str] = []
        renames: List[dict[str, str]] = []
        catchup: List[str] = []
        toks = b.decode("latin-1").split("\x00")
        i = 0
        while i < len(toks):
            st = toks[i]
            if not st:
                i += 1
                continue
            if st[0] in ("R", "C"):
                if i + 2 >= len(toks):
                    break
                from_p, to_p = toks[i + 1], toks[i + 2]
                i += 3
                paths.append(to_p)
                if st[0] == "R":
                    renames.append({"from": from_p, "to": to_p})
                    catchup.append(to_p)
            else:
                if i + 1 >= len(toks):
                    break
                path = toks[i + 1]
                i += 2
                paths.append(path)
                if st[0] in ("A", "M", "T"):
                    catchup.append(path)
        c = common("commit")
        c["repo_id"] = repo_id
        c["sha"] = sha
        c["paths"] = paths
        c["renames"] = renames
        add(c)
        for path in catchup:
            if Kind(path) == "":
                continue
            try:
                blob = _facts_git(ctx, dir_path, "show", f"{sha}:{path}")
            except OSError:
                continue
            try:
                blob_text = blob.decode("utf-8")
            except UnicodeDecodeError:
                continue
            hits = Scan(blob_text)
            if hits:
                o.Reasons.append(
                    f"secret: {hits[0].Pattern} at line {hits[0].Line} in {path}"
                )
                continue
            v = common("artifact_version")
            v["repo_id"] = repo_id
            v["path"] = path
            v["content_hash"] = ContentHash(blob)
            v["content"] = blob_text
            v["source"] = "commit"
            v["sha"] = sha
            add(v)
        return


def WritePaths(raw: Optional[bytes]) -> Optional[List[str]]:
    if raw is None:
        return None
    p = _parse_file(File(Data=raw))
    if p.bad:
        return None
    paths = _write_paths(p)
    if not paths:
        return None
    return paths


# --- drain ---

ReasonIdle = "idle"
ReasonLockHeld = "lock held by another drain"
ReasonGaveUp = "backoff at cap and no new file"
ReasonStopped = "stopped"

_MAX_DRAIN_FILES = 500
_MAX_DRAIN_BYTES = 8 << 20


class _NetErr(Exception):
    pass


_ERR_NETWORK: BaseException = _NetErr()


class _DiscardIO:
    def write(self, s: str) -> int:
        return len(s)

    def flush(self) -> None:
        pass


_DISCARD_IO = _DiscardIO()


@dataclass
class DrainResponse:
    Status: int = 0
    RetryAfter: float = 0.0
    Results: List[dict[str, Any]] = field(default_factory=list)


# A bearer value with CR/LF becomes a header-injection error whose message
# quotes the value. Refuse it before it is placed on a request.
_ILLEGAL_HEADER = re.compile(rb"\n(?![ \t])|\r(?![ \t\n])")


def _bearer_header(key: str) -> Optional[str]:
    if key == "":
        return ""
    try:
        raw = ("Bearer " + key).encode("latin-1")
    except UnicodeEncodeError:
        return None
    if _ILLEGAL_HEADER.search(raw):
        return None
    return "Bearer " + key


def _request_base(endpoint: str) -> Optional[str]:
    """http(s) base with userinfo, query, and fragment removed.

    None means the value must not be requested or shown: a non-http scheme
    (file, ftp) or a URL with no host.
    """
    raw = endpoint.strip()
    if not raw:
        return None
    try:
        u = urllib.parse.urlsplit(raw)
    except ValueError:
        return None
    if u.scheme not in ("http", "https") or not u.hostname:
        return None
    host = u.hostname
    if ":" in host:
        host = "[" + host + "]"
    if u.port is not None:
        host = f"{host}:{u.port}"
    path = u.path or ""
    if path != "/":
        path = path.rstrip("/")
    try:
        return urllib.parse.urlunsplit((u.scheme, host, path, "", ""))
    except ValueError:
        return None


def _shown_endpoint(endpoint: str) -> str:
    base = _request_base(endpoint)
    if base is None:
        return "(invalid)"
    return base


def _host_ascii(url: str) -> str:
    try:
        host = urllib.parse.urlparse(url).hostname or ""
    except ValueError:
        return ""
    try:
        return host.encode("idna").decode("ascii").rstrip(".")
    except UnicodeError:
        return host.lower().rstrip(".")


def _auth_may_follow(origin: str, dest: str) -> bool:
    """Go's rule: keep Authorization on the same host or a subdomain of it."""
    origin_host = _host_ascii(origin)
    dest_host = _host_ascii(dest)
    if not origin_host or not dest_host:
        return False
    if dest_host == origin_host:
        return True
    # A zone or IPv6 literal is not a subdomain of a name in its suffix.
    if ":" in dest_host or "%" in dest_host:
        return False
    return dest_host.endswith("." + origin_host)


class _BearerRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parts = urllib.parse.urlparse(newurl)
        if parts.scheme not in ("http", "https", ""):
            raise urllib.error.HTTPError(
                req.full_url, code, "redirect refused", headers, fp
            )
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is None:
            return None
        if not _auth_may_follow(req.full_url, new.full_url):
            new.remove_header("Authorization")
        return new


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(
            req.full_url, code, "redirect refused", headers, fp
        )


def _plugin_version_text() -> str:
    path = os.path.join(os.path.dirname(__file__), "..", "bin", "VERSION")
    with open(path, encoding="utf-8") as f:
        return f.read().strip()


def _user_agent() -> str:
    # Cloudflare in front of api.yakka.build rejects urllib's default Python-urllib agent (error 1010).
    try:
        return "yakka-client/" + _plugin_version_text()
    except OSError:
        return "yakka-client"


_OPENER = urllib.request.build_opener(_BearerRedirectHandler)
_NO_REDIRECT = urllib.request.build_opener(_NoRedirectHandler)
_OPENER.addheaders = [("User-Agent", _user_agent())]
_NO_REDIRECT.addheaders = [("User-Agent", _user_agent())]


def _urlopen(req: urllib.request.Request, timeout: float = 30.0):
    return _OPENER.open(req, timeout=timeout)


def _urlopen_noredir(req: urllib.request.Request, timeout: float = 30.0):
    return _NO_REDIRECT.open(req, timeout=timeout)


def _close_resp(resp: Any) -> None:
    closer = getattr(resp, "close", None)
    if closer is None:
        return
    try:
        closer()
    except Exception:
        pass


class HTTPSink:
    def __init__(
        self,
        Endpoint: str = "",
        Key: str = "",
        Client: Any = None,
    ) -> None:
        self.Endpoint = Endpoint
        self.Key = Key
        self.Client = Client

    def Send(
        self, ctx: "DrainContext", facts: List[bytes]
    ) -> Tuple[DrainResponse, Optional[BaseException]]:
        for f in facts:
            try:
                json.loads(f)
            except (json.JSONDecodeError, TypeError, UnicodeDecodeError):
                return DrainResponse(), _ERR_NETWORK
        base = _request_base(self.Endpoint)
        auth = _bearer_header(self.Key)
        if base is None or auth is None:
            return DrainResponse(), _ERR_NETWORK
        body = b'{"facts":[' + b",".join(facts) + b"]}"
        url = base.rstrip("/") + "/v1/ingest"
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        if auth:
            req.add_header("Authorization", auth)
        timeout = 30.0
        if self.Client is not None and hasattr(self.Client, "timeout"):
            timeout = self.Client.timeout
        resp = None
        try:
            try:
                resp = _urlopen(req, timeout=timeout)
                status = resp.status
                headers = resp.headers
                data = resp.read(64 << 20)
            except urllib.error.HTTPError as e:
                status = e.code
                headers = e.headers
                try:
                    data = e.read(64 << 20) if e.fp is not None else b""
                finally:
                    e.close()
            finally:
                if resp is not None:
                    _close_resp(resp)
        except Exception:
            return DrainResponse(), _ERR_NETWORK
        if headers is None:
            headers = {}
        out = DrainResponse(Status=status)
        ra = headers.get("Retry-After", "").strip()
        if ra.isdigit():
            out.RetryAfter = float(ra)
        if status == 200:
            try:
                r = json.loads(data)
            except (json.JSONDecodeError, TypeError):
                out.Status = 502
            else:
                if not isinstance(r, dict):
                    out.Status = 502
                else:
                    results = r.get("results", [])
                    if results is None:
                        out.Results = []
                    elif not isinstance(results, list):
                        out.Status = 502
                    else:
                        for item in results:
                            if not isinstance(item, dict):
                                out.Status = 502
                                break
                        else:
                            out.Results = results
        return out, None


def ConfigSink() -> Tuple[Optional[HTTPSink], Optional[BaseException]]:
    try:
        c = Load()
    except (ErrPartialEnv, OSError, ValueError) as err:
        return None, err
    return HTTPSink(Endpoint=c.Endpoint, Key=c.Key), None


@dataclass
class Options:
    Dir: str = ""
    Sink: Optional[Callable[[], Tuple[Any, Optional[BaseException]]]] = None
    Window: float = 0.0
    Linger: float = 0.0
    BackoffMax: float = 0.0
    BackoffMin: float = 0.0
    GiveUp: float = 0.0
    Poll: float = 0.0
    LockWait: float = 0.0
    Wake: Any = None
    Hosted: bool = False
    Log: Any = None
    afterRelease: Optional[Callable[[], None]] = None

    def defaults(self) -> None:
        if not self.Dir:
            self.Dir = QueueDir()
        if self.Window <= 0:
            self.Window = 1.5
        if self.Linger <= 0:
            self.Linger = 60.0
        if self.BackoffMax <= 0:
            self.BackoffMax = 300.0
        if self.BackoffMin <= 0:
            self.BackoffMin = 0.5
        if self.GiveUp <= 0:
            self.GiveUp = 900.0
        if self.Poll <= 0:
            self.Poll = 0.25
        if self.LockWait <= 0:
            self.LockWait = 1.0
        if self.BackoffMin > self.BackoffMax:
            self.BackoffMin = self.BackoffMax
        if self.Log is None:
            self.Log = _DISCARD_IO


class DrainContext:
    def __init__(
        self,
        deadline: Optional[float] = None,
        cancelled: bool = False,
    ) -> None:
        self._deadline = deadline
        self._cancelled = cancelled

    @classmethod
    def with_timeout(cls, seconds: float) -> "DrainContext":
        return cls(deadline=time.monotonic() + seconds)

    def cancel(self) -> None:
        self._cancelled = True

    def cancelled(self) -> bool:
        if self._cancelled:
            return True
        if self._deadline is not None and time.monotonic() > self._deadline:
            return True
        return False

    def err(self) -> Optional[BaseException]:
        if self.cancelled():
            return InterruptedError()
        return None


def QueueDir() -> str:
    d = os.environ.get("YAKKA_QUEUE", "")
    if d:
        return d
    return os.path.join(_home(), ".local", "share", "yakka", "queue")


def EnsureDirs(dir_path: str) -> Optional[OSError]:
    for d in (
        dir_path,
        os.path.join(dir_path, "tmp"),
        os.path.join(dir_path, "rejected"),
    ):
        try:
            os.makedirs(d, mode=0o700, exist_ok=True)
        except OSError as err:
            return err
    return None


def _lock_path(dir_path: str) -> str:
    return os.path.join(dir_path, ".drain.lock")


def _try_lock(dir_path: str) -> Tuple[Optional[Any], Optional[BaseException]]:
    path = _lock_path(dir_path)
    try:
        f = open(path, "a+b")
    except OSError as err:
        return None, err
    try:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as err:
        f.close()
        return None, err
    return f, None


def _release_lock(f: Any) -> None:
    if f is not None:
        try:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        try:
            f.close()
        except OSError:
            pass


def _acquire(
    ctx: DrainContext,
    dir_path: str,
    wait: float,
    poll: float,
    forever: bool,
) -> Tuple[Optional[Any], Optional[BaseException]]:
    deadline = time.monotonic() + wait
    step = poll if forever else 0.02
    while True:
        f, err = _try_lock(dir_path)
        if f is not None:
            return f, None
        if err is not None and not isinstance(err, BlockingIOError):
            return None, err
        if not forever and time.monotonic() > deadline:
            return None, BlockingIOError()
        if not _drain_sleep(ctx, step):
            return None, InterruptedError()
        if ctx.cancelled():
            return None, InterruptedError()


def Running(dir_path: str) -> bool:
    path = _lock_path(dir_path)
    try:
        f = open(path, "r+b")
    except OSError:
        return False
    try:
        try:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        except OSError:
            return False
        try:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        return False
    finally:
        f.close()


def _drain_sleep(ctx: DrainContext, duration: float) -> bool:
    if duration <= 0:
        return not ctx.cancelled()
    end = time.monotonic() + duration
    while time.monotonic() < end:
        if ctx.cancelled():
            return False
        time.sleep(min(0.02, end - time.monotonic()))
    return True


@dataclass
class _QueueEntry:
    name: str
    mod: float


def _list_queue(dir_path: str) -> List[_QueueEntry]:
    try:
        names = os.listdir(dir_path)
    except OSError:
        return []
    out: List[_QueueEntry] = []
    for n in names:
        if n.startswith(".") or not n.endswith(".evt"):
            continue
        p = os.path.join(dir_path, n)
        if not os.path.isfile(p):
            continue
        out.append(_QueueEntry(n, os.path.getmtime(p)))
    out.sort(key=lambda e: (e.mod, e.name))
    return out


@dataclass
class QueueStatusData:
    Dir: str
    Queued: int
    OldestAge: float
    Rejected: int
    Running: bool


def QueueStatus(dir_path: str) -> QueueStatusData:
    st = QueueStatusData(
        Dir=dir_path,
        Queued=0,
        OldestAge=-1.0,
        Rejected=0,
        Running=Running(dir_path),
    )
    es = _list_queue(dir_path)
    st.Queued = len(es)
    if es:
        st.OldestAge = time.time() - es[0].mod
    rej = os.path.join(dir_path, "rejected")
    try:
        for n in os.listdir(rej):
            if n.endswith(".evt"):
                st.Rejected += 1
    except OSError:
        pass
    return st


@dataclass
class _BatchItem:
    name: str
    facts: List[bytes]
    reasons: List[str]


def _prefix(name: str, reasons: List[str]) -> List[str]:
    return [name + ": " + s for s in reasons]


class _Runner:
    def __init__(self, o: Options) -> None:
        self.o = o
        self.seen: set[str] = set()
        self.last_new = time.monotonic()

    def logf(self, fmt: str, *args: Any) -> None:
        self.o.Log.write("drain: " + (fmt % args) + "\n")
        self.o.Log.flush()

    def scan(self) -> List[_QueueEntry]:
        es = _list_queue(self.o.Dir)
        cur = {e.name for e in es}
        now = time.monotonic()
        for e in es:
            if e.name not in self.seen:
                self.last_new = now
        self.seen = cur
        return es

    def wait_for_work(self, ctx: DrainContext) -> bool:
        linger_end = None
        if not self.o.Hosted:
            linger_end = time.monotonic() + self.o.Linger
        while True:
            if ctx.cancelled():
                return False
            if linger_end is not None and time.monotonic() >= linger_end:
                return False
            if self.o.Wake is not None:
                self.o.Wake.acquire(block=False)
            if len(self.scan()) > 0:
                return True
            if not _drain_sleep(ctx, self.o.Poll):
                return False


    def batch(
        self, ctx: DrainContext, sink: HTTPSink, files: List[_QueueEntry]
    ) -> Tuple[bool, float]:
        in_files: List[File] = []
        for e in files:
            path = os.path.join(self.o.Dir, e.name)
            try:
                with open(path, "rb") as f:
                    data = f.read()
            except OSError:
                continue
            in_files.append(File(Name=e.name, Data=data))
        items: List[_BatchItem] = []
        for out in Build(None, in_files):
            if not out.Facts:
                if out.Reasons:
                    self.reject(out.Name, _prefix(out.Name, out.Reasons))
                else:
                    self.remove(out.Name)
                continue
            items.append(_BatchItem(out.Name, list(out.Facts), list(out.Reasons)))
        while items:
            n, size = 0, 0
            while n < len(items):
                s = sum(len(f) for f in items[n].facts)
                if n > 0 and size + s > _MAX_DRAIN_BYTES:
                    break
                size += s
                n += 1
            retry, wait = self.send(ctx, sink, items[:n])
            if retry:
                return True, wait
            items = items[n:]
        return False, 0.0

    def send(
        self, ctx: DrainContext, sink: HTTPSink, items: List[_BatchItem]
    ) -> Tuple[bool, float]:
        all_facts: List[bytes] = []
        for it in items:
            all_facts.extend(it.facts)
        resp, err = sink.Send(ctx, all_facts)
        if err is not None:
            if not ctx.cancelled():
                self.logf(
                    "attempt failed: network error (%d files kept)", len(items)
                )
            return True, 0.0
        if resp.Status == 200:
            return self.apply(items, all_facts, resp)
        if resp.Status == 429:
            wait = max(resp.RetryAfter, 0.001)
            self.logf(
                "attempt failed: status=429 retry-after=%s (%d files kept)",
                wait,
                len(items),
            )
            return True, wait
        if resp.Status in (400, 413):
            if len(items) == 1:
                self.logf("file rejected: status=%d", resp.Status)
                it = items[0]
                self.reject(
                    it.name,
                    _prefix(
                        it.name,
                        [str(resp.Status)] + list(it.reasons),
                    ),
                )
                return False, 0.0
            self.logf("status=%d: splitting %d files", resp.Status, len(items))
            h = len(items) // 2
            retry, wait = self.send(ctx, sink, items[:h])
            if retry:
                return True, wait
            return self.send(ctx, sink, items[h:])
        self.logf(
            "attempt failed: status=%d (%d files kept)", resp.Status, len(items)
        )
        return True, 0.0

    def apply(
        self,
        items: List[_BatchItem],
        all_facts: List[bytes],
        resp: DrainResponse,
    ) -> Tuple[bool, float]:
        if len(resp.Results) != len(all_facts):
            self.logf(
                "attempt failed: %d results for %d facts (%d files kept)",
                len(resp.Results),
                len(all_facts),
                len(items),
            )
            return True, 0.0
        for res in resp.Results:
            st = res.get("status", "")
            if st not in ("accepted", "duplicate", "rejected"):
                self.logf(
                    "attempt failed: unknown result status (%d files kept)",
                    len(items),
                )
                return True, 0.0
        i = 0
        for it in items:
            rej: List[str] = []
            for _ in it.facts:
                res = resp.Results[i]
                i += 1
                if res.get("status") == "rejected":
                    reason = res.get("reason") or "rejected"
                    rej.append(res.get("id", "") + ": " + reason)
            rej.extend(_prefix(it.name, it.reasons))
            if rej:
                self.reject(it.name, rej)
            else:
                self.remove(it.name)
        return False, 0.0

    def remove(self, name: str) -> None:
        path = os.path.join(self.o.Dir, name)
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
        except OSError as err:
            self.logf("delete failed: %s", err)

    def reject(self, name: str, reasons: List[str]) -> None:
        dst = os.path.join(self.o.Dir, "rejected", name)
        lines = []
        for s in reasons:
            lines.append(s.replace("\r", " ").replace("\n", " ") + "\n")
        reason_path = dst + ".reason"
        try:
            fd = os.open(
                reason_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600
            )
            try:
                try:
                    os.fchmod(fd, 0o600)
                except (AttributeError, NotImplementedError):
                    pass
                os.write(fd, "".join(lines).encode("utf-8"))
            finally:
                os.close(fd)
        except OSError as err:
            self.logf("reason write failed: %s", err)
        src = os.path.join(self.o.Dir, name)
        try:
            os.rename(src, dst)
        except FileNotFoundError:
            pass
        except OSError as err:
            self.logf("reject move failed: %s", err)


def Run(ctx: DrainContext, o: Options) -> Tuple[str, Optional[BaseException]]:
    o.defaults()
    if o.Sink is None:
        return "", OSError("drain: no sink")
    err = EnsureDirs(o.Dir)
    if err is not None:
        return "", err
    r = _Runner(o)
    lock, err = _acquire(ctx, o.Dir, o.LockWait, o.Poll, o.Hosted)
    if err is not None:
        if ctx.cancelled():
            return ReasonStopped, None
        if isinstance(err, BlockingIOError):
            return ReasonLockHeld, None
        return "", err
    r.logf("acquired lock pid=%d", os.getpid())
    fresh = True
    backoff = 0.0
    try:
        while True:
            if ctx.cancelled():
                return ReasonStopped, None
            files = r.scan()
            if not files:
                fresh = True
                backoff = 0.0
                if not r.wait_for_work(ctx):
                    if ctx.cancelled():
                        return ReasonStopped, None
                    _release_lock(lock)
                    lock = None
                    if o.afterRelease is not None:
                        o.afterRelease()
                    if len(r.scan()) == 0:
                        return ReasonIdle, None
                    lock, err = _acquire(ctx, o.Dir, o.LockWait, o.Poll, False)
                    if err is not None:
                        if ctx.cancelled():
                            return ReasonStopped, None
                        return ReasonLockHeld, None
                    r.logf("acquired lock pid=%d", os.getpid())
                continue
            if fresh:
                fresh = False
                if not _drain_sleep(ctx, o.Window):
                    return ReasonStopped, None
                files = r.scan()
            sink, err = o.Sink()
            if err is not None:
                r.logf("config unavailable; retrying")
                if not o.Hosted and (time.monotonic() - r.last_new) >= o.GiveUp:
                    return ReasonGaveUp, None
                if not _drain_sleep(ctx, max(o.Poll, 1.0)):
                    return ReasonStopped, None
                continue
            if len(files) > _MAX_DRAIN_FILES:
                files = files[:_MAX_DRAIN_FILES]
            res = r.batch(ctx, sink, files)
            if not res[0]:
                backoff = 0.0
                continue
            wait = res[1]
            if wait <= 0:
                if backoff == 0:
                    backoff = o.BackoffMin
                else:
                    backoff = min(backoff * 2, o.BackoffMax)
                wait = backoff / 2 + random.random() * (backoff / 2)
            r.scan()
            if (
                not o.Hosted
                and backoff >= o.BackoffMax
                and (time.monotonic() - r.last_new) >= o.GiveUp
            ):
                return ReasonGaveUp, None
            if not _drain_sleep(ctx, wait):
                return ReasonStopped, None
    finally:
        _release_lock(lock)


_go_duration_re = re.compile(r"([0-9]+(?:\.[0-9]*)?)(ns|us|µs|ms|s|m|h)")
_go_duration_units = {
    "ns": 1e-9,
    "us": 1e-6,
    "µs": 1e-6,
    "ms": 1e-3,
    "s": 1.0,
    "m": 60.0,
    "h": 3600.0,
}


def _parse_go_duration(s: str) -> float:
    pos = 0
    total = 0.0
    while pos < len(s):
        m = _go_duration_re.match(s, pos)
        if not m:
            raise ValueError(f"invalid duration {s!r}")
        total += float(m.group(1)) * _go_duration_units[m.group(2)]
        pos = m.end()
    return total


def RunStandalone(ctx: DrainContext, stderr: Any) -> int:
    try:
        Load()
    except ErrPartialEnv as err:
        print("yakka drain:", err, file=stderr)
        return 1
    o = Options(Sink=ConfigSink, Log=stderr, Poll=0.25)
    for env, attr in (
        ("YAKKA_DRAIN_WINDOW", "Window"),
        ("YAKKA_DRAIN_LINGER", "Linger"),
        ("YAKKA_DRAIN_BACKOFF_MAX", "BackoffMax"),
        ("YAKKA_DRAIN_GIVEUP", "GiveUp"),
    ):
        v = os.environ.get(env, "")
        if v:
            try:
                setattr(o, attr, _parse_go_duration(v))
            except ValueError as err:
                print(f"yakka drain: {env}: {err}", file=stderr)
                return 2
    o.defaults()
    if o.BackoffMax > 0 and o.BackoffMax < 0.5:
        o.BackoffMin = o.BackoffMax
    reason, err = Run(ctx, o)
    if err is not None:
        print("yakka drain:", err, file=stderr)
        return 1
    print(f"drain: exit: {reason}", file=stderr)
    return 0


# --- mcp ---

_MCP_MAX_BODY = 8 << 20
_MCP_WORKERS = 8
_MCP_CANCEL = "notifications/cancelled"
_MCP_CONNECT_TIMEOUT_S = 5.0
_MCP_READER_TIMEOUT_S = 5.0
_MCP_READERS_TIMEOUT_S = 10.0
_MCP_CONNECT_TIMEOUT_S = 5.0
_MCP_READER_TIMEOUT_S = 5.0
_MCP_READERS_TIMEOUT_S = 10.0


@dataclass
class McpOptions:
    Version: str = ""
    QueueDir: str = ""
    Wait: float = 0.0
    StartDrain: Optional[Callable[[], Optional[BaseException]]] = None
    Getwd: Optional[Callable[[], Tuple[str, Optional[BaseException]]]] = None
    Cancelled: Optional[Callable[[], bool]] = None

    def defaults(self) -> None:
        if not self.QueueDir:
            self.QueueDir = QueueDir()
        if self.Cancelled is None:
            self.Cancelled = lambda: False


def _mcp_host(endpoint: str) -> str:
    base = _request_base(endpoint)
    if base is None:
        return ""
    try:
        return urllib.parse.urlsplit(base).hostname or ""
    except ValueError:
        return ""


def _mcp_error(kind: str, detail: str, host: str, ident: Any, queued: Optional[int] = None, effect_outcome: Optional[str] = None) -> bytes:
    fixes = {
        "bad config": "Check the shared login and endpoint configuration.",
        "unreachable": "Check the network and try again.",
        "unauthorized": "Log in again or check the key.",
        "server unsupported": "Update the server to a version with MCP support.",
        "timeout": "Retry; the request may have completed.",
        "redirect refused": "Use the configured endpoint directly.",
        "bad reply": "Update the server or retry the request.",
    }
    data: dict[str, Any] = {"code": kind.replace(" ", "_"), "host": host}
    if queued is not None:
        data["queued_locally"] = queued
    if effect_outcome is not None:
        data["local_effect_outcome"] = effect_outcome
    value = {
        "jsonrpc": "2.0",
        "id": ident,
        "error": {
            "code": -32000,
            "message": f"{kind}: {detail}. {fixes[kind]}",
            "data": data,
        },
    }
    return json.dumps(value, separators=(",", ":")).encode("utf-8") + b"\n"


def _mcp_queued_count(queue_dir: str) -> int:
    try:
        return sum(1 for name in os.listdir(queue_dir) if name.endswith(".evt") and not name.startswith("."))
    except OSError:
        return 0


def _mcp_parse(line: bytes) -> tuple[Optional[dict[str, Any]], Any, str]:
    try:
        value = json.loads(line)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, None, ""
    if not isinstance(value, dict):
        return None, None, ""
    return value, value.get("id"), value.get("method", "") if isinstance(value.get("method", ""), str) else ""


def _mcp_response(raw: bytes) -> Optional[dict[str, Any]]:
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(value, dict) or value.get("jsonrpc") != "2.0":
        return None
    if "id" not in value or ("result" in value) == ("error" in value):
        return None
    if "error" in value:
        error = value["error"]
        if (
            not isinstance(error, dict)
            or isinstance(error.get("code"), bool)
            or not isinstance(error.get("code"), int)
            or not isinstance(error.get("message"), str)
        ):
            return None
    return value


_MCP_ACTION = {"action": "enqueue_file_snapshot", "v": 1, "path_from": "resolved_path"}
_MCP_ACTION_CAPABILITY = {"v": 1, "actions": [{"action": "enqueue_file_snapshot", "v": 1}]}
_MCP_READER_VERSIONS = {"cwd": {1}, "project_dir": {1}, "resolved_path": {1}, "file": {1}, "git": {1}, "queue": {1, 2}, "drain": {1}}
_MCP_READER_FAILURES = {"unsupported_reader", "unsupported_reader_version", "unsupported_declaration", "bad_params", "bad_input", "dependency_failed", "timeout", "io_error", "over_budget", "secret_in_context", "internal", "incomplete_queue"}


def _mcp_failed(code: str) -> dict[str, Any]:
    return {"_failed": {"code": code if code in _MCP_READER_FAILURES else "internal"}}


def _mcp_id_key(ident: Any) -> str:
    """JSON-encode a request id so number 1 and string "1" do not share a slot."""
    try:
        return json.dumps(ident, separators=(",", ":"), ensure_ascii=False)
    except (TypeError, ValueError):
        return "null"


def _mcp_hash_file(path: str) -> str:
    """Hash a regular file. O_NOFOLLOW refuses a final-component symlink swap."""
    flags = os.O_RDONLY
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    if nofollow:
        flags |= nofollow
    fd = os.open(path, flags)
    try:
        digest = hashlib.sha256()
        while True:
            chunk = os.read(fd, 1 << 20)
            if not chunk:
                break
            digest.update(chunk)
        return digest.hexdigest()
    finally:
        os.close(fd)


def _mcp_real_repo(path: str, deadline: Optional[float] = None) -> tuple[str, str, str]:
    """Return canonical worktree top, repository identity and slash path."""
    git = shutil.which("git")
    if not git:
        raise FileNotFoundError("git unavailable")
    env = {"PATH": os.environ.get("PATH", ""), "HOME": _home(), "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1"}
    def git_read(*args: str) -> str:
        if deadline is not None and time.monotonic() >= deadline:
            raise TimeoutError()
        timeout = 3.0 if deadline is None else min(3.0, deadline - time.monotonic())
        if timeout <= 0:
            raise TimeoutError()
        try:
            result = subprocess.run([git, "-C", os.path.dirname(path), *args], check=True, capture_output=True, timeout=timeout, env=env)
        except subprocess.TimeoutExpired as exc:
            raise TimeoutError() from exc
        except (OSError, subprocess.CalledProcessError) as exc:
            raise ValueError("no repo") from exc
        if len(result.stdout) > 65536:
            raise ValueError("no repo")
        return result.stdout.decode("utf-8").strip()
    try:
        top = os.path.realpath(git_read("rev-parse", "--show-toplevel"))
    except (ValueError, TimeoutError):
        raise
    real = os.path.realpath(path)
    rel = os.path.relpath(real, top)
    if rel == ".." or rel.startswith(".." + os.sep):
        raise ValueError("outside repo")
    remotes = sorted(git_read("remote").split())
    if remotes:
        remote = "origin" if "origin" in remotes else remotes[0]
        # "--" keeps a remote named like an option from being parsed as one.
        rid = NormalizeRemote(git_read("remote", "get-url", "--", remote))
    else:
        roots = sorted(git_read("rev-list", "--max-parents=0", "HEAD").split())
        if not roots:
            raise ValueError("no commit")
        rid = "root:" + roots[0]
    return top, rid, rel.replace(os.sep, "/")


def _mcp_queue_entries(queue_dir: str, repo_id: str, rel_path: str, absolute: str, file_mtime: float, deadline: Optional[float] = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """Read the full queue set before returning diagnostic samples and v2 coverage."""
    pending_all: list[dict[str, Any]] = []
    rejected_all: list[dict[str, Any]] = []
    now = time.time()
    rejected_dir = os.path.join(queue_dir, "rejected")
    try:
        names = os.listdir(queue_dir)
    except FileNotFoundError:
        names = []
    except OSError as exc:
        raise OSError("queue unavailable") from exc
    try:
        rejected_names = os.listdir(rejected_dir)
    except FileNotFoundError:
        rejected_names = []
    except OSError as exc:
        raise OSError("queue unavailable") from exc
    for folder, items, is_rejected in ((queue_dir, names, False), (rejected_dir, rejected_names, True)):
        for name in items:
            if deadline is not None and time.monotonic() >= deadline:
                raise TimeoutError()
            if not name.endswith(".evt") or name.startswith("."):
                continue
            p = os.path.join(folder, name)
            try:
                if os.path.islink(p):
                    raise OSError("incomplete queue")
                if not os.path.isfile(p):
                    continue
                with open(p, "rb") as fh:
                    raw = fh.read(65537)
                if len(raw) > 65536:
                    raise OSError("incomplete queue")
                parsed = _parse_file(File(Name=name, Data=raw))
                if parsed.bad:
                    raise OSError("incomplete queue")
                paths = _write_paths(parsed)
                matched = False
                for fp in paths:
                    if os.path.normpath(fp) == os.path.normpath(absolute):
                        matched = True
                        break
                    try:
                        _, entry_repo, entry_rel = _mcp_real_repo(fp, deadline)
                        if entry_repo == repo_id and entry_rel == rel_path:
                            matched = True
                            break
                    except ValueError:
                        # A path that is not in a repository cannot match this file.
                        continue
                if not matched:
                    continue
                st = os.stat(p)
                item: dict[str, Any] = {"mtime": st.st_mtime}
                if is_rejected:
                    reason_path = p + ".reason"
                    try:
                        if os.path.islink(reason_path):
                            raise OSError("incomplete queue")
                        with open(reason_path, encoding="utf-8") as fh:
                            reason = fh.read(4097)
                    except OSError:
                        reason = ""
                    if len(reason) > 4096:
                        raise OSError("incomplete queue")
                    item["reason"] = reason
                    rejected_all.append(item)
                else:
                    item["age_s"] = max(0.0, now - st.st_mtime)
                    pending_all.append(item)
            except TimeoutError:
                raise
            except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError):
                # A potentially matching unreadable entry makes absence unprovable.
                raise OSError("incomplete queue")
    pending_all.sort(key=lambda x: x["mtime"])
    rejected_all.sort(key=lambda x: x["mtime"])
    pcover = [e for e in pending_all if e["mtime"] >= file_mtime]
    rcover = [e for e in rejected_all if e["mtime"] >= file_mtime]
    coverage = {"complete": True, "pending_covering": len(pcover), "rejected_covering": len(rcover), "oldest_covering_age_s": min((max(0.0, now-e["mtime"]) for e in pcover), default=None)}
    return pending_all[:50], rejected_all[:50], coverage


def _mcp_readers(request: dict[str, Any], declaration: Any, queue_dir: str, getwd: Optional[Callable[[], Tuple[str, Optional[BaseException]]]] = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """Evaluate only the fixed declared reader table; return values and private guards."""
    local: dict[str, Any] = {}
    guards: dict[str, Any] = {}
    if not isinstance(declaration, dict):
        return local, guards
    dv = declaration.get("v", 1)
    entries = declaration.get("context", [])
    if isinstance(dv, bool) or not isinstance(dv, int) or dv not in (1, 2) or not isinstance(entries, list):
        return {str(e.get("reader", "unknown")): _mcp_failed("unsupported_declaration") for e in entries if isinstance(e, dict)} if isinstance(entries, list) else {}, guards
    rev = declaration.get("rev")
    if not isinstance(rev, str) or re.fullmatch(r"[0-9a-f]{16}", rev) is None:
        return {str(e.get("reader", "unknown")): _mcp_failed("unsupported_declaration") for e in entries if isinstance(e, dict)}, guards
    if "local_actions" in declaration:
        expected = {"v": 2, "local_actions": [_MCP_ACTION]}
        names = {e.get("reader"): e for e in entries if isinstance(e, dict)}
        if dv != expected["v"] or declaration.get("local_actions") != expected["local_actions"] or any(n not in names or names[n].get("required", True) is not True for n in ("resolved_path", "file", "git", "queue", "drain")) or names.get("queue", {}).get("v") != 2:
            return {str(e.get("reader", "unknown")): _mcp_failed("unsupported_declaration") for e in entries if isinstance(e, dict)}, guards
    args = request.get("params", {}).get("arguments", {}) if isinstance(request.get("params"), dict) else {}
    if not isinstance(args, dict):
        return local, guards
    values: dict[str, Any] = {}
    names_seen: set[str] = set()
    deadline = time.monotonic() + _MCP_READERS_TIMEOUT_S
    for entry in entries:
        if time.monotonic() >= deadline:
            values[str(entry.get("reader", ""))] = _mcp_failed("timeout") if isinstance(entry, dict) else _mcp_failed("bad_params")
            continue
        if not isinstance(entry, dict):
            continue
        name, ver, params = entry.get("reader"), entry.get("v", 1), entry.get("params", {})
        if not isinstance(name, str):
            continue
        if name in names_seen:
            values[name] = _mcp_failed("bad_params"); continue
        names_seen.add(name)
        if not isinstance(params, dict):
            values[name] = _mcp_failed("bad_params"); continue
        if "required" in entry and not isinstance(entry["required"], bool):
            values[name] = _mcp_failed("bad_params"); continue
        if dv > 2:
            values[name] = _mcp_failed("unsupported_declaration"); continue
        if name not in _MCP_READER_VERSIONS:
            values[name] = _mcp_failed("unsupported_reader"); continue
        if isinstance(ver, bool) or not isinstance(ver, int) or ver not in _MCP_READER_VERSIONS[name]:
            values[name] = _mcp_failed("unsupported_reader_version"); continue
        allowed_params = {"cwd": set(), "project_dir": set(), "resolved_path": {"path_arg", "bases"}, "file": {"of"}, "git": {"of"}, "queue": {"of", "path"}, "drain": set()}[name]
        if set(params) != allowed_params:
            values[name] = _mcp_failed("bad_params"); continue
        valid_params = True
        if name == "resolved_path":
            bases = params.get("bases")
            valid_params = isinstance(params.get("path_arg"), str) and bool(params.get("path_arg")) and isinstance(bases, list) and all(isinstance(x, str) and x in ("project_dir", "cwd") for x in bases) and len(bases) == len(set(bases))
        elif name == "file":
            valid_params = params.get("of") == "resolved_path"
        elif name == "git":
            valid_params = params.get("of") in ("resolved_path", "project_dir", "cwd")
        elif name == "queue":
            valid_params = params.get("of") == "git" and params.get("path") == "resolved_path"
        if not valid_params:
            values[name] = _mcp_failed("bad_params"); continue
        reader_deadline = min(deadline, time.monotonic() + _MCP_READER_TIMEOUT_S)
        deps = {"file": ["resolved_path"], "git": [], "queue": ["git", "resolved_path"] + (["file"] if ver == 2 else []), "resolved_path": [], "cwd": [], "project_dir": [], "drain": []}[name]
        if any(dep not in values for dep in deps):
            values[name] = _mcp_failed("bad_params"); continue
        try:
            if name == "cwd":
                if getwd is not None:
                    path, error = getwd()
                    if error is not None:
                        raise OSError("cwd unavailable")
                else:
                    path = os.getcwd()
                value = {"path": os.path.normpath(path)}
            elif name == "project_dir":
                path = next((os.environ[k] for k in ("CLAUDE_PROJECT_DIR", "CODEX_PROJECT_DIR", "CURSOR_PROJECT_DIR") if os.environ.get(k)), None)
                value = {"path": os.path.normpath(path) if path else None}
            elif name == "resolved_path":
                pa, bases = params.get("path_arg"), params.get("bases")
                if not isinstance(pa, str) or not isinstance(bases, list):
                    raise ValueError("params")
                raw = args.get(pa)
                base = next((values[b]["path"] for b in bases if isinstance(values.get(b), dict) and values[b].get("path")), None)
                resolved = os.path.normpath(raw if os.path.isabs(raw) else os.path.join(base, raw)) if isinstance(raw, str) and raw and (os.path.isabs(raw) or base) else None
                value = {"path": resolved, "base": base}
            elif name in ("file", "git", "queue"):
                parent = params.get("of")
                pkey = parent if isinstance(parent, str) else (parent[0] if isinstance(parent, list) and parent else None)
                parent_value = values.get(pkey) if pkey else None
                if name == "queue":
                    git_fact = values.get("git")
                    if isinstance(git_fact, dict) and "_failed" in git_fact:
                        raise RuntimeError("dependency")
                    path_fact = values.get(params.get("path"))
                    parent_value = path_fact if isinstance(path_fact, dict) else parent_value
                if isinstance(parent_value, dict) and "_failed" in parent_value:
                    raise RuntimeError("dependency")
                path = parent_value.get("path") if isinstance(parent_value, dict) else None
                if name == "git" and path is None:
                    # git accepts only declared resolved_path/project_dir/cwd facts.
                    path = parent_value.get("path") if isinstance(parent_value, dict) else None
                if not isinstance(path, str):
                    value = {"skipped": "no_input"}
                elif name == "file":
                    try:
                        st = os.stat(path)
                    except FileNotFoundError:
                        # A missing path is a fact. FileNotFoundError is an OSError, so it
                        # must be caught here or the outer handler reports io_error.
                        value = {"exists": False, "is_file": False, "size": None, "mtime": None, "content_hash": None, "withheld": None, "read_error": None}
                    else:
                        is_file = stat.S_ISREG(st.st_mode)
                        value = {"exists": True, "is_file": is_file, "size": st.st_size, "mtime": st.st_mtime, "content_hash": None, "withheld": None, "read_error": None}
                        try:
                            top, rid, rel = _mcp_real_repo(path, reader_deadline)
                            real = os.path.realpath(path)
                            if is_file and st.st_size > 256 << 20:
                                value["withheld"] = "too_large"
                            elif is_file:
                                try:
                                    value["content_hash"] = _mcp_hash_file(real)
                                    guards["file"] = {"path": os.path.normpath(path), "real": real, "top": top, "repo_id": rid, "rel_path": rel, "dev": st.st_dev, "ino": st.st_ino, "size": st.st_size, "mtime": st.st_mtime, "hash": value["content_hash"]}
                                except OSError as exc:
                                    value["read_error"] = type(exc).__name__
                        except ValueError:
                            value["withheld"] = "symlink_out" if os.path.realpath(path) != os.path.abspath(path) else "outside_repo"
                        except FileNotFoundError:
                            # git is not installed. The file is still present; do not hash it.
                            pass
                elif name == "git":
                    try:
                        top, rid, rel = _mcp_real_repo(path, reader_deadline)
                        value = {"repo_id": rid, "rel_path": rel, "error": None}
                        guards["repo"] = {"top": top, "repo_id": rid}
                    except FileNotFoundError:
                        value = {"repo_id": None, "rel_path": None, "error": "git_unavailable"}
                    except ValueError as exc:
                        value = {"repo_id": None, "rel_path": None, "error": "no_commit" if str(exc) == "no commit" else "no_repo"}
                else:
                    gitv = values.get("git", {})
                    filev = values.get("file", {}) if isinstance(values.get("file"), dict) else {}
                    if not isinstance(gitv, dict) or "_failed" in gitv:
                        raise RuntimeError("dependency")
                    empty_coverage = {"complete": True, "pending_covering": 0, "rejected_covering": 0, "oldest_covering_age_s": None}
                    if not gitv.get("repo_id"):
                        # No repository identity means nothing can be queued for this path.
                        value = {"pending": [], "rejected": []}
                        if ver == 2:
                            value["coverage"] = empty_coverage
                    else:
                        mtime = filev.get("mtime")
                        if ver == 2 and (isinstance(mtime, bool) or not isinstance(mtime, (int, float))):
                            if "_failed" in filev:
                                raise RuntimeError("dependency")
                            raise OSError("incomplete queue")
                        abs_file = os.path.realpath(path)
                        pending, rejected, coverage = _mcp_queue_entries(queue_dir, gitv["repo_id"], gitv.get("rel_path") or "", abs_file, float(mtime or 0), reader_deadline)
                        value = {"pending": pending, "rejected": rejected}
                        if ver == 2:
                            value["coverage"] = coverage
            elif name == "drain":
                value = {"running": Running(queue_dir)}
            else:
                value = _mcp_failed("unsupported_reader")
            if len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")) > 65536:
                values[name] = _mcp_failed("over_budget")
            else:
                values[name] = value
        except RuntimeError:
            values[name] = _mcp_failed("dependency_failed")
        except TimeoutError:
            values[name] = _mcp_failed("timeout")
        except ValueError:
            values[name] = _mcp_failed("bad_params")
        except OSError as exc:
            values[name] = _mcp_failed("incomplete_queue" if name == "queue" and str(exc) == "incomplete queue" else "io_error")
        except Exception:
            values[name] = _mcp_failed("internal")
    local.update(values)
    try:
        cfg = Load()
        # Same encoding as the body the shim sends, so an escaped form cannot hide the key.
        encoded = json.dumps(local, separators=(",", ":"), ensure_ascii=False)
        if cfg.Key and cfg.Key in encoded:
            matches = [name for name, value in local.items() if not name.startswith("_") and cfg.Key in json.dumps(value, separators=(",", ":"), ensure_ascii=False)]
            for name in matches or [n for n in local if not n.startswith("_")]:
                local[name] = _mcp_failed("secret_in_context")
    except Exception:
        pass
    return local, guards


def _mcp_context_call(body: bytes, method: str, request: dict[str, Any], declaration: Any, queue_dir: str = "", call: Optional[str] = None, effects: Optional[list[dict[str, Any]]] = None, getwd: Optional[Callable[[], Tuple[str, Optional[BaseException]]]] = None) -> tuple[bytes, dict[str, Any], dict[str, Any], Optional[str]]:
    if method != "tools/call" or not isinstance(request, dict):
        return body, {}, {}, None
    clone = json.loads(body)
    params = clone.get("params")
    if not isinstance(params, dict):
        return body, {}, {}, None
    args = params.get("arguments")
    if not isinstance(args, dict):
        return body, {}, {}, None
    args.pop("_local", None)
    local: dict[str, Any] = {}
    guards: dict[str, Any] = {}
    token: Optional[str] = None
    if isinstance(declaration, dict):
        local, guards = _mcp_readers(request, declaration, queue_dir or QueueDir(), getwd)
        version = declaration.get("v", 1)
        local["_v"] = version
        local["_rev"] = declaration.get("rev", "")
        if version == 2:
            token = call or os.urandom(16).hex()
            local["_call"] = token
        if effects is not None:
            local["effects"] = effects
        args["_local"] = local
    return json.dumps(clone, separators=(",", ":"), ensure_ascii=False).encode("utf-8"), local, guards, token


def _mcp_effect(action_id: Any, ok: bool, outcome: str, error: Optional[str]) -> dict[str, Any]:
    return {"action": "enqueue_file_snapshot", "v": 1, "action_id": action_id, "ok": ok, "outcome": outcome, "error": error}


def _mcp_action_error(code: str, ident: Any, host: str) -> bytes:
    return json.dumps({"jsonrpc": "2.0", "id": ident, "error": {"code": -32000, "message": "bad directive: the server returned an unbound local action. Retry the call.", "data": {"code": code, "host": host}}}, separators=(",", ":")).encode() + b"\n"


def _mcp_enqueue(guards: dict[str, Any], resolved: Any, queue_dir: str, call: str, cancelled: threading.Event, deadline: float, action_id: Any = None) -> dict[str, Any]:
    def failed(code: str, outcome: str = "failed") -> dict[str, Any]:
        return _mcp_effect(action_id, False, outcome, code)
    if os.environ.get("YAKKA_HOOKLOG", "").lower() in ("0", "off", "false"):
        return failed("capture_off")
    if os.environ.get("YAKKA_BIN", ""):
        return failed("yakka_bin_set")
    if not isinstance(resolved, str):
        return failed("path_changed")
    pinned = guards.get("file")
    if not isinstance(pinned, dict) or resolved != pinned.get("path"):
        return failed("path_changed")
    lock = None
    try:
        old_umask = os.umask(0o077)
        try:
            os.makedirs(queue_dir, mode=0o700, exist_ok=True)
            lock = open(os.path.join(queue_dir, ".mcp-enqueue.lock"), "a+b")
        finally:
            os.umask(old_umask)
        while True:
            if cancelled.is_set():
                return failed("effect_unknown", "unknown")
            if time.monotonic() >= deadline:
                return failed("effect_unknown", "unknown")
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                time.sleep(min(0.02, max(0.001, deadline - time.monotonic())))
        if not os.path.isabs(resolved) or os.path.realpath(resolved) != pinned["real"]:
            return failed("path_changed")
        st = os.stat(resolved)
        top, rid, rel = _mcp_real_repo(resolved, deadline)
        if top != pinned["top"] or (st.st_dev, st.st_ino, st.st_size, st.st_mtime, rid, rel) != (pinned["dev"], pinned["ino"], pinned["size"], pinned["mtime"], pinned["repo_id"], pinned["rel_path"]):
            return failed("path_changed")
        digest = hashlib.sha256()
        with open(resolved, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                digest.update(chunk)
        if digest.hexdigest() != pinned["hash"]:
            return failed("path_changed")
        _, rejected, coverage = _mcp_queue_entries(queue_dir, rid, rel, os.path.realpath(resolved), st.st_mtime, deadline)
        if coverage["rejected_covering"]:
            return failed("queue_rejected")
        if coverage["pending_covering"]:
            return _mcp_effect(action_id, True, "covered", None)
        script = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "script", "spool.sh"))
        # The fixed hook payload contains pointer metadata only; it never includes file bytes.
        payload = {"hook_event_name": "PostToolUse", "conversation_id": call, "session_id": call, "cwd": top, "tool_name": "Write", "tool_input": {"file_path": resolved}}
        packet = json.dumps(payload, separators=(",", ":")).encode()
        env = os.environ.copy()
        env["YAKKA_QUEUE"] = queue_dir
        env["YAKKA_SPOOL_PRINT"] = "1"
        timeout = max(0.05, min(10.0, deadline - time.monotonic()))
        if cancelled.is_set() or time.monotonic() >= deadline:
            return failed("effect_unknown", "unknown")
        try:
            out = subprocess.run([script, "--harness", "codex", "--event", "PostToolUse"], input=packet, capture_output=True, timeout=timeout, env=env, check=False)
        except subprocess.TimeoutExpired:
            return failed("effect_unknown", "unknown")
        if out.returncode != 0:
            return failed("spool_dropped")
        ack = out.stdout.decode("ascii", "ignore").strip()
        if not re.fullmatch(r"[A-Za-z0-9._-]+\.evt", ack):
            return failed("spool_dropped")
        return _mcp_effect(action_id, True, "enqueued", None)
    except (OSError, ValueError, TimeoutError):
        return failed("queue_unavailable")
    finally:
        if lock is not None:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
            lock.close()


class _McpRelay:
    def __init__(self, opts: McpOptions) -> None:
        self.opts = opts
        self.declarations: dict[str, Any] = {}
        self.action_capability: Any = None
        self.declarations_lock = threading.Lock()
        self.active: dict[str, Any] = {}
        self.active_lock = threading.Lock()
        self.stdout_lock = threading.Lock()
        self.counter = 0

    def _declaration(self, request: dict[str, Any]) -> Any:
        params = request.get("params")
        name = params.get("name") if isinstance(params, dict) else None
        if not isinstance(name, str):
            return None
        with self.declarations_lock:
            return self.declarations.get(name)

    def _cache_list(self, response: dict[str, Any]) -> None:
        result = response.get("result")
        tools = result.get("tools") if isinstance(result, dict) else None
        found: dict[str, Any] = {}
        if isinstance(tools, list):
            for item in tools:
                if not isinstance(item, dict) or not isinstance(item.get("name"), str):
                    continue
                meta = item.get("_meta")
                declaration = meta.get("yakka/tool") if isinstance(meta, dict) else None
                if declaration is not None:
                    found[item["name"]] = declaration
        with self.declarations_lock:
            self.declarations = found

    def _cache_initialize(self, response: dict[str, Any]) -> None:
        result = response.get("result")
        meta = result.get("_meta") if isinstance(result, dict) else None
        with self.declarations_lock:
            self.action_capability = meta.get("yakka/local-actions") if isinstance(meta, dict) else None

    def _refresh(self, timeout: float, cancelled: threading.Event, active_id: Any) -> None:
        with self.stdout_lock:
            self.counter += 1
            ident = f"yakka-internal-{self.counter}"
        request = json.dumps({"jsonrpc": "2.0", "id": ident, "method": "tools/list"}, separators=(",", ":")).encode()
        status, raw, _, _ = self._post(request, timeout, cancelled, active_id)
        response = _mcp_response(raw) if status is not None and status < 300 else None
        if response is not None and "error" not in response:
            self._cache_list(response)

    def _action_supported(self, timeout: float, cancelled: threading.Event, active_id: Any) -> bool:
        with self.declarations_lock:
            self.action_capability = None
        with self.stdout_lock:
            self.counter += 1
            internal_id = f"yakka-internal-init-{self.counter}"
        request = json.dumps({"jsonrpc": "2.0", "id": internal_id, "method": "initialize", "params": {"protocolVersion": "2025-11-25", "capabilities": {}}}, separators=(",", ":")).encode()
        status, raw, problem, _ = self._post(request, min(timeout, 10.0), cancelled, active_id)
        response = _mcp_response(raw) if status is not None and not problem else None
        if response is not None and "error" not in response:
            self._cache_initialize(response)
        with self.declarations_lock:
            cap = self.action_capability
        return cap == _MCP_ACTION_CAPABILITY

    def _endpoint(self, cfg: Config) -> tuple[str, str, int, bool]:
        base = _request_base(cfg.Endpoint)
        if base is None:
            raise ValueError("invalid endpoint")
        parts = urllib.parse.urlsplit(base)
        if parts.path not in ("", "/"):
            raise ValueError("endpoint must be an origin")
        host = parts.hostname or ""
        secure = parts.scheme == "https"
        try:
            port = parts.port or (443 if secure else 80)
        except ValueError as exc:
            raise ValueError("invalid endpoint") from exc
        if not secure:
            try:
                loopback = host.lower() == "localhost" or ipaddress.ip_address(host).is_loopback
            except ValueError:
                loopback = False
            if not loopback and cfg.Key:
                raise ValueError("cleartext endpoint is not loopback")
        return host, parts.scheme, port, secure

    def _post(self, body: bytes, timeout: float, cancelled: threading.Event, active_id: Any) -> tuple[Optional[int], bytes, str, str]:
        cfg: Optional[Config] = None
        host = ""
        try:
            cfg = Load()
            host, scheme, port, secure = self._endpoint(cfg)
            auth = _bearer_header(cfg.Key) if not cfg.Local else ""
            if auth is None:
                raise ValueError("invalid bearer header")
        except (ErrPartialEnv, OSError, ValueError) as exc:
            return None, b"", "config:" + str(exc), host
        if cancelled.is_set():
            return None, b"", "cancelled", host
        conn: Any = None
        slot = _mcp_id_key(active_id)
        try:
            cls = http.client.HTTPSConnection if secure else http.client.HTTPConnection
            # Connect is bounded separately from the call. A connect failure has not sent the request.
            conn = cls(host, port, timeout=min(_MCP_CONNECT_TIMEOUT_S, max(0.05, timeout)))
            with self.active_lock:
                self.active[slot] = conn
            if cancelled.is_set():
                conn.close()
                return None, b"", "cancelled", host
            try:
                conn.connect()
            except (TimeoutError, socket.timeout, OSError):
                return None, b"", "network", host
            if conn.sock is not None:
                conn.sock.settimeout(timeout)
            version = (self.opts.Version or _plugin_version_text()).replace("\r", "").replace("\n", "")
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Yakka-Context": "2",
                "Yakka-Local-Actions": "enqueue_file_snapshot/1",
                "User-Agent": "yakka-shim/" + version,
            }
            if auth:
                headers["Authorization"] = auth
            conn.request("POST", "/v1/mcp", body=body, headers=headers)
            response = conn.getresponse()
            raw = response.read(_MCP_MAX_BODY + 1)
            status = response.status
            if len(raw) > _MCP_MAX_BODY:
                return status, raw, "oversize", host
            if status in (504, 524):
                return status, raw, "timeout", host
            if 300 <= status < 400:
                # Name only the redirect target's host, never the Location URL.
                target = _mcp_host(response.getheader("Location") or "") or host
                return status, raw, "redirect", target
            return status, raw, "", host
        except (TimeoutError, socket.timeout):
            return None, b"", "timeout", host
        except (OSError, http.client.HTTPException, ValueError):
            return None, b"", "network", host
        finally:
            if conn is not None:
                with self.active_lock:
                    if self.active.get(slot) is conn:
                        self.active.pop(slot, None)
                conn.close()

    def _timeout(self, method: str, declaration: Any) -> float:
        if method != "tools/call":
            return 10.0
        seconds = declaration.get("timeout_s", 5) if isinstance(declaration, dict) else 5
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or seconds <= 0:
            seconds = 5
        return min(float(seconds), 300.0) + 5.0

    def _dispatch(self, body: bytes, request: Optional[dict[str, Any]], ident: Any, method: str, expects_reply: bool, cancelled: threading.Event) -> None:
        host = ""
        declaration = self._declaration(request or {}) if method == "tools/call" else None
        timeout = self._timeout(method, declaration)
        call_deadline = time.monotonic() + timeout
        if method == "tools/call" and declaration is None:
            self._refresh(min(10.0, max(0.05, call_deadline - time.monotonic())), cancelled, ident)
            declaration = self._declaration(request or {})
        outbound, initial_local, guards, call_token = _mcp_context_call(body, method, request or {}, declaration, self.opts.QueueDir, getwd=self.opts.Getwd)
        remaining = call_deadline - time.monotonic()
        if remaining <= 0:
            status, raw, problem = None, b"", "timeout"
        else:
            status, raw, problem, host = self._post(outbound, remaining, cancelled, ident)
        if cancelled.is_set() or not expects_reply:
            return
        effect_outcome: Optional[str] = None
        response = _mcp_response(raw) if status is not None else None
        first_error = response.get("error") if isinstance(response, dict) else None
        if method == "tools/call" and isinstance(first_error, dict) and first_error.get("code") == -32010 and not cancelled.is_set():
            # One refresh before any local effect. A later stale error is relayed as-is.
            self._refresh(min(10.0, max(0.05, call_deadline - time.monotonic())), cancelled, ident)
            declaration = self._declaration(request or {})
            outbound, initial_local, guards, call_token = _mcp_context_call(body, method, request or {}, declaration, self.opts.QueueDir, getwd=self.opts.Getwd)
            status, raw, problem, host = self._post(outbound, max(0.05, call_deadline - time.monotonic()), cancelled, ident)
            response = _mcp_response(raw) if status is not None and not problem else None
        server_error = response.get("error") if isinstance(response, dict) else None
        directive = server_error.get("data") if isinstance(server_error, dict) and server_error.get("code") == -32011 else None
        if method == "tools/call" and isinstance(server_error, dict) and server_error.get("code") == -32011:
            if not isinstance(directive, dict) or directive.get("code") != "local_action_required":
                reply = _mcp_action_error("bad_directive", ident, host)
                with self.stdout_lock:
                    self._write(reply)
                return
            resolved = initial_local.get("resolved_path") if isinstance(initial_local, dict) else None
            resolved_path = resolved.get("path") if isinstance(resolved, dict) else None
            safely_bound = (
                isinstance(declaration, dict) and declaration.get("v") == 2 and call_token is not None
                and type(directive.get("v")) is int and directive.get("v") == 1 and directive.get("call") == call_token
                and directive.get("rev") == declaration.get("rev")
                and isinstance(directive.get("action_id"), str) and 0 < len(directive["action_id"]) <= 128
                and isinstance(resolved_path, str) and directive.get("path") == resolved_path
            )
            if not safely_bound:
                reply = _mcp_action_error("bad_directive", ident, host)
                with self.stdout_lock:
                    self._write(reply)
                return
            self._refresh(max(0.05, call_deadline - time.monotonic()), cancelled, ident)
            if self._declaration(request or {}) != declaration:
                reply = _mcp_action_error("bad_directive", ident, host)
                with self.stdout_lock:
                    self._write(reply)
                return
            supported = self._action_supported(max(0.05, call_deadline - time.monotonic()), cancelled, ident)
            declared = declaration.get("local_actions") == [_MCP_ACTION]
            if directive.get("action") != "enqueue_file_snapshot" or type(directive.get("action_v")) is not int or directive.get("action_v") != 1 or not declared or not supported:
                effect = _mcp_effect(directive["action_id"], False, "failed", "unsupported")
            elif cancelled.is_set():
                return
            else:
                effect = _mcp_enqueue(guards, resolved_path, self.opts.QueueDir, call_token, cancelled, call_deadline, directive["action_id"])
            effect_outcome = effect["outcome"]
            continuation, _, _, same_call = _mcp_context_call(body, method, request or {}, declaration, self.opts.QueueDir, call_token, [effect], self.opts.Getwd)
            if same_call != call_token:
                reply = _mcp_action_error("bad_directive", ident, host)
                with self.stdout_lock:
                    self._write(reply)
                return
            remaining = call_deadline - time.monotonic()
            if remaining <= 0:
                status, raw, problem = None, b"", "timeout"
            else:
                status, raw, problem, host = self._post(continuation, remaining, cancelled, ident)
            if problem and not cancelled.is_set():
                # After the effect, retry only the same result facts; never run the primitive again.
                remaining = call_deadline - time.monotonic()
                if remaining > 0:
                    status, raw, problem, host = self._post(continuation, remaining, cancelled, ident)
            if cancelled.is_set():
                return
            response = _mcp_response(raw) if status is not None and not problem else None
            again = response.get("error") if isinstance(response, dict) else None
            if isinstance(again, dict) and again.get("code") == -32011:
                reply = _mcp_action_error("bad_directive", ident, host)
                with self.stdout_lock:
                    self._write(reply)
                return
        if problem == "timeout":
            reply = _mcp_error("timeout", "the server did not reply in time", host, ident, effect_outcome=effect_outcome)
        elif problem == "redirect":
            reply = _mcp_error("redirect refused", "the endpoint redirected the request", host, ident)
        elif problem == "oversize":
            reply = _mcp_error("bad reply", "the response exceeded 8 MiB", host, ident)
        elif problem.startswith("config:"):
            reply = _mcp_error("bad config", "login or endpoint configuration is unusable", host, ident)
        elif problem or status is None:
            reply = _mcp_error("unreachable", "the configured server could not be reached", host, ident, _mcp_queued_count(self.opts.QueueDir), effect_outcome)
        else:
            response = _mcp_response(raw)
            if response is not None:
                if method == "initialize" and "error" not in response:
                    self._cache_initialize(response)
                if method == "tools/list" and "error" not in response:
                    self._cache_list(response)
                # Do not start a second call here. After an enqueue, a fresh tools/call
                # would drop the effect facts and could ask for the action again.
                reply = raw + b"\n"
            elif status == 401:
                reply = _mcp_error("unauthorized", "the server rejected the credential", host, ident)
            elif status in (404, 405):
                reply = _mcp_error("server unsupported", "the server does not support this endpoint", host, ident)
            elif response is None:
                if status >= 500:
                    reply = _mcp_error("unreachable", "the configured server returned an HTTP error", host, ident, _mcp_queued_count(self.opts.QueueDir))
                else:
                    reply = _mcp_error("bad reply", "the server returned a non-JSON-RPC response", host, ident)
        if not cancelled.is_set():
            with self.stdout_lock:
                self._write(reply)

    def _write(self, reply: bytes) -> None:
        # Serve installs its output stream here so each complete frame is serialized.
        writer = getattr(self, "writer", None)
        if writer is not None:
            writer.write(reply)
            writer.flush()

    def cancel(self, request_id: Any) -> None:
        with self.active_lock:
            conn = self.active.get(_mcp_id_key(request_id))
        if conn is not None:
            conn.close()


def Serve(r: Any, w: Any, opts: McpOptions) -> Optional[BaseException]:
    opts.defaults()
    relay = _McpRelay(opts)
    relay.writer = w
    pending: dict[str, threading.Event] = {}
    inflight: set[threading.Event] = set()
    pending_lock = threading.Lock()
    pool = ThreadPoolExecutor(max_workers=_MCP_WORKERS, thread_name_prefix="yakka-mcp")
    try:
        while True:
            if opts.Cancelled():
                break
            line = r.readline(_MCP_MAX_BODY + 3)
            if not line:
                break
            if not line.endswith(b"\n") and len(line) > _MCP_MAX_BODY + 2:
                while True:
                    extra = r.readline(65536)
                    if not extra or extra.endswith(b"\n"):
                        break
                with relay.stdout_lock:
                    relay._write(_mcp_error("bad reply", "the request exceeded 8 MiB", "", None))
                continue
            if len(line.rstrip(b"\r\n")) > _MCP_MAX_BODY:
                with relay.stdout_lock:
                    relay._write(_mcp_error("bad reply", "the request exceeded 8 MiB", "", None))
                continue
            if not line.strip():
                continue
            request, ident, method = _mcp_parse(line)
            params = request.get("params") if request else None
            if method == _MCP_CANCEL:
                cancelled_id = params.get("requestId") if isinstance(params, dict) else None
                if cancelled_id is not None:
                    with pending_lock:
                        event = pending.get(_mcp_id_key(cancelled_id))
                        if event is not None:
                            event.set()
                    relay.cancel(cancelled_id)
                continue
            expects_reply = request is None or "id" in request or not method
            event = threading.Event()
            with pending_lock:
                inflight.add(event)
            if expects_reply:
                with pending_lock:
                    pending[_mcp_id_key(ident)] = event
            def run(raw: bytes = line.rstrip(b"\r\n"), req: Optional[dict[str, Any]] = request, rid: Any = ident, meth: str = method, wants_reply: bool = expects_reply, ev: threading.Event = event) -> None:
                try:
                    relay._dispatch(raw, req, rid, meth, wants_reply, ev)
                except (OSError, ValueError):
                    if wants_reply and not ev.is_set():
                        with relay.stdout_lock:
                            relay._write(_mcp_error("bad reply", "the relay could not process the response", "", rid))
                finally:
                    if wants_reply:
                        with pending_lock:
                            pending.pop(_mcp_id_key(rid), None)
                    with pending_lock:
                        inflight.discard(ev)
            pool.submit(run)
        with pending_lock:
            for event in inflight:
                event.set()
        with relay.active_lock:
            active = list(relay.active.values())
        for conn in active:
            conn.close()
        return None
    finally:
        pool.shutdown(wait=True, cancel_futures=True)


def cmd_mcp(argv: List[str]) -> int:
    if len(argv) > 2:
        print("usage: yakka mcp (no arguments)\n", file=sys.stderr)
        return 2
    version = _plugin_version_text()
    err = Serve(sys.stdin.buffer, sys.stdout.buffer, McpOptions(Version=version))
    if err is not None and not isinstance(err, InterruptedError):
        print("yakka mcp:", err, file=sys.stderr)
        return 1
    return 0


# --- login ---

DefaultEndpoint = "https://api.yakka.build"
_NO_DEVICE_LOGIN = "this endpoint has no device login"


def normalize_origin(raw: str) -> Tuple[str, Optional[BaseException]]:
    msg = "endpoint must be a collector origin (scheme and host, no path)"
    raw = raw.strip()
    try:
        u = urllib.parse.urlsplit(raw)
    except ValueError:
        return "", ValueError(msg)
    if u.scheme not in ("http", "https") or not u.hostname or u.path not in ("", "/"):
        return "", ValueError(msg)
    base = _request_base(raw)
    if base is None or urllib.parse.urlsplit(base).path not in ("",):
        return "", ValueError(msg)
    return base, None


def resolve_endpoint(flag: str, sync: bool = False) -> Tuple[str, Optional[BaseException]]:
    """--endpoint, else endpoint in client.toml, else DefaultEndpoint (login only).

    A sync login never reads client.toml: its credential is separate from the drain's, so the
    drain's current target says nothing about where to migrate to.
    """
    flag = flag.strip()
    if flag:
        return normalize_origin(flag)
    if sync:
        return DefaultEndpoint, None
    try:
        with open(Path(), encoding="utf-8") as f:
            data = f.read()
    except FileNotFoundError:
        return DefaultEndpoint, None
    except OSError as err:
        return "", OSError(f"read config: {err}")
    for line in data.split("\n"):
        line = line.strip()
        m = _line_re.match(line)
        if not m or m.group(1) != "endpoint":
            continue
        try:
            v = json.loads(m.group(2))
        except json.JSONDecodeError:
            continue
        if not v:
            continue
        return normalize_origin(v)
    return DefaultEndpoint, None


def write_client_config(path: str, endpoint: str, key: str) -> Optional[BaseException]:
    try:
        os.makedirs(os.path.dirname(path), mode=0o755, exist_ok=True)
    except OSError as err:
        return err
    content = f'endpoint = {json.dumps(endpoint)}\nkey = {json.dumps(key)}\n'
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    except OSError as err:
        return err
    try:
        try:
            os.fchmod(fd, 0o600)
        except (AttributeError, NotImplementedError):
            pass
        os.write(fd, content.encode("utf-8"))
    except OSError as err:
        return err
    finally:
        os.close(fd)
    return None


def default_open_browser(url: str) -> Optional[BaseException]:
    cmd = os.environ.get("YAKKA_LOGIN_BROWSER", "").strip()
    if cmd:
        argv = [cmd, url]
    elif sys.platform == "darwin":
        argv = ["open", url]
    elif sys.platform == "win32":
        argv = ["cmd", "/c", "start", url]
    else:
        argv = ["xdg-open", url]
    try:
        subprocess.Popen(argv, close_fds=True)
    except OSError as err:
        return err
    return None


def _pending_path() -> str:
    return Path() + ".pending"


def _rfc3339(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def _parse_rfc3339(s: str) -> float:
    return calendar.timegm(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ"))


def _device_post(
    base: str, path: str, body: dict, timeout: float = 30.0
) -> Tuple[int, Optional[dict]]:
    """POST JSON; returns (status, parsed object or None). Status 0 is a network error."""
    req = urllib.request.Request(
        base + path, data=json.dumps(body).encode("utf-8"), method="POST"
    )
    req.add_header("Content-Type", "application/json")
    try:
        with _urlopen_noredir(req, timeout=timeout) as resp:
            status = resp.status
            data = resp.read(65536)
    except urllib.error.HTTPError as e:
        status = e.code
        try:
            data = e.read(65536)
        except Exception:
            data = b""
        _close_resp(e)
    except Exception:
        return 0, None
    try:
        out = json.loads(data.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return status, None
    return status, out if isinstance(out, dict) else None


def _write_pending(info: dict) -> Optional[BaseException]:
    path = _pending_path()
    tmp = path + ".tmp"
    try:
        os.makedirs(os.path.dirname(path), mode=0o755, exist_ok=True)
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            try:
                os.fchmod(fd, 0o600)
            except (AttributeError, NotImplementedError):
                pass
            os.write(fd, json.dumps(info).encode("utf-8"))
        finally:
            os.close(fd)
        os.replace(tmp, path)
    except OSError as err:
        return err
    return None


def _remove_pending() -> None:
    try:
        os.unlink(_pending_path())
    except OSError:
        pass


def _start(
    endpoint_flag: str,
    stdout: Any,
    stderr: Any,
    clock: Callable[[], float],
    sync: bool = False,
) -> Tuple[Optional[dict], int]:
    base, err = resolve_endpoint(endpoint_flag, sync)
    if err is not None:
        print("yakka login:", err, file=stderr)
        return None, 1
    # The host name becomes the default token name on the approval page.
    status, out = _device_post(base, "/v1/device/code", {"host": socket.gethostname()})
    if status == 404:
        print(f"yakka login: {_NO_DEVICE_LOGIN}", file=stderr)
        return None, 1
    if status == 0:
        print("yakka login: could not reach the endpoint", file=stderr)
        return None, 1
    if status != 200 or out is None:
        print(f"yakka login: device code request failed ({status})", file=stderr)
        return None, 1
    dc, uc = out.get("device_code"), out.get("user_code")
    url = out.get("verification_uri_complete")
    exp, iv = out.get("expires_in"), out.get("interval")
    if (
        not all(isinstance(x, str) and x for x in (dc, uc, url))
        or not isinstance(exp, int)
        or isinstance(exp, bool)
        or exp <= 0
        or not isinstance(iv, int)
        or isinstance(iv, bool)
        or iv <= 0
    ):
        print("yakka login: invalid device code response", file=stderr)
        return None, 1
    expires_at = _rfc3339(clock() + exp)
    werr = _write_pending(
        {
            "endpoint": base,
            "device_code": dc,
            "user_code": uc,
            "interval": iv,
            "expires_at": expires_at,
            "target": "sync" if sync else "client",
        }
    )
    if werr is not None:
        print(f"yakka login: write pending file: {werr}", file=stderr)
        return None, 1
    print(f"url: {url}", file=stdout)
    print(f"code: {uc}", file=stdout)
    print(f"expires: {expires_at}", file=stdout)
    stdout.flush()
    return {"url": url}, 0


def login_start(
    endpoint_flag: str = "",
    stdout: Any = None,
    stderr: Any = None,
    clock: Callable[[], float] = time.time,
    sync: bool = False,
) -> int:
    stdout = stdout if stdout is not None else sys.stdout
    stderr = stderr if stderr is not None else sys.stderr
    _, rc = _start(endpoint_flag, stdout, stderr, clock, sync)
    return rc


def login_wait(
    stderr: Any = None,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.time,
) -> int:
    stderr = stderr if stderr is not None else sys.stderr
    try:
        with open(_pending_path(), encoding="utf-8") as f:
            p = json.load(f)
        base, dc = p["endpoint"], p["device_code"]
        interval = int(p["interval"])
        deadline = _parse_rfc3339(p["expires_at"])
        # A pending file from before --sync existed has no target and is a normal login.
        target = p.get("target", "client")
        if (
            not isinstance(base, str)
            or not isinstance(dc, str)
            or interval <= 0
            or target not in ("client", "sync")
        ):
            raise ValueError("bad pending file")
    except FileNotFoundError:
        print("yakka login: no pending login (run yakka login start)", file=stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError):
        print("yakka login: invalid pending login file; run yakka login start", file=stderr)
        _remove_pending()
        return 1
    while True:
        sleep(interval)
        if clock() >= deadline:
            break
        status, out = _device_post(base, "/v1/device/token", {"device_code": dc})
        if status == 200 and out is not None:
            token = out.get("token")
            if not isinstance(token, str) or not token or _bearer_header(token) is None:
                print("yakka login: invalid token response", file=stderr)
                _remove_pending()
                return 1
            ep = out.get("endpoint")
            ep = normalize_origin(ep)[0] if isinstance(ep, str) and ep else ""
            tenant = out.get("tenant")
            dest = SyncPath() if target == "sync" else Path()
            werr = write_client_config(dest, ep or base, token)
            if werr is not None:
                print(f"yakka login: write config: {werr}", file=stderr)
                _remove_pending()
                return 1
            _remove_pending()
            print(f"wrote {dest}", file=stderr)
            print(f"tenant: {tenant if isinstance(tenant, str) else ''}", file=stderr)
            return 0
        code = out.get("error") if out is not None else None
        if status == 400 and code == "slow_down":
            interval += 5
        elif status == 400 and code == "access_denied":
            print("yakka login: login was denied", file=stderr)
            _remove_pending()
            return 1
        elif status == 400 and code == "expired_token":
            print("yakka login: login code expired; run yakka login start", file=stderr)
            _remove_pending()
            return 1
        # authorization_pending, rate limits, 5xx and network errors: keep polling
    print("yakka login: login code expired; run yakka login start", file=stderr)
    _remove_pending()
    return 1


def run_login(
    endpoint_flag: str = "",
    stdout: Any = None,
    stderr: Any = None,
    open_browser: Optional[Callable[[str], Optional[BaseException]]] = None,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.time,
    sync: bool = False,
) -> int:
    stdout = stdout if stdout is not None else sys.stdout
    stderr = stderr if stderr is not None else sys.stderr
    info, rc = _start(endpoint_flag, stdout, stderr, clock, sync)
    if info is None:
        return rc
    open_fn = open_browser if open_browser is not None else default_open_browser
    try:
        open_fn(info["url"])
    except Exception:
        pass
    return login_wait(stderr, sleep, clock)


# --- status ---


def run_status(w: Any) -> int:
    st = QueueStatus(QueueDir())
    print(f"queue: {st.Dir}", file=w)
    print(f"queued: {st.Queued}", file=w)
    if st.OldestAge < 0:
        print("oldest: -", file=w)
    else:
        print(f"oldest: {int(st.OldestAge)}", file=w)
    print(f"rejected: {st.Rejected}", file=w)
    if st.Running:
        print("drain: running", file=w)
    else:
        print("drain: not running", file=w)
    try:
        cfg = Load()
    except ErrPartialEnv as err:
        print(f"config: {err}", file=w)
        print("endpoint: -", file=w)
        return 1
    except (OSError, ValueError):
        print(f"config: {Path()} (invalid)", file=w)
        print("endpoint: -", file=w)
        return 0
    if cfg.Local:
        print("config: none (local mode)", file=w)
    elif os.environ.get(_ENV_ENDPOINT, "").strip() and os.environ.get(_ENV_KEY, "").strip():
        print("config: env (remote mode)", file=w)
    else:
        print(f"config: {Path()} (remote mode)", file=w)
    reach = "unreachable"
    base = _request_base(cfg.Endpoint)
    if base is not None:
        req = urllib.request.Request(base.rstrip("/") + "/v1/health", method="GET")
        try:
            with _urlopen(req, timeout=2.0) as resp:
                if 200 <= resp.status < 300:
                    reach = "reachable"
        except Exception:
            pass
    print(f"endpoint: {_shown_endpoint(cfg.Endpoint)} {reach}", file=w)
    if reach == "unreachable" and st.Queued > 0:
        return 1
    return 0


# --- command dispatch ---


def cmd_login(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(prog="yakka login")
    parser.add_argument("sub", nargs="?", choices=["start", "wait"])
    parser.add_argument(
        "--endpoint",
        default="",
        help="collector origin (https URL, no path); default https://api.yakka.build",
    )
    parser.add_argument(
        "--sync",
        action="store_true",
        help="log in for `yakka sync` (writes sync.toml, leaves client.toml and the drain alone)",
    )
    try:
        args = parser.parse_args(argv[2:])
    except SystemExit as e:
        code = e.code
        return int(code) if isinstance(code, int) and code != 0 else 2
    if args.sub == "wait":
        if args.sync or args.endpoint:
            print("yakka login: wait takes no options; they belong to start", file=sys.stderr)
            return 2
        return login_wait()
    if args.sub == "start":
        return login_start(args.endpoint, sync=args.sync)
    return run_login(args.endpoint, sync=args.sync)


def cmd_status(argv: List[str]) -> int:
    if len(argv) > 2:
        print("usage: yakka status (no arguments)\n", file=sys.stderr)
        return 2
    return run_status(sys.stdout)


def cmd_version(argv: List[str]) -> int:
    ver = _plugin_version_text()
    commit = os.environ.get("YAKKA_COMMIT") or "unknown"
    print(f"yakka {ver} {commit}")
    return 0


def cmd_drain(argv: List[str]) -> int:
    ctx = DrainContext()
    return RunStandalone(ctx, sys.stderr)


def main(argv: List[str]) -> int:
    if len(argv) < 2:
        print("yakka: unknown command", file=sys.stderr)
        return 2
    cmd = argv[1]
    if cmd in ("--version", "version"):
        return cmd_version(argv)
    if cmd == "drain":
        return cmd_drain(argv)
    if cmd == "mcp":
        return cmd_mcp(argv)
    if cmd == "login":
        return cmd_login(argv)
    if cmd == "status":
        return cmd_status(argv)
    print("yakka: unknown command", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
