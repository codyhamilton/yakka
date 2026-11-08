#!/usr/bin/env python3
"""Run the stats-jev-tournament dry phase without network access."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path
from typing import Any


def find_repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / ".git").exists():
            return parent
    raise RuntimeError("workflow-plugin repository root not found")


REPO_ROOT = find_repo_root()
OUTPUT_DIR = Path(__file__).resolve().parent
OPEN_FIELD_ROOT = REPO_ROOT / "docs/lab/RESEARCH/2026-10-01-session-analysis-open-field"
sys.path.insert(0, str(OPEN_FIELD_ROOT / "proofs/lib"))

from import_paths import ensure_import_paths  # noqa: E402

ensure_import_paths()

from classify import classify  # noqa: E402
from pack_io import pack_row_to_jev_state  # noqa: E402
from paths import AGREEMENT_MATRIX, DEFAULT_FIXTURES, SHAPE_QUAL_PACK  # noqa: E402
from schemas import JEV_MODEL, canonical_questions_json  # noqa: E402
from stats_card import build_stats_card  # noqa: E402
from segments import stats_card_to_pack_row  # noqa: E402

CASE_ID = "PR-STATS-JEV-TOURNAMENT"
APPROACH_ID = "stats-jev-tournament"
SCHEMA_ID = "early-signal-v0"
STRATUM = "maps-5h"
REGISTRATION_ID = "stats-jev-tournament-redry-v2-final-1"
REGISTRY_DEFAULT = Path("/home/codyh/workspace/corpus-ops/registry/stats-jev-tournament/framings.json")
WORKERS = (
    "92a48e004519",
    "ca977b9ca0dd",
    "87a380bc64ff",
    "bb6165018de0",
    "15f24c7ba18c",
    "0677f597286e",
    "074c8cf22927",
    "daf933273c8f",
)
EXPECTED_FRAMINGS = {
    "esv0-binary-foreshadow": (
        "esv0-binary-foreshadow#d0f736b5ecc043ce",
        "d0f736b5ecc043ce235cff655a3d3b72bc9b09fc8e231fe3b696e625893981f6",
    ),
    "esv0-likert-collapse": (
        "esv0-likert-collapse#4ddae065dda2245f",
        "4ddae065dda2245fbe46a9de7dbc61e56fd66c1d7938ccb7c45e5aff6fe35031",
    ),
    "esv0-binary-monitor-present": (
        "esv0-binary-monitor-present#77ace2e03f04a9da",
        "77ace2e03f04a9daf622faa0e49da54a620af1c0cf7b94be89e45fd9720e7db6",
    ),
    "esv0-binary-counts-only": (
        "esv0-binary-counts-only#10485a6cd618781e",
        "10485a6cd618781e93260513dd01dcc7fb058bdc6ebcf5be8b1f383d445983cd",
    ),
}


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_json(value: Any) -> str:
    return sha256_text(json.dumps(value, ensure_ascii=False, sort_keys=True))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def load_registry(path: Path) -> dict[str, Any]:
    registry = json.loads(path.read_text(encoding="utf-8"))
    if registry.get("case_id") != CASE_ID or registry.get("approach_id") != APPROACH_ID:
        raise ValueError("registry case or approach does not match the dry phase")
    if registry.get("schema_id") != SCHEMA_ID:
        raise ValueError("registry schema does not match the dry phase")
    if registry.get("model_pin") != JEV_MODEL:
        raise ValueError(f"registry model {registry.get('model_pin')!r} != {JEV_MODEL!r}")
    if registry.get("state_mode") != "stats_card" or registry.get("stratum") != STRATUM:
        raise ValueError("registry state mode or stratum does not match the dry phase")
    if registry.get("protocol", {}).get("live_max") != 32:
        raise ValueError("registry live cap is not 32")
    if registry.get("freeze_version") != "TYPESAFE_LEGAL_v2":
        raise ValueError("registry is not the final TYPESAFE_LEGAL_v2 freeze")
    return registry


def validate_framing(row: dict[str, Any]) -> dict[str, Any]:
    questions = row["questions"]
    canonical = canonical_questions_json(questions)
    computed_sha = sha256_text(canonical)
    expected_id = f"{row['registry_id']}#{computed_sha[:16]}"
    if computed_sha != row["questions_sha256"]:
        raise ValueError(f"{row['registry_id']}: questions_sha256 mismatch")
    if canonical != row["canonical_questions_json"]:
        raise ValueError(f"{row['registry_id']}: canonical question JSON mismatch")
    if expected_id != row["framing_id"]:
        raise ValueError(f"{row['registry_id']}: framing_id mismatch")
    expected = EXPECTED_FRAMINGS.get(row["registry_id"])
    if expected is None or row["framing_id"] != expected[0]:
        raise ValueError(f"{row['registry_id']}: unexpected final framing_id")
    if computed_sha != expected[1] or row["questions_sha256"] != expected[1]:
        raise ValueError(f"{row['registry_id']}: full questions_sha256 is not final")
    if row["freeze_status"] != "TYPESAFE_LEGAL_v2":
        raise ValueError(f"{row['registry_id']}: framing is not TYPESAFE_LEGAL_v2")
    return {
        "registry_id": row["registry_id"],
        "pilot_slug": row["pilot_slug"],
        "framing_id": row["framing_id"],
        "schema_id": row["schema_id"],
        "model_pin": row["model_pin"],
        "questions_sha256": row["questions_sha256"],
        "canonical_questions_json": canonical,
        "questions": questions,
        "freeze_status": row["freeze_status"],
        "description": row["description"],
    }


def load_t_by_worker() -> dict[str, int]:
    data = json.loads(AGREEMENT_MATRIX.read_text(encoding="utf-8"))
    return {row["worker_id"]: int(row["T"]) for row in data["workers"]}


def build_worker_state(worker_id: str, t_by_worker: dict[str, int]) -> tuple[dict[str, Any], dict[str, Any]]:
    card = build_stats_card(worker_id, T=t_by_worker[worker_id], pack=SHAPE_QUAL_PACK)
    state = pack_row_to_jev_state(stats_card_to_pack_row(card))
    if any(str(item.get("excerpt") or "").strip() for item in state.get("tail") or []):
        raise ValueError(f"{worker_id}: stats_card state contains a transcript excerpt")
    return card, state


def fixture_info(worker_id: str) -> dict[str, Any]:
    maps_path = DEFAULT_FIXTURES / f"{worker_id}.jsonl"
    return {
        "used_path": str(SHAPE_QUAL_PACK.relative_to(REPO_ROOT)),
        "used_kind": "shape-qual-full-maps-v1-judge-pack",
        "maps_jsonl_available": maps_path.is_file(),
        "maps_jsonl_path": str(maps_path.relative_to(REPO_ROOT)) if maps_path.is_file() else None,
    }


def run(registry_path: Path, output_dir: Path) -> dict[str, Any]:
    registry = load_registry(registry_path)
    framing_rows = [validate_framing(row) for row in registry["framings"]]
    if len(framing_rows) != 4:
        raise ValueError("expected exactly four frozen framings")
    if [row["registry_id"] for row in framing_rows] != [
        "esv0-binary-foreshadow",
        "esv0-likert-collapse",
        "esv0-binary-monitor-present",
        "esv0-binary-counts-only",
    ]:
        raise ValueError("frozen framing order changed")

    t_by_worker = load_t_by_worker()
    missing_workers = [worker_id for worker_id in WORKERS if worker_id not in t_by_worker]
    if missing_workers:
        raise ValueError(f"agreement matrix missing workers: {missing_workers}")

    worker_cards: dict[str, dict[str, Any]] = {}
    worker_states: dict[str, dict[str, Any]] = {}
    worker_fixture_info: dict[str, dict[str, Any]] = {}
    for worker_id in WORKERS:
        card, state = build_worker_state(worker_id, t_by_worker)
        worker_cards[worker_id] = card
        worker_states[worker_id] = state
        worker_fixture_info[worker_id] = fixture_info(worker_id)

    output_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = output_dir / "raw"
    write_json(
        output_dir / "framing-lock.json",
        {
            "registry_source": str(registry_path),
            "registry_sha256": hashlib.sha256(registry_path.read_bytes()).hexdigest(),
            "schema_id": SCHEMA_ID,
            "model_pin": JEV_MODEL,
            "framings": framing_rows,
            "likert_theme_collapse_rule": registry["likert_theme_collapse_rule"],
        },
    )
    registry_copy = output_dir / "registry-copy" / "framings.json"
    registry_copy.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(registry_path, registry_copy)
    write_jsonl(raw_dir / "stats_cards.jsonl", [worker_cards[worker_id] for worker_id in WORKERS])

    request_rows: list[dict[str, Any]] = []
    response_rows: list[dict[str, Any]] = []
    result_rows: list[dict[str, Any]] = []
    manifest_cells: list[dict[str, Any]] = []

    for worker_id in WORKERS:
        for framing in framing_rows:
            cell_id = f"{APPROACH_ID}:dry:{worker_id}:{framing['registry_id']}"
            state = worker_states[worker_id]
            candidate_request = {
                "model": JEV_MODEL,
                "state": state,
                "questions": framing["questions"],
            }
            try:
                classified = classify(
                    schema_id=SCHEMA_ID,
                    framing_slug=framing["pilot_slug"],
                    state=state,
                    evidence_class="stats_only",
                    live=False,
                    confirm_live=False,
                    questions_override=framing["questions"],
                )
                decision = classified.get("decision")
                reason = classified.get("reason")
                detail = classified.get("detail")
                cache_key = classified.get("cache_key")
                request_body = classified.get("request")
            except Exception as exc:
                decision = "error"
                reason = "dry_runner_exception"
                detail = str(exc)
                cache_key = None
                request_body = None

            if request_body is not None and request_body != candidate_request:
                raise ValueError(f"{cell_id}: classify request differs from frozen candidate")

            preflight_pass = decision == "dry_run"
            result_row = {
                "cell_id": cell_id,
                "worker_id": worker_id,
                "stratum": STRATUM,
                "framing_id": framing["framing_id"],
                "registry_id": framing["registry_id"],
                "questions_sha256": framing["questions_sha256"],
                "schema_id": SCHEMA_ID,
                "model": JEV_MODEL,
                "state_mode": "stats_card",
                "decision": decision,
                "preflight_pass": preflight_pass,
                "reason": reason,
                "detail": detail,
                "cache_key": cache_key,
                "network_call": False,
                "live_post": False,
            }
            result_rows.append(result_row)
            request_rows.append(
                {
                    "registration_id": REGISTRATION_ID,
                    "mode": "dry",
                    "cell_id": cell_id,
                    "worker_id": worker_id,
                    "stratum": STRATUM,
                    "framing_id": framing["framing_id"],
                    "schema_id": SCHEMA_ID,
                    "model": JEV_MODEL,
                    "decision": decision,
                    "preflight_pass": preflight_pass,
                    "cache_key": cache_key,
                    "would_post": False,
                    "request_body": request_body,
                    "candidate_request": candidate_request,
                }
            )
            response_rows.append(
                {
                    "registration_id": REGISTRATION_ID,
                    "mode": "dry",
                    "cell_id": cell_id,
                    "cache_key": cache_key,
                    "response_body": None,
                    "input_tokens": None,
                    "network_call": False,
                    "error": None,
                }
            )
            manifest_cells.append(
                {
                    "cell_id": cell_id,
                    "worker_id": worker_id,
                    "stratum": STRATUM,
                    "framing_id": framing["framing_id"],
                    "registry_id": framing["registry_id"],
                    "questions_sha256": framing["questions_sha256"],
                    "schema_id": SCHEMA_ID,
                    "model_pin": JEV_MODEL,
                    "state_mode": "stats_card",
                    "T": worker_cards[worker_id]["T"],
                    "checkpoint_turn": worker_cards[worker_id]["checkpoint_turn"],
                    "card_hash": worker_cards[worker_id]["card_hash"],
                    "state_sha256": sha256_json(state),
                    "fixture": worker_fixture_info[worker_id],
                    "decision": decision,
                    "preflight_pass": preflight_pass,
                }
            )

    write_jsonl(raw_dir / "requests.jsonl", request_rows)
    write_jsonl(raw_dir / "responses.jsonl", response_rows)
    write_jsonl(output_dir / "results.jsonl", result_rows)

    framing_summary = []
    for framing in framing_rows:
        rows = [row for row in result_rows if row["registry_id"] == framing["registry_id"]]
        framing_summary.append(
            {
                "registry_id": framing["registry_id"],
                "framing_id": framing["framing_id"],
                "cells": len(rows),
                "dry_run_cells": sum(row["decision"] == "dry_run" for row in rows),
                "preflight_failures": sum(not row["preflight_pass"] for row in rows),
                "pass": all(row["preflight_pass"] for row in rows),
                "failure_reasons": sorted({row["reason"] for row in rows if row["reason"]}),
            }
        )

    missing_fixtures = [
        worker_id for worker_id, info in worker_fixture_info.items() if not info["used_path"]
    ]
    manifest = {
        "manifest_version": 1,
        "registration_id": REGISTRATION_ID,
        "case_id": CASE_ID,
        "approach_id": APPROACH_ID,
        "mode": "dry",
        "dry_only": True,
        "schema_id": SCHEMA_ID,
        "model_pin": JEV_MODEL,
        "state_mode": "stats_card",
        "stratum": STRATUM,
        "hold_out_n": 26,
        "hold_out_scored": False,
        "live_max": 32,
        "live_seats_run": 0,
        "worker_order": list(WORKERS),
        "framing_ids": [framing["framing_id"] for framing in framing_rows],
        "cell_count": len(manifest_cells),
        "cell_ids": [cell["cell_id"] for cell in manifest_cells],
        "missing_fixtures": missing_fixtures,
        "framing_summary": framing_summary,
        "cells": manifest_cells,
    }
    write_json(output_dir / "cell-manifest.json", manifest)
    write_json(
        output_dir / "meters.json",
        {
            "registration_id": REGISTRATION_ID,
            "mode": "dry",
            "model_pin": JEV_MODEL,
            "cells_planned": len(result_rows),
            "cells_recorded": len(result_rows),
            "dry_run_decisions": sum(row["decision"] == "dry_run" for row in result_rows),
            "preflight_failures": sum(not row["preflight_pass"] for row in result_rows),
            "network_calls": 0,
            "jev_posts": 0,
            "flash_calls": 0,
            "live_seats_run": 0,
            "hold_out_scored": 0,
            "transcript_excerpts_in_state": 0,
            "missing_fixtures": len(missing_fixtures),
            "framing_summary": framing_summary,
        },
    )
    (output_dir / "METERS.md").write_text(
        "# stats-jev-tournament dry meters\n\n"
        f"- Cells: {len(result_rows)} (8 workers x 4 framings)\n"
        f"- Dry-run decisions: {sum(row['decision'] == 'dry_run' for row in result_rows)}\n"
        f"- Preflight failures: {sum(not row['preflight_pass'] for row in result_rows)}\n"
        "- Network calls: 0\n"
        "- TypeSafe POSTs: 0\n"
        "- Flash calls: 0\n"
        "- Live seats run: 0\n"
        "- Hold-out scored: 0 of 26\n"
        "- Transcript excerpts in state: 0\n"
        f"- Missing accepted fixtures: {len(missing_fixtures)}\n",
        encoding="utf-8",
    )

    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, default=REGISTRY_DEFAULT)
    parser.add_argument("--out", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()
    manifest = run(args.registry, args.out)
    print(
        json.dumps(
            {
                "cell_count": manifest["cell_count"],
                "live_seats_run": manifest["live_seats_run"],
                "missing_fixtures": manifest["missing_fixtures"],
                "framing_summary": manifest["framing_summary"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
