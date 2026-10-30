#!/usr/bin/env python3
"""Run the maps-only PR-VALIDATION-TOOLGROUNDED TypeSafe grid."""

from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[6]
PACK_DIR = Path("/home/codyh/workspace/corpus-ops/corpus-ops/registry/validation-phase/packs")
OUT = Path(__file__).resolve().parent
RAW = OUT / "raw"
URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-1.13.0"
PROTOCOL_PATH = Path(
    "/home/codyh/workspace/corpus-ops/registry/validation-phase/protocol-v2-toolgrounded.json"
)
PROTOCOL_SHA256 = "f15e130fb807421a1f0ff0fe5feaf16b17897f586c7e1671da2f404a2b26ac06"
AEST = ZoneInfo("Australia/Brisbane")
SEATS = ("seat-1", "seat-2", "seat-3")
WORKERS = {
    "92a48e004519": "thrash",
    "ca977b9ca0dd": "thrash",
    "87a380bc64ff": "poll",
    "bb6165018de0": "poll",
    "15f24c7ba18c": "poll",
    "0677f597286e": "productive_edit",
    "074c8cf22927": "productive_edit",
}
CPS = (50, 60, 75)
LABELS = ("in_validation", "building", "inconclusive")
PATTERN_NOTES = ("test_fix_loop", "forward_edit", "mixed_or_unclear")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cell_id(seat: str, worker: str, checkpoint: int) -> str:
    raw = f"{PROTOCOL_SHA256}|maps-only|{seat}|{worker}|{checkpoint}|choice-toolgrounded-v3"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def load_packs() -> dict[tuple[str, int], dict[str, Any]]:
    path = PACK_DIR / "validation-phase-earlycps-judge-packs-20261002-earlycps.jsonl"
    if not path.exists():
        raise RuntimeError(f"frozen combined pack missing: {path}")
    rows: dict[tuple[str, int], dict[str, Any]] = {}
    for line in path.read_text().splitlines():
        row = json.loads(line)
        rows[(row["worker_id"], int(row["checkpoint_turn"]))] = row
    missing = [
        (worker, cp)
        for worker in WORKERS
        for cp in CPS
        if (worker, cp) not in rows
    ]
    if missing:
        raise RuntimeError(f"missing pinned pack rows: {missing}")
    return rows


def tool_evidence(row: dict[str, Any]) -> dict[str, Any]:
    cumulative = row.get("cumulative") or {}
    histogram = cumulative.get("tool_histogram") or {}
    tail = row.get("tail") or []
    last_tools = [name for item in tail[-8:] for name in item.get("tool_names", [])]
    edit_count = int(histogram.get("Edit", 0))
    write_count = int(histogram.get("Write", 0))
    bash_count = int(histogram.get("Bash", 0))
    shown = ", ".join(last_tools) if last_tools else "none"
    block = (
        f"edit_count={edit_count}; write_count={write_count}; "
        f"bash_count={bash_count}; last_tools=[{shown}]"
    )
    return {
        "edit_count": edit_count,
        "write_count": write_count,
        "bash_count": bash_count,
        "last_tools": last_tools,
        "tool_evidence_block": block,
    }


