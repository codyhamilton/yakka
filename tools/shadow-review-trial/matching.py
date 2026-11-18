"""Deterministic matching and statistics for the Phase 4 comparison report.

No randomness outside an explicit seed, no model call, no I/O and no module
state.  ``text_similarity`` is the Jaccard index of the normalised word sets
(``normalise_text`` casefolds, collapses every whitespace run to one space and
strips); two empty texts have similarity 0.0.

``classify`` returns one band per (review, target) pair:

- ``structural``: same path, overlapping or point-inside line ranges, and text
  similarity at or above ``STRUCTURAL_SIMILARITY``.
- ``non_match``: a different path with text similarity below
  ``STRUCTURAL_SIMILARITY``, or no line overlap with text similarity below
  ``UNCERTAIN_SIMILARITY``.  The brief also lists "different path" as a
  non-match unconditionally while giving "path differs, text very similar" as
  an uncertain example; this module follows the example, so a path mismatch
  alone is not decisive when the text is very similar.
- ``uncertain``: every other case, including a path match whose lines miss but
  whose text is similar.  Only this band goes to adjudication.
"""
from __future__ import annotations

import math
import random
import re
from typing import Any

STRUCTURAL_SIMILARITY = 0.60
UNCERTAIN_SIMILARITY = 0.30


def normalise_text(text: str) -> str:
    """Casefold, collapse all whitespace to single spaces and strip."""
    return re.sub(r"\s+", " ", text.casefold()).strip()


def text_similarity(a: str, b: str) -> float:
    """Jaccard similarity over the normalised word sets; 0.0 when both are empty."""
    words_a = set(normalise_text(a).split())
    words_b = set(normalise_text(b).split())
    union = words_a | words_b
    if not union:
        return 0.0
    return len(words_a & words_b) / len(union)


def _range(target: dict[str, Any], start_key: str, end_key: str) -> tuple[int, int]:
    start = int(target[start_key])
    end = target.get(end_key)
    return start, int(start if end is None else end)


def _has_line_overlap(first: tuple[int, int], second: tuple[int, int]) -> bool:
    return first[0] <= second[1] and second[0] <= first[1]


def classify(review: dict[str, Any], target: dict[str, Any]) -> dict[str, Any]:
    """Band one review finding against one recorded outcome or later-fix hunk."""
    review_text = review.get("evidence") or review.get("title") or ""
    target_text = target.get("excerpt") or target.get("text") or ""
    similarity = text_similarity(review_text, target_text)
    path_match = review["path"] == target["path"]
    line_overlap = _has_line_overlap(_range(review, "line_start", "line_end"),
                                     _range(target, "line_start", "line_end"))
    if path_match and line_overlap and similarity >= STRUCTURAL_SIMILARITY:
        band = "structural"
    elif (not path_match and similarity < STRUCTURAL_SIMILARITY) or (
            not line_overlap and similarity < UNCERTAIN_SIMILARITY):
        band = "non_match"
    else:
        band = "uncertain"
    return {"band": band, "path_match": path_match,
            "line_overlap": line_overlap, "text_similarity": similarity}


def tag_method(band: str, adjudicated: bool) -> str:
    """Method tag attached to every emitted match."""
    if band == "structural":
        return "structural"
    if band == "uncertain" and adjudicated:
        return "adjudicated"
    return ""


def shuffled_case_map(case_ids: list[str], seed: int) -> dict[str, str]:
    """Seeded derangement over the sorted distinct cases for the null comparator."""
    cases = sorted(set(case_ids))
    if len(cases) < 2:
        return {}
    offset = random.Random(seed).randrange(1, len(cases))
    return {case_id: cases[(index + offset) % len(cases)]
            for index, case_id in enumerate(cases)}


def cohen_kappa(pairs: list[tuple[str, str]]) -> float | None:
    """Cohen's kappa on string labels; None for too few pairs or degenerate agreement."""
    if len(pairs) < 2:
        return None
    labels = {label for pair in pairs for label in pair}
    if len(labels) < 2:
        return None
    observed = sum(1 for first, second in pairs if first == second) / len(pairs)
    first_counts: dict[str, int] = {}
    second_counts: dict[str, int] = {}
    for first, second in pairs:
        first_counts[first] = first_counts.get(first, 0) + 1
        second_counts[second] = second_counts.get(second, 0) + 1
    expected = sum((first_counts[label] / len(pairs)) * (second_counts.get(label, 0) / len(pairs))
                   for label in first_counts)
    if math.isclose(expected, 1.0):
        return None
    return (observed - expected) / (1.0 - expected)


def bootstrap_interval(values: list[float], seed: int, resamples: int = 2000,
                       alpha: float = 0.05) -> dict[str, Any]:
    """Seeded percentile bootstrap of the mean with sorted resampled means."""
    if not values:
        return {"n": 0, "mean": None, "low": None, "high": None, "resamples": resamples}
    mean = sum(values) / len(values)
    rng = random.Random(seed)
    means = sorted(sum(rng.choices(values, k=len(values))) / len(values)
                   for _ in range(resamples))

    def at(probability: float) -> float:
        last = len(means) - 1
        position = probability * last
        lower = math.floor(position)
        upper = math.ceil(position)
        if lower == upper:
            return means[lower]
        return means[lower] + (means[upper] - means[lower]) * (position - lower)

    return {"n": len(values), "mean": mean, "low": at(alpha / 2),
            "high": at(1 - alpha / 2), "resamples": resamples}
