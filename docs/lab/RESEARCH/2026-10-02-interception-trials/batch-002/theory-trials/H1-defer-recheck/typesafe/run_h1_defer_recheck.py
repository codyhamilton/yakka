#!/usr/bin/env python3
"""Run the Maps-only H1 defer/re-check TypeSafe slice.

This is offline evidence collection only. It sends one prefix-only System One
request per cell and never touches hooks, assert hooks, or the live Jev path.
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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO = Path(os.environ.get("WF_REPO", "/home/codyh/workspace/workflow-plugin"))
OUT = Path(__file__).resolve().parent
RAW = OUT / "raw"
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
APPROACH_ID = "H1-defer-recheck"
STRATUM = "maps-5h"
CHECKPOINTS = (75, 90)
RECHECK_INTERVAL = 15
SESSION_IDS = ("92a48e004519", "bb6165018de0", "0aab88c525de", "036ff3ed4a89")
RESPONSE_LABELS = (
    "fire_now",
    "defer_recheck",
    "defer_closing",
    "defer_productive",
    "defer_insufficient",
)


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def stable_cell_id(session_id: str, checkpoint: int) -> str:
    raw = (
        f"{APPROACH_ID}|{MODEL}|{STRATUM}|{session_id}|{checkpoint}|"
        "trial-prefix-v1|defer_recheck"
    )
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def prior_projection(state: dict[str, Any]) -> dict[str, Any]:
    """Keep a bounded prior card; all values originate at the prior prefix."""
    prior = {
        "checkpoint_turn": state.get("checkpoint_turn"),
        "evidence_class": "prior_prefix_projection",
        "cumulative": copy.deepcopy(state.get("cumulative") or {}),
        "tail": copy.deepcopy((state.get("tail") or [])[-4:]),
    }
    return prior


def build_cells() -> list[dict[str, Any]]:
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
            if state_size > 12_000:
                raise SystemExit(f"state over budget for {session_id}@{checkpoint}: {state_size}")
            states[checkpoint] = state
            cells.append(
                {
                    "cell_id": stable_cell_id(session_id, checkpoint),
                    "session_id": session_id,
                    "checkpoint": checkpoint,
                    "prior_checkpoint": prior,
                    "stratum": STRATUM,
                    "approach_id": APPROACH_ID,
                    "model": MODEL,
                    "fixture": str(path.relative_to(REPO)),
                    "fixture_sha256": file_sha256(path),
                    "source_turns_for_eligibility_only": indexed.T,
                    "state": state,
                    "state_chars": state_size,
                    "shrink_steps": shrink_steps,
                    "response_class": "defer_recheck",
                    "question": (
                        "At this checkpoint, choose fire_now only for likely avoidable "
                        "low-value continuation. Otherwise choose the most specific "
                        "defer label. At the first checkpoint, defer_recheck means "
                        "preserve productive work and reassess in about 15 turns. "
                        "At the re-check, use the bounded prior prefix only to judge "
                        "whether concern persisted; protect concrete closing value "
                        "and checkable progress."
                    ),
                }
            )
            prior = checkpoint
    return cells


def questions(cell: dict[str, Any]) -> dict[str, Any]:
    return {
        "response": {
            "type": "choice",
            "instructions": cell["question"] + " Choose exactly one response label.",
            "criteria": {
                "fire_now": "Fire now: likely avoidable low-value continuation.",
                "defer_recheck": "Defer and re-check: concern is not persistent or evidence is insufficient.",
                "defer_closing": "Defer: concrete completion, validation, or delivery value remains.",
                "defer_productive": "Defer: checkable productive progress remains.",
                "defer_insufficient": "Defer: evidence is too weak to justify firing.",
            },
        },
        "rating": {
            "type": "score",
            "instructions": (
                "Rate steer urgency from 0 to 3 using only the supplied prefix. "
                "0 means clearly defer, 1 mild concern, 2 steer soon, 3 fire now."
            ),
            "criteria": [
                "0: clearly productive, closing, or insufficient; defer",
                "1: mild concern; defer and retain a re-check",
                "2: meaningful concern; steer soon",
                "3: likely avoidable low-value continuation; fire now",
            ],
        },
    }


def post_cell(cell: dict[str, Any]) -> dict[str, Any]:
    cell_id = cell["cell_id"]
    request = {
        "model": MODEL,
        "state": cell["state"],
        "questions": questions(cell),
    }
    RAW.mkdir(parents=True, exist_ok=True)
    request_path = RAW / f"{cell_id}-request.json"
    request_path.write_text(json.dumps(request, indent=2, ensure_ascii=False) + "\n")
    started = timestamp()
    started_clock = time.monotonic()
    result: dict[str, Any] = {
        "cell_id": cell_id,
        "session_id": cell["session_id"],
        "checkpoint": cell["checkpoint"],
        "prior_checkpoint": cell["prior_checkpoint"],
        "stratum": STRATUM,
        "approach_id": APPROACH_ID,
        "model": MODEL,
        "response_class": cell["response_class"],
        "request_started_at": started,
        "request_path": str(request_path.relative_to(OUT)),
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
            raw = response.read().decode("utf-8")
            result["http_status"] = response.status
        response_path = RAW / f"{cell_id}-response.json"
        response_path.write_text(raw + ("" if raw.endswith("\n") else "\n"))
        result["response_path"] = str(response_path.relative_to(OUT))
        payload = json.loads(raw)
        answers = payload.get("answers") or {}
        result["raw_answers"] = answers
        choice = (answers.get("response") or {}).get("choice")
        score_answer = answers.get("rating") or {}
        score = score_answer.get("score")
        result["raw_rating_score"] = score
        probabilities = score_answer.get("probabilities") or {}
        if probabilities:
            result["rating"] = int(max(probabilities.items(), key=lambda item: float(item[1]))[0])
        elif isinstance(score, (int, float)):
            result["rating"] = int(round(float(score) * 3 if float(score) <= 1.5 else float(score)))
            result["rating"] = max(0, min(3, result["rating"]))
        if choice in RESPONSE_LABELS:
            result["decision"] = "fire" if choice == "fire_now" else "defer"
            result["fire"] = choice == "fire_now"
            result["response_label"] = choice
            result["response_class"] = choice
        else:
            result["error"] = f"unexpected response choice: {choice!r}"
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        error_path = RAW / f"{cell_id}-error.txt"
        error_path.write_text(f"HTTP {exc.code}\n{detail}\n")
        result["http_status"] = exc.code
        result["error"] = f"HTTP {exc.code}: {detail[:800]}"
        result["error_path"] = str(error_path.relative_to(OUT))
    except Exception as exc:  # pragma: no cover - exercised by network failures
        error_path = RAW / f"{cell_id}-error.txt"
        error_path.write_text(f"{type(exc).__name__}: {exc}\n")
        result["error"] = f"{type(exc).__name__}: {exc}"
        result["error_path"] = str(error_path.relative_to(OUT))
    result["response_received_at"] = timestamp()
    result["elapsed_ms"] = round((time.monotonic() - started_clock) * 1000)
    return result


def write_outputs(cells: list[dict[str, Any]], results: list[dict[str, Any]]) -> None:
    results_by_id = {row["cell_id"]: row for row in results}
    ordered = [results_by_id[cell["cell_id"]] for cell in cells]
    (OUT / "results.jsonl").write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in ordered)
    )
    manifest = {
        "generated_at": timestamp(),
        "stratum": STRATUM,
        "approach_id": APPROACH_ID,
        "model": MODEL,
        "driver": "TypeSafe System One",
        "api_url": API_URL,
        "soft_standard_hold": True,
        "product_wiring": False,
        "hooks_unlock": False,
        "state_contract": {
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
                "approach_id": APPROACH_ID,
                "model": MODEL,
                "fixture": cell["fixture"],
                "fixture_sha256": cell["fixture_sha256"],
                "state_chars": cell["state_chars"],
                "shrink_steps": cell["shrink_steps"],
                "decision": results_by_id[cell["cell_id"]].get("decision"),
                "fire": results_by_id[cell["cell_id"]].get("fire"),
                "rating": results_by_id[cell["cell_id"]].get("rating"),
                "response_label": results_by_id[cell["cell_id"]].get("response_label"),
                "request_started_at": results_by_id[cell["cell_id"]].get("request_started_at"),
                "response_received_at": results_by_id[cell["cell_id"]].get("response_received_at"),
                "raw_request": results_by_id[cell["cell_id"]].get("request_path"),
                "raw_response": results_by_id[cell["cell_id"]].get("response_path"),
                "error": results_by_id[cell["cell_id"]].get("error"),
            }
            for cell in cells
        ],
    }
    (OUT / "cell-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> int:
    if not os.environ.get("TYPESAFE_API_KEY", "").strip():
        raise SystemExit("TYPESAFE_API_KEY is not set")
    cells = build_cells()
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(post_cell, cell) for cell in cells]
        for future in as_completed(futures):
            row = future.result()
            results.append(row)
            print(
                f"{row['cell_id']} {row['session_id']}@{row['checkpoint']} "
                f"decision={row.get('decision')} rating={row.get('rating')} "
                f"error={row.get('error')}",
                flush=True,
            )
    write_outputs(cells, results)
    errors = [row for row in results if row.get("error")]
    print(json.dumps({"n_cells": len(cells), "errors": len(errors), "cell_ids": [c["cell_id"] for c in cells]}))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
