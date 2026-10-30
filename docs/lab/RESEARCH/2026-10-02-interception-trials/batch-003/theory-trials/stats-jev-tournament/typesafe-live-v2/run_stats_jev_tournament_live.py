#!/usr/bin/env python3
"""Run the frozen stats-jev-tournament live wave.

This is a measurement-only runner.  It validates every candidate cell before
consulting the zero-call gate and never changes product/runtime behaviour.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
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
sys.path.insert(0, str(REPO_ROOT / "tools/transcript"))

from import_paths import ensure_import_paths  # noqa: E402

ensure_import_paths()

from pack_io import pack_row_to_jev_state  # noqa: E402
from paths import AGREEMENT_MATRIX, DEFAULT_FIXTURES, SHAPE_QUAL_PACK  # noqa: E402
from schemas import (  # noqa: E402
    DEFAULT_INSTRUCTION,
    JEV_MODEL,
    cache_key,
    canonical_questions_json,
)
from segments import stats_card_to_pack_row  # noqa: E402
from stats_card import build_stats_card  # noqa: E402
from lib.jev_client import validate_systemone_request  # type: ignore  # noqa: E402


API_URL = "https://api.typesafe.ai/v1/systemone"
CASE_ID = "PR-STATS-JEV-TOURNAMENT"
APPROACH_ID = "stats-jev-tournament"
SCHEMA_ID = "early-signal-v0"
STRATUM = "maps-5h"
REGISTRATION_ID = "stats-jev-tournament-live-v2-1"
MODEL_PIN = "jev-1.13.0"
MAX_POSTS = 32
HOLD_OUT_N = 26
LIVE_FRAMING = "live-v2"
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

THRASH_WORKERS = frozenset({"92a48e004519", "ca977b9ca0dd"})
POLL_WORKERS = frozenset({"87a380bc64ff", "bb6165018de0", "15f24c7ba18c"})
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
        raise ValueError("registry case or approach does not match the live wave")
    if registry.get("schema_id") != SCHEMA_ID:
        raise ValueError("registry schema does not match the live wave")
    if registry.get("model_pin") != MODEL_PIN:
        raise ValueError(f"registry model {registry.get('model_pin')!r} != {MODEL_PIN!r}")
    if registry.get("state_mode") != "stats_card" or registry.get("stratum") != STRATUM:
        raise ValueError("registry state mode or stratum does not match the live wave")
    if registry.get("protocol", {}).get("live_max") != MAX_POSTS:
        raise ValueError("registry live cap is not 32")
    if registry.get("protocol", {}).get("hold_out_n") not in (None, HOLD_OUT_N):
        raise ValueError("registry hold-out size does not match the live wave")
    if registry.get("freeze_version") != "TYPESAFE_LEGAL_v2":
        raise ValueError("registry is not the final TYPESAFE_LEGAL_v2 freeze")
    return registry


def validate_framing(row: dict[str, Any]) -> dict[str, Any]:
    questions = row["questions"]
    canonical = canonical_questions_json(questions)
    computed_sha = sha256_text(canonical)
    expected_id = f"{row['registry_id']}#{computed_sha[:16]}"
    expected = EXPECTED_FRAMINGS.get(row["registry_id"])
    if computed_sha != row["questions_sha256"] or canonical != row["canonical_questions_json"]:
        raise ValueError(f"{row['registry_id']}: canonical question hash mismatch")
    if expected is None or expected_id != row["framing_id"] or computed_sha != expected[1]:
        raise ValueError(f"{row['registry_id']}: unexpected final framing id or SHA256")
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


def build_worker_state(
    worker_id: str, t_by_worker: dict[str, int]
) -> tuple[dict[str, Any], dict[str, Any]]:
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


def extreme_features(card: dict[str, Any]) -> dict[str, Any]:
    cumulative = card.get("cumulative") or {}
    histogram = cumulative.get("tool_histogram") or {}
    reread_paths = cumulative.get("reread_paths") or {}
    if isinstance(reread_paths, dict):
        reread_max = max((int(value) for value in reread_paths.values()), default=0)
    else:
        reread_max = max(
            (int(item.get("count", 0)) for item in reread_paths if isinstance(item, dict)),
            default=0,
        )
    compaction = int(cumulative.get("compaction_event_count", 0))
    no_mutation = not (histogram.get("Edit", 0) or histogram.get("Write", 0))
    return {
        "monitor_count": int(histogram.get("Monitor", 0)),
        "reread_max": reread_max,
        "compaction_event_count": compaction,
        "no_mutation": no_mutation,
        "thrash_screen_strict": no_mutation and reread_max >= 8 and compaction >= 8,
    }


def zero_call_gate(features: dict[str, dict[str, Any]]) -> dict[str, Any]:
    extreme = sorted(
        worker_id for worker_id, values in features.items() if values["thrash_screen_strict"]
    )
    overlap = sorted(worker_id for worker_id in extreme if worker_id in POLL_WORKERS)
    thrash_present = THRASH_WORKERS.issubset(extreme)
    return {
        "criterion": "zero_call_already_separates",
        "fired": thrash_present and not overlap,
        "thrash_workers_expected": sorted(THRASH_WORKERS),
        "poll_workers_in_wave": sorted(POLL_WORKERS),
        "extreme_workers": extreme,
        "poll_overlap": overlap,
        "rule": "no Edit/Write and reread_max >= 8 and compaction_event_count >= 8",
    }


def candidate_request(state: dict[str, Any], framing: dict[str, Any]) -> dict[str, Any]:
    request = {"model": MODEL_PIN, "state": state, "questions": framing["questions"]}
    if request["model"] != MODEL_PIN:
        raise ValueError("hard kill: request model is not jev-1.13.0")
    validate_systemone_request(request)
    return request


def scrape_choices(
    payload: dict[str, Any], questions: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Scrape actual choice labels; never assign a response class by rubric."""
    answers = payload.get("answers")
    if not isinstance(answers, dict):
        raise ValueError("TypeSafe response has no answers object")
    scraped: dict[str, dict[str, Any]] = {}
    for question_id, question in questions.items():
        if question.get("type") != "choice":
            continue
        answer = answers.get(question_id)
        if not isinstance(answer, dict) or "choice" not in answer:
            raise ValueError(f"missing choice answer for {question_id}")
        response_label = answer["choice"]
        response_class = answer.get("response_class", response_label)
        if response_class != response_label:
            raise ValueError(
                f"{question_id}: response_class {response_class!r} != "
                f"response_label {response_label!r}"
            )
        scraped[question_id] = {
            "response_class": response_class,
            "response_label": response_label,
        }
    return scraped


