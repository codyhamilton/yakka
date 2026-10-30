#!/usr/bin/env python3
"""Maps-only TypeSafe seat for the frozen binary-foreshadow framing.

This is measurement-only evidence collection.  It reads frozen fixtures,
builds prefix-only states, and POSTs directly to TypeSafe System One.  It
does not import product code, start localhost:8080, invoke hooks, unlock
anything, or score outcomes.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO = Path(os.environ.get("WF_REPO", "/home/codyh/workspace/workflow-plugin"))
ROOT = Path(__file__).resolve().parent
FIXTURES = (
    REPO
    / "docs/lab/RESEARCH/2026-09-30-jev-cheap-judgement-signals"
    / "proofs/fixtures/maps-5h-workers"
)
OPEN_FIELD_ROOT = REPO / "docs/lab/RESEARCH/2026-10-01-session-analysis-open-field"
PROOFS = REPO / "docs/lab/RESEARCH/2026-10-01-progressive-jev-session-gates/proofs"
sys.path.insert(0, str(OPEN_FIELD_ROOT / "proofs/lib"))
sys.path.insert(0, str(PROOFS))

from framing_pool import OPEN_FIELD_FRAMING_SLUGS, blob_digest  # noqa: E402
from snapshot_state import prepare_hybrid_state, state_json_len  # noqa: E402
from turn_index import file_sha256, index_transcript  # noqa: E402

API_URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-1.13.0"
DRIVER = "typesafe"
STRATUM = "maps-5h"
PILOT_SLUG = "tournament-binary-foreshadow"
REGISTRY_ID = "esv0-binary-foreshadow"
FRAMING_ID = "esv0-binary-foreshadow#d0f736b5ecc043ce"
FRAMING_SHA256 = "d0f736b5ecc043ce235cff655a3d3b72bc9b09fc8e231fe3b696e625893981f6"
SCHEMA_ID = "early-signal-v0"
CHECKPOINTS = (75, 90)
FIRST_CHECKPOINT = 75
INTERVAL = 15
MAX_STATE_CHARS = 12_000
WORKERS = ("92a48e004519", "bb6165018de0", "0aab88c525de", "036ff3ed4a89")
RESPONSE_LABELS = (
    "fire_now",
    "defer_recheck",
    "defer_closing",
    "defer_productive",
    "defer_insufficient",
)
RESPONSE_CRITERIA = {
    "fire_now": "Fire now: likely avoidable low-value continuation.",
    "defer_recheck": "Defer and re-check: concern is not persistent or evidence is insufficient.",
    "defer_closing": "Defer: concrete completion, validation, or delivery value remains.",
    "defer_productive": "Defer: checkable productive progress remains.",
    "defer_insufficient": "Defer: evidence is too weak to justify firing.",
}
FRAME_ANSWER_LABELS = {
    "reread_cluster": {"yes", "no"},
    "thrash_bundle": {"yes", "no"},
    "poll_monitor": {"yes", "no"},
}
REGISTRY_DEFAULT = Path(
    "/home/codyh/workspace/corpus-ops/registry/stats-jev-tournament/framings.json"
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def digest_json(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def load_framing(registry_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    matches = [
        row
        for row in registry.get("framings", [])
        if row.get("registry_id") == REGISTRY_ID
        and row.get("pilot_slug") == PILOT_SLUG
    ]
    if len(matches) != 1:
        raise SystemExit(f"expected one locked {REGISTRY_ID}/{PILOT_SLUG} row")
    row = matches[0]
    questions = row.get("questions")
    pool_questions = OPEN_FIELD_FRAMING_SLUGS.get(PILOT_SLUG)
    if questions != pool_questions:
        raise SystemExit("locked registry questions differ from open-field framing_pool")
    if blob_digest(questions) != FRAMING_SHA256:
        raise SystemExit("binary-foreshadow question digest is not TYPESAFE_LEGAL_v2")
    if row.get("framing_id") != FRAMING_ID or row.get("questions_sha256") != FRAMING_SHA256:
        raise SystemExit("locked registry framing_id/hash mismatch")
    if row.get("freeze_status") != "TYPESAFE_LEGAL_v2":
        raise SystemExit("selected framing is not TYPESAFE_LEGAL_v2")
    if "tournament-monitor-called-out" in json.dumps(row, sort_keys=True):
        raise SystemExit("killed monitor framing is present in the selected framing")
    return registry, row


def prior_projection(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "checkpoint_turn": state.get("checkpoint_turn"),
        "evidence_class": "prior_prefix_projection",
        "cumulative": copy.deepcopy(state.get("cumulative") or {}),
        "tail": copy.deepcopy((state.get("tail") or [])[-4:]),
    }


def build_cells(framing: dict[str, Any]) -> list[dict[str, Any]]:
    cells: list[dict[str, Any]] = []
    for worker_id in WORKERS:
        fixture = FIXTURES / f"{worker_id}.jsonl"
        if not fixture.is_file():
            raise SystemExit(f"missing fixture: {fixture}")
        indexed = index_transcript(fixture, worker_id=worker_id)
        if indexed.T < max(CHECKPOINTS):
            raise SystemExit(f"{worker_id} has only {indexed.T} turns; cannot run 90")
        prior: int | None = None
        states: dict[int, dict[str, Any]] = {}
        for checkpoint in CHECKPOINTS:
            state, shrink_steps = prepare_hybrid_state(
                indexed,
                checkpoint,
                first_at=FIRST_CHECKPOINT,
                interval=INTERVAL,
                prior=prior,
            )
            if state is None:
                raise SystemExit(f"state unavailable for {worker_id}@{checkpoint}")
            state["evidence_class"] = "trial-prefix-v1"
            if checkpoint == 90:
                state["prior_prefix_projection"] = prior_projection(states[75])
                state["elapsed_turns_since_prior"] = INTERVAL
            if state_json_len(state) > MAX_STATE_CHARS:
                raise SystemExit(f"state over budget for {worker_id}@{checkpoint}")
            cell_recipe = (
                f"batch003-v1|{DRIVER}|{PILOT_SLUG}|{worker_id}|{checkpoint}|"
                "75:15|post-90-prune|response-v1"
            )
            cells.append(
                {
                    "cell_id": hashlib.sha256(cell_recipe.encode()).hexdigest()[:16],
                    "worker_id": worker_id,
                    "checkpoint": checkpoint,
                    "prior_checkpoint": prior,
                    "stratum": STRATUM,
                    "driver": DRIVER,
                    "model": MODEL,
                    "pilot_slug": PILOT_SLUG,
                    "registry_id": REGISTRY_ID,
                    "framing_id": framing["framing_id"],
                    "questions_sha256": framing["questions_sha256"],
                    "fixture": str(fixture.relative_to(REPO)),
                    "fixture_sha256": file_sha256(fixture),
                    "source_turns_for_eligibility_only": indexed.T,
                    "state": state,
                    "state_chars": state_json_len(state),
                    "shrink_steps": shrink_steps,
                    "framing_questions": framing["questions"],
                }
            )
            states[checkpoint] = state
            prior = checkpoint
    return cells


def request_questions(cell: dict[str, Any]) -> dict[str, Any]:
    # The frozen framing questions are preserved byte-for-byte as their own
    # entries.  The separate response entry supplies the trial's fire/defer
    # decision and is parsed independently from the foreshadow axes.
    return {
        "response": {
            "type": "choice",
            "instructions": (
                "From the supplied prefix only, choose exactly one response "
                "label. Fire only for likely avoidable low-value continuation; "
                "otherwise choose the most specific defer label."
            ),
            "criteria": RESPONSE_CRITERIA,
        },
        **cell["framing_questions"],
    }


def post_cell(out: Path, cell: dict[str, Any], key: str) -> dict[str, Any]:
    cell_id = cell["cell_id"]
    raw = out / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    request = {
        "model": MODEL,
        "state": cell["state"],
        "questions": request_questions(cell),
    }
    request_path = raw / f"{cell_id}-request.json"
    request_path.write_text(
        json.dumps(request, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    started_clock = time.monotonic()
    result: dict[str, Any] = {
        "cell_id": cell_id,
        "worker_id": cell["worker_id"],
        "checkpoint": cell["checkpoint"],
        "prior_checkpoint": cell["prior_checkpoint"],
        "stratum": STRATUM,
        "driver": DRIVER,
        "model": MODEL,
        "pilot_slug": PILOT_SLUG,
        "registry_id": REGISTRY_ID,
        "framing_id": FRAMING_ID,
        "questions_sha256": FRAMING_SHA256,
        "state_prefix_only": True,
        "state_chars": cell["state_chars"],
        "request_path": str(request_path.relative_to(out)),
        "request_started_at": now(),
        "http_status": None,
        "response_label": None,
        "response_class": None,
        "decision": None,
        "fire": None,
        "raw_answers": None,
        "frame_answers": {},
        "error": None,
    }
    try:
        http_request = urllib.request.Request(
            API_URL,
            data=json.dumps(request, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(http_request, timeout=120) as response:
            raw_response = response.read().decode("utf-8")
            result["http_status"] = response.status
        response_path = raw / f"{cell_id}-response.json"
        response_path.write_text(
            raw_response + ("" if raw_response.endswith("\n") else "\n"),
            encoding="utf-8",
        )
        result["response_path"] = str(response_path.relative_to(out))
        payload = json.loads(raw_response)
        answers = payload.get("answers") or {}
        result["raw_answers"] = answers
        choice = (answers.get("response") or {}).get("choice")
        result["response_label"] = choice
        if choice in RESPONSE_LABELS:
            # Do not hardcode response_class: it is the scraped choice.
            result["response_class"] = choice
            result["decision"] = "fire" if choice == "fire_now" else "defer"
            result["fire"] = choice == "fire_now"
        else:
            result["error"] = f"unexpected response choice: {choice!r}"
        for question_id, valid in FRAME_ANSWER_LABELS.items():
            frame_choice = (answers.get(question_id) or {}).get("choice")
            result["frame_answers"][question_id] = frame_choice
            if frame_choice not in valid:
                suffix = f"unexpected {question_id} choice: {frame_choice!r}"
                result["error"] = (
                    f"{result['error']}; {suffix}" if result["error"] else suffix
                )
        result["usage"] = payload.get("usage")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        error_path = raw / f"{cell_id}-error.txt"
        error_path.write_text(f"HTTP {exc.code}\n{detail}\n", encoding="utf-8")
        result["http_status"] = exc.code
        result["error"] = f"HTTP {exc.code}: {detail[:800]}"
        result["error_path"] = str(error_path.relative_to(out))
    except Exception as exc:
        error_path = raw / f"{cell_id}-error.txt"
        error_path.write_text(f"{type(exc).__name__}: {exc}\n", encoding="utf-8")
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["error_path"] = str(error_path.relative_to(out))
    result["response_received_at"] = now()
    result["elapsed_ms"] = round((time.monotonic() - started_clock) * 1000)
    return result


def write_outputs(
    out: Path,
    cells: list[dict[str, Any]],
    results: list[dict[str, Any]],
    registry: dict[str, Any],
    framing: dict[str, Any],
    registry_path: Path,
) -> None:
    by_id = {row["cell_id"]: row for row in results}
    ordered = [by_id[cell["cell_id"]] for cell in cells if cell["cell_id"] in by_id]
    write_jsonl(out / "results.jsonl", ordered)
    manifest_cells = []
    for cell in cells:
        row = by_id.get(cell["cell_id"], {})
        manifest_cells.append(
            {
                "cell_id": cell["cell_id"],
                "worker_id": cell["worker_id"],
                "checkpoint": cell["checkpoint"],
                "prior_checkpoint": cell["prior_checkpoint"],
                "stratum": STRATUM,
                "driver": DRIVER,
                "model": MODEL,
                "fixture": cell["fixture"],
                "fixture_sha256": cell["fixture_sha256"],
                "source_turns_for_eligibility_only": cell[
                    "source_turns_for_eligibility_only"
                ],
                "state_chars": cell["state_chars"],
                "state_sha256": digest_json(cell["state"]),
                "shrink_steps": cell["shrink_steps"],
                "framing_id": FRAMING_ID,
                "response_label": row.get("response_label"),
                "response_class": row.get("response_class"),
                "decision": row.get("decision"),
                "fire": row.get("fire"),
                "request_path": row.get("request_path"),
                "response_path": row.get("response_path"),
                "error": row.get("error"),
            }
        )
    write_json(
        out / "cell-manifest.json",
        {
            "manifest_version": 1,
            "generated_at": now(),
            "case_id": "tournament-binary-foreshadow",
            "driver": DRIVER,
            "model": MODEL,
            "stratum": STRATUM,
            "maps_only": True,
            "measurement_only": True,
            "behaviour_ship": False,
            "localhost_8080": False,
            "hooks_unlock": False,
            "post_90_prune": True,
            "schedule": {"first_checkpoint": 75, "interval": 15, "checkpoints": [75, 90]},
            "registry_id": REGISTRY_ID,
            "pilot_slug": PILOT_SLUG,
            "framing_id": FRAMING_ID,
            "questions_sha256": FRAMING_SHA256,
            "framing_questions_exact": framing["questions"],
            "response_labels": list(RESPONSE_LABELS),
            "cell_id_recipe": (
                "sha256(batch003-v1|typesafe|pilot_slug|worker|checkpoint|"
                "75:15|post-90-prune|response-v1)[:16]"
            ),
            "n_cells_planned": len(cells),
            "n_cells_recorded": len(ordered),
            "cell_ids": [cell["cell_id"] for cell in cells],
            "cells": manifest_cells,
            "registry_source": str(registry_path),
            "registry_sha256": hashlib.sha256(registry_path.read_bytes()).hexdigest(),
            "monitor_called_out_included": False,
            "registry_rows_loaded": len(registry.get("framings") or []),
        },
    )
    errors = [row for row in ordered if row.get("error")]
    response_counts = {
        label: sum(row.get("response_label") == label for row in ordered)
        for label in RESPONSE_LABELS
    }
    frame_counts = {
        question_id: {
            label: sum(
                (row.get("frame_answers") or {}).get(question_id) == label
                for row in ordered
            )
            for label in sorted(labels)
        }
        for question_id, labels in FRAME_ANSWER_LABELS.items()
    }
    by_checkpoint = {}
    for checkpoint in CHECKPOINTS:
        rows = [row for row in ordered if row["checkpoint"] == checkpoint]
        by_checkpoint[str(checkpoint)] = {
            "n": len(rows),
            "fire": sum(row.get("fire") is True for row in rows),
            "defer": sum(row.get("fire") is False for row in rows),
        }
    meters = {
        "generated_at": now(),
        "case_id": "tournament-binary-foreshadow",
        "driver": DRIVER,
        "model": MODEL,
        "stratum": STRATUM,
        "maps_only": True,
        "measurement_only": True,
        "behaviour_ship": False,
        "localhost_8080": False,
        "post_90_prune": True,
        "framing_id": FRAMING_ID,
        "n_cells_planned": len(cells),
        "n_cells_recorded": len(ordered),
        "n_successful": len(ordered) - len(errors),
        "n_errors": len(errors),
        "fire_count": sum(row.get("fire") is True for row in ordered),
        "defer_count": sum(row.get("fire") is False for row in ordered),
        "parse_miss_count": sum(
            bool(row.get("error")) and row.get("response_label") is None for row in ordered
        ),
        "response_label_counts": response_counts,
        "frame_answer_counts": frame_counts,
        "response_class_equals_response_label": all(
            row.get("response_class") == row.get("response_label")
            for row in ordered
            if row.get("response_label") is not None
        ),
        "by_checkpoint": by_checkpoint,
        "error_cell_ids": [row["cell_id"] for row in errors],
        "monitor_called_out_included": False,
        "outcome_scoring": "unidentified; no outcome labels supplied",
    }
    write_json(out / "meters.json", meters)
    (out / "METERS.md").write_text(
        "\n".join(
            [
                "# tournament-binary-foreshadow TypeSafe meters",
                "",
                "Maps-only, prefix-only measurement. No behaviour ship, hooks, "
                "unlock, outcome scoring, or localhost:8080.",
                "",
                f"- Framing: `{FRAMING_ID}`",
                f"- Cells: {len(ordered)}/{len(cells)}",
                f"- Fire: {meters['fire_count']}",
                f"- Defer: {meters['defer_count']}",
                f"- Errors: {meters['n_errors']}",
                f"- Parse misses: {meters['parse_miss_count']}",
                f"- `response_class == response_label`: "
                f"{meters['response_class_equals_response_label']}",
                "",
                "| Checkpoint | Cells | Fire | Defer |",
                "|---:|---:|---:|---:|",
                *[
                    f"| {checkpoint} | {by_checkpoint[str(checkpoint)]['n']} | "
                    f"{by_checkpoint[str(checkpoint)]['fire']} | "
                    f"{by_checkpoint[str(checkpoint)]['defer']} |"
                    for checkpoint in CHECKPOINTS
                ],
                "",
                "Frame yes/no answers are retained separately in `results.jsonl` "
                "and `meters.json`; they are not substituted for fire/defer.",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


def run(args: argparse.Namespace) -> int:
    registry, framing = load_framing(args.registry)
    cells = build_cells(framing)
    out = args.output
    out.mkdir(parents=True, exist_ok=True)
    write_json(
        out / "framing-lock.json",
        {
            "registry_source": str(args.registry),
            "registry_sha256": hashlib.sha256(args.registry.read_bytes()).hexdigest(),
            "schema_id": SCHEMA_ID,
            "model_pin": MODEL,
            "registry_id": REGISTRY_ID,
            "pilot_slug": PILOT_SLUG,
            "framing_id": FRAMING_ID,
            "questions_sha256": FRAMING_SHA256,
            "freeze_status": framing["freeze_status"],
            "questions": framing["questions"],
            "killed_framing": "tournament-monitor-called-out",
        },
    )
    inputs = out / "inputs"
    inputs.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.registry, inputs / "framings.json")
    for worker_id in WORKERS:
        shutil.copyfile(FIXTURES / f"{worker_id}.jsonl", inputs / f"{worker_id}.jsonl")
    write_jsonl(
        out / "raw" / "prepared-cells.jsonl",
        [
            {
                "cell_id": cell["cell_id"],
                "worker_id": cell["worker_id"],
                "checkpoint": cell["checkpoint"],
                "state": cell["state"],
                "state_sha256": digest_json(cell["state"]),
                "request": {
                    "model": MODEL,
                    "state": cell["state"],
                    "questions": request_questions(cell),
                },
            }
            for cell in cells
        ],
    )
    if args.dry_run:
        dry_results = [
            {
                "cell_id": cell["cell_id"],
                "worker_id": cell["worker_id"],
                "checkpoint": cell["checkpoint"],
                "response_label": None,
                "response_class": None,
                "decision": "dry_run",
                "fire": None,
                "error": None,
            }
            for cell in cells
        ]
        write_outputs(out, cells, dry_results, registry, framing, args.registry)
        print(json.dumps({"status": "dry_run", "n_cells": len(cells)}))
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
            if (
                row.get("cell_id")
                and not row.get("error")
                and row.get("http_status") == 200
                and row.get("response_label") in RESPONSE_LABELS
            ):
                existing[row["cell_id"]] = row
    todo = [cell for cell in cells if cell["cell_id"] not in existing]
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(post_cell, out, cell, key) for cell in todo]
        for future in as_completed(futures):
            row = future.result()
            existing[row["cell_id"]] = row
            print(
                f"{row['cell_id']} {row['worker_id']}@{row['checkpoint']} "
                f"decision={row.get('decision')} label={row.get('response_label')} "
                f"error={row.get('error')}",
                flush=True,
            )
    write_outputs(out, cells, list(existing.values()), registry, framing, args.registry)
    errors = [row for row in existing.values() if row.get("error")]
    print(
        json.dumps(
            {
                "status": "complete" if len(existing) == len(cells) and not errors else "partial",
                "n_cells": len(cells),
                "recorded": len(existing),
                "errors": len(errors),
                "fire": sum(row.get("fire") is True for row in existing.values()),
                "defer": sum(row.get("fire") is False for row in existing.values()),
            }
        )
    )
    return 1 if errors or len(existing) != len(cells) else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, default=REGISTRY_DEFAULT)
    parser.add_argument("--output", type=Path, default=ROOT)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
