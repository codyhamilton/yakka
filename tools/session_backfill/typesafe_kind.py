"""TypeSafe System One kind schema and answer parsing for back-fill pass 2.

Each request carries one scrubbed, truncated prompt prefix and nothing else.
The transport is injected by the caller. Only `live_transport` reaches
`jev_client.post_systemone`, and kind_pass calls it only under --live.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE.parents[1] / "tools" / "transcript" / "lib"))

from backfill import _scrub_evidence  # noqa: E402
import jev_client  # noqa: E402

PROMPT_PREFIX_CHARS = 1000
EVIDENCE_CHARS = 300
QUESTION_ID = "work_kind"
UNCLEAR = "unclear"

KIND_CRITERIA: dict[str, str] = {
    "design": "Designing, planning, or writing a spec or phase outline",
    "refine": "Turning a signed-off design into dispatchable briefs",
    "build": "Implementing the planned change as the main thrust",
    "review": "Reviewing a diff, PR, or prior agent output",
    "fix": "Correcting a failure, error, or regression",
    "close-out": "Closing a plan: collapsing records or final merge steps",
    "sync": "Bringing branches, records, or state up to date",
    "escalation": "Handing a blocked item to a human or a higher tier",
    "triage": "Sorting, prioritising, or deciding what to do next",
    "research": "Surveying docs, repo, or web before deciding",
    UNCLEAR: "No single kind dominates the prompt",
}
KIND_LABELS: tuple[str, ...] = tuple(KIND_CRITERIA)

WORK_KIND_INSTRUCTIONS = (
    "What kind of work does this session's opening prompt ask for? "
    "Choose the single kind the prompt asks for. "
    "Answer unclear only when no kind dominates."
)

Transport = Callable[[dict[str, Any]], dict[str, Any]]


@dataclass(frozen=True)
class KindResult:
    kind: str
    confidence: float
    # "" for a usable kind; otherwise why the result is not usable.
    reason: str
    prompt_prefix: str


def prompt_prefix(text: str) -> str:
    """First non-empty line, secret-scrubbed, then truncated to PROMPT_PREFIX_CHARS."""
    first = next((line for line in text.splitlines() if line.strip()), "")
    return _scrub_evidence(first, limit=PROMPT_PREFIX_CHARS)


def build_work_kind_question() -> dict[str, Any]:
    return {
        "type": "choice",
        "instructions": WORK_KIND_INSTRUCTIONS,
        "criteria": dict(KIND_CRITERIA),
    }


def build_kind_request(prefix: str) -> dict[str, Any]:
    request = {
        "model": jev_client.JEV_MODEL,
        "state": {"prompt": prefix},
        "questions": {QUESTION_ID: build_work_kind_question()},
    }
    jev_client.validate_systemone_request(request)
    return request


def parse_answer(response: Any) -> tuple[str, float, str]:
    """Return (kind, confidence, reason); reason is "" only for a usable kind."""
    answers = response.get("answers") if isinstance(response, dict) else None
    answer = answers.get(QUESTION_ID) if isinstance(answers, dict) else None
    if not isinstance(answer, dict):
        return UNCLEAR, 0.0, "invalid_answer"
    choice = answer.get("choice")
    confidence = answer.get("confidence")
    if (
        not isinstance(choice, str)
        or choice not in KIND_LABELS
        or isinstance(confidence, bool)
        or not isinstance(confidence, (int, float))
        or not math.isfinite(confidence)
        or not 0.0 <= confidence <= 1.0
    ):
        return UNCLEAR, 0.0, "invalid_answer"
    if choice == UNCLEAR:
        return UNCLEAR, float(confidence), "model_unclear"
    return choice, float(confidence), ""


def classify_prompt(prefix: str, transport: Transport) -> KindResult:
    """Classify one prefix. Never raises for a bad answer or a failed call."""
    if not prefix:
        # Nothing to send; an empty prompt is not a classification request.
        return KindResult(UNCLEAR, 0.0, "empty_prompt", "")
    request = build_kind_request(prefix)
    try:
        response = transport(request)
    except (Exception, SystemExit):
        # post_systemone exits on HTTP and URL errors; isolate those per item.
        return KindResult(UNCLEAR, 0.0, "transport_error", prefix)
    kind, confidence, reason = parse_answer(response)
    return KindResult(kind, confidence, reason, prefix)


def live_transport(request: dict[str, Any]) -> dict[str, Any]:
    """The only path to the network. Reached solely through kind_pass --live."""
    return jev_client.post_systemone(request)
