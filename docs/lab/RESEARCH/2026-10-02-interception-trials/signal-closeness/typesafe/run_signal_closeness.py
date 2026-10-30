#!/usr/bin/env python3
"""Seat the maps-only PR-SIGNAL-CLOSENESS TypeSafe measurement.

The first three signals are gated offline from the pinned turn profiles.  The
only model ask in this seat is the protocol-required prompt_plus_last_n float
for validation_inflection.  The runner is resumable and captures request and
response bodies under the ignored raw/ directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

OUT = Path(__file__).resolve().parent
RAW = OUT / "raw"
URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-1.13.0"
PROTOCOL_PATH = Path(
    "/home/codyh/workspace/corpus-ops/registry/signal-closeness/protocol-v0-atomic.json"
)
PANEL_PATH = Path(
    "/home/codyh/workspace/corpus-ops/registry/signal-closeness/panel-v0.json"
)
PROTOCOL_SHA256 = "5f54251e6168ad35e67a0c192bacd1a03b1d05814bc56565373453fbc9206d52"
PANEL_SHA256 = "e36fcebc51da2e9b6be21de49457a1da0a82c60eceaa8991ae644c39b4adec67"
SHARED_PACK_DIR = Path(
    "/home/codyh/workspace/corpus-ops/registry/validation-phase/packs"
)
GOLD_PACK_DIR = (
    Path(__file__).resolve().parents[3]
    / "2026-10-01-progressive-jev-session-gates"
    / "proofs"
    / "validated"
    / "gold"
    / "packs"
)
AEST = ZoneInfo("Australia/Brisbane")
CHECKPOINT = 75
REPLICATES = 2
WORKERS = (
    ("92a48e004519", "thrash"),
    ("ca977b9ca0dd", "thrash"),
    ("87a380bc64ff", "poll"),
    ("bb6165018de0", "poll"),
    ("15f24c7ba18c", "poll"),
    ("0677f597286e", "productive_edit"),
    ("074c8cf22927", "productive_edit"),
    ("0aab88c525de", "validation_inflection"),
    ("036ff3ed4a89", "validation_inflection"),
)
SIGNALS = ("thrash", "poll", "productive_edit", "validation_inflection")
SHARED_WORKERS = {worker for worker, _ in WORKERS if worker not in {"0aab88c525de", "036ff3ed4a89"}}
RESIDUAL_WORKERS = {"0aab88c525de", "036ff3ed4a89"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def pack_path(worker_id: str) -> Path:
    if worker_id in SHARED_WORKERS:
        return SHARED_PACK_DIR / (
            f"{worker_id}-judge-packs-20261002-earlycps.jsonl"
        )
    return GOLD_PACK_DIR / (
        f"{worker_id}-judge-packs-20261001-202909.jsonl"
    )


def load_snapshots() -> dict[str, dict[str, Any]]:
    snapshots: dict[str, dict[str, Any]] = {}
    for worker_id, _ in WORKERS:
        path = pack_path(worker_id)
        rows = load_jsonl(path)
        matches = [row for row in rows if int(row["checkpoint_turn"]) == CHECKPOINT]
        if len(matches) != 1:
            raise RuntimeError(f"expected one checkpoint {CHECKPOINT} in {path}")
        snapshots[worker_id] = {
            "worker_id": worker_id,
            "checkpoint_turn": CHECKPOINT,
            "schedule": matches[0].get("schedule"),
            "snapshot_mode": matches[0].get("snapshot_mode"),
            "snapshot_params": matches[0].get("snapshot_params"),
            "prior_checkpoint_turn": matches[0].get("prior_checkpoint_turn"),
            "brief_anchor": matches[0].get("brief_anchor"),
            "api_turns_note": matches[0].get("api_turns_note"),
            "cumulative": matches[0].get("cumulative"),
            "delta_since_prior": matches[0].get("delta_since_prior"),
            "thrash_top_rereads": matches[0].get("thrash_top_rereads"),
            "tail": matches[0].get("tail"),
        }
    return snapshots


def histogram(snapshot: dict[str, Any]) -> dict[str, int]:
    return {
        str(key): int(value)
        for key, value in (snapshot.get("cumulative") or {}).get("tool_histogram", {}).items()
    }


def reread_total(snapshot: dict[str, Any]) -> int:
    return sum(
        int(item.get("count", 0))
        for item in (snapshot.get("cumulative") or {}).get("reread_paths", [])
    )


def wait_terms(snapshot: dict[str, Any]) -> int:
    text = " ".join(str(item.get("excerpt") or "").lower() for item in snapshot.get("tail") or [])
    return sum(len(re.findall(rf"\b{re.escape(term)}\b", text)) for term in (
        "wait", "waiting", "blocked", "monitor", "poll", "standing by"
    ))


def profile(snapshot: dict[str, Any]) -> dict[str, Any]:
    tools = histogram(snapshot)
    return {
        "edit_count": tools.get("Edit", 0),
        "write_count": tools.get("Write", 0),
        "edit_write_count": tools.get("Edit", 0) + tools.get("Write", 0),
        "monitor_count": tools.get("Monitor", 0),
        "wait_term_count": wait_terms(snapshot),
        "reread_total": reread_total(snapshot),
        "compaction_event_count": int(
            (snapshot.get("cumulative") or {}).get("compaction_event_count", 0)
        ),
        "tool_histogram": tools,
    }


def zero_call_flags(snapshots: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    profiles = {worker: profile(snapshot) for worker, snapshot in snapshots.items()}

    def means(worker_ids: set[str], metric: str) -> float:
        values = [profiles[worker][metric] for worker in worker_ids]
        return sum(values) / len(values)

    thrash = {worker for worker, stratum in WORKERS if stratum == "thrash"}
    poll = {worker for worker, stratum in WORKERS if stratum == "poll"}
    productive = {worker for worker, stratum in WORKERS if stratum == "productive_edit"}
    thrash_low = productive
    productive_low = thrash

    checks = {
        "thrash": {
            "metric": "reread_total_plus_compaction",
            "high_workers": sorted(thrash),
            "low_workers": sorted(thrash_low),
            "high_mean": means(thrash, "reread_total") + means(thrash, "compaction_event_count"),
            "low_mean": means(thrash_low, "reread_total") + means(thrash_low, "compaction_event_count"),
            "high_greater_than_low": (
                means(thrash, "reread_total") + means(thrash, "compaction_event_count")
                > means(thrash_low, "reread_total") + means(thrash_low, "compaction_event_count")
            ),
            "evidence": "cumulative reread_paths plus compaction_event_count",
        },
        "poll": {
            "metric": "monitor_plus_wait_terms",
            "high_workers": sorted(poll),
            "low_workers": sorted(productive),
            "high_mean": means(poll, "monitor_count") + means(poll, "wait_term_count"),
            "low_mean": means(productive, "monitor_count") + means(productive, "wait_term_count"),
            "high_greater_than_low": (
                means(poll, "monitor_count") + means(poll, "wait_term_count")
                > means(productive, "monitor_count") + means(productive, "wait_term_count")
            ),
            "evidence": "cumulative Monitor count plus wait/monitor/poll terms in last-n excerpts",
            "write_count_caution_worker": "bb6165018de0",
            "write_count_caution": profiles["bb6165018de0"]["write_count"],
        },
        "productive_edit": {
            "metric": "edit_plus_write",
            "high_workers": sorted(productive),
            "low_workers": sorted(productive_low),
            "high_mean": means(productive, "edit_write_count"),
            "low_mean": means(productive_low, "edit_write_count"),
            "high_greater_than_low": means(productive, "edit_write_count")
            > means(productive_low, "edit_write_count"),
            "evidence": "cumulative Edit plus Write counts",
        },
        "validation_inflection": {
            "zero_call_separation": False,
            "model_skipped": False,
            "skip_profile": True,
            "skip_profile_reason": (
                "protocol requires prompt_plus_last_n for this signal; "
                "profile skipped by design"
            ),
        },
    }
    for signal in ("thrash", "poll", "productive_edit"):
        checks[signal]["zero_call_separation"] = bool(checks[signal]["high_greater_than_low"])
        checks[signal]["model_skipped"] = checks[signal]["zero_call_separation"]
    return {
        "checkpoint_turn": CHECKPOINT,
        "replicates": REPLICATES,
        "profiles": profiles,
        "signals": checks,
    }


def cell_id(worker_id: str, replicate: int) -> str:
    raw = (
        f"{PROTOCOL_SHA256}|{PANEL_SHA256}|maps-only|prompt_plus_last_n|"
        f"validation_inflection|{worker_id}|{CHECKPOINT}|replicate-{replicate}"
    )
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def build_cells(snapshots: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    cells = []
    for worker_id, stratum in WORKERS:
        for replicate in range(1, REPLICATES + 1):
            cells.append(
                {
                    "cell_id": cell_id(worker_id, replicate),
                    "worker_id": worker_id,
                    "stratum": stratum,
                    "checkpoint_turn": CHECKPOINT,
                    "replicate": replicate,
                    "driver": "TypeSafe",
                    "model": MODEL,
                    "protocol_sha256": PROTOCOL_SHA256,
                    "panel_sha256": PANEL_SHA256,
                    "maps_only": True,
                    "behaviour_ship": False,
                    "no_call_jev": True,
                    "no_8080": True,
                    "subset": "prompt_plus_last_n",
                    "pack_path": str(pack_path(worker_id)),
                    "request": {
                        "model": MODEL,
                        "state": {
                            "evidence_class": "hybrid_v0",
                            "framing": "PR-SIGNAL-CLOSENESS",
                            "subset": "prompt_plus_last_n",
                            "worker_id": worker_id,
                            "checkpoint_turn": CHECKPOINT,
                            "snapshot": snapshots[worker_id],
                        },
                        "questions": {
                            "validation_inflection": {
                                "type": "score",
                                "instructions": (
                                    "Return one independent float in [0,1] for the "
                                    "closeness of this snapshot to the signal "
                                    "validation_inflection: a shift from forward "
                                    "delivery into reactive read/fix/test mode. "
                                    "Judge the prompt plus the shown last-n turns only. "
                                    "This is a closeness measurement, not a phase "
                                    "class; do not emit a union, winner, fire decision, "
                                    "or any other signal score."
                                ),
                                "criteria": [
                                    "0.0 = no evidence of a forward-to-reactive mode shift",
                                    "0.5 = ambiguous or partial mode-shift evidence",
                                    "1.0 = strong evidence of a forward-to-reactive mode shift",
                                ],
                            }
                        },
                    },
                }
            )
    return cells


def answer_value(answer: dict[str, Any]) -> Any:
    for key in ("score", "value", "float", "noul"):
        if key in answer:
            return answer[key]
    return None


def parse_score(payload: dict[str, Any]) -> dict[str, Any]:
    answer = (payload.get("answers") or {}).get("validation_inflection") or {}
    value = answer_value(answer)
    try:
        raw_score = float(value)
    except (TypeError, ValueError):
        raw_score = None
    # TypeSafe's score wire returns the expected ordinal over the three
    # criteria (0, 1, 2).  The protocol output is the corresponding float in
    # [0, 1], so retain the raw ordinal and normalize by the pinned scale.
    score = raw_score / 2.0 if raw_score is not None else None
    return {
        "wire_type": answer.get("type"),
        "raw_score": raw_score,
        "score": score,
        "score_in_range": score is not None and 0.0 <= score <= 1.0,
        "score_normalization": "raw TypeSafe ordinal / 2.0",
        "raw_answer": answer,
    }


def post(cell: dict[str, Any], key: str) -> dict[str, Any]:
    cell_id_value = cell["cell_id"]
    body = json.loads(json.dumps(cell["request"]))
    (RAW / f"{cell_id_value}-request.json").write_text(json.dumps(body, indent=2) + "\n")
    request = urllib.request.Request(
        URL,
        data=json.dumps(body).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    started = time.time()
    base = {
        k: cell[k]
        for k in (
            "cell_id", "worker_id", "stratum", "checkpoint_turn", "replicate",
            "driver", "model", "protocol_sha256", "panel_sha256", "maps_only",
            "behaviour_ship", "no_call_jev", "no_8080", "subset", "pack_path",
        )
    }
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            text = response.read().decode()
            payload = json.loads(text)
            status = response.status
        (RAW / f"{cell_id_value}-response.json").write_text(text + "\n")
        return {
            **base,
            "http": status,
            "error": None,
            **parse_score(payload),
            "raw_response": f"raw/{cell_id_value}-response.json",
            "usage": payload.get("usage"),
            "ts": datetime.now(AEST).isoformat(timespec="seconds"),
            "wall_s": round(time.time() - started, 3),
        }
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        (RAW / f"{cell_id_value}-error.txt").write_text(
            f"HTTP {error.code}\n{detail}\n"
        )
        return {
            **base,
            "http": error.code,
            "error": detail[:1000],
            "raw_response": f"raw/{cell_id_value}-error.txt",
            "ts": datetime.now(AEST).isoformat(timespec="seconds"),
            "wall_s": round(time.time() - started, 3),
        }
    except Exception as error:
        return {
            **base,
            "http": None,
            "error": f"{type(error).__name__}: {error}",
            "raw_response": None,
            "ts": datetime.now(AEST).isoformat(timespec="seconds"),
            "wall_s": round(time.time() - started, 3),
        }


def write_manifest(cells: list[dict[str, Any]], zero_calls: dict[str, Any]) -> None:
    (OUT / "cell-manifest.json").write_text(
        json.dumps(
            {
                "case_id": "PR-SIGNAL-CLOSENESS",
                "protocol_sha256": PROTOCOL_SHA256,
                "protocol_sha256_verified": sha256(PROTOCOL_PATH) == PROTOCOL_SHA256,
                "panel_sha256": PANEL_SHA256,
                "panel_sha256_verified": sha256(PANEL_PATH) == PANEL_SHA256,
                "driver": "TypeSafe",
                "model": MODEL,
                "maps_only": True,
                "behaviour_ship": False,
                "no_call_jev": True,
                "no_8080": True,
                "replicates": REPLICATES,
                "preferred_checkpoint": CHECKPOINT,
                "planned_post_count": len(cells),
                "scored_workers": [worker for worker, _ in WORKERS],
                "holdouts_scored": False,
                "signals": list(SIGNALS),
                "zero_call": zero_calls,
                "cells": cells,
            },
            indent=2,
        )
        + "\n"
    )
    (OUT / "zero-call.json").write_text(json.dumps(zero_calls, indent=2) + "\n")


def group_scores(rows: list[dict[str, Any]], worker_ids: set[str]) -> list[float]:
    values = [
        float(row["score"])
        for row in rows
        if row.get("worker_id") in worker_ids
        and row.get("http") == 200
        and row.get("score_in_range")
    ]
    return values


def write_analysis(
    rows: list[dict[str, Any]],
    cells: list[dict[str, Any]],
    zero_calls: dict[str, Any],
) -> dict[str, Any]:
    successful = [
        row for row in rows
        if row.get("http") == 200 and row.get("score_in_range")
    ]
    high_ids = {worker for worker, stratum in WORKERS if stratum == "validation_inflection"}
    low_ids = {
        worker for worker, stratum in WORKERS
        if stratum in {"thrash", "productive_edit"}
    }
    high = group_scores(successful, high_ids)
    low = group_scores(successful, low_ids)
    summary = {
        "case_id": "PR-SIGNAL-CLOSENESS",
        "driver": "TypeSafe",
        "model": MODEL,
        "protocol_sha256": PROTOCOL_SHA256,
        "panel_sha256": PANEL_SHA256,
        "protocol_sha256_verified": sha256(PROTOCOL_PATH) == PROTOCOL_SHA256,
        "panel_sha256_verified": sha256(PANEL_PATH) == PANEL_SHA256,
        "maps_only": True,
        "behaviour_ship": False,
        "no_call_jev": True,
        "no_8080": True,
        "replicates": REPLICATES,
        "planned_cells": len(cells),
        "result_rows": len(rows),
        "successful_rows": len(successful),
        "error_rows": len(rows) - len(successful),
        "valid_float_rows": sum(row.get("score_in_range", False) for row in rows),
        "http_counts": dict(Counter(str(row.get("http")) for row in rows)),
        "zero_call": zero_calls,
        "validation_inflection": {
            "high_workers": sorted(high_ids),
            "low_workers": sorted(low_ids),
            "high_scores": high,
            "low_scores": low,
            "high_mean": sum(high) / len(high) if high else None,
            "low_mean": sum(low) / len(low) if low else None,
            "outcome": (
                "PASS — high-side mean strictly exceeds low-side mean"
                if high and low and sum(high) / len(high) > sum(low) / len(low)
                else "KILL — flat or reversed contrast"
                if high and low
                else "INCOMPLETE — insufficient valid float responses"
            ),
        },
        "freeform_wire": "not used; score-only request",
        "holdouts_scored": False,
        "generated_at": datetime.now(AEST).isoformat(timespec="seconds"),
    }
    (OUT / "results-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def normalize_existing_row(row: dict[str, Any]) -> dict[str, Any]:
    """Upgrade rows from the first accepted 0..2 score-wire responses."""
    raw_answer = row.get("raw_answer") or {}
    raw_score = raw_answer.get("score", row.get("raw_score"))
    try:
        raw_score = float(raw_score)
    except (TypeError, ValueError):
        return row
    row["raw_score"] = raw_score
    row["score"] = raw_score / 2.0
    row["score_in_range"] = 0.0 <= row["score"] <= 1.0
    row["score_normalization"] = "raw TypeSafe ordinal / 2.0"
    return row


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    if sha256(PROTOCOL_PATH) != PROTOCOL_SHA256:
        raise SystemExit("protocol SHA256 mismatch; aborting")
    if sha256(PANEL_PATH) != PANEL_SHA256:
        raise SystemExit("panel SHA256 mismatch; aborting")

    snapshots = load_snapshots()
    zero_calls = zero_call_flags(snapshots)
    cells = build_cells(snapshots)
    write_manifest(cells, zero_calls)
    if args.prepare_only:
        print(json.dumps({"status": "prepared", "planned": len(cells)}))
        return 0

    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if not key:
        raise SystemExit("TYPESAFE_API_KEY is required")
    results_path = OUT / "results.jsonl"
    done: dict[str, dict[str, Any]] = {}
    if results_path.exists():
        for line in results_path.read_text().splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("cell_id"):
                done[row["cell_id"]] = row
    todo = [cell for cell in cells if cell["cell_id"] not in done]
    max_workers = int(os.environ.get("TS_SIGNAL_WORKERS", "4"))
    with ThreadPoolExecutor(max_workers=max_workers) as executor, results_path.open("a") as output:
        futures = [executor.submit(post, cell, key) for cell in todo]
        for future in as_completed(futures):
            row = future.result()
            done[row["cell_id"]] = row
            output.write(json.dumps(row) + "\n")
            output.flush()
    for cell_id_value in list(done):
        done[cell_id_value] = normalize_existing_row(done[cell_id_value])
    results_path.write_text(
        "".join(
            json.dumps(done[cell["cell_id"]]) + "\n"
            for cell in cells
            if cell["cell_id"] in done
        )
    )
    rows = [done[cell["cell_id"]] for cell in cells if cell["cell_id"] in done]
    write_analysis(rows, cells, zero_calls)
    print(json.dumps({
        "status": "complete" if len(rows) == len(cells) else "partial",
        "planned": len(cells),
        "rows": len(rows),
        "successful": sum(row.get("http") == 200 and row.get("score_in_range") for row in rows),
        "errors": sum(bool(row.get("error")) for row in rows),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
