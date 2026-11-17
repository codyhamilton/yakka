"""Request-level leak check over a frozen historical review manifest.

Reconstructs the exact requests ``runner.build_request`` would post and proves
that no case-plan review document and no recorded outcome excerpt travels in
them.  No I/O, no network and no echoing of diffs, paths, SHAs or excerpts; the
result is aggregate counts only.
"""
from __future__ import annotations

import re
from typing import Any

import matching
import runner

EFFORTS = ("high", "xhigh", "max")
PLAN_DOCUMENTS = ("REVIEW.md", "IMPLEMENTATION.md", "DESIGN.md")
SCOPE = "case_plan_and_outcome_excerpts"
_PLAN_PATH = re.compile(r"docs/plans/[^\s\"']+")


def _plan_prefix(plan: Any) -> str | None:
    if not isinstance(plan, str):
        return None
    value = plan.strip().rstrip("/")
    return value or None


def _own_document_hits(diff: str, prefix: str | None) -> int:
    if not prefix:
        return 0
    names = "|".join(re.escape(name) for name in PLAN_DOCUMENTS)
    pattern = re.compile(re.escape(prefix) + r"/(?:" + names + r")")
    return len(pattern.findall(diff))


def _has_foreign_plan_document(diff: str, prefix: str | None) -> bool:
    for path in _PLAN_PATH.findall(diff):
        if prefix and (path == prefix or path.startswith(prefix + "/")):
            continue
        return True
    return False


def _criteria_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return "\n".join(part for part in value if isinstance(part, str))
    return ""


def _outcome_hits(diff: str, criteria: str, outcomes: Any) -> int:
    normalised_diff = matching.normalise_text(diff)
    normalised_criteria = matching.normalise_text(criteria)
    hits = 0
    for outcome in outcomes or []:
        if not isinstance(outcome, dict):
            continue
        excerpt = outcome.get("excerpt")
        if not isinstance(excerpt, str):
            continue
        normalised = matching.normalise_text(excerpt)
        if normalised and (normalised in normalised_diff or normalised in normalised_criteria):
            hits += 1
    return hits


def check_requests(manifest: dict[str, Any], run_id: str) -> dict[str, Any]:
    """Return aggregate leak-check counts for every request the runner would send."""
    by_id: dict[str, dict[str, Any]] = {}
    for case in manifest.get("cases", []):
        if isinstance(case, dict) and isinstance(case.get("case_id"), str):
            by_id[case["case_id"]] = case
    request_errors: list[str] = []
    requests_checked = 0
    own_plan_document_hits = 0
    outcome_text_hits = 0
    foreign_plan_document_captures = 0
    for case_id in manifest.get("run_order", []):
        case = by_id.get(case_id)
        if case is None:
            request_errors.append(case_id)
            continue
        built = []
        for effort in EFFORTS:
            try:
                built.append(runner.build_request(manifest, case, effort, False, run_id))
            except runner.RunnerError:
                request_errors.append(case_id)
                break
        if len(built) != len(EFFORTS):
            continue
        requests_checked += len(built)
        prefix = _plan_prefix(case.get("plan"))
        foreign = False
        for request in built:
            diff = request["capture"]["diff"]
            criteria = _criteria_text(request["criteria_text"])
            own_plan_document_hits += _own_document_hits(diff, prefix)
            outcome_text_hits += _outcome_hits(diff, criteria, case.get("outcomes"))
            foreign = foreign or _has_foreign_plan_document(diff, prefix)
        if foreign:
            foreign_plan_document_captures += 1
    return {
        "pass": not request_errors and own_plan_document_hits == 0 and outcome_text_hits == 0,
        "requests_checked": requests_checked,
        "request_errors": request_errors,
        "own_plan_document_hits": own_plan_document_hits,
        "outcome_text_hits": outcome_text_hits,
        "foreign_plan_document_captures": foreign_plan_document_captures,
        "scope": SCOPE,
    }
