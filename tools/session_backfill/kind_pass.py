#!/usr/bin/env python3
"""Back-fill pass 2: TypeSafe kind labels for Pass 1 partial labels.

Gold items are queue-log sessions whose kind is known; they set the confidence
threshold. Targets are Pass 1 partial labels (subject, no kind).

The default run is a dry run: no transport is called and nothing is written.
--live sends scrubbed prompt prefixes to TypeSafe and needs --confirm-egress.
--enqueue writes complete labels to the local queue and needs --live.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

import typesafe_kind as tk  # noqa: E402
from backfill import Label, discover, is_flash_analysis, label_session, parse_queue_logs  # noqa: E402
import yakka  # noqa: E402

ACCURACY_BAR = 0.90
STORES = frozenset({"claude", "codex", "opencode", "cursor"})


@dataclass(frozen=True)
class Target:
    label: Label
    prompt_prefix: str


@dataclass(frozen=True)
class Gold:
    session_id: str
    expected: str
    prompt_prefix: str


def parse_roots(items: list[str]) -> dict[str, Path]:
    roots: dict[str, Path] = {}
    for item in items:
        if "=" not in item:
            raise SystemExit("--root must be STORE=PATH")
        name, path = item.split("=", 1)
        if name not in STORES:
            raise SystemExit(f"unknown store: {name}")
        roots[name] = Path(path)
    return roots


def collect_work(roots: dict[str, Path], repo: str, queue_truth: dict[str, dict[str, str]]) -> tuple[list[Target], list[Gold], int]:
    targets: list[Target] = []
    gold: list[Gold] = []
    sessions = 0
    for session in discover(roots):
        sessions += 1
        if session.store == "opencode" and is_flash_analysis(session):
            continue
        prefix = tk.prompt_prefix(session.text)
        truth_kind = queue_truth.get(session.session_id, {}).get("kind", "") if session.session_id else ""
        if truth_kind in tk.KIND_LABELS and truth_kind != tk.UNCLEAR:
            gold.append(Gold(session.session_id, truth_kind, prefix))
            continue
        label = label_session(session, repo, queue_truth)
        if label.status == "partial":
            targets.append(Target(label, prefix))
    return targets, gold, sessions


def compute_threshold(pairs: Iterable[tuple[str, tk.KindResult]]) -> tuple[float | None, str]:
    """Lowest gold confidence c where accuracy of answers at or above c reaches the bar.

    `unclear` answers are excluded: they never complete a label.
    """
    usable = [(result.confidence, result.kind == expected) for expected, result in pairs if result.kind != tk.UNCLEAR]
    if not usable:
        return None, "no_gold_answers"
    for candidate in sorted({confidence for confidence, _ in usable}):
        hits = [ok for confidence, ok in usable if confidence >= candidate]
        if sum(hits) / len(hits) >= ACCURACY_BAR:
            return candidate, "ok"
    return None, "accuracy_bar_not_met"


def accuracy(pairs: list[tuple[str, tk.KindResult]]) -> dict[str, Any]:
    """Accuracy over every gold item; an `unclear` or unusable answer counts as a miss."""
    total = len(pairs)
    correct = sum(result.kind == expected for expected, result in pairs)
    per_kind: dict[str, dict[str, Any]] = {}
    for kind in sorted({expected for expected, _ in pairs}):
        rows = [result.kind == expected for expected, result in pairs if expected == kind]
        per_kind[kind] = {"labelled": len(rows), "correct": sum(rows), "accuracy": round(sum(rows) / len(rows), 4)}
    confusion: dict[str, dict[str, int]] = {kind: {label: 0 for label in tk.KIND_LABELS} for kind in per_kind}
    for expected, result in pairs:
        confusion[expected][result.kind] += 1
    return {
        "labelled": total,
        "correct": correct,
        "accuracy": round(correct / total, 4) if total else None,
        "per_kind": per_kind,
        "confusion": confusion,
    }


def route(results: Iterable[tuple[Target, tk.KindResult]], threshold: float | None) -> tuple[list[Label], list[dict[str, Any]]]:
    completed: list[Label] = []
    review: list[dict[str, Any]] = []
    for target, result in results:
        if result.kind == tk.UNCLEAR:
            reason = result.reason
        elif threshold is None:
            reason = "no_threshold"
        elif result.confidence < threshold:
            reason = "below_threshold"
        else:
            action = {**target.label.action, "kind": result.kind}
            evidence = ("kind:typesafe; " + result.prompt_prefix)[: tk.EVIDENCE_CHARS]
            completed.append(Label(
                target.label.session_id,
                target.label.store,
                "complete",
                action,
                evidence,
                result.confidence,
                target.label.source_file,
            ))
            continue
        review.append({
            "session_id": target.label.session_id,
            "store": target.label.store,
            "action": target.label.action,
            "predicted_kind": result.kind,
            "confidence": result.confidence,
            "reason": reason,
            "prompt_prefix": result.prompt_prefix,
        })
    return completed, review


def enqueue(labels: Iterable[Label], queue_dir: str | None = None) -> int:
    count = 0
    # One action per conversation ID per run, as Pass 1 does.
    seen: set[str] = set()
    for label in labels:
        if not label.session_id or label.session_id in seen:
            continue
        seen.add(label.session_id)
        yakka.EnqueueSessionAction(
            conversation_id=label.session_id,
            action=label.action,
            source="backfill",
            method="typesafe",
            confidence=label.confidence,
            evidence=label.evidence,
            dir_path=queue_dir,
        )
        count += 1
    return count


def write_review(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    with temp.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    os.replace(temp, path)


def run_pass(
    roots: dict[str, Path],
    *,
    repo: str = "",
    queue_logs: Path | None = None,
    transport: tk.Transport | None = None,
    enqueue_facts: bool = False,
    queue_dir: str | None = None,
    review_path: Path | None = None,
) -> dict[str, Any]:
    """Run pass 2. With transport None this is a dry run: no call, no write."""
    if enqueue_facts and transport is None:
        raise ValueError("enqueue requires a live transport")
    truth = parse_queue_logs(queue_logs) if queue_logs else {}
    targets, gold, sessions = collect_work(roots, repo, truth)
    report: dict[str, Any] = {
        "mode": "live" if transport is not None else "dry_run",
        "sessions": sessions,
        "targets": len(targets),
        "gold": len(gold),
    }
    if transport is None:
        report.update(accuracy=None, threshold=None, threshold_reason="dry_run",
                      completed=None, review=None, enqueued=0, review_file=None)
        return report

    gold_results = [(item.expected, tk.classify_prompt(item.prompt_prefix, transport)) for item in gold]
    threshold, threshold_reason = compute_threshold(gold_results)
    target_results = [(target, tk.classify_prompt(target.prompt_prefix, transport)) for target in targets]
    completed, review = route(target_results, threshold)
    if review_path is not None:
        write_review(review_path, review)
    enqueued = enqueue(completed, queue_dir) if enqueue_facts else 0
    report.update(
        accuracy=accuracy(gold_results),
        threshold=threshold,
        threshold_reason=threshold_reason,
        completed=len(completed),
        review=dict(Counter(row["reason"] for row in review)),
        enqueued=enqueued,
        review_file=str(review_path) if review_path is not None else None,
    )
    return report


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--root", action="append", default=[], metavar="STORE=PATH", help="explicit store root; repeat for claude/codex/opencode/cursor")
    p.add_argument("--queue-logs", type=Path)
    p.add_argument("--repo", default="", help="owner/repo for inferred subjects")
    p.add_argument("--review", type=Path, default=Path("session-kind-review.jsonl"), help="review JSONL, written only with --live")
    p.add_argument("--live", action="store_true", help="send scrubbed prompt prefixes to TypeSafe")
    p.add_argument("--confirm-egress", action="store_true", help="confirm prompt egress to TypeSafe for this run; required with --live")
    p.add_argument("--enqueue", action="store_true", help="write complete kind labels to the local queue; requires --live")
    p.add_argument("--queue-dir", help="queue directory override for isolated use")
    return p


def main(argv: list[str] | None = None) -> int:
    p = parser()
    args = p.parse_args(argv)
    if args.enqueue and not args.live:
        p.error("--enqueue requires --live")
    if args.live and not args.confirm_egress:
        p.error("--live sends scrubbed prompt prefixes to TypeSafe; add --confirm-egress to confirm")
    if args.live and not os.environ.get("TYPESAFE_API_KEY", "").strip():
        p.error("TYPESAFE_API_KEY is not set")
    roots = parse_roots(args.root)
    result = run_pass(
        roots,
        repo=args.repo,
        queue_logs=args.queue_logs,
        transport=tk.live_transport if args.live else None,
        enqueue_facts=args.enqueue,
        queue_dir=args.queue_dir,
        review_path=args.review if args.live else None,
    )
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
