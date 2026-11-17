"""Request-level leak check over a frozen historical review manifest.

Reconstructs the exact requests ``runner.build_request`` would post and proves
that no case-plan review document and no recorded outcome excerpt travels in
them.  A plan document is a diff *section* whose path resolves under a
``docs/plans/`` folder; a bare mention of such a path in code or prose is not a
leaked document.  Only distinctive outcome excerpts (at least
``MIN_EXCERPT_WORDS`` normalised words) are searched, and every
``docs/plans/`` section body is excluded from that search.  No I/O, no network
and no echoing of diffs, paths, SHAs or excerpts; the result is aggregate
counts only.
"""
from __future__ import annotations

import re
from typing import Any

import matching
import runner

EFFORTS = ("high", "xhigh", "max")
PLAN_DOCUMENTS = ("REVIEW.md", "IMPLEMENTATION.md", "DESIGN.md")
MIN_EXCERPT_WORDS = 5
SCOPE = "case_plan_and_outcome_excerpts"
_PLAN_ROOT = "docs/plans/"
_DIFF_HEADER = re.compile(r"^diff --git a/(.*?) b/(.*)$")


def _plan_prefix(plan: Any) -> str | None:
    if not isinstance(plan, str):
        return None
    value = plan.strip().rstrip("/")
    return value or None


def _sections(diff: str) -> list[str]:
    if not diff:
        return []
    parts = re.split(r"(?m)^(?=diff --git )", diff)
    return [part for part in parts if part]


def _section_path(section: str) -> str:
    first = section.split("\n", 1)[0]
    match = _DIFF_HEADER.match(first)
    return match.group(2) if match else ""


def _under(path: str, prefix: str | None) -> bool:
    if not prefix:
        return False
    return path == prefix or path.startswith(prefix + "/")


def _is_plan_document(path: str) -> bool:
    return path.startswith(_PLAN_ROOT)


def _own_document_sections(diff: str, prefix: str | None) -> int:
    if not prefix:
        return 0
    own_documents = {f"{prefix}/{name}" for name in PLAN_DOCUMENTS}
    return sum(1 for section in _sections(diff)
               if _section_path(section) in own_documents)


def _has_foreign_plan_document(diff: str, prefix: str | None) -> bool:
    for section in _sections(diff):
        path = _section_path(section)
        if _is_plan_document(path) and not _under(path, prefix):
            return True
    return False


def _non_plan_bodies(diff: str) -> list[str]:
    """Diff content outside any ``docs/plans/`` section: preamble plus kept bodies."""
    bodies: list[str] = []
    parts = re.split(r"(?m)^(?=diff --git )", diff or "")
    preamble = parts[0] if parts and not parts[0].startswith("diff --git ") else ""
    if preamble:
        bodies.append(preamble)
    for section in parts:
        if not section.startswith("diff --git "):
            continue
        if _is_plan_document(_section_path(section)):
            continue
        bodies.append(section)
    return bodies


def _criteria_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return "\n".join(part for part in value if isinstance(part, str))
    return ""


def _outcome_hits(search_texts: list[str], outcomes: Any) -> tuple[int, int]:
    """Return (distinctive hits, short excerpts skipped) for one request."""
    hits = 0
    skipped = 0
    for outcome in outcomes or []:
        if not isinstance(outcome, dict):
            continue
        excerpt = outcome.get("excerpt")
        if not isinstance(excerpt, str):
            continue
        normalised = matching.normalise_text(excerpt)
        if len(normalised.split()) < MIN_EXCERPT_WORDS:
            skipped += 1
            continue
        if any(normalised in text for text in search_texts):
            hits += 1
    return hits, skipped


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
    short_excerpts_skipped = 0
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
            criteria = matching.normalise_text(_criteria_text(request["criteria_text"]))
            own_plan_document_hits += _own_document_sections(diff, prefix)
            search_texts = [matching.normalise_text(body) for body in _non_plan_bodies(diff)]
            search_texts.append(criteria)
            hits, skipped = _outcome_hits(search_texts, case.get("outcomes"))
            outcome_text_hits += hits
            short_excerpts_skipped += skipped
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
        "short_excerpts_skipped": short_excerpts_skipped,
        "min_excerpt_words": MIN_EXCERPT_WORDS,
        "scope": SCOPE,
    }