def build_cells() -> list[dict[str, Any]]:
    packs = load_packs()
    cells = []
    for seat in SEATS:
        for worker, stratum in WORKERS.items():
            for checkpoint in CPS:
                row = packs[(worker, checkpoint)]
                evidence = tool_evidence(row)
                snapshot = {
                    "worker_id": worker,
                    "stratum": stratum,
                    "checkpoint_turn": checkpoint,
                    "snapshot_mode": row["snapshot_mode"],
                    "cumulative": row.get("cumulative"),
                    "delta_since_prior": row.get("delta_since_prior"),
                    "tail": row.get("tail"),
                    "tool_evidence": evidence,
                }
                cid = cell_id(seat, worker, checkpoint)
                cells.append(
                    {
                        "cell_id": cid,
                        "seat": seat,
                        "worker_id": worker,
                        "stratum": stratum,
                        "checkpoint_turn": checkpoint,
                        "driver": "TypeSafe",
                        "model": MODEL,
                        "protocol_sha256": PROTOCOL_SHA256,
                        "maps_only": True,
                        "behaviour_ship": False,
                        "no_call_jev": True,
                        "no_8080": True,
                        "tool_evidence": evidence,
                        "request": {
                            "model": MODEL,
                            "state": {
                                "evidence_class": "hybrid_v0",
                                "framing": "PR-VALIDATION-TOOLGROUNDED",
                                "seat": seat,
                                "worker_id": worker,
                                "stratum": stratum,
                                "checkpoint_turn": checkpoint,
                                "tool_evidence": evidence,
                                "snapshot": snapshot,
                            },
                            "questions": {
                                "choice": {
                                    "type": "choice",
                                    "instructions": (
                                        "Is this worker already in validation "
                                        "(reactive read/fix/test loop) vs forward build? "
                                        "Answer building ONLY if Edit or Write appears in "
                                        "the shown window tool evidence; otherwise prefer "
                                        "in_validation or inconclusive."
                                    ),
                                    "labels": list(LABELS),
                                    "criteria": {
                                        "in_validation": (
                                            "Reactive read/fix/test loop is supported; "
                                            "do not call building without Edit or Write evidence."
                                        ),
                                        "building": (
                                            "Forward build is supported AND Edit or Write "
                                            "appears in the shown tool evidence."
                                        ),
                                        "inconclusive": (
                                            "The shown evidence does not distinguish "
                                            "validation from forward build."
                                        ),
                                    },
                                },
                                "pattern_note": {
                                    "type": "choice",
                                    "instructions": (
                                        "Choose exactly one pattern note from the shown "
                                        "tool evidence: test_fix_loop, forward_edit, or "
                                        "mixed_or_unclear."
                                    ),
                                    "labels": list(PATTERN_NOTES),
                                    "criteria": {
                                        "test_fix_loop": "Reactive read/fix/test loop dominates.",
                                        "forward_edit": "Forward editing/building dominates.",
                                        "mixed_or_unclear": "Evidence is mixed or unclear.",
                                    },
                                },
                                "freeform_note": {
                                    "type": "noul",
                                    "instructions": (
                                        "One concise free-form note about the tool "
                                        "evidence; do not introduce a new label."
                                    ),
                                },
                            },
                        },
                    }
                )
    return cells


def answer_value(answer: dict[str, Any]) -> Any:
    return answer.get("value", answer.get("text", answer.get("noul")))


def parse_answers(payload: dict[str, Any]) -> dict[str, Any]:
    answers = payload.get("answers") or {}
    parsed: dict[str, Any] = {}
    for question_id in ("choice", "pattern_note", "freeform_note"):
        answer = answers.get(question_id) or {}
        is_choice = answer.get("type") == "choice"
        label = answer.get("choice") if is_choice else None
        parsed[question_id] = {
            "wire_type": answer.get("type"),
            "response_class": label if is_choice else answer.get("type"),
            "response_label": label,
            "choice_scrape_ok": not is_choice or (
                label is not None and (label if is_choice else None) == label
            ),
            "value": label if is_choice else answer_value(answer),
            "raw": answer,
        }
    choice = parsed["choice"]
    note = parsed["pattern_note"]["response_label"]
    parsed["choice_valid"] = choice["response_label"] in LABELS
    parsed["pattern_note_valid"] = note in PATTERN_NOTES
    return parsed


def post(cell: dict[str, Any], key: str) -> dict[str, Any]:
    body = json.loads(json.dumps(cell["request"]))
    cid = cell["cell_id"]
    (RAW / f"{cid}-request.json").write_text(json.dumps(body, indent=2) + "\n")
    request = urllib.request.Request(
        URL,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "application/json"},
    )
    started = time.time()
    base = {
        k: cell[k]
        for k in (
            "cell_id", "seat", "worker_id", "stratum", "checkpoint_turn",
            "driver", "model", "protocol_sha256", "maps_only",
            "behaviour_ship", "no_call_jev", "no_8080", "tool_evidence",
        )
    }
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            text = response.read().decode()
            payload = json.loads(text)
            status = response.status
        (RAW / f"{cid}-response.json").write_text(text + "\n")
        answers = parse_answers(payload)
        return {
            **base,
            "http": status,
            "error": None,
            "answers": answers,
            "choice_scrape_ok": answers["choice"]["choice_scrape_ok"],
            "raw_response": f"raw/{cid}-response.json",
            "usage": payload.get("usage"),
            "ts": datetime.now(AEST).isoformat(timespec="seconds"),
            "wall_s": round(time.time() - started, 3),
        }
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        (RAW / f"{cid}-error.txt").write_text(f"HTTP {error.code}\n{detail}\n")
        return {**base, "http": error.code, "error": detail[:1000],
                "raw_response": f"raw/{cid}-error.txt",
                "ts": datetime.now(AEST).isoformat(timespec="seconds"),
                "wall_s": round(time.time() - started, 3)}
    except Exception as error:
        return {**base, "http": None, "error": f"{type(error).__name__}: {error}",
                "raw_response": None, "ts": datetime.now(AEST).isoformat(timespec="seconds"),
                "wall_s": round(time.time() - started, 3)}