def post_systemone(request: dict[str, Any], api_key: str) -> dict[str, Any]:
    body = json.dumps(request, ensure_ascii=False).encode("utf-8")
    http_request = urllib.request.Request(
        API_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(http_request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def run(registry_path: Path, output_dir: Path) -> dict[str, Any]:
    registry = load_registry(registry_path)
    framings = [validate_framing(row) for row in registry["framings"]]
    expected_order = [
        "esv0-binary-foreshadow",
        "esv0-likert-collapse",
        "esv0-binary-monitor-present",
        "esv0-binary-counts-only",
    ]
    if [framing["registry_id"] for framing in framings] != expected_order:
        raise ValueError("frozen framing order changed")
    if len(framings) != 4:
        raise ValueError("expected exactly four frozen framings")

    t_by_worker = load_t_by_worker()
    worker_cards: dict[str, dict[str, Any]] = {}
    worker_states: dict[str, dict[str, Any]] = {}
    fixture_by_worker: dict[str, dict[str, Any]] = {}
    features: dict[str, dict[str, Any]] = {}
    for worker_id in WORKERS:
        card, state = build_worker_state(worker_id, t_by_worker)
        worker_cards[worker_id] = card
        worker_states[worker_id] = state
        fixture_by_worker[worker_id] = fixture_info(worker_id)
        features[worker_id] = extreme_features(card)

    cells: list[dict[str, Any]] = []
    request_rows: list[dict[str, Any]] = []
    response_rows: list[dict[str, Any]] = []
    result_rows: list[dict[str, Any]] = []
    framing_counts: dict[str, dict[str, Counter[str]]] = {
        framing["registry_id"]: defaultdict(Counter) for framing in framings
    }
    for worker_id in WORKERS:
        for framing in framings:
            registry_id = framing["registry_id"]
            cell_id = f"{APPROACH_ID}:{LIVE_FRAMING}:{worker_id}:{registry_id}"
            request = candidate_request(worker_states[worker_id], framing)
            request_hash = sha256_json(request)
            cell = {
                "cell_id": cell_id,
                "worker_id": worker_id,
                "stratum": STRATUM,
                "framing_id": framing["framing_id"],
                "registry_id": registry_id,
                "questions_sha256": framing["questions_sha256"],
                "schema_id": SCHEMA_ID,
                "model_pin": MODEL_PIN,
                "state_mode": "stats_card",
                "T": worker_cards[worker_id]["T"],
                "checkpoint_turn": worker_cards[worker_id]["checkpoint_turn"],
                "card_hash": worker_cards[worker_id]["card_hash"],
                "state_sha256": sha256_json(worker_states[worker_id]),
                "request_sha256": request_hash,
                "fixture": fixture_by_worker[worker_id],
                "preflight_pass": True,
                "status": "planned",
            }
            cells.append(cell)
            request_rows.append(
                {
                    "registration_id": REGISTRATION_ID,
                    "mode": "live",
                    "cell_id": cell_id,
                    "worker_id": worker_id,
                    "framing_id": framing["framing_id"],
                    "model": MODEL_PIN,
                    "cache_on": True,
                    "cache_key": cache_key(
                        endpoint=API_URL,
                        model=MODEL_PIN,
                        questions=framing["questions"],
                        state=worker_states[worker_id],
                        instruction=DEFAULT_INSTRUCTION,
                    ),
                    "request_sha256": request_hash,
                    "candidate_request": request,
                    "would_post": True,
                }
            )

    if len(cells) != MAX_POSTS:
        raise ValueError(f"expected {MAX_POSTS} cells, got {len(cells)}")
    gate = zero_call_gate(features)
    kill_reason: str | None = gate["criterion"] if gate["fired"] else None
    posts = 0
    api_errors: list[dict[str, Any]] = []

    for index, cell in enumerate(cells):
        framing = next(item for item in framings if item["registry_id"] == cell["registry_id"])
        request = request_rows[index]["candidate_request"]
        response: dict[str, Any] | None = None
        error: str | None = None
        scraped: dict[str, dict[str, Any]] = {}
        if kill_reason:
            cell["status"] = "not_run_kill_before_post"
            request_rows[index]["would_post"] = False
        else:
            key = os.environ.get("TYPESAFE_API_KEY", "").strip()
            if not key:
                raise RuntimeError("TYPESAFE_API_KEY is missing before live POST")
            if posts >= MAX_POSTS:
                raise RuntimeError("hard cap exceeded")
            started = time.time()
            try:
                response = post_systemone(request, key)
                scraped = scrape_choices(response, framing["questions"])
                posts += 1
                cell["status"] = "live"
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                error = f"HTTP {exc.code}: {detail[:500]}"
                api_errors.append({"cell_id": cell["cell_id"], "error": error})
                cell["status"] = "error"
            except Exception as exc:  # preserve the row and stop further burning
                error = f"{type(exc).__name__}: {exc}"
                api_errors.append({"cell_id": cell["cell_id"], "error": error})
                cell["status"] = "error"
            cell["wall_s"] = round(time.time() - started, 3)

        if scraped:
            for question_id, choice in scraped.items():
                framing_counts[cell["registry_id"]][question_id][str(choice["response_label"])] += 1
        result_rows.append(
            {
                "registration_id": REGISTRATION_ID,
                "cell_id": cell["cell_id"],
                "worker_id": cell["worker_id"],
                "stratum": STRATUM,
                "framing_id": cell["framing_id"],
                "registry_id": cell["registry_id"],
                "questions_sha256": cell["questions_sha256"],
                "schema_id": SCHEMA_ID,
                "model": MODEL_PIN,
                "state_mode": "stats_card",
                "status": cell["status"],
                "preflight_pass": True,
                "network_call": bool(response),
                "live_post": bool(response),
                "cache_on": True,
                "replay_post": False,
                "response_class": {
                    question_id: choice["response_class"] for question_id, choice in scraped.items()
                },
                "response_label": {
                    question_id: choice["response_label"] for question_id, choice in scraped.items()
                },
                "choice_scrape": scraped,
                "response_body": response,
                "error": error,
                "kill_reason": kill_reason,
            }
        )
        response_rows.append(
            {
                "registration_id": REGISTRATION_ID,
                "cell_id": cell["cell_id"],
                "response_body": response,
                "choice_scrape": scraped,
                "network_call": bool(response),
                "error": error,
                "suppressed_by_kill": bool(kill_reason),
            }
        )

        if not kill_reason and scraped:
            # Stop immediately if both prototypes and a poll worker co-flag.
            # The response label is read from the answer, never hardcoded.
            if cell["registry_id"] in {
                "esv0-binary-foreshadow",
                "esv0-binary-monitor-present",
            }:
                thrash_label = scraped.get("thrash_bundle", {}).get("response_label")
                if thrash_label == "yes" and cell["worker_id"] in POLL_WORKERS:
                    prior = [
                        row
                        for row in result_rows
                        if row["registry_id"] == cell["registry_id"]
                        and row["worker_id"] in THRASH_WORKERS
                        and row["response_label"].get("thrash_bundle") == "yes"
                    ]
                    if len(prior) == len(THRASH_WORKERS):
                        kill_reason = "thrash_poll_co_flagged"
                        break
        if api_errors:
            break

    for cell in cells:
        cell.setdefault("status", "not_reached_after_kill")

    framing_summary = []
    for framing in framings:
        registry_id = framing["registry_id"]
        rows = [row for row in result_rows if row["registry_id"] == registry_id]
        counts = {
            question_id: dict(values)
            for question_id, values in framing_counts[registry_id].items()
        }
        framing_summary.append(
            {
                "registry_id": registry_id,
                "framing_id": framing["framing_id"],
                "planned_cells": len([cell for cell in cells if cell["registry_id"] == registry_id]),
                "recorded_cells": len(rows),
                "live_posts": sum(row["live_post"] for row in rows),
                "not_run_cells": sum(not row["live_post"] for row in rows),
                "outcome_counts": counts,
                "pass": not any(row["error"] for row in rows),
            }
        )
    missing_fixtures = [
        worker_id for worker_id, info in fixture_by_worker.items() if not info["used_path"]
    ]

    output_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = output_dir / "raw"
    write_json(output_dir / "registry-copy" / "framings.json", registry)
    write_json(
        output_dir / "framing-lock.json",
        {
            "registry_source": str(registry_path),
            "registry_sha256": hashlib.sha256(registry_path.read_bytes()).hexdigest(),
            "schema_id": SCHEMA_ID,
            "model_pin": MODEL_PIN,
            "state_mode": "stats_card",
            "framings": framings,
            "likert_theme_collapse_rule": registry["likert_theme_collapse_rule"],
        },
    )
    write_jsonl(raw_dir / "stats_cards.jsonl", [worker_cards[worker_id] for worker_id in WORKERS])
    write_jsonl(raw_dir / "requests.jsonl", request_rows)
    write_jsonl(raw_dir / "responses.jsonl", response_rows)
    write_jsonl(output_dir / "results.jsonl", result_rows)

    manifest = {
        "manifest_version": 1,
        "registration_id": REGISTRATION_ID,
        "case_id": CASE_ID,
        "approach_id": APPROACH_ID,
        "mode": "live",
        "dry_only": False,
        "measurement_only": True,
        "behaviour_ship": False,
        "schema_id": SCHEMA_ID,
        "model_pin": MODEL_PIN,
        "state_mode": "stats_card",
        "stratum": STRATUM,
        "hold_out_n": HOLD_OUT_N,
        "hold_out_scored": False,
        "live_max": MAX_POSTS,
        "live_seats_run": posts,
        "posts": posts,
        "replay_posts": 0,
        "cache_on": True,
        "worker_order": list(WORKERS),
        "framing_ids": [framing["framing_id"] for framing in framings],
        "cell_count": len(cells),
        "cell_ids": [cell["cell_id"] for cell in cells],
        "missing_fixtures": missing_fixtures,
        "zero_call_gate": gate,
        "kill_fired": bool(kill_reason),
        "kill_reason": kill_reason,
        "api_errors": api_errors,
        "choice_scrape_contract": "response_class == response_label; derive both from returned choice",
        "framing_summary": framing_summary,
        "cells": cells,
    }
    write_json(output_dir / "cell-manifest.json", manifest)
    meters = {
        "registration_id": REGISTRATION_ID,
        "mode": "live",
        "model_pin": MODEL_PIN,
        "cells_planned": len(cells),
        "cells_recorded": len(result_rows),
        "preflight_passes": sum(cell["preflight_pass"] for cell in cells),
        "network_calls": posts,
        "jev_posts": posts,
        "replay_posts": 0,
        "flash_calls": 0,
        "live_seats_run": posts,
        "hold_out_scored": 0,
        "transcript_excerpts_in_state": 0,
        "missing_fixtures": len(missing_fixtures),
        "kill_fired": bool(kill_reason),
        "kill_reason": kill_reason,
        "api_errors": api_errors,
        "framing_summary": framing_summary,
    }
    write_json(output_dir / "meters.json", meters)
    write_json(
        output_dir / "zero-call-evidence.json",
        {"features": features, "gate": gate, "selected_workers": list(WORKERS)},
    )
    report = [
        "# stats-jev-tournament live v2",
        "",
        f"- Model: `{MODEL_PIN}`",
        f"- State: `{SCHEMA_ID}` `stats_card` only",
        f"- Stratum: `{STRATUM}`",
        f"- Cells: {len(cells)} planned (8 workers × 4 framings)",
        f"- TypeSafe POSTs: {posts}",
        f"- Replay POSTs: 0",
        f"- Hold-out scored: 0 of {HOLD_OUT_N}",
        f"- Kill fired: {'yes' if kill_reason else 'no'}",
        f"- Kill reason: `{kill_reason or 'none'}`",
        "",
        "The zero-call gate was evaluated before live POSTs. No behavior was shipped.",
        "",
        "## Per-framing outcome counts",
        "",
    ]
    for summary in framing_summary:
        report.append(f"- `{summary['framing_id']}` — {summary['outcome_counts'] or 'no responses'}")
    report.extend(
        [
            "",
            "## API errors",
            "",
            f"- `{api_errors or 'none'}`",
            "",
            "Choice scrape contract: `response_class == response_label`; no response class is hardcoded.",
        ]
    )
    (output_dir / "LIVE-REPORT.md").write_text("\n".join(report) + "\n", encoding="utf-8")
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
                "posts": manifest["posts"],
                "kill_fired": manifest["kill_fired"],
                "kill_reason": manifest["kill_reason"],
                "api_errors": manifest["api_errors"],
                "framing_summary": manifest["framing_summary"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
