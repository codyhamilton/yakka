#!/usr/bin/env python3
"""Run the PR-VALIDATION-PHASE TypeSafe measurement grid.

This runner consumes the frozen, redacted early-prefix judge packs.  It sends
one prefix-only System One request for each of 7 workers at checkpoints
50/60/75, for 63 calls total.  It does not use hooks, checkout labels, or any
live Jev/unlock path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CASE_ID = "PR-VALIDATION-PHASE"
MODEL = "jev-1.13.0"
DRIVER = "typesafe"
STRATUM = "maps-5h"
API_URL = "https://api.typesafe.ai/v1/systemone"
CHECKPOINTS = (50, 60, 75)
REPLICATES = (1, 2, 3)
WORKERS = (
    "92a48e004519",
    "ca977b9ca0dd",
    "87a380bc64ff",
    "bb6165018de0",
    "15f24c7ba18c",
    "0677f597286e",
    "074c8cf22927",
)
WORKER_STRATA = {
    "92a48e004519": "thrash",
    "ca977b9ca0dd": "thrash",
    "87a380bc64ff": "poll",
    "bb6165018de0": "poll",
    "15f24c7ba18c": "poll",
    "0677f597286e": "productive-edit",
    "074c8cf22927": "productive-edit",
}
RESPONSE_LABELS = ("in_validation", "building", "inconclusive")
PATTERN_LABELS = ("test_fix_loop", "forward_edit", "mixed_or_unclear")
COMBINED_NAME = (
    "validation-phase-earlycps-judge-packs-20261002-earlycps.jsonl"
)
EXPECTED_PACK_SHA256 = (
    "81908d76b4d435a4b6d430390ce5b93b917f57d3d3239901b078251200d9978d"
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def stable_cell_id(worker_id: str, checkpoint: int, replicate: int) -> str:
    recipe = (
        f"batch003-v1|{DRIVER}|{worker_id}|{checkpoint}|"
        f"hybrid_v0|validation_phase|w0|replicate.{replicate}"
    )
    return hashlib.sha256(recipe.encode()).hexdigest()[:16]


def load_pack(path: Path) -> tuple[list[dict[str, Any]], str]:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != EXPECTED_PACK_SHA256:
        raise SystemExit(
            f"frozen pack sha256 mismatch: expected {EXPECTED_PACK_SHA256}, "
            f"got {digest}"
        )
    rows = [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    expected = {(worker, checkpoint) for worker in WORKERS for checkpoint in CHECKPOINTS}
    actual = {(row.get("worker_id"), row.get("checkpoint_turn")) for row in rows}
    if len(rows) != len(expected) or actual != expected:
        raise SystemExit(
            f"frozen pack grid mismatch: expected {len(expected)} rows, got {len(rows)}"
        )
    return rows, digest


def prefix_state(row: dict[str, Any]) -> dict[str, Any]:
    """Build the only state sent to TypeSafe from a frozen pack row.

    Provenance, source transcript hashes, total-turn metadata, and pack
    bookkeeping are deliberately excluded from the request.
    """
    return {
        "question_id": CASE_ID,
        "worker_id": row["worker_id"],
        "checkpoint_turn": row["checkpoint_turn"],
        "prior_checkpoint_turn": row.get("prior_checkpoint_turn"),
        "evidence_class": "validation-phase-earlycps-prefix",
        "brief_anchor": row.get("brief_anchor", ""),
        "cumulative": row.get("cumulative") or {},
        "delta_since_prior": row.get("delta_since_prior") or {},
        "thrash_top_rereads": row.get("thrash_top_rereads") or [],
        "tail": row.get("tail") or [],
    }


def question_block() -> dict[str, Any]:
    return {
        "response": {
            "type": "choice",
            "instructions": (
                "Is this worker already in validation (reactive read/fix/test "
                "loop) versus forward build? Answer exactly one of "
                "in_validation, building, or inconclusive from the supplied "
                "prefix only."
            ),
            "criteria": {
                "in_validation": (
                    "A reactive read/fix/test loop is already the dominant "
                    "pattern in this prefix."
                ),
                "building": (
                    "Forward implementation or construction is the dominant "
                    "pattern in this prefix."
                ),
                "inconclusive": (
                    "The prefix does not distinguish validation from forward "
                    "build with adequate confidence."
                ),
            },
        },
        "pattern_note": {
            "type": "choice",
            "instructions": (
                "Add one concise pattern note by choosing the best label from "
                "the prefix only."
            ),
            "criteria": {
                "test_fix_loop": (
                    "Reactive tests, reads, fixes, retries, or verification "
                    "dominate the recent pattern."
                ),
                "forward_edit": (
                    "Forward edits or implementation construction dominate "
                    "the recent pattern."
                ),
                "mixed_or_unclear": (
                    "The pattern is mixed or cannot be distinguished from the "
                    "prefix."
                ),
            },
        },
    }


def build_cells(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cells = []
    for row in sorted(rows, key=lambda item: (WORKERS.index(item["worker_id"]), item["checkpoint_turn"])):
        worker_id = row["worker_id"]
        checkpoint = row["checkpoint_turn"]
        for replicate in REPLICATES:
            cells.append(
                {
                    "cell_id": stable_cell_id(worker_id, checkpoint, replicate),
                    "case_id": CASE_ID,
                    "driver": DRIVER,
                    "model": MODEL,
                    "stratum": STRATUM,
                    "worker_id": worker_id,
                    "worker_stratum": WORKER_STRATA[worker_id],
                    "checkpoint": checkpoint,
                    "prior_checkpoint": row.get("prior_checkpoint_turn"),
                    "replicate": replicate,
                    "pack_sha256": EXPECTED_PACK_SHA256,
                    "state": prefix_state(row),
                }
            )
    return cells


def request_body(cell: dict[str, Any]) -> dict[str, Any]:
    return {
        "model": MODEL,
        "state": {
            "scenario_id": (
                f"case.{CASE_ID}|worker.{cell['worker_id']}|"
                f"checkpoint.{cell['checkpoint']}"
            ),
            "checkpoint_turn": cell["checkpoint"],
            "evidence_class": "validation-phase-earlycps-prefix",
            "snapshot": cell["state"],
        },
        "questions": question_block(),
    }


def post_cell(cell: dict[str, Any], out: Path, key: str) -> dict[str, Any]:
    cell_id = cell["cell_id"]
    raw = out / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    request = request_body(cell)
    request_path = raw / f"{cell_id}-request.json"
    request_path.write_text(json.dumps(request, indent=2, ensure_ascii=False) + "\n")
    result: dict[str, Any] = {
        "cell_id": cell_id,
        "case_id": CASE_ID,
        "driver": DRIVER,
        "model": MODEL,
        "stratum": STRATUM,
        "worker_id": cell["worker_id"],
        "worker_stratum": cell["worker_stratum"],
        "checkpoint": cell["checkpoint"],
        "prior_checkpoint": cell["prior_checkpoint"],
        "replicate": cell["replicate"],
        "state_prefix_only": True,
        "state_chars": len(json_dump(cell["state"])),
        "request_path": str(request_path.relative_to(out)),
        "request_started_at": now(),
        "http_status": None,
        "response_label": None,
        "response_class": None,
        "pattern_note": None,
        "decision": None,
        "error": None,
    }
    started = time.monotonic()
    try:
        body = json_dump(request).encode()
        http_request = urllib.request.Request(
            API_URL,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(http_request, timeout=120) as response:
            response_body = response.read().decode("utf-8")
            result["http_status"] = response.status
        response_path = raw / f"{cell_id}-response.json"
        response_path.write_text(
            response_body + ("" if response_body.endswith("\n") else "\n")
        )
        result["response_path"] = str(response_path.relative_to(out))
        payload = json.loads(response_body)
        answers = payload.get("answers") or {}
        result["raw_answers"] = answers
        response_answer = answers.get("response") or {}
        choice = response_answer.get("choice")
        result["response_label"] = choice
        if choice in RESPONSE_LABELS:
            result["response_class"] = choice
            result["decision"] = choice
        else:
            result["error"] = f"unexpected response choice: {choice!r}"
        pattern_answer = answers.get("pattern_note") or {}
        pattern = pattern_answer.get("choice")
        result["pattern_note"] = pattern
        if pattern not in PATTERN_LABELS:
            suffix = f"unexpected pattern_note choice: {pattern!r}"
            result["error"] = f"{result['error']}; {suffix}" if result["error"] else suffix
        result["usage"] = payload.get("usage")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        error_path = raw / f"{cell_id}-error.txt"
        error_path.write_text(f"HTTP {exc.code}\n{detail}\n")
        result["http_status"] = exc.code
        result["error"] = f"HTTP {exc.code}: {detail[:800]}"
        result["error_path"] = str(error_path.relative_to(out))
    except Exception as exc:  # network, timeout, or malformed response
        error_path = raw / f"{cell_id}-error.txt"
        error_path.write_text(f"{type(exc).__name__}: {exc}\n")
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["error_path"] = str(error_path.relative_to(out))
    result["response_received_at"] = now()
    result["elapsed_ms"] = round((time.monotonic() - started) * 1000)
    return result


def write_outputs(
    out: Path,
    cells: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    pack_sha256: str,
    prepared_at: str,
) -> None:
    by_id = {row["cell_id"]: row for row in rows}
    ordered = [by_id[cell["cell_id"]] for cell in cells if cell["cell_id"] in by_id]
    (out / "results.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in ordered)
    )
    manifest_cells = []
    for cell in cells:
        result = by_id.get(cell["cell_id"], {})
        manifest_cells.append(
            {
                "cell_id": cell["cell_id"],
                "worker_id": cell["worker_id"],
                "worker_stratum": cell["worker_stratum"],
                "checkpoint": cell["checkpoint"],
                "prior_checkpoint": cell["prior_checkpoint"],
                "replicate": cell["replicate"],
                "request_path": result.get("request_path"),
                "response_path": result.get("response_path"),
                "response_label": result.get("response_label"),
                "response_class": result.get("response_class"),
                "pattern_note": result.get("pattern_note"),
                "error": result.get("error"),
            }
        )
    manifest = {
        "schema_version": "validation-phase-typesafe-v1",
        "case_id": CASE_ID,
        "driver": DRIVER,
        "model": MODEL,
        "stratum": STRATUM,
        "measurement_only": True,
        "unlock_called": False,
        "checkout_scoring": False,
        "api_url": API_URL,
        "pack_sha256": pack_sha256,
        "prepared_at": prepared_at,
        "n_cells_planned": len(cells),
        "n_cells_recorded": len(ordered),
        "cell_id_recipe": "sha256(batch003-v1|driver|worker|checkpoint|hybrid_v0|validation_phase|w0|replicate)[:16]",
        "choice_labels": list(RESPONSE_LABELS),
        "pattern_note_labels": list(PATTERN_LABELS),
        "cells": manifest_cells,
    }
    (out / "cell-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    errors = [row for row in ordered if row.get("error")]
    response_counts = Counter(row.get("response_label") for row in ordered)
    pattern_counts = Counter(row.get("pattern_note") for row in ordered)
    per_checkpoint = {}
    per_worker = {}
    for row in ordered:
        cp = str(row["checkpoint"])
        per_checkpoint.setdefault(cp, Counter())[
            row.get("response_label")
        ] += 1
        per_worker.setdefault(row["worker_id"], Counter())[
            row.get("response_label")
        ] += 1
    meters = {
        "schema_version": "validation-phase-typesafe-meters-v1",
        "case_id": CASE_ID,
        "driver": DRIVER,
        "model": MODEL,
        "stratum": STRATUM,
        "measurement_only": True,
        "unlock_called": False,
        "checkout_scoring": False,
        "pack_sha256": pack_sha256,
        "n_cells_planned": len(cells),
        "n_cells_recorded": len(ordered),
        "n_successful": sum(not row.get("error") for row in ordered),
        "n_errors": len(errors),
        "response_counts": dict(response_counts),
        "pattern_note_counts": dict(pattern_counts),
        "response_class_equals_response_label": all(
            row.get("response_class") == row.get("response_label")
            for row in ordered
            if row.get("response_label") is not None
        ),
        "by_checkpoint": {
            key: dict(value) for key, value in sorted(per_checkpoint.items())
        },
        "by_worker": {
            key: dict(value) for key, value in sorted(per_worker.items())
        },
        "missing_cells": [
            cell["cell_id"] for cell in cells if cell["cell_id"] not in by_id
        ],
        "error_cells": [row["cell_id"] for row in errors],
        "missing_packs": [],
        "generated_at": now(),
    }
    (out / "meters.json").write_text(json.dumps(meters, indent=2) + "\n")
    write_meters_md(out / "METERS.md", meters)


def write_meters_md(path: Path, meters: dict[str, Any]) -> None:
    lines = [
        "# PR-VALIDATION-PHASE TypeSafe meters",
        "",
        "**Scope:** Maps-only, prefix-only measurement. No behaviour ship, "
        "checkout scoring, or unlock path.",
        "",
        "| Measure | Result |",
        "|---|---:|",
        f"| Planned cells | {meters['n_cells_planned']} |",
        f"| Recorded cells | {meters['n_cells_recorded']} |",
        f"| Successful cells | {meters['n_successful']} |",
        f"| Error cells | {meters['n_errors']} |",
        f"| Missing packs | {len(meters['missing_packs'])} |",
        f"| response_class == response_label | {meters['response_class_equals_response_label']} |",
        "",
        "## Choice counts",
        "",
        "| Choice | Count |",
        "|---|---:|",
    ]
    lines.extend(
        f"| `{label}` | {meters['response_counts'].get(label, 0)} |"
        for label in RESPONSE_LABELS
    )
    lines.extend(
        [
            "",
            "## Pattern-note counts",
            "",
            "| Pattern note | Count |",
            "|---|---:|",
        ]
    )
    lines.extend(
        f"| `{label}` | {meters['pattern_note_counts'].get(label, 0)} |"
        for label in PATTERN_LABELS
    )
    lines.extend(
        [
            "",
            "All missing/error cells remain explicit in `meters.json`; no "
            "checkout or outcome-linked metric is derived.",
        ]
    )
    path.write_text("\n".join(lines) + "\n")


def copy_inputs(out: Path, pack_path: Path, pack_sha256: str) -> None:
    inputs = out / "inputs"
    inputs.mkdir(parents=True, exist_ok=True)
    (inputs / COMBINED_NAME).write_bytes(pack_path.read_bytes())
    protocol = pack_path.parents[1] / "protocol.json"
    if protocol.is_file():
        (inputs / "protocol.json").write_bytes(protocol.read_bytes())
    manifest = pack_path.parent / "MANIFEST.md"
    if manifest.is_file():
        (inputs / "MANIFEST.md").write_bytes(manifest.read_bytes())
    (inputs / "SOURCE-SHA256.txt").write_text(f"{pack_sha256}  {COMBINED_NAME}\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    default_out = Path(__file__).resolve().parent
    parser.add_argument(
        "--pack",
        type=Path,
        default=Path(
            "/home/codyh/workspace/corpus-ops/registry/validation-phase/packs"
        )
        / COMBINED_NAME,
    )
    parser.add_argument("--output", type=Path, default=default_out)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--prepare-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    pack_rows, pack_sha256 = load_pack(args.pack)
    cells = build_cells(pack_rows)
    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    prepared_at = now()
    copy_inputs(out, args.pack, pack_sha256)
    if args.prepare_only:
        write_outputs(out, cells, [], pack_sha256, prepared_at)
        print(json.dumps({"status": "prepared", "n_cells": len(cells)}))
        return 0
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if not key:
        raise SystemExit("TYPESAFE_API_KEY is not set")

    existing: dict[str, dict[str, Any]] = {}
    results_path = out / "results.jsonl"
    if results_path.is_file():
        for line in results_path.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("cell_id") and not row.get("error"):
                existing[row["cell_id"]] = row
    todo = [cell for cell in cells if cell["cell_id"] not in existing]
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = [pool.submit(post_cell, cell, out, key) for cell in todo]
        for future in as_completed(futures):
            row = future.result()
            existing[row["cell_id"]] = row
            print(
                f"{row['cell_id']} {row['worker_id']}@{row['checkpoint']} "
                f"choice={row.get('response_label')} pattern={row.get('pattern_note')} "
                f"error={row.get('error')}",
                flush=True,
            )
    write_outputs(out, cells, list(existing.values()), pack_sha256, prepared_at)
    errors = [row for row in existing.values() if row.get("error")]
    print(
        json.dumps(
            {
                "status": "complete" if len(existing) == len(cells) and not errors else "partial",
                "n_cells": len(cells),
                "recorded": len(existing),
                "errors": len(errors),
            }
        )
    )
    return 1 if errors or len(existing) != len(cells) else 0


if __name__ == "__main__":
    raise SystemExit(main())
