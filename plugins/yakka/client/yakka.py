#!/usr/bin/env python3
"""Yakka plugin client: config, keys, secrets, and command dispatch (stdlib only)."""

from __future__ import annotations

import argparse
import calendar
import fcntl
import hashlib
import http.client
import json
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
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

_MCP_VERSIONS = frozenset(
    {"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"}
)
_MCP_INSTRUCTIONS = (
    "Read-only advice on design, brief and report files: delivery state and "
    "scores for a file, the checks a kind is scored against, and similar past "
    "artifacts."
)
_MCP_FIX_LINE = "Fix: rewrite the file; the new write is the repair."


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
        if self.Wait == 0:
            self.Wait = 1.5
        if self.StartDrain is None:
            self.StartDrain = _mcp_start_drain
        if self.Getwd is None:
            self.Getwd = _mcp_getcwd
        if self.Cancelled is None:
            self.Cancelled = lambda: False


def _mcp_getcwd() -> Tuple[str, Optional[BaseException]]:
    try:
        return os.getcwd(), None
    except OSError as err:
        return "", err


def _mcp_start_drain() -> Optional[BaseException]:
    yakka_bin = os.environ.get("YAKKA_BIN", "")
    if yakka_bin and os.access(yakka_bin, os.X_OK):
        cmd = [yakka_bin, "drain"]
    else:
        script = os.path.abspath(__file__)
        cmd = ["python3", script, "drain"]
    try:
        proc = subprocess.Popen(
            cmd,
            start_new_session=True,
            close_fds=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError as err:
        return err
    threading.Thread(target=proc.wait, daemon=True).start()
    return None


class _McpServer:
    def __init__(self, o: McpOptions) -> None:
        self.o = o

    def _get(
        self,
        cfg: Config,
        path: str,
        q: dict[str, str],
        timeout: float,
    ) -> Tuple[int, bytes, Optional[BaseException]]:
        base = _request_base(cfg.Endpoint)
        if base is None:
            return 0, b"", OSError("request failed")
        params = urllib.parse.urlencode({k: v for k, v in q.items() if v})
        u = base + path
        if params:
            u += "?" + params
        req = urllib.request.Request(u, method="GET")
        if cfg.Key:
            header = _bearer_header(cfg.Key)
            if header is None:
                return 0, b"", OSError("request failed")
            req.add_header("Authorization", header)
        try:
            resp = _urlopen(req, timeout=timeout)
            try:
                body = resp.read(8 << 20)
                return resp.status, body, None
            finally:
                resp.close()
        except urllib.error.HTTPError as err:
            try:
                body = err.read(8 << 20) if err.fp else b""
            finally:
                err.close()
            return err.code, body, None
        except (urllib.error.URLError, OSError, http.client.HTTPException, ValueError):
            return 0, b"", OSError("request failed")

    def _fetch(
        self, path: str, q: dict[str, str], out: dict[str, Any]
    ) -> str:
        try:
            cfg = Load()
        except (ErrPartialEnv, OSError, ValueError) as err:
            return _mcp_bad_config_text(err)
        code, body, err = self._get(cfg, path, q, 3.0)
        if err is not None or code >= 500:
            return "service unreachable at " + _shown_endpoint(cfg.Endpoint)
        if code != 200:
            return (
                f"service refused the request (HTTP {code}) at {_shown_endpoint(cfg.Endpoint)}"
            )
        try:
            parsed = json.loads(body.decode())
        except (json.JSONDecodeError, UnicodeDecodeError):
            return "service at " + _shown_endpoint(cfg.Endpoint) + " returned an unreadable answer"
        if not isinstance(parsed, dict):
            return "service at " + _shown_endpoint(cfg.Endpoint) + " returned an unreadable answer"
        out.update(parsed)
        return ""

    def feedback(self, args: dict[str, Any]) -> Tuple[str, bool]:
        p = args.get("path")
        if not isinstance(p, str) or not p.strip():
            return "path must be a non-empty string", True
        abs_path = p
        if not os.path.isabs(p):
            wd, err = self.o.Getwd()
            if err is not None:
                return "cannot resolve the working directory", True
            abs_path = os.path.join(wd, p)
        abs_path = os.path.normpath(abs_path)
        try:
            info = os.stat(abs_path)
        except OSError:
            return "path does not exist: " + abs_path, True
        if not os.path.isfile(abs_path):
            return "path is a directory, not a file: " + abs_path, True
        try:
            with open(abs_path, "rb") as f:
                data = f.read()
        except OSError:
            return "cannot read " + abs_path, True
        content_hash = ContentHash(data)
        top, rel, in_repo, err = RepoPath(abs_path)

        def untracked(why: str) -> Tuple[str, bool]:
            return (
                "state: not tracked\npath: "
                + abs_path
                + "\n"
                + why
                + "; nothing is captured for this file",
                False,
            )

        if err is not None or not in_repo:
            return untracked("not inside a git repository")
        if not Kind(rel):
            return untracked("not a design, brief or report path")
        repo, rid_err = RepoID(top)
        if rid_err is not None:
            return untracked("repository has no commit yet, so it has no repo_id")
        head = f"path: {rel}\nrepo: {repo}\ncontent_hash: {content_hash}\n"

        def state(st: str, *lines: str) -> Tuple[str, bool]:
            body = "state: " + st + "\n" + head + "\n".join(lines)
            return body, False

        matcher = _McpMatcher(abs_path, rel, repo)
        qdir = self.o.QueueDir
        queued = matcher.scan(qdir)
        cfg: Optional[Config] = None
        cfg_err: Optional[Exception] = None
        try:
            cfg = Load()
        except (ErrPartialEnv, OSError, ValueError) as exc:
            cfg_err = exc
        if queued and cfg_err is None:
            if not Running(qdir):
                drain_err = self.o.StartDrain()
                if drain_err is not None:
                    print(
                        "yakka mcp: could not start the drain:",
                        drain_err,
                        file=sys.stderr,
                    )
        if queued and cfg_err is None and self.o.Wait > 0:
            deadline = time.monotonic() + self.o.Wait
            while queued and time.monotonic() < deadline:
                if self.o.Cancelled():
                    break
                time.sleep(0.1)
                queued = matcher.scan(qdir)
        if queued:
            why = "draining"
            extra: List[str] = []
            if cfg_err is not None:
                why = "bad config (" + Path() + ")"
            elif cfg is not None:
                code, _, herr = self._get(cfg, "/v1/health", {}, 3.0)
                if herr is not None or code >= 500:
                    why = "remote unreachable"
                    extra = ["service unreachable at " + _shown_endpoint(cfg.Endpoint)]
            age_s = f"{int(round(time.time() - queued[0].mod))}s"
            lines = [
                f"{len(queued)} events for this file still queued, oldest {age_s}, {why}"
            ]
            return state("queued", *lines, *extra)
        rej_lines: List[str] = []
        superseded = False
        rej_dir = os.path.join(qdir, "rejected")
        for r in matcher.scan(rej_dir):
            if r.mod < info.st_mtime:
                superseded = True
                continue
            reason_path = os.path.join(rej_dir, r.name + ".reason")
            rej_lines.extend(_mcp_reasons(reason_path))
        if rej_lines:
            return state("rejected", *rej_lines, _MCP_FIX_LINE)
        note: List[str] = []
        if superseded:
            note = ["note: earlier rejection superseded by a later write"]
        if cfg_err is not None:
            return state("bad config", _mcp_bad_config_text(cfg_err), *note)
        code, body, herr = self._get(
            cfg,
            "/v1/artifacts",
            {"repo_id": repo, "path": rel},
            3.0,
        )
        if herr is not None or code >= 500:
            return state(
                "not delivered",
                "nothing queued or rejected locally",
                "service unreachable at " + _shown_endpoint(cfg.Endpoint),
                *note,
            )
        if code == 404:
            return state(
                "not delivered",
                "the service has no version of this file and nothing is queued; "
                "if it was just written, wait for the hook or rewrite the file",
                *note,
            )
        if code != 200:
            return state(
                "not delivered",
                f"service refused the request (HTTP {code}) at {_shown_endpoint(cfg.Endpoint)}",
                *note,
            )
        try:
            artifact = json.loads(body.decode())
        except (json.JSONDecodeError, UnicodeDecodeError):
            return state(
                "not delivered",
                "service at " + _shown_endpoint(cfg.Endpoint) + " returned an unreadable answer",
            )
        if not isinstance(artifact, dict):
            return state(
                "not delivered",
                "service at " + _shown_endpoint(cfg.Endpoint) + " returned an unreadable answer",
            )
        latest = artifact.get("latest")
        if latest is None:
            latest = {}
        elif not isinstance(latest, dict):
            return state(
                "not delivered",
                "service at " + _shown_endpoint(cfg.Endpoint) + " returned an unreadable answer",
            )
        if latest.get("content_hash") != content_hash:
            short = latest.get("content_hash", "")
            if len(short) > 12:
                short = short[:12]
            return state(
                "stale",
                f"current content not yet delivered (service has {short} from "
                f"{latest.get('received_at', '')}); normally a write still in the "
                "batch window",
                *note,
            )
        lines: List[str] = []
        screen = latest.get("screen")
        rejection = latest.get("rejection")
        verdict = screen.get("verdict") if isinstance(screen, dict) else None
        if verdict == "unscreened":
            lines.append("screen: unscreened (no scorer on the service)")
        elif verdict == "pass":
            lines.append("screen: pass by " + str(screen.get("scorer", "")))
        elif verdict:
            lines.append("screen: " + str(verdict))
        elif isinstance(rejection, dict) and rejection.get("stage") == "screen":
            lines.append("screen: flagged: " + str(rejection.get("reason", "")))
            lines.append(_MCP_FIX_LINE)
        else:
            lines.append("screen: awaiting screen")
            if isinstance(rejection, dict) and rejection.get("stage"):
                lines.append(
                    f"rejection at {rejection['stage']}: {rejection.get('reason', '')}"
                )
        scores = latest.get("scores") or []
        bl: dict[str, Any] = {}
        if scores and cfg is not None:
            c, b, berr = self._get(
                cfg, "/v1/baselines", {"kind": Kind(rel)}, 3.0
            )
            if berr is not None or c != 200:
                lines.append("baselines unavailable")
            else:
                try:
                    bl = json.loads(b.decode())
                except (json.JSONDecodeError, UnicodeDecodeError):
                    lines.append("baselines unavailable")
                    bl = {}
        checks_bl = bl.get("checks") if isinstance(bl, dict) else {}
        if not isinstance(checks_bl, dict):
            checks_bl = {}
        for sc in scores:
            if not isinstance(sc, dict):
                continue
            check = sc.get("check", "")
            score = sc.get("score", 0.0)
            if isinstance(score, bool) or not isinstance(score, (int, float)):
                return state(
                    "not delivered",
                    "service at " + _shown_endpoint(cfg.Endpoint) + " returned an unreadable answer",
                )
            b = checks_bl.get(check)
            if not isinstance(b, dict):
                lines.append(f"{check} {score:.2f} (no baseline)")
                continue
            try:
                n = int(b.get("n", 0))
                p25 = float(b.get("p25", 0))
                median = float(b.get("median", 0))
            except (TypeError, ValueError):
                lines.append(f"{check} {score:.2f} (no baseline)")
                continue
            if n < 4:
                lines.append(
                    f"{check} {score:.2f} (baseline n={n}, too few to flag)"
                )
            else:
                tag = " BELOW p25" if score < p25 else ""
                lines.append(
                    f"{check} {score:.2f} (baseline p25 {p25:.2f}, "
                    f"median {median:.2f}, n {n}){tag}"
                )
        versions = artifact.get("versions", 0)
        lines.append(f"versions: {versions}")
        return state("delivered", *lines, *note)

    def list_checks(self, args: dict[str, Any]) -> Tuple[str, bool]:
        kind, bad = _mcp_kind_arg(args, True)
        if bad:
            return bad, True
        out: dict[str, Any] = {}
        msg = self._fetch("/v1/checks", {"kind": kind}, out)
        if msg:
            return msg, False
        checks = out.get("checks") or []
        loaded = out.get("loaded")
        if (loaded is not None and not loaded) or not checks:
            return "no checks loaded on the service", False
        parts: List[str] = []
        for c in checks:
            if not isinstance(c, dict):
                continue
            levels = c.get("levels") or []
            line = f"{c.get('name', '')} [levels {'/'.join(levels)}]"
            if c.get("invert"):
                line += " [inverted]"
            line += f": {c.get('q', '')}"
            parts.append(line)
        return "\n".join(parts), False

    def search(self, args: dict[str, Any]) -> Tuple[str, bool]:
        q = args.get("query")
        if not isinstance(q, str) or not q.strip():
            return "query must be a non-empty string", True
        kind, bad = _mcp_kind_arg(args, False)
        if bad:
            return bad, True
        out: dict[str, Any] = {}
        msg = self._fetch(
            "/v1/search", {"q": q, "kind": kind, "limit": "10"}, out
        )
        if msg:
            return msg, False
        hits = out.get("hits") or []
        if not hits:
            return "no matches", False
        parts: List[str] = []
        for h in hits:
            if not isinstance(h, dict):
                continue
            parts.append(
                f"{h.get('kind', '')} {h.get('repo_id', '')}:"
                f"{h.get('path', '')} (rank {h.get('rank', 0)})\n"
                f"{h.get('snippet', '')}\n"
            )
        return "\n".join(parts).rstrip("\n"), False


class _McpMatcher:
    def __init__(self, abs_path: str, rel: str, repo: str) -> None:
        self.abs = abs_path
        self.rel = rel
        self.repo = repo
        self.cache: dict[str, Tuple[str, str]] = {}

    def _key(self, p: str) -> Tuple[str, str]:
        if p in self.cache:
            return self.cache[p]
        k = ("", "")
        top, rel, in_repo, err = RepoPath(p)
        if err is None and in_repo:
            rid, rid_err = RepoID(top)
            if rid_err is None:
                k = (rid, rel)
        self.cache[p] = k
        return k

    def scan(self, dir_path: str) -> List[_QueueEntry]:
        try:
            names = os.listdir(dir_path)
        except OSError:
            return []
        out: List[_QueueEntry] = []
        for n in names:
            if n.startswith(".") or not n.endswith(".evt"):
                continue
            path = os.path.join(dir_path, n)
            try:
                st = os.stat(path)
            except OSError:
                continue
            if not os.path.isfile(path):
                continue
            try:
                with open(path, "rb") as f:
                    raw = f.read()
            except OSError:
                continue
            paths = WritePaths(raw)
            if not paths:
                continue
            matched = False
            for wp in paths:
                if wp == self.abs:
                    matched = True
                    break
                k = self._key(wp)
                if k[0] == self.repo and k[1] == self.rel:
                    matched = True
                    break
            if matched:
                out.append(_QueueEntry(n, st.st_mtime))
        out.sort(key=lambda x: x.mod)
        return out


def _mcp_reasons(path: str) -> List[str]:
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return []
    out: List[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        if ": " in line:
            _, line = line.split(": ", 1)
        out.append(line)
    return out


def _mcp_bad_config_text(err: Exception) -> str:
    return f"client config at {Path()} is unusable: {err}"


def _mcp_kind_arg(args: dict[str, Any], required: bool) -> Tuple[str, str]:
    if "kind" not in args and not required:
        return "", ""
    k = args.get("kind")
    if k not in ("design", "brief", "report"):
        return "", "kind must be one of design, brief, report"
    return k, ""


def _mcp_schema(props: dict[str, Any], *required: str) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": props,
        "required": list(required),
        "additionalProperties": False,
    }


_KIND_ENUM = {"type": "string", "enum": ["design", "brief", "report"]}

_MCP_TOOL_LIST = [
    {
        "name": "artifact_feedback",
        "description": (
            "State of one design, brief or report file: queued, rejected (with the "
            "reason), delivered (screen verdict, scores against the tenant baseline), "
            "stale or not delivered."
        ),
        "inputSchema": _mcp_schema(
            {
                "path": {
                    "type": "string",
                    "description": (
                        "path of the file, absolute or relative to the working directory"
                    ),
                }
            },
            "path",
        ),
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "list_checks",
        "description": "The checks a design, brief or report is scored against.",
        "inputSchema": _mcp_schema({"kind": _KIND_ENUM}, "kind"),
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "search_artifacts",
        "description": (
            "Similar past designs, briefs and reports in this tenant, with path, "
            "repo and a snippet."
        ),
        "inputSchema": _mcp_schema(
            {"query": {"type": "string"}, "kind": _KIND_ENUM},
            "query",
        ),
        "annotations": {"readOnlyHint": True},
    },
]


def _mcp_fail(id_raw: Any, code: int, msg: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": id_raw,
        "error": {"code": code, "message": msg},
    }


def _mcp_handle(server: _McpServer, line: bytes) -> Optional[dict[str, Any]]:
    try:
        v = json.loads(line)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _mcp_fail(None, -32700, "parse error")
    if not isinstance(v, dict):
        return _mcp_fail(None, -32600, "invalid request: expected a single JSON object")
    rq_id = v.get("id")
    method = v.get("method", "")
    params = v.get("params")
    if not method:
        return _mcp_fail(rq_id, -32600, "invalid request")
    if rq_id is None:
        return None

    def ok(res: Any) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": rq_id, "result": res}

    if method == "initialize":
        pv = "2025-11-25"
        if isinstance(params, dict):
            client_pv = params.get("protocolVersion", "")
            if client_pv in _MCP_VERSIONS:
                pv = client_pv
        return ok(
            {
                "protocolVersion": pv,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "yakka", "version": server.o.Version},
                "instructions": _MCP_INSTRUCTIONS,
            }
        )
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": _MCP_TOOL_LIST})
    if method == "tools/call":
        if not isinstance(params, dict):
            params = {}
        name = params.get("name", "")
        args_raw = params.get("arguments")
        args: dict[str, Any] = {}
        arg_err = ""
        if args_raw is not None:
            if not isinstance(args_raw, dict):
                arg_err = "arguments must be an object"
            else:
                args = args_raw
        if name not in ("artifact_feedback", "list_checks", "search_artifacts"):
            return _mcp_fail(rq_id, -32602, "unknown tool")
        if arg_err:
            text, bad = arg_err, True
        elif name == "artifact_feedback":
            text, bad = server.feedback(args)
        elif name == "list_checks":
            text, bad = server.list_checks(args)
        else:
            text, bad = server.search(args)
        return ok(
            {
                "content": [{"type": "text", "text": text}],
                "isError": bad,
            }
        )
    return _mcp_fail(rq_id, -32601, "method not found: " + method)


def Serve(
    r: Any, w: Any, opts: McpOptions
) -> Optional[BaseException]:
    opts.defaults()
    server = _McpServer(opts)
    lines: Queue[bytes] = Queue()

    def reader() -> None:
        while True:
            line = r.readline()
            if not line:
                break
            if line.strip():
                lines.put(line)

    t = threading.Thread(target=reader, daemon=True)
    t.start()
    while True:
        if opts.Cancelled():
            return InterruptedError()
        try:
            line = lines.get(timeout=0.05)
        except Empty:
            if not t.is_alive() and lines.empty():
                return None
            continue
        resp = _mcp_handle(server, line)
        if resp is not None:
            out = json.dumps(resp, separators=(",", ":")).encode() + b"\n"
            try:
                w.write(out)
                w.flush()
            except OSError as err:
                return err


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
    status, out = _device_post(base, "/v1/device/code", {})
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
