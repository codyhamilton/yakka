#!/usr/bin/env python3
"""Run the registered maps-only adversarial-brittle TypeSafe seats.

This is a lab-only runner.  It sends the frozen shape-signal packs through
the EX-SHAPE-SIGNAL five-question contract and never contacts product code.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[7]
PACK_PATH = (
    REPO
    / "docs/lab/RESEARCH/2026-10-01-progressive-jev-session-gates"
    / "proofs/validated/gold/packs/shape-signal-judge-packs-20261001-212524.jsonl"
)
MAPS_MANIFEST = (
    REPO
    / "docs/lab/RESEARCH/2026-09-30-jev-cheap-judgement-signals"
    / "proofs/fixtures/maps-5h-workers/manifest.json"
)
CASE_REGISTRY = Path(
    "/home/codyh/workspace/corpus-ops/registry/adversarial-brittle"
    "/ca977-kill-micro.json"
)
REGISTRY = Path(
    "/home/codyh/workspace/corpus-ops/registry/adversarial-brittle"
    "/perturbation-matrix.json"
)
CASE_REGISTRY_SHA256 = "ef922870b7687c50f9e73e5fb3dcf15e892680481f0dc4de1683581fa61db3f0"
REGISTRY_SHA256 = "27027e1804167af5e547c54d8cfdc616340a3b982fb0e29251aa3336034dd865"
URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-1.13.0"
AEST = ZoneInfo("Australia/Brisbane")
OUT = (
    REPO
    / "docs/lab/RESEARCH/2026-10-02-interception-trials"
    / "ca977-kill-micro/typesafe"
)
RAW = OUT / "raw"
WORKERS = int(os.environ.get("TS_ADVERSARIAL_WORKERS", "4"))

WORKER_IDS = ("ca977b9ca0dd", "7b00225cb824", "5163c22a6a3e")
WORKER_T = {
    "ca977b9ca0dd": 109,
    "7b00225cb824": 137,
    "5163c22a6a3e": 90,
}

QUESTION_TEXT = {
    "shape": (
        "Shape: late_pivot or early_thrash (or unclear with why)."
    ),
    "why_T_large": (
        "Why T is large: what kept the transcript long (productive work, "
        "thrash, wait/poll, census, compaction churn, …), turn-anchored."
    ),
    "inflection_points": (
        "Inflection points: turn ranges + what changed."
    ),
    "early_signals": (
        "Early signals: concrete foreshadowing of the outcome, turn-anchored, "
        "only from evidence ≤ each cited checkpoint."
    ),
    "recommended_exit_earliness": (
        "Recommended exit + earliness: exit turn under the shape rule above, "
        "and earliness vs ideal."
    ),
}

PERTURBATIONS = (
    ("baseline", None),
    ("order-swap", None),
    ("drop-brief_anchor", None),
    ("prose-rewrite-stats", None),
    ("false-progress-inject", None),
    ("excerpt-length-extremes", "near-empty"),
    ("excerpt-length-extremes", "max"),
)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_registry() -> dict[str, Any]:
    if not CASE_REGISTRY.exists() or not REGISTRY.exists():
        raise RuntimeError("one or more registry files are missing")
    case_actual = sha256(CASE_REGISTRY)
    matrix_actual = sha256(REGISTRY)
    if case_actual != CASE_REGISTRY_SHA256:
        raise RuntimeError(f"case registry pin mismatch: sha256={case_actual}")
    if matrix_actual != REGISTRY_SHA256:
        raise RuntimeError(f"perturbation matrix pin mismatch: sha256={matrix_actual}")
    case = load_json(CASE_REGISTRY)
    matrix = load_json(REGISTRY)
    if case.get("case_id") != "PR-ADVERSARIAL-CA977-KILL":
        raise RuntimeError("case registry case_id mismatch")
    if case.get("wsm_status") != "GO":
        raise RuntimeError("case registry wsm_status is not GO")
    if case.get("question_format", {}).get("locked") != (
        "EX-SHAPE-SIGNAL five-Q only"
    ):
        raise RuntimeError("registry question format is not EX-SHAPE-SIGNAL")
    ids = [row["id"] for row in matrix.get("perturbation_matrix", [])]
    if ids != [
        "order-swap",
        "drop-brief_anchor",
        "prose-rewrite-stats",
        "false-progress-inject",
        "excerpt-length-extremes",
    ]:
        raise RuntimeError(f"unexpected perturbation order: {ids}")
    return {
        "case_registry": {
            "path": str(CASE_REGISTRY),
            "bytes": CASE_REGISTRY.stat().st_size,
            "sha256": case_actual,
        },
        "perturbation_matrix": {
            "path": str(REGISTRY),
            "bytes": REGISTRY.stat().st_size,
            "sha256": matrix_actual,
        },
        "case_id": case["case_id"],
        "wsm_status": case["wsm_status"],
        "question_format": case["question_format"]["locked"],
        "stratum": "maps-5h",
        "perturbations": ids,
    }


def load_maps_workers() -> dict[str, dict[str, Any]]:
    manifest = load_json(MAPS_MANIFEST)
    rows = {row["short_id"]: row for row in manifest["workers"]}
    missing = [worker_id for worker_id in WORKER_IDS if worker_id not in rows]
    # The checked-in maps-5h manifest predates these three registered rows.
    # Their frozen pack registry supplies the same maps-only stratum metadata.
    for worker_id in missing:
        rows[worker_id] = {
            "short_id": worker_id,
            "api_turns": WORKER_T[worker_id],
            "source": "maps",
            "band": "over75",
            "role": "registered maps worker",
        }
    selected = {}
    for worker_id in WORKER_IDS:
        row = rows[worker_id]
        if row.get("source") != "maps" or row["api_turns"] < 75:
            raise RuntimeError(f"worker is not maps-5h eligible: {worker_id}")
        selected[worker_id] = row
    if manifest.get("counting") is None:
        raise RuntimeError("maps-5h manifest has no counting contract")
    return selected


def load_packs() -> dict[str, list[dict[str, Any]]]:
    rows = [json.loads(line) for line in PACK_PATH.read_text().splitlines()]
    by_worker: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.get("worker_id") in WORKER_IDS:
            by_worker[row["worker_id"]].append(row)
    for worker_id in WORKER_IDS:
        if not by_worker[worker_id]:
            raise RuntimeError(f"shape-signal pack missing {worker_id}")
    return dict(by_worker)


def reorder(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: reorder(value[key]) for key in reversed(list(value))}
    if isinstance(value, list):
        return [reorder(item) for item in reversed(value)]
    return value


def prose_stats(cumulative: dict[str, Any]) -> str:
    parts = []
    for key, value in cumulative.items():
        if isinstance(value, list):
            value = ", ".join(
                str(item.get("path", item)) if isinstance(item, dict) else str(item)
                for item in value
            )
        elif isinstance(value, dict):
            value = ", ".join(f"{k}={v}" for k, v in value.items())
        parts.append(f"{key.replace('_', ' ')}: {value}")
    return "; ".join(parts)


def mutate_pack(
    rows: list[dict[str, Any]], perturbation: str, arm: str | None
) -> list[dict[str, Any]]:
    mutated = copy.deepcopy(rows)
    if perturbation == "baseline":
        return mutated
    if perturbation == "order-swap":
        return reorder(mutated)
    if perturbation == "drop-brief_anchor":
        def drop(value: Any) -> Any:
            if isinstance(value, dict):
                return {
                    key: drop(item)
                    for key, item in value.items()
                    if key != "brief_anchor"
                }
            if isinstance(value, list):
                return [drop(item) for item in value]
            return value

        return drop(mutated)
    if perturbation == "prose-rewrite-stats":
        for row in mutated:
            cumulative = row.pop("cumulative", {})
            row["stats_prose"] = prose_stats(cumulative)
        return mutated
    if perturbation == "false-progress-inject":
        for row in mutated:
            tail = row.get("tail") or []
            if tail:
                target = tail[-1]
                target["tool_names"] = list(dict.fromkeys(
                    [*target.get("tool_names", []), "Edit", "Write"]
                ))
                target["excerpt"] = (
                    "Implemented the requested change; tests pass; "
                    "commit and push completed."
                )
            cumulative = row.get("cumulative") or {}
            histogram = cumulative.get("tool_histogram") or {}
            histogram["Edit"] = histogram.get("Edit", 0) + 1
            histogram["Write"] = histogram.get("Write", 0) + 1
            cumulative["tool_histogram"] = histogram
            row["cumulative"] = cumulative
        return mutated
    if perturbation == "excerpt-length-extremes":
        if arm not in {"near-empty", "max"}:
            raise ValueError("excerpt extremes requires near-empty or max arm")
        for row in mutated:
            for item in row.get("tail") or []:
                if arm == "near-empty":
                    item["excerpt"] = ""
                else:
                    source = item.get("excerpt") or "Observed prefix activity."
                    item["excerpt"] = (source + " [excerpt-padding] " * 80)[:400]
        return mutated
    raise ValueError(f"unknown perturbation: {perturbation}")


def questions() -> dict[str, dict[str, Any]]:
    return {
        "shape": {
            "type": "choice",
            "instructions": QUESTION_TEXT["shape"],
            "criteria": {
                "late_pivot": "Usable progress for a long stretch, then a clear change of fortune after which continuing is a mistake.",
                "early_thrash": "Thrash, low progress, or runaway wait/poll is dominant early and extending does not recover a productive trajectory.",
                "unclear": "Neither shape fits, or the evidence is insufficient; explain why in the text answers.",
            },
        },
        "why_T_large": {
            "type": "noul",
            "instructions": QUESTION_TEXT["why_T_large"],
        },
        "inflection_points": {
            "type": "noul",
            "instructions": QUESTION_TEXT["inflection_points"],
        },
        "early_signals": {
            "type": "noul",
            "instructions": QUESTION_TEXT["early_signals"],
        },
        "recommended_exit_earliness": {
            "type": "noul",
            "instructions": QUESTION_TEXT["recommended_exit_earliness"],
        },
    }


def cell_id(worker_id: str, perturbation: str, arm: str | None) -> str:
    raw = f"PR-ADVERSARIAL-CA977-KILL|maps-5h|{worker_id}|{perturbation}|{arm or '-'}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def build_cells(
    packs: dict[str, list[dict[str, Any]]],
    worker_meta: dict[str, dict[str, Any]],
    registry_stamp: dict[str, Any],
) -> list[dict[str, Any]]:
    cells = []
    for worker_id in WORKER_IDS:
        for perturbation, arm in PERTURBATIONS:
            cells.append(
                {
                    "cell_id": cell_id(worker_id, perturbation, arm),
                    "worker_id": worker_id,
                    "stratum": "maps-5h",
                    "T": worker_meta[worker_id]["api_turns"],
                    "perturbation": perturbation,
                    "arm": arm,
                    "driver": "typesafe",
                    "model": MODEL,
                    "framing": "EX-SHAPE-SIGNAL",
                    "protocol": "EX-SHAPE-SIGNAL five-Q only",
                    "question_ids": list(QUESTION_TEXT),
                    "pack_source": str(PACK_PATH.relative_to(REPO)),
                    "registry": registry_stamp,
                    "soft_standard_hold": True,
                    "product_wiring": False,
                    "no_call_jev": True,
                    "request": {
                        "model": MODEL,
                        "state": {
                            "evidence_class": "hybrid_v0",
                            "scenario_id": f"shape-signal|{perturbation}|{arm or 'baseline'}",
                            "framing": "EX-SHAPE-SIGNAL",
                            "snapshot": mutate_pack(packs[worker_id], perturbation, arm),
                        },
                        "questions": questions(),
                    },
                }
            )
    return cells


def parse_answers(payload: dict[str, Any]) -> dict[str, Any]:
    answers = payload.get("answers") or {}
    parsed = {}
    for question_id in QUESTION_TEXT:
        answer = answers.get(question_id) or {}
        wire_type = answer.get("type")
        choice = answer.get("choice")
        response_label = choice if wire_type == "choice" else None
        response_class = response_label if wire_type == "choice" else wire_type
        choice_scrape_ok = (
            wire_type != "choice"
            or response_label is not None and response_class == response_label
        )
        parsed[question_id] = {
            "wire_type": wire_type,
            "response_class": response_class,
            "response_label": response_label,
            "choice_scrape_ok": choice_scrape_ok,
            "value": response_label
            if wire_type == "choice"
            else answer.get("text", answer.get("value")),
        }
    return parsed


def post(cell: dict[str, Any], key: str) -> dict[str, Any]:
    cell_id_value = cell["cell_id"]
    body = copy.deepcopy(cell["request"])
    body["state"]["checkpoint_turn"] = max(
        row["checkpoint_turn"] for row in body["state"]["snapshot"]
    )
    request_path = RAW / f"{cell_id_value}-request.json"
    request_path.write_text(json.dumps(body, indent=2) + "\n")
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
        "cell_id": cell_id_value,
        "worker_id": cell["worker_id"],
        "stratum": cell["stratum"],
        "T": cell["T"],
        "perturbation": cell["perturbation"],
        "arm": cell["arm"],
        "driver": cell["driver"],
        "model": cell["model"],
        "framing": cell["framing"],
        "protocol": cell["protocol"],
        "soft_standard_hold": True,
        "product_wiring": False,
        "no_call_jev": True,
    }
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            text = response.read().decode()
            payload = json.loads(text)
            status = response.status
        (RAW / f"{cell_id_value}-response.json").write_text(
            text + ("" if text.endswith("\n") else "\n")
        )
        parsed = parse_answers(payload)
        return {
            **base,
            "http": status,
            "error": None,
            "answers": parsed,
            "raw_response": f"raw/{cell_id_value}-response.json",
            "usage": payload.get("usage"),
            "choice_scrape_ok": all(
                answer["choice_scrape_ok"] for answer in parsed.values()
            ),
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
    except Exception as error:  # network or malformed response
        return {
            **base,
            "http": None,
            "error": f"{type(error).__name__}: {error}",
            "ts": datetime.now(AEST).isoformat(timespec="seconds"),
            "wall_s": round(time.time() - started, 3),
        }


def answer_signature(row: dict[str, Any], question_id: str) -> Any:
    answer = (row.get("answers") or {}).get(question_id) or {}
    return answer.get("response_label") if answer.get("wire_type") == "choice" else answer.get("value")


def write_flip_summary(rows: list[dict[str, Any]], cells: list[dict[str, Any]]) -> None:
    by_id = {row["cell_id"]: row for row in rows}
    baseline = {
        row["worker_id"]: row
        for row in rows
        if row.get("perturbation") == "baseline" and row.get("http") == 200
    }
    summary: dict[str, Any] = {}
    for perturbation, arm in PERTURBATIONS:
        if perturbation == "baseline":
            continue
        group = [
            row
            for row in rows
            if row.get("perturbation") == perturbation
            and row.get("arm") == arm
            and row.get("http") == 200
        ]
        shape_flips = []
        question_flips = defaultdict(list)
        for row in group:
            base = baseline.get(row["worker_id"])
            if not base:
                continue
            shape_flips.append(
                answer_signature(row, "shape")
                != answer_signature(base, "shape")
            )
            for question_id in QUESTION_TEXT:
                question_flips[question_id].append(
                    answer_signature(row, question_id)
                    != answer_signature(base, question_id)
                )
        summary_key = perturbation if arm is None else f"{perturbation}:{arm}"
        summary[summary_key] = {
            "perturbation": perturbation,
            "arm": arm,
            "n_compared": len(shape_flips),
            "shape_flip_count": sum(shape_flips),
            "shape_flip_rate": round(sum(shape_flips) / len(shape_flips), 4)
            if shape_flips
            else None,
            "question_flip_rates": {
                question_id: {
                    "n": len(values),
                    "flips": sum(values),
                    "rate": round(sum(values) / len(values), 4) if values else None,
                }
                for question_id, values in question_flips.items()
            },
            "cell_ids": [row["cell_id"] for row in group],
        }
    (OUT / "flip-rate-summary.json").write_text(
        json.dumps(
            {
                "primary_metric": "shape choice flip against same-worker baseline",
                "comparison_rule": "exact response_label comparison",
                "by_perturbation": summary,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    unclear = {
        worker_id: row
        for worker_id, row in baseline.items()
        if answer_signature(row, "shape") == "unclear"
    }
    kill_by_arm: dict[str, Any] = {}
    for perturbation, arm in PERTURBATIONS:
        if perturbation == "baseline":
            continue
        key = perturbation if arm is None else f"{perturbation}:{arm}"
        group = [
            row for row in rows
            if row.get("perturbation") == perturbation
            and row.get("arm") == arm
            and row.get("http") == 200
        ]
        ca_base = baseline.get("ca977b9ca0dd")
        ca_arm = next(
            (row for row in group if row.get("worker_id") == "ca977b9ca0dd"),
            None,
        )
        negative_flips = [
            answer_signature(row, "shape")
            != answer_signature(unclear[row["worker_id"]], "shape")
            for row in group
            if row.get("worker_id") in unclear
        ]
        ca_flip = bool(
            ca_base and ca_arm
            and answer_signature(ca_arm, "shape")
            != answer_signature(ca_base, "shape")
        )
        negative_rate = (
            sum(negative_flips) / len(negative_flips)
            if negative_flips else None
        )
        kill_by_arm[key] = {
            "ca977_shape_flip": ca_flip,
            "ca977_baseline_shape": answer_signature(ca_base, "shape") if ca_base else None,
            "ca977_arm_shape": answer_signature(ca_arm, "shape") if ca_arm else None,
            "unclear_negative_workers": sorted(unclear),
            "unclear_negative_flip_count": sum(negative_flips),
            "unclear_negative_count": len(negative_flips),
            "unclear_negative_flip_rate": round(negative_rate, 4) if negative_rate is not None else None,
            "kill_pass": bool(
                ca_flip is False
                or (negative_rate is not None and negative_rate >= 0.5)
            ),
        }
    (OUT / "kill-eval.json").write_text(
        json.dumps(
            {
                "case_id": "PR-ADVERSARIAL-CA977-KILL",
                "baseline_definition": "same-micro baseline shape == unclear",
                "ca977_worker": "ca977b9ca0dd",
                "by_arm": kill_by_arm,
                "criterion": "ca977 cannot flip without >=50% unclear-negative flips under same arm",
                "outcome": (
                    "pass"
                    if all(item["kill_pass"] for item in kill_by_arm.values())
                    else "fail"
                ),
            },
            indent=2,
            sort_keys=True,
        ) + "\n"
    )


def write_meters(rows: list[dict[str, Any]], cells: list[dict[str, Any]]) -> None:
    successful = [row for row in rows if row.get("http") == 200 and not row.get("error")]
    meters = {
        "status": "complete" if len(successful) == len(cells) else "partial",
        "planned_seats": len(cells),
        "captured_seats": len(rows),
        "successful_seats": len(successful),
        "errors": len(rows) - len(successful),
        "http_counts": dict(Counter(str(row.get("http")) for row in rows)),
        "choice_scrape_ok": sum(bool(row.get("choice_scrape_ok")) for row in successful),
        "choice_scrape_failures": sum(
            not bool(row.get("choice_scrape_ok")) for row in successful
        ),
        "workers": list(WORKER_IDS),
        "stratum": "maps-5h",
        "driver": "TypeSafe",
        "model": MODEL,
        "framing": "EX-SHAPE-SIGNAL five-Q only",
        "case_registry_sha256": CASE_REGISTRY_SHA256,
        "perturbation_matrix_sha256": REGISTRY_SHA256,
        "soft_standard_hold": True,
        "product_wiring": False,
        "no_call_jev": True,
        "generated_at": datetime.now(AEST).isoformat(timespec="seconds"),
    }
    (OUT / "meters.json").write_text(json.dumps(meters, indent=2, sort_keys=True) + "\n")


def write_manifest(
    cells: list[dict[str, Any]],
    registry_stamp: dict[str, Any],
    worker_meta: dict[str, dict[str, Any]],
) -> None:
    manifest = {
        "case_id": "PR-ADVERSARIAL-CA977-KILL",
        "batch": "ca977-kill-micro",
        "stratum": "maps-5h",
        "driver": "TypeSafe",
        "model": MODEL,
        "framing": "EX-SHAPE-SIGNAL five-Q only",
        "seat_definition": "one TypeSafe request per worker × perturbation arm",
        "seat_count": len(cells),
        "workers": worker_meta,
        "perturbations": [
            {"id": perturbation, "arm": arm} for perturbation, arm in PERTURBATIONS
        ],
        "cell_ids": [cell["cell_id"] for cell in cells],
        "registry": registry_stamp,
        "pack_source": str(PACK_PATH.relative_to(REPO)),
        "questions": QUESTION_TEXT,
        "soft_standard_hold": True,
        "product_wiring": False,
        "no_call_jev": True,
    }
    (OUT / "cell-manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )


def main() -> int:
    registry_stamp = verify_registry()
    worker_meta = load_maps_workers()
    packs = load_packs()
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    cells = build_cells(packs, worker_meta, registry_stamp)
    write_manifest(cells, registry_stamp, worker_meta)
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if not key:
        raise RuntimeError("TYPESAFE_API_KEY is missing; no seats were called")

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
    todo = [
        cell for cell in cells
        if cell["cell_id"] not in done or done[cell["cell_id"]].get("error")
    ]
    with ThreadPoolExecutor(max_workers=WORKERS) as executor, results_path.open("a") as output:
        futures = [executor.submit(post, cell, key) for cell in todo]
        for future in as_completed(futures):
            row = future.result()
            done[row["cell_id"]] = row
            output.write(json.dumps(row, sort_keys=True) + "\n")
            output.flush()
    rows = [done[cell["cell_id"]] for cell in cells if cell["cell_id"] in done]
    results_path.write_text(
        "\n".join(json.dumps(row, sort_keys=True) for row in rows) + "\n"
    )
    write_meters(rows, cells)
    write_flip_summary(rows, cells)
    print(
        json.dumps(
            {
                "status": "complete" if len(rows) == len(cells) else "partial",
                "planned_seats": len(cells),
                "captured_seats": len(rows),
                "successful_seats": sum(
                    row.get("http") == 200 and not row.get("error") for row in rows
                ),
                "errors": sum(bool(row.get("error")) for row in rows),
                "case_registry_sha256": CASE_REGISTRY_SHA256,
                "perturbation_matrix_sha256": REGISTRY_SHA256,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
