#!/usr/bin/env python3
"""Deterministic, offline labelling of past sessions from their own signals.

All store roots are explicit inputs. The normal CLI defaults are provided by
`cli.py`; tests use temporary synthetic roots. The tool never reads a queue log,
never calls a model and never touches the network. Dry run is the default.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
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
BRIEF_RE = re.compile(r"docs/plans/([A-Za-z0-9._-]+)/briefs/([A-Za-z0-9._/-]+?)\.md")
COMMAND_RE = re.compile(r"<command-name>(.*?)</command-name>(?:\s*<command-args>(.*?)</command-args>)?", re.S)
MANUAL_SKILLS_RE = re.compile(r"<manually_attached_skills>(.*?)</manually_attached_skills>", re.S)
SKILL_NAME_RE = re.compile(r"Skill name\s*:?\s*([A-Za-z0-9._:-]+)")
SECRET_ASSIGN_RE = re.compile(r"(?i)\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+")
SAFE_SESSION_RE = re.compile(r"^[A-Za-z0-9._:-]{1,200}$")

# The one signal table. The id is the part after the last ":".
# id -> (signal class, kind)
SKILL_SIGNAL_TABLE = {
    "design": ("planning", "design"),
    "plan": ("planning", "design"),
    "planning": ("planning", "design"),
    "refine": ("refining", "refine"),
    "execute": ("executing", "build"),
    "plan-execution": ("executing", "build"),
}
SIGNAL_CLASSES = ("planning", "refining", "executing", "brief")
STATUSES = ("labelled", "multi_signal", "no_signal", "no_subject", "unreadable")


@dataclass
class Signal:
    signal_class: str
    kind: str
    text: str
    source: str
    ident: str = ""


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
    # Such a session is still counted (unreadable) so it is never silently dropped.
    unreadable: bool = False
    # The store's own first user prompt, not the concatenated transcript text.
    first_prompt: str = ""
    signals: list[Signal] = field(default_factory=list)


@dataclass
class Label:
    session_id: str
    store: str
    status: str
    action: dict[str, str] = field(default_factory=dict)
    evidence: str = ""
    confidence: float = 0.0
    source_file: str = ""
    signal_class: str = ""


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


def _text_of_content(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str)
        )
    return ""


def _signal_from_id(raw, source: str, text: str = "") -> Signal | None:
    if not isinstance(raw, str):
        return None
    ident = raw.strip().split(":")[-1].strip().lower()
    entry = SKILL_SIGNAL_TABLE.get(ident)
    if not entry:
        return None
    signal_class, kind = entry
    return Signal(signal_class, kind, text, source, ident)


def _claude_first_prompt(objects: list) -> str:
    for obj in objects:
        if not isinstance(obj, dict) or obj.get("type") != "user":
            continue
        message = obj.get("message")
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        content = message.get("content")
        if isinstance(content, list) and content and all(
            isinstance(block, dict) and block.get("type") == "tool_result" for block in content
        ):
            continue
        text = _text_of_content(content)
        if text.strip():
            return text
    return ""


def _claude_signals(objects: list) -> list[Signal]:
    out: list[Signal] = []
    for obj in objects:
        if not isinstance(obj, dict):
            continue
        message = obj.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("name") == "Skill":
                    payload = block.get("input") if isinstance(block.get("input"), dict) else {}
                    signal = _signal_from_id(payload.get("skill"), "claude_skill", str(payload.get("args") or ""))
                    if signal:
                        out.append(signal)
        if obj.get("type") == "user":
            for match in COMMAND_RE.finditer(_text_of_content(content)):
                signal = _signal_from_id((match.group(1) or "").strip().lstrip("/"),
                                         "claude_command", match.group(2) or "")
                if signal:
                    out.append(signal)
    return out


def _cursor_first_prompt(objects: list) -> str:
    for obj in objects:
        if not isinstance(obj, dict) or obj.get("role") != "user":
            continue
        message = obj.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        text = _text_of_content(content)
        if text.strip():
            return text
    return ""


def _cursor_signals(objects: list) -> list[Signal]:
    out: list[Signal] = []
    for obj in objects:
        if not isinstance(obj, dict) or obj.get("role") != "user":
            continue
        message = obj.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        for block in MANUAL_SKILLS_RE.findall(_text_of_content(content)):
            for ident in SKILL_NAME_RE.findall(block):
                signal = _signal_from_id(ident, "cursor_block", "")
                if signal:
                    out.append(signal)
    return out


def _codex_payload_text(payload: dict) -> str:
    content = payload.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and isinstance(block.get("text"), str)
        )
    return ""


def _codex_first_prompt(objects: list) -> str:
    for obj in objects:
        if not isinstance(obj, dict) or obj.get("type") != "event_msg":
            continue
        payload = obj.get("payload")
        if (isinstance(payload, dict) and payload.get("type") == "user_message"
                and isinstance(payload.get("message"), str) and payload["message"].strip()):
            return payload["message"]
    for obj in objects:
        if not isinstance(obj, dict) or obj.get("type") != "response_item":
            continue
        payload = obj.get("payload")
        if isinstance(payload, dict) and payload.get("type") == "message" and payload.get("role") == "user":
            text = _codex_payload_text(payload)
            if text.strip():
                return text
    return ""


def _first_prompt(store: str, objects: list) -> str:
    if store == "claude":
        return _claude_first_prompt(objects)
    if store == "cursor":
        return _cursor_first_prompt(objects)
    if store == "codex":
        return _codex_first_prompt(objects)
    return ""


def _signals(store: str, objects: list) -> list[Signal]:
    if store == "claude":
        return _claude_signals(objects)
    if store == "cursor":
        return _cursor_signals(objects)
    return []


def _brief_signals(prompt: str) -> list[Signal]:
    return [Signal("brief", "build", match.group(0), "brief_path", match.group(0))
            for match in BRIEF_RE.finditer(prompt)]


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
    first_prompt = _first_prompt(store, objects)
    return Session(sid, store, str(path), text[:256_000], cwd, branch, sorted(set(files)),
                   first_prompt=first_prompt,
                   signals=_signals(store, objects) + _brief_signals(first_prompt))


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


def _opencode_first_prompt(entries: list[tuple[str, Path]], message_rows: dict[str, dict],
                           parts_by_message: dict[str, list[dict]]) -> str:
    users = [
        (mid, path) for mid, path in entries
        if isinstance(message_rows.get(mid), dict) and message_rows[mid].get("role") == "user"
    ]
    if not users:
        return ""
    users.sort(key=lambda item: item[0])
    mid, _ = users[0]
    parts = sorted(parts_by_message.get(mid, []), key=lambda row: str(row.get("id") or ""))
    return "\n".join(
        row.get("text", "") for row in parts
        if row.get("type") == "text" and isinstance(row.get("text"), str)
    )


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
    messages_by_session: dict[str, list[tuple[str, Path]]] = {}
    message_rows: dict[str, dict] = {}
    for path in message_root.rglob("*.json") if message_root.is_dir() else ():
        try:
            row = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):
            continue
        if not isinstance(row, dict):
            continue
        sid = row.get("sessionID") or row.get("sessionId")
        mid = row.get("id")
        if isinstance(sid, str) and isinstance(mid, str):
            messages_by_session.setdefault(sid, []).append((mid, path))
            message_rows[mid] = row
    parts_by_session: dict[str, list[Path]] = {}
    parts_by_message: dict[str, list[dict]] = {}
    for path in part_root.rglob("*.json") if part_root.is_dir() else ():
        try:
            row = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):
            continue
        if not isinstance(row, dict):
            continue
        mid = row.get("messageID") or row.get("messageId")
        if not isinstance(mid, str):
            continue
        parts_by_message.setdefault(mid, []).append(row)
        message = message_rows.get(mid)
        sid = (message.get("sessionID") or message.get("sessionId")) if isinstance(message, dict) else None
        if isinstance(sid, str):
            parts_by_session.setdefault(sid, []).append(path)
    for path in sorted(session_root.rglob("*.json")):
        try:
            meta = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):
            yield _unreadable(path, "opencode", None)
            continue
        sid = meta.get("id") if isinstance(meta, dict) else None
        sid = sid if isinstance(sid, str) else path.stem
        entries = messages_by_session.get(sid, [])
        related = [message_path for _, message_path in entries] + parts_by_session.get(sid, [])
        session = read_session(path, "opencode", sid, related)
        session.first_prompt = _opencode_first_prompt(entries, message_rows, parts_by_message)
        session.signals = _brief_signals(session.first_prompt)
        yield session


def _empty_store_stats() -> dict[str, int]:
    return {
        "transcripts_discovered": 0,
        "skipped_subagent": 0,
        "skipped_child": 0,
        "duplicate_ids": 0,
        "duplicate_transcripts": 0,
    }


def discover(roots: dict[str, Path], stats: dict[str, dict[str, int]] | None = None) -> Iterable[Session]:
    """Discover only within explicit roots; caller chooses whether roots are real or synthetic.

    Duplicate conversation ids inside a store collapse to one session row. The
    stats dict (when given) is filled with the discovery counts the report needs
    to reconcile with the sessions.
    """
    stats = stats if stats is not None else {}
    patterns = {
        "claude": ("*.jsonl",),
        "codex": ("rollout-*.jsonl",),
        "opencode": ("*.jsonl", "*.json"),
        "cursor": ("*.jsonl",),
    }
    for store, root in roots.items():
        store_stats = stats.setdefault(store, _empty_store_stats())
        seen: set[str] = set()
        duplicate_seen: set[str] = set()

        def accept(session: Session) -> bool:
            sid = session.session_id
            if not sid:
                return True
            if sid in seen:
                store_stats["duplicate_transcripts"] += 1
                if sid not in duplicate_seen:
                    duplicate_seen.add(sid)
                    store_stats["duplicate_ids"] += 1
                return False
            seen.add(sid)
            return True

        if store == "opencode":
            for session in _discover_opencode(root):
                store_stats["transcripts_discovered"] += 1
                if accept(session):
                    yield session
            continue
        if store not in patterns or not root.is_dir():
            continue
        found: set[Path] = set()
        for pattern in patterns[store]:
            found.update(root.rglob(pattern))
        for path in sorted(found):
            store_stats["transcripts_discovered"] += 1
            if store == "claude" and "subagents" in path.parts:
                store_stats["skipped_subagent"] += 1
                continue
            if store == "cursor" and "subagents" in path.parts:
                store_stats["skipped_child"] += 1
                continue
            sid = path.parent.name if store == "cursor" and path.parent.name != path.stem else path.stem
            session = read_session(path, store, sid)
            if session and accept(session):
                yield session


def _scrub_evidence(text: str, limit: int = 300) -> str:
    text = SECRET_ASSIGN_RE.sub(lambda m: m.group(1) + "=[REDACTED]", text)
    text = yakka.Redact(text)
    text = " ".join(text.split())
    return text[:limit]


def _identity(text: str) -> tuple[str, str, str, str]:
    plans = [m.group(1).lower() for m in PLAN_RE.finditer(text)]
    phase_match = PHASE_RE.search(text)
    issue = ISSUE_RE.search(text)
    pr = PR_RE.search(text)
    return (
        plans[0] if plans else "",
        phase_match.group(1) if phase_match else "",
        issue.group(1) if issue else "",
        pr.group(1) if pr else "",
    )


def _brief_identity(text: str) -> tuple[str, str]:
    match = BRIEF_RE.search(text)
    if not match:
        return "", ""
    plan = match.group(1).lower()
    filename = match.group(2).rsplit("/", 1)[-1]
    phase_match = re.match(r"(\d+)-", filename)
    return plan, phase_match.group(1) if phase_match else ""


def label_session(session: Session, repo: str = "") -> Label:
    if session.unreadable:
        return Label(session.session_id, session.store, "unreadable",
                     evidence="transcript unreadable or has no parseable records",
                     source_file=session.path)
    if not session.session_id:
        # Keep identity failures visible without creating a label that could be
        # enqueued against an invented conversation ID.
        return Label("", session.store, "unreadable",
                     evidence="missing or invalid session_meta conversation ID",
                     source_file=session.path)

    classes = {signal.signal_class for signal in session.signals}
    sources = ",".join(sorted({f"{signal.source}:{signal.ident}" for signal in session.signals}))
    if len(classes) > 1:
        return Label(session.session_id, session.store, "multi_signal",
                     evidence=_scrub_evidence(f"signal:{sources}; status:multi_signal"),
                     source_file=session.path)
    if not classes:
        return Label(session.session_id, session.store, "no_signal",
                     evidence=_scrub_evidence("signal:none; status:no_signal"),
                     source_file=session.path)

    signal_class = next(iter(classes))
    chosen = next(signal for signal in session.signals if signal.signal_class == signal_class)
    plan = phase = issue = pr = ""
    subject_source = ""
    if signal_class == "brief":
        for signal in session.signals:
            if signal.signal_class != "brief":
                continue
            candidate_plan, candidate_phase = _brief_identity(signal.text)
            if candidate_plan:
                plan, phase, subject_source = candidate_plan, candidate_phase, "signal"
                break
    else:
        for signal in session.signals:
            if signal.signal_class != signal_class:
                continue
            candidate_plan, candidate_phase, candidate_issue, candidate_pr = _identity(signal.text)
            if candidate_plan or candidate_issue:
                plan, phase, issue, pr = candidate_plan, candidate_phase, candidate_issue, candidate_pr
                subject_source = "signal"
                break
    if not subject_source:
        haystack = "\n".join((session.text[:200_000], session.cwd, session.branch, *session.files))
        candidate_plan, candidate_phase, candidate_issue, candidate_pr = _identity(haystack)
        if candidate_plan or candidate_issue:
            plan, phase, issue, pr = candidate_plan, candidate_phase, candidate_issue, candidate_pr
            subject_source = "fallback"

    action: dict[str, str] = {}
    if plan and repo:
        action.update(subject_type="plan", subject_id=f"{repo.lower()}:plan/{plan}")
    elif issue and repo:
        action.update(subject_type="github", subject_id=f"{repo.lower()}#{issue}")
    if action:
        action["kind"] = chosen.kind
        if phase:
            action["phase"] = str(int(phase))
        if pr:
            action["pr"] = pr
        if repo:
            action["repo"] = repo.lower()
        confidence = 1.0 if subject_source == "signal" else 0.65
        return Label(session.session_id, session.store, "labelled", action,
                     _scrub_evidence(f"signal:{chosen.source}:{chosen.ident}; subject:{subject_source}"),
                     confidence, session.path, signal_class)
    return Label(session.session_id, session.store, "no_subject",
                 evidence=_scrub_evidence(f"signal:{chosen.source}:{chosen.ident}; subject:none"),
                 source_file=session.path, signal_class=signal_class)


def _empty_report_row() -> dict:
    return {
        "sessions": 0,
        "labelled": 0,
        "multi_signal": 0,
        "no_signal": 0,
        "no_subject": 0,
        "unreadable": 0,
        "labelled_by_signal": {signal_class: 0 for signal_class in SIGNAL_CLASSES},
        "skipped_subagent": 0,
        "skipped_child": 0,
        "duplicate_ids": 0,
        "duplicate_transcripts": 0,
        "transcripts_discovered": 0,
    }


def summarize(labels: list[Label], stats: dict[str, dict[str, int]] | None = None) -> tuple[dict[str, dict], dict]:
    stats = stats or {}
    stores: dict[str, dict] = {}
    for label in labels:
        row = stores.setdefault(label.store, _empty_report_row())
        row["sessions"] += 1
        if label.status in STATUSES:
            row[label.status] += 1
        if label.status == "labelled" and label.signal_class in row["labelled_by_signal"]:
            row["labelled_by_signal"][label.signal_class] += 1
    for store, store_stats in stats.items():
        row = stores.setdefault(store, _empty_report_row())
        for key in ("skipped_subagent", "skipped_child", "duplicate_ids",
                    "duplicate_transcripts", "transcripts_discovered"):
            row[key] = store_stats.get(key, 0)
    total = _empty_report_row()
    for row in stores.values():
        for key in ("sessions", "labelled", "multi_signal", "no_signal", "no_subject", "unreadable",
                    "skipped_subagent", "skipped_child", "duplicate_ids",
                    "duplicate_transcripts", "transcripts_discovered"):
            total[key] += row[key]
        for signal_class in SIGNAL_CLASSES:
            total["labelled_by_signal"][signal_class] += row["labelled_by_signal"][signal_class]
    return stores, total


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
    # labelled row for an ID is emitted.
    seen: set[str] = set()
    for label in labels:
        if label.status != "labelled" or not label.session_id or label.session_id in seen:
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
    p.add_argument("--repo", default="", help="owner/repo for inferred subjects")
    p.add_argument("--labels", type=Path, default=Path("session-labels.jsonl"))
    p.add_argument("--server-fact-count", type=int, help="offline count supplied from a prior GET /v1/actions snapshot")
    p.add_argument("--server-action-ids", type=Path, help="newline-delimited conversation IDs from a prior GET /v1/actions snapshot")
    p.add_argument("--enqueue", action="store_true", help="write labelled sessions to the local Yakka queue; never sends network traffic")
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
    stats: dict[str, dict[str, int]] = {}
    labels: list[Label] = []
    for session in discover(roots, stats):
        labels.append(label_session(session, args.repo))
    stores, total = summarize(labels, stats)
    if args.labels:
        write_labels(args.labels, labels)
    server_ids = set(args.server_action_ids.read_text(encoding="utf-8").splitlines()) if args.server_action_ids else set()
    result = {
        "stores": stores,
        "total": total,
        "label_file": str(args.labels),
        "server_fact_count": args.server_fact_count,
        "labelled_sessions_with_server_facts": (
            sum(1 for label in labels if label.status == "labelled" and label.session_id in server_ids)
            if args.server_action_ids else None
        ),
    }
    if args.enqueue:
        result["emitted"] = enqueue(labels, args.queue_dir)
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
