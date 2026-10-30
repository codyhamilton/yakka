#!/usr/bin/env python3
"""Run the Maps-only H3/H4 TypeSafe competing approaches.

This is offline evidence collection only.  It sends one prefix-only System
One request per cell and never touches hooks, assert hooks, or the live Jev
path.  H3 and H4 use the exact H1 state projection and checkpoint grid; only
the approach question and response classes differ.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
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
PROOFS = REPO / "docs/lab/RESEARCH/2026-10-01-progressive-jev-session-gates/proofs"
sys.path.insert(0, str(PROOFS))

from snapshot_state import prepare_hybrid_state, state_json_len  # noqa: E402
from turn_index import file_sha256, index_transcript  # noqa: E402


API_URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-1.13.0"
STRATUM = "maps-5h"
CHECKPOINTS = (75, 90)
RECHECK_INTERVAL = 15
SESSION_IDS = ("92a48e004519", "bb6165018de0", "0aab88c525de", "036ff3ed4a89")
STATE_LIMIT = 12_000


@dataclass(frozen=True)
class Approach:
    approach_id: str
    directory: str
    response_labels: tuple[str, ...]
    question: str
    criteria: dict[str, str]


APPROACHES = (
    Approach(
        approach_id="H3-progress-velocity",
        directory="H3-progress-velocity",
        response_labels=(
            "fire_now",
            "defer_recovery",
            "defer_progress",
            "defer_activity_not_value",
            "defer_insufficient",
        ),
        question=(
            "Assess progress velocity against the requested outcome, not activity "
            "alone. Choose fire_now only when useful progress has remained low "
            "despite continued activity and the evidence supports a sustained "
            "plateau after allowing for temporary recovery. Otherwise choose the "
            "most specific defer label."
        ),
        criteria={
            "fire_now": (
                "Fire now: sustained low-yield continuation or thrashing is more "
                "likely than useful recovery."
            ),
            "defer_recovery": (
                "Defer: a temporary stall may recover and the evidence is not yet "
                "a sustained plateau."
            ),
            "defer_progress": (
                "Defer: checkable substantive progress remains, even if activity "
                "is uneven."
            ),
            "defer_activity_not_value": (
                "Defer: activity alone does not establish a plateau or justify "
                "firing."
            ),
            "defer_insufficient": (
                "Defer: the prefix does not provide enough evidence to identify "
                "progress velocity."
            ),
        },
    ),
    Approach(
        approach_id="H4-deliverable-boundary",
        directory="H4-deliverable-boundary",
        response_labels=(
            "fire_now",
            "defer_preboundary",
            "defer_closing",
            "defer_invalidated_boundary",
            "defer_insufficient",
        ),
        question=(
            "Assess the requested deliverable boundary from the prefix only. "
            "Choose fire_now only when required work, relevant validation, and "
            "delivery appear complete and continuation has no demonstrated value. "
            "Protect necessary closing work and treat an apparent boundary as "
            "invalid when a consequential defect or unmet requirement remains. "
            "Otherwise choose the most specific defer label."
        ),
        criteria={
            "fire_now": (
                "Fire now: the defensible deliverable boundary is reached and "
                "continuation is unjustified overrun."
            ),
            "defer_preboundary": (
                "Defer: required content, functionality, validation, or delivery "
                "is not yet complete."
            ),
            "defer_closing": (
                "Defer: necessary final fixes, validation, or delivery work still "
                "has demonstrated value."
            ),
            "defer_invalidated_boundary": (
                "Defer: an apparent completion boundary is invalidated by a "
                "consequential defect or unmet requirement."
            ),
            "defer_insufficient": (
                "Defer: the prefix does not establish a defensible boundary."
            ),
        },
    ),
)


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def stable_cell_id(approach: Approach, session_id: str, checkpoint: int) -> str:
    raw = (
        f"{approach.approach_id}|{MODEL}|{STRATUM}|{session_id}|{checkpoint}|"
        "trial-prefix-v1|approach-specific"
    )
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def prior_projection(state: dict[str, Any]) -> dict[str, Any]:
    """Keep a bounded prior card; all values originate at the prior prefix."""
    return {
        "checkpoint_turn": state.get("checkpoint_turn"),
        "evidence_class": "prior_prefix_projection",
        "cumulative": copy.deepcopy(state.get("cumulative") or {}),
        "tail": copy.deepcopy((state.get("tail") or [])[-4:]),
    }


def build_cells(approach: Approach) -> list[dict[str, Any]]:
    cells: list[dict[str, Any]] = []
    for session_id in SESSION_IDS:
        path = FIXTURES / f"{session_id}.jsonl"
        if not path.is_file():
            raise SystemExit(f"missing fixture: {path}")
        indexed = index_transcript(path, worker_id=session_id)
        if indexed.T < 90:
            raise SystemExit(f"{session_id} has only {indexed.T} turns; cannot run 90")

        states: dict[int, dict[str, Any]] = {}
        prior: int | None = None
        for checkpoint in CHECKPOINTS:
            state, shrink_steps = prepare_hybrid_state(
                indexed,
                checkpoint,
                first_at=75,
                interval=RECHECK_INTERVAL,
                prior=prior,
            )
            if state is None:
                raise SystemExit(f"state unavailable for {session_id}@{checkpoint}")
            state["evidence_class"] = "trial-prefix-v1"
            if checkpoint == 90:
                # The paired prior is a projection of prefix(75), never the
                # final transcript or any post-90 event.
                state["prior_prefix_projection"] = prior_projection(states[75])
                state["elapsed_turns_since_prior"] = RECHECK_INTERVAL
            state_size = state_json_len(state)
            if state_size > STATE_LIMIT:
                raise SystemExit(
                    f"state over budget for {session_id}@{checkpoint}: {state_size}"
                )
            states[checkpoint] = state
            cells.append(
                {
                    "cell_id": stable_cell_id(approach, session_id, checkpoint),
                    "session_id": session_id,
                    "checkpoint": checkpoint,
                    "prior_checkpoint": prior,
                    "stratum": STRATUM,
                    "approach_id": approach.approach_id,
                    "model": MODEL,
                    "fixture": str(path.relative_to(REPO)),
                    "fixture_sha256": file_sha256(path),
                    # Eligibility metadata only; this is never sent in state.
                    "source_turns_for_eligibility_only": indexed.T,
                    "state": state,
                    "state_chars": state_size,
                    "shrink_steps": shrink_steps,
                    "response_class": approach.approach_id,
                    "question": approach.question,
                }
            )
            prior = checkpoint
    return cells


def questions(approach: Approach, cell: dict[str, Any]) -> dict[str, Any]:
    return {
        "response": {
            "type": "choice",
            "instructions": cell["question"] + " Choose exactly one response label.",
            "criteria": approach.criteria,
        },
        "rating": {
            "type": "score",
            "instructions": (
                "Rate intervention urgency from 0 to 3 using only the supplied "
                "prefix. 0 means clearly defer, 1 mild concern, 2 steer soon, "
                "3 fire now."
            ),
            "criteria": [
                "0: clearly productive, closing, pre-boundary, or insufficient; defer",
                "1: mild concern; defer and retain recovery or boundary evidence",
                "2: meaningful concern; steer soon",
                "3: likely justified fire under this approach",
            ],
        },
    }


def post_cell(approach: Approach, out: Path, cell: dict[str, Any]) -> dict[str, Any]:
    cell_id = cell["cell_id"]
    request = {
        "model": MODEL,
        "state": cell["state"],
        "questions": questions(approach, cell),
    }
    raw = out / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    request_path = raw / f"{cell_id}-request.json"
    request_path.write_text(json.dumps(request, indent=2, ensure_ascii=False) + "\n")
    started = timestamp()
    started_clock = time.monotonic()
    result: dict[str, Any] = {
        "cell_id": cell_id,
        "session_id": cell["session_id"],
        "checkpoint": cell["checkpoint"],
        "prior_checkpoint": cell["prior_checkpoint"],
        "stratum": STRATUM,
        "approach_id": approach.approach_id,
        "model": MODEL,
        "response_class": cell["response_class"],
        "request_started_at": started,
        "request_path": str(request_path.relative_to(out)),
        "state_prefix_only": True,
        "state_chars": cell["state_chars"],
        "http_status": None,
        "decision": None,
        "fire": None,
        "rating": None,
        "raw_rating_score": None,
        "raw_answers": None,
        "error": None,
        "window_status": "unidentified",
        "reference_fire": None,
        "outcome_tag": None,
    }
    try:
        key = os.environ["TYPESAFE_API_KEY"].strip()
        body = json.dumps(request, ensure_ascii=False).encode()
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
        choice = (answers.get("response") or {}).get("choice")
        score_answer = answers.get("rating") or {}
        score = score_answer.get("score")
        result["raw_rating_score"] = score
        probabilities = score_answer.get("probabilities") or {}
        if probabilities:
            result["rating"] = int(
                max(probabilities.items(), key=lambda item: float(item[1]))[0]
            )
        elif isinstance(score, (int, float)):
            result["rating"] = int(
                round(float(score) * 3 if float(score) <= 1.5 else float(score))
            )
            result["rating"] = max(0, min(3, result["rating"]))
        if choice in approach.response_labels:
            result["decision"] = "fire" if choice == "fire_now" else "defer"
            result["fire"] = choice == "fire_now"
            result["response_label"] = choice
            result["response_class"] = choice
        else:
            result["error"] = f"unexpected response choice: {choice!r}"
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        error_path = raw / f"{cell_id}-error.txt"
        error_path.write_text(f"HTTP {exc.code}\n{detail}\n")
        result["http_status"] = exc.code
        result["error"] = f"HTTP {exc.code}: {detail[:800]}"
        result["error_path"] = str(error_path.relative_to(out))
    except Exception as exc:  # pragma: no cover - exercised by network failures
        error_path = raw / f"{cell_id}-error.txt"
        error_path.write_text(f"{type(exc).__name__}: {exc}\n")
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["error_path"] = str(error_path.relative_to(out))
    result["response_received_at"] = timestamp()
    result["elapsed_ms"] = round((time.monotonic() - started_clock) * 1000)
    return result


def null_baselines(cells: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute H2 nulls from the fixed grid, without a model call."""
    by_checkpoint: dict[str, int] = {}
    for cell in cells:
        key = str(cell["checkpoint"])
        by_checkpoint[key] = by_checkpoint.get(key, 0) + 1

    def rows(fire_at_or_after: int | None) -> dict[str, Any]:
        result: dict[str, Any] = {}
        total_fire = 0
        for checkpoint in sorted(by_checkpoint, key=int):
            n = by_checkpoint[checkpoint]
            fire = n if fire_at_or_after is None else (
                n if int(checkpoint) >= fire_at_or_after else 0
            )
            total_fire += fire
            result[checkpoint] = {"n": n, "fire": fire, "defer": n - fire}
        return {
            "fire_count": total_fire,
            "defer_count": len(cells) - total_fire,
            "by_checkpoint": result,
        }

    return {
        "never_fire": {
            "definition": "Never fire at any checkpoint; no model needed.",
            **rows(10**9),
        },
        "constant_turn_75": {
            "definition": "Fire at every checkpoint at or after turn 75; no model needed.",
            **rows(75),
        },
        "constant_turn_90": {
            "definition": "Fire at every checkpoint at or after turn 90; no model needed.",
            **rows(90),
        },
    }


