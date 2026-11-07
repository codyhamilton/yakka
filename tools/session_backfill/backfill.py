#!/usr/bin/env python3
"""Deterministic, offline first pass for session work labels.

All store roots and queue-log roots are explicit inputs. The normal CLI defaults
are provided by `cli.py`; tests use temporary synthetic roots.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
import os
import re
import secrets
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "plugins/yakka/client"))
import yakka  # noqa: E402


PLAN_RE = re.compile(r"(?:docs/plans/|\bplan[: /]|(?:^|[/\\])(?:feat|worktree)[/:])([0-9]{1,3}-[a-z0-9][a-z0-9._-]*)", re.I)
PHASE_RE = re.compile(r"\bphase\s+0*([1-9][0-9]?)\b", re.I)
ISSUE_RE = re.compile(r"(?<![\w/])#([1-9][0-9]{0,8})\b")
PR_RE = re.compile(r"(?i)\b(?:pull\s+request|PR)\s*#?([1-9][0-9]{0,8})\b")
FLASH_RE = re.compile(r"flash", re.I)
SECRET_ASSIGN_RE = re.compile(r"(?i)\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+")
QUEUE_FILE_RE = re.compile(r"^par-(.+)-(\d{1,2}|[a-z][a-z0-9-]*)-(claude|codex|opencode|cursor)-\d+\.log$", re.I)
SAFE_SESSION_RE = re.compile(r"^[A-Za-z0-9._:-]{1,200}$")


@dataclass
class Session:
    # Empty when a Codex rollout has no usable transcript identity.
    session_id: str
    store: str
    path: str
    text: str
    cwd: str = ""
    branch: str = ""
    files: list[str] = field(default_factory=list)
    # Set when the transcript could not be read or has no parseable records.
    # Such a session is still labelled (unresolved) so it is never silently dropped.
    unreadable: bool = False


@dataclass
class Label:
    session_id: str
    store: str
    status: str
    action: dict[str, str] = field(default_factory=dict)
    evidence: str = ""
    confidence: float = 0.0
    source_file: str = ""


def _walk_strings(value, out: list[str], key_values: dict[str, list[str]]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if isinstance(child, (str, int, float)):
                key_values.setdefault(str(key).lower(), []).append(str(child))
            _walk_strings(child, out, key_values)
    elif isinstance(value, list):
        for child in value:
            _walk_strings(child, out, key_values)
    elif isinstance(value, str):
        out.append(value)


def _unreadable(path: Path, store: str, session_id: str | None) -> Session:
    # Codex identity comes only from session_meta, so an unreadable rollout has none.
    sid = "" if store == "codex" else (session_id or path.stem)
    return Session(sid, store, str(path), "", unreadable=True)


def read_session(path: Path, store: str, session_id: str | None = None, related_paths: Iterable[Path] = ()) -> Session:
    """Read JSON/JSONL transcript envelopes into a bounded text view."""
    try:
        size = path.stat().st_size
        with path.open("rb") as f:
            if path.suffix == ".jsonl" and size > (1 << 20):
                head = f.read(768 << 10)
                f.seek(max(0, size - (256 << 10)))
                raw_bytes = head + b"\n" + f.read(256 << 10)
            else:
                raw_bytes = f.read(1 << 20)
        raw = raw_bytes.decode("utf-8", errors="replace")
    except OSError:
        return _unreadable(path, store, session_id)
    objects = _read_objects(raw)
    for related in related_paths:
        try:
            with related.open("rb") as f:
                related_raw = f.read(1 << 20).decode("utf-8", errors="replace")
            objects.extend(_read_objects(related_raw))
        except OSError:
            continue
    if not objects and store != "codex":
        return _unreadable(path, store, session_id)
    if store == "codex":
        # Rollout filenames identify timestamped files; usage facts use the
        # thread ID recorded in session_meta. Never use a filename (or a
        # caller's filename-derived ID) when that identity is unavailable.
        session_id = ""
        for obj in objects:
            if not isinstance(obj, dict) or obj.get("type") != "session_meta":
                continue
            payload = obj.get("payload")
            if not isinstance(payload, dict):
                continue
            meta = payload.get("meta")
            candidates = [payload.get("id")]
            if isinstance(meta, dict):
                candidates.append(meta.get("id"))
            session_id = next(
                (candidate for candidate in candidates
                 if isinstance(candidate, str) and SAFE_SESSION_RE.fullmatch(candidate)),
                "",
            )
            if session_id:
                break
    strings: list[str] = []
    keys: dict[str, list[str]] = {}
    for obj in objects:
        _walk_strings(obj, strings, keys)
    text = "\n".join(strings)
    cwd = next((v for k in ("cwd", "workingdirectory", "projectpath", "worktree") for v in keys.get(k, []) if v.startswith("/")), "")
    branch = next((v for k in ("branch", "gitbranch") for v in keys.get(k, []) if v), "")
    files = []
    for value in strings:
        if re.search(r"(?:^|[/\\])docs[/\\]plans[/\\][^\s\"']+", value, re.I):
            files.extend(re.findall(r"(?:[A-Za-z0-9._-]+[/\\])*docs[/\\]plans[/\\][A-Za-z0-9._/-]+", value, re.I))
    sid = session_id if store == "codex" else session_id or path.stem
    if store == "cursor" and path.parent.name == sid:
        sid = path.parent.name
    return Session(sid, store, str(path), text[:256_000], cwd, branch, sorted(set(files)))


def _read_objects(raw: str) -> list:
    objects = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        try:
            objects.append(json.loads(line))
        except (ValueError, TypeError):
            continue
    if not objects:
        try:
            obj = json.loads(raw)
            return obj if isinstance(obj, list) else [obj]
        except (ValueError, TypeError):
            return []
    return objects


def _discover_opencode(root: Path) -> Iterable[Session]:
    session_root = root / "session"
    message_root = root / "message"
    part_root = root / "part"
    if not session_root.is_dir():
        for path in root.rglob("*.jsonl"):
            session = read_session(path, "opencode")
            if session:
                yield session
        return
    messages_by_session: dict[str, list[Path]] = {}
    message_ids: dict[str, str] = {}
    for path in message_root.rglob("*.json") if message_root.is_dir() else ():
        try:
            row = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):
            continue
        if not isinstance(row, dict):
            continue
        sid = row.get("sessionID") or row.get("sessionId")
        mid = row.get("id")
        if isinstance(sid, str):
            messages_by_session.setdefault(sid, []).append(path)
        if isinstance(mid, str) and isinstance(sid, str):
            message_ids[mid] = sid
    parts_by_session: dict[str, list[Path]] = {}
    for path in part_root.rglob("*.json") if part_root.is_dir() else ():
        try:
            row = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):
            continue
        if not isinstance(row, dict):
            continue
        mid = row.get("messageID") or row.get("messageId")
        sid = message_ids.get(mid) if isinstance(mid, str) else None
        if sid:
            parts_by_session.setdefault(sid, []).append(path)
    for path in sorted(session_root.rglob("*.json")):
        try:
            meta = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):
            yield _unreadable(path, "opencode", None)
            continue
        sid = meta.get("id") if isinstance(meta, dict) else None
        sid = sid if isinstance(sid, str) else path.stem
        related = [*messages_by_session.get(sid, []), *parts_by_session.get(sid, [])]
        yield read_session(path, "opencode", sid, related)


def discover(roots: dict[str, Path]) -> Iterable[Session]:
    """Discover only within explicit roots; caller chooses whether roots are real or synthetic."""
    patterns = {
        "claude": ("*.jsonl",),
        "codex": ("rollout-*.jsonl",),
        "opencode": ("*.jsonl", "*.json"),
        "cursor": ("*.jsonl",),
    }
    for store, root in roots.items():
        if store == "opencode":
            yield from _discover_opencode(root)
            continue
        if store not in patterns or not root.is_dir():
            continue
        found: set[Path] = set()
        for pattern in patterns[store]:
            found.update(root.rglob(pattern))
        for path in sorted(found):
            if store == "cursor" and "subagents" in path.parts:
                continue
            sid = path.parent.name if store == "cursor" and path.parent.name != path.stem else path.stem
            session = read_session(path, store, sid)
            if session:
                yield session


def parse_queue_logs(root: Path) -> dict[str, dict[str, str]]:
    """Extract launch truth from queue-log filenames and optional status mapping."""
    truth: dict[str, dict[str, str]] = {}
    if not root.is_dir():
        return truth
    for path in sorted(root.rglob("par-*.log")):
        match = QUEUE_FILE_RE.match(path.name)
        if not match:
            continue
        plan, phase_or_action, harness = match.groups()
        kind = phase_or_action.lower() if phase_or_action.lower() in {"design", "refine", "build", "review", "fix", "close-out", "sync", "escalation", "triage", "research"} else ""
        phase = phase_or_action if phase_or_action.isdigit() else ""
        try:
            body = path.read_text(encoding="utf-8", errors="replace")[:200_000]
        except OSError:
            body = ""
        kind_match = re.search(r"(?i)\b(?:kind|action)\s*[:=]\s*(design|refine|build|review|fix|close-out|sync|escalation|triage|research)\b", body)
        if kind_match:
            kind = kind_match.group(1).lower()
        # A queue run's own transcript path or UUID can be included by harness wrappers.
        ids = re.findall(r"(?:session_id|sessionID|conversation_id)\s*[=:]\s*[\"']?([A-Za-z0-9._:-]{1,200})", body)
        for session_id in ids:
            truth[session_id] = {"plan": plan, "phase": phase, "kind": kind, "harness": harness.lower(), "queue_log": path.name}
    return truth


def _scrub_evidence(text: str, limit: int = 300) -> str:
    text = SECRET_ASSIGN_RE.sub(lambda m: m.group(1) + "=[REDACTED]", text)
    text = yakka.Redact(text)
    text = " ".join(text.split())
    return text[:limit]


def label_session(session: Session, repo: str = "", queue_truth: dict[str, dict[str, str]] | None = None) -> Label:
    if session.unreadable:
        return Label(session.session_id, session.store, "unresolved",
                     evidence="transcript unreadable or has no parseable records",
                     source_file=session.path)
    if not session.session_id:
        # Keep identity failures visible without creating a label that a later
        # pass could complete and attach to an invented conversation ID.
        return Label("", session.store, "unresolved",
                     evidence="missing or invalid session_meta conversation ID",
                     source_file=session.path)
    truth = (queue_truth or {}).get(session.session_id, {})
    haystack = "\n".join((session.text[:200_000], session.cwd, session.branch, *session.files))
    plans = [m.group(1).lower() for m in PLAN_RE.finditer(haystack)]
    plan = truth.get("plan") or (plans[0] if plans else "")
    phase_match = PHASE_RE.search(haystack)
    phase = truth.get("phase") or (phase_match.group(1) if phase_match else "")
    issue = ISSUE_RE.search(session.text)
    pr = PR_RE.search(session.text)
    action: dict[str, str] = {}
    evidence_parts: list[str] = []
    if plan and repo:
        action.update(subject_type="plan", subject_id=f"{repo.lower()}:plan/{plan.lower()}")
        evidence_parts.append("plan:" + ("queue-log" if truth else "transcript/cwd/files"))
    elif issue and repo:
        action.update(subject_type="github", subject_id=f"{repo.lower()}#{issue.group(1)}")
        evidence_parts.append("issue:prompt")
    if phase:
        action["phase"] = str(int(phase))
        evidence_parts.append("phase:" + ("queue-log" if truth else "transcript"))
    if pr:
        action["pr"] = pr.group(1)
        evidence_parts.append("pr:prompt")
    kind = truth.get("kind", "")
    if kind:
        action["kind"] = kind
        evidence_parts.append("kind:queue-log")
    if repo:
        action["repo"] = repo.lower()
    # Prompt snippets are evidence only after scrub; content itself is not exported.
    prompt = next((line[:2048] for line in session.text.splitlines() if line.strip()), "")
    evidence = _scrub_evidence("; ".join(evidence_parts + ([prompt] if prompt else [])))
    complete = bool(action.get("subject_type") and action.get("subject_id") and action.get("kind"))
    status = "complete" if complete else ("partial" if action.get("subject_id") else "unresolved")
    if truth:
        confidence = 1.0
    elif action.get("subject_id"):
        confidence = 0.65 if phase else 0.55
    else:
        confidence = 0.0
    return Label(session.session_id, session.store, status, action, evidence, confidence, truth.get("queue_log", ""))


def score_gold(labels: Iterable[Label], truth: dict[str, dict[str, str]]) -> tuple[int, int, float]:
    total = correct = 0
    for label in labels:
        expected = truth.get(label.session_id)
        if not expected or not label.action.get("subject_id"):
            continue
        total += 1
        subject_id = label.action.get("subject_id", "")
        if (label.action.get("subject_type") == "plan"
                and subject_id.endswith(":plan/" + expected.get("plan", "\0"))
                and label.action.get("phase", "") == (str(int(expected["phase"])) if expected.get("phase") else "")):
            correct += 1
    return correct, total, (correct / total if total else 0.0)


def is_flash_analysis(session: Session) -> bool:
    return bool(FLASH_RE.search(session.text) and re.search(r"analysis|rating|classification", session.text, re.I))


def summarize(labels: list[Label]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for label in labels:
        row = out.setdefault(label.store, {"complete": 0, "partial": 0, "unresolved": 0, "excluded": 0})
        row[label.status] += 1
    return out


def write_labels(path: Path, labels: list[Label]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    with temp.open("w", encoding="utf-8") as f:
        for label in labels:
            f.write(json.dumps(asdict(label), ensure_ascii=False, sort_keys=True) + "\n")
    os.replace(temp, path)


def enqueue(labels: Iterable[Label], queue_dir: str | None = None) -> int:
    count = 0
    # One action per conversation: the same ID can come from two transcript files
    # (Cursor files one chat under two project directories), so only the first
    # complete label for an ID is emitted.
    seen: set[str] = set()
    for label in labels:
        if label.status != "complete" or not label.session_id or label.session_id in seen:
            continue
        seen.add(label.session_id)
        yakka.EnqueueSessionAction(
            conversation_id=label.session_id,
            action=label.action,
            source="backfill",
            method="deterministic",
            confidence=label.confidence,
            evidence=label.evidence,
            dir_path=queue_dir,
        )
        count += 1
    return count


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", action="append", default=[], metavar="STORE=PATH", help="explicit store root; repeat for claude/codex/opencode/cursor")
    p.add_argument("--queue-logs", type=Path)
    p.add_argument("--repo", default="", help="owner/repo for inferred subjects")
    p.add_argument("--labels", type=Path, default=Path("session-labels.jsonl"))
    p.add_argument("--server-fact-count", type=int, help="offline count supplied from a prior GET /v1/actions snapshot")
    p.add_argument("--server-action-ids", type=Path, help="newline-delimited conversation IDs from a prior GET /v1/actions snapshot")
    p.add_argument("--enqueue", action="store_true", help="write complete labels to the local Yakka queue; never sends network traffic")
    p.add_argument("--queue-dir", help="queue directory override for isolated use")
    return p


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    roots = {}
    for item in args.root:
        if "=" not in item:
            raise SystemExit("--root must be STORE=PATH")
        name, path = item.split("=", 1)
        if name not in {"claude", "codex", "opencode", "cursor"}:
            raise SystemExit(f"unknown store: {name}")
        roots[name] = Path(path)
    sessions = discover(roots)
    truth = parse_queue_logs(args.queue_logs) if args.queue_logs else {}
    labels: list[Label] = []
    excluded: list[Label] = []
    session_count = 0
    unreadable_count = 0
    gold: list[Label] = []
    for session in sessions:
        session_count += 1
        unreadable_count += session.unreadable
        if session.store == "opencode" and is_flash_analysis(session):
            excluded.append(Label(session.session_id, session.store, "excluded", evidence="automated Flash analysis excluded"))
            continue
        label = label_session(session, args.repo, truth)
        labels.append(label)
        if session.session_id in truth:
            gold.append(label_session(session, args.repo, {}))
    report = summarize(labels)
    for label in excluded:
        report.setdefault(label.store, {"complete": 0, "partial": 0, "unresolved": 0, "excluded": 0})["excluded"] += 1
    if args.labels:
        write_labels(args.labels, [*labels, *excluded])
    correct, total, agreement = score_gold(gold, truth)
    server_ids = set(args.server_action_ids.read_text(encoding="utf-8").splitlines()) if args.server_action_ids else set()
    id_counts = Counter(label.session_id for label in labels if label.session_id)
    result = {"stores": report, "sessions": session_count, "unreadable": unreadable_count, "duplicate_conversation_ids": sum(1 for n in id_counts.values() if n > 1), "gold":{"correct": correct, "labelled": total, "agreement": agreement}, "coverage": {"complete": sum(r["complete"] for r in report.values()), "incomplete": sum(r["partial"] + r["unresolved"] for r in report.values())}, "label_file": str(args.labels), "server_fact_count": args.server_fact_count, "labelled_sessions_with_server_facts": sum(1 for label in labels if label.action.get("subject_id") and label.session_id in server_ids) if args.server_action_ids else None}
    if args.enqueue:
        result["emitted"] = enqueue(labels, args.queue_dir)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