def write_analysis(rows: list[dict[str, Any]], cells: list[dict[str, Any]]) -> None:
    successful = [row for row in rows if row.get("http") == 200 and not row.get("error")]
    counts = Counter(
        (row.get("answers") or {}).get("choice", {}).get("response_label")
        for row in successful
    )
    building_evidence_violations = [
        row["cell_id"]
        for row in successful
        if (row.get("answers") or {}).get("choice", {}).get("response_label") == "building"
        and not (
            row["tool_evidence"]["edit_count"] > 0
            or row["tool_evidence"]["write_count"] > 0
        )
    ]
    by_stratum = {
        stratum: dict(Counter(
            (row.get("answers") or {}).get("choice", {}).get("response_label")
            for row in successful if row["stratum"] == stratum
        ))
        for stratum in sorted(WORKERS.values())
    }
    summary = {
        "case_id": "PR-VALIDATION-TOOLGROUNDED",
        "driver": "TypeSafe",
        "model": MODEL,
        "protocol_sha256": PROTOCOL_SHA256,
        "protocol_sha256_verified": sha256(PROTOCOL_PATH) == PROTOCOL_SHA256,
        "maps_only": True,
        "behaviour_ship": False,
        "no_call_jev": True,
        "no_8080": True,
        "seat_count": len(SEATS),
        "worker_count": len(WORKERS),
        "checkpoint_count": len(CPS),
        "planned_cells": len(cells),
        "result_rows": len(rows),
        "successful_rows": len(successful),
        "error_rows": len(rows) - len(successful),
        "choice_counts": dict(counts),
        "choice_counts_by_stratum": by_stratum,
        "building_rule": "building ONLY when Edit or Write appears in shown tool evidence",
        "building_evidence_violations": building_evidence_violations,
        "response_class_equals_response_label": all(
            (row.get("answers") or {}).get("choice", {}).get("response_class")
            == (row.get("answers") or {}).get("choice", {}).get("response_label")
            for row in successful
        ),
        "pattern_notes": list(PATTERN_NOTES),
        "freeform_wire": "noul",
    }
    (OUT / "choice-counts.json").write_text(json.dumps(summary, indent=2) + "\n")
    (OUT / "toolgrounded-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (OUT / "meters.json").write_text(json.dumps({
        **summary,
        "http_counts": dict(Counter(str(row.get("http")) for row in rows)),
        "choice_scrape_failures": sum(not row.get("choice_scrape_ok", False) for row in successful),
        "pattern_note_invalid": sum(
            not (row.get("answers") or {}).get("pattern_note_valid", False)
            for row in successful
        ),
        "building_evidence_violations": building_evidence_violations,
        "freeform_noul_answers": sum(
            (row.get("answers") or {}).get("freeform_note", {}).get("wire_type") == "noul"
            for row in successful
        ),
        "generated_at": datetime.now(AEST).isoformat(timespec="seconds"),
    }, indent=2) + "\n")


def main() -> int:
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if not key:
        raise SystemExit("TYPESAFE_API_KEY is required")
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    if sha256(PROTOCOL_PATH) != PROTOCOL_SHA256:
        raise SystemExit("protocol SHA256 mismatch; aborting")
    cells = build_cells()
    (OUT / "cell-manifest.json").write_text(json.dumps({
        "case_id": "PR-VALIDATION-TOOLGROUNDED",
        "protocol_sha256": PROTOCOL_SHA256,
        "protocol_sha256_verified": True,
        "driver": "TypeSafe",
        "model": MODEL,
        "seats": list(SEATS),
        "workers": WORKERS,
        "checkpoints": list(CPS),
        "planned_cell_count": len(cells),
        "cells": cells,
    }, indent=2) + "\n")
    results_path = OUT / "results.jsonl"
    done: dict[str, dict[str, Any]] = {}
    if results_path.exists():
        for line in results_path.read_text().splitlines():
            try:
                row = json.loads(line)
                if row.get("cell_id"):
                    done[row["cell_id"]] = row
            except json.JSONDecodeError:
                pass
    todo = [cell for cell in cells if cell["cell_id"] not in done]
    workers = int(os.environ.get("TS_VALIDATION_WORKERS", "8"))
    with ThreadPoolExecutor(max_workers=workers) as executor, results_path.open("a") as output:
        futures = [executor.submit(post, cell, key) for cell in todo]
        for future in as_completed(futures):
            row = future.result()
            done[row["cell_id"]] = row
            output.write(json.dumps(row) + "\n")
            output.flush()
    rows = [done[cell["cell_id"]] for cell in cells if cell["cell_id"] in done]
    write_analysis(rows, cells)
    print(json.dumps({"planned": len(cells), "rows": len(rows),
                      "successful": sum(row.get("http") == 200 and not row.get("error") for row in rows),
                      "errors": sum(bool(row.get("error")) for row in rows)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