def write_outputs(approach: Approach, out: Path, cells: list[dict[str, Any]]) -> None:
    results_path = out / "results.jsonl"
    results = [
        json.loads(line)
        for line in results_path.read_text().splitlines()
        if line.strip()
    ]
    results_by_id = {row["cell_id"]: row for row in results}
    ordered = [results_by_id[cell["cell_id"]] for cell in cells]
    results_path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in ordered)
    )
    errors = [row for row in ordered if row.get("error")]
    fires = [row for row in ordered if row.get("fire") is True]
    manifest = {
        "generated_at": timestamp(),
        "stratum": STRATUM,
        "approach_id": approach.approach_id,
        "model": MODEL,
        "driver": "TypeSafe System One",
        "api_url": API_URL,
        "soft_standard_hold": True,
        "product_wiring": False,
        "hooks_unlock": False,
        "state_contract": {
            "matches": "H1-defer-recheck TypeSafe grid/state projection",
            "prefix_only": True,
            "first_checkpoint": 75,
            "recheck_checkpoint": 90,
            "interval_turns": 15,
            "outcome_labels": "not supplied to judge",
            "final_length": "eligibility metadata only; never sent in state",
        },
        "n_cells": len(cells),
        "cell_ids": [cell["cell_id"] for cell in cells],
        "cells": [
            {
                "cell_id": cell["cell_id"],
                "session_id": cell["session_id"],
                "checkpoint": cell["checkpoint"],
                "prior_checkpoint": cell["prior_checkpoint"],
                "stratum": STRATUM,
                "approach_id": approach.approach_id,
                "model": MODEL,
                "fixture": cell["fixture"],
                "fixture_sha256": cell["fixture_sha256"],
                "state_chars": cell["state_chars"],
                "shrink_steps": cell["shrink_steps"],
                "decision": results_by_id[cell["cell_id"]].get("decision"),
                "fire": results_by_id[cell["cell_id"]].get("fire"),
                "rating": results_by_id[cell["cell_id"]].get("rating"),
                "response_label": results_by_id[cell["cell_id"]].get("response_label"),
                "request_started_at": results_by_id[cell["cell_id"]].get(
                    "request_started_at"
                ),
                "response_received_at": results_by_id[cell["cell_id"]].get(
                    "response_received_at"
                ),
                "raw_request": results_by_id[cell["cell_id"]].get("request_path"),
                "raw_response": results_by_id[cell["cell_id"]].get("response_path"),
                "error": results_by_id[cell["cell_id"]].get("error"),
            }
            for cell in cells
        ],
    }
    (out / "cell-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    by_checkpoint: dict[str, dict[str, int]] = {}
    for row in ordered:
        bucket = by_checkpoint.setdefault(
            str(row["checkpoint"]), {"n": 0, "fire": 0, "defer": 0}
        )
        bucket["n"] += 1
        if row.get("fire") is True:
            bucket["fire"] += 1
        elif row.get("fire") is False:
            bucket["defer"] += 1
    meters = {
        "generated_at": timestamp(),
        "stratum": STRATUM,
        "approach_id": approach.approach_id,
        "model": MODEL,
        "driver": "TypeSafe System One",
        "n_cells": len(cells),
        "n_sessions": len(SESSION_IDS),
        "checkpoints": list(CHECKPOINTS),
        "recheck_interval_turns": RECHECK_INTERVAL,
        "http_successes": sum(row.get("http_status") == 200 for row in ordered),
        "errors": len(errors),
        "parse_miss_cells": sum(
            (row.get("error") or "").startswith("unexpected response choice")
            for row in ordered
        ),
        "fire_count": len(fires),
        "defer_count": sum(row.get("fire") is False for row in ordered),
        "fire_by_checkpoint": by_checkpoint,
        "fire_cell_ids": [row["cell_id"] for row in fires],
        "response_label_counts": {
            label: sum(row.get("response_label") == label for row in ordered)
            for label in approach.response_labels
        },
        "h2_null_baselines": null_baselines(cells),
        "ideal_steer_status": "unidentified",
        "near_done_fp": "unknown",
        "runaway_miss": "unknown",
        "scoreboard_note": (
            "No evidence-based outcome-label sidecar; final length was not sent "
            "to the judge. H2 nulls are deterministic grid baselines only."
        ),
        "soft_standard_hold": True,
        "product_wiring": False,
        "hooks_unlock": False,
    }
    (out / "meters.json").write_text(json.dumps(meters, indent=2) + "\n")

    lines = [
        f"# {approach.approach_id} TypeSafe meters",
        "",
        "**Generated:** 2026-10-02 UTC  ",
        f"**Stratum:** `{STRATUM}`  ",
        f"**Approach:** `{approach.approach_id}`  ",
        f"**Driver/model:** TypeSafe System One / `{MODEL}`",
        "",
        "Maps-only offline assessment/decision evidence. The H3/H4 cells use "
        "the H1 prefix-only state projection and 75/90 grid. Only the approach "
        "question and response classes differ. No hooks, assert-hook changes, "
        "Pilot live Jev, or product wiring.",
        "",
        "## Execution",
        "",
        "| Measure | Result |",
        "|---|---:|",
        f"| Cells | {len(cells)} |",
        f"| Sessions | {len(SESSION_IDS)} |",
        "| Checkpoints | 75 and 90 |",
        f"| Re-check interval | {RECHECK_INTERVAL} turns |",
        f"| HTTP successes | {meters['http_successes']} |",
        f"| Errors | {meters['errors']} |",
        f"| Parse misses | {meters['parse_miss_cells']} |",
        f"| Fire | {meters['fire_count']} |",
        f"| Defer | {meters['defer_count']} |",
        "",
        "| Checkpoint | Cells | Fire | Defer |",
        "|---:|---:|---:|---:|",
    ]
    for checkpoint in CHECKPOINTS:
        bucket = by_checkpoint[str(checkpoint)]
        lines.append(
            f"| {checkpoint} | {bucket['n']} | {bucket['fire']} | {bucket['defer']} |"
        )
    lines.extend(
        [
            "",
            "## H2 null baselines",
            "",
            "These are deterministic baselines over the same eight cells; no "
            "model call or outcome label is used.",
            "",
            "| Null | Fire | Defer |",
            "|---|---:|---:|",
        ]
    )
    for name, baseline in meters["h2_null_baselines"].items():
        lines.append(
            f"| `{name}` | {baseline['fire_count']} | {baseline['defer_count']} |"
        )
    lines.extend(
        [
            "",
            "## Fire-time versus ideal steer",
            "",
            "The fixture set has no independent adjudicated steer-window sidecar. "
            "`ideal_steer_window` is therefore unidentified, and `near_done_fp` "
            "and `runaway_miss` are unknown rather than zero. This trial does not "
            "claim a timing hit, miss, or false-positive rate.",
            "",
            "## Artifact paths",
            "",
            "- `cell-manifest.json` — stable cell IDs, inputs, decisions, ratings, and timestamps",
            "- `results.jsonl` — normalized rows with raw answers and response paths",
            "- `meters.json` / `METERS.md` — execution counts, H2 nulls, and honest unknowns",
            "- `raw/` — per-cell request and TypeSafe response captures",
        ]
    )
    (out / "METERS.md").write_text("\n".join(lines) + "\n")


def run_approach(approach: Approach) -> int:
    out = ROOT / approach.directory / "typesafe"
    out.mkdir(parents=True, exist_ok=True)
    cells = build_cells(approach)
    results_path = out / "results.jsonl"
    if results_path.is_file():
        existing = [
            json.loads(line)
            for line in results_path.read_text().splitlines()
            if line.strip()
        ]
        expected_ids = {cell["cell_id"] for cell in cells}
        if (
            {row.get("cell_id") for row in existing} == expected_ids
            and len(existing) == len(cells)
            and not any(row.get("error") for row in existing)
        ):
            # Make completed runs idempotent and repair older rows before
            # regenerating their manifest and meters.
            for row in existing:
                if row.get("response_label") is not None:
                    row["response_class"] = row["response_label"]
            results_path.write_text(
                "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in existing)
            )
            write_outputs(approach, out, cells)
            print(
                json.dumps(
                    {
                        "approach_id": approach.approach_id,
                        "n_cells": len(cells),
                        "errors": 0,
                        "resumed_existing_results": True,
                        "cell_ids": [cell["cell_id"] for cell in cells],
                    }
                )
            )
            return 0
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(post_cell, approach, out, cell) for cell in cells]
        for future in as_completed(futures):
            row = future.result()
            results.append(row)
            print(
                f"{approach.approach_id} {row['cell_id']} "
                f"{row['session_id']}@{row['checkpoint']} "
                f"decision={row.get('decision')} rating={row.get('rating')} "
                f"error={row.get('error')}",
                flush=True,
            )
    (out / "results.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in results)
    )
    write_outputs(approach, out, cells)
    errors = [row for row in results if row.get("error")]
    print(
        json.dumps(
            {
                "approach_id": approach.approach_id,
                "n_cells": len(cells),
                "errors": len(errors),
                "cell_ids": [cell["cell_id"] for cell in cells],
            }
        )
    )
    return 1 if errors else 0


def main() -> int:
    if not os.environ.get("TYPESAFE_API_KEY", "").strip():
        raise SystemExit("TYPESAFE_API_KEY is not set")
    status = 0
    for approach in APPROACHES:
        status |= run_approach(approach)
    return status


if __name__ == "__main__":
    raise SystemExit(main())
