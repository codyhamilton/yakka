"""Named repository histories.

A history profile names the commit-trailer keys, plan-record paths, close
markers and later-fix window one repository's workflow uses. Manifest
construction selects a profile by name so trailer and layout assumptions are
not baked into the manifest.

Candidate extraction lives in ``history_extract_a`` and ``history_extract_b``.
``extract(repo, profile, *, now)`` returns ``sha -> metadata`` with ``tier``
(``phase``, ``unit``, ``pr`` or ``None``), ``plan``, ``phase``, ``pr``,
``base_sha``, ``outcomes``, ``later_fixes``, ``censored`` and ``window_end``.
``now`` is injected; the extractors do not read the wall clock.
"""
from __future__ import annotations

import dataclasses
import pathlib

LATER_FIX_WINDOW_DAYS = 60


@dataclasses.dataclass(frozen=True)
class HistoryProfile:
    name: str
    plan_trailers: tuple[str, ...] = ("Workflow-Plan", "Yakka-Plan")
    phase_trailers: tuple[str, ...] = ("Workflow-Phase", "Yakka-Phase")
    pr_markers: tuple[str, ...] = ("Pull-Request", "PR")
    plans_root: str = "docs/plans"
    design_name: str = "DESIGN.md"
    review_name: str = "REVIEW.md"
    implementation_name: str = "IMPLEMENTATION.md"
    reports_name: str = "reports"
    phase_close_markers: tuple[str, ...] = ("Workflow-Phase", "Yakka-Phase")
    close_out_markers: tuple[str, ...] = ("Workflow-Close-Out", "Yakka-Close-Out")
    later_fix_window_days: int = LATER_FIX_WINDOW_DAYS

    def plan_root(self, plan: str | None) -> str | None:
        if not plan:
            return None
        value = plan.strip().rstrip("/")
        if not value:
            return None
        if value.startswith(("docs/plans/", self.plans_root + "/")):
            return value
        return f"{self.plans_root}/{value}"

    def is_collapsed(self, plan: str | None) -> bool:
        root = self.plan_root(plan)
        return bool(root and root.endswith(".md"))

    def record_paths(self, plan: str | None) -> dict[str, str]:
        root = self.plan_root(plan)
        if not root:
            return {}
        if self.is_collapsed(plan):
            return {"design": root, "review": root, "implementation": root,
                    "reports": f"{pathlib.PurePosixPath(root).parent}/{self.reports_name}"}
        return {"design": f"{root}/{self.design_name}",
                "review": f"{root}/{self.review_name}",
                "implementation": f"{root}/{self.implementation_name}",
                "reports": f"{root}/{self.reports_name}"}

    def design_paths(self, plan: str | None) -> list[str]:
        design = self.record_paths(plan).get("design")
        return [design] if design else []


GARCIA_MUSIC_WORKFLOW = HistoryProfile(name="garcia-music-workflow")
GENERIC_WORKFLOW = HistoryProfile(name="generic-workflow")
PROFILES = {profile.name: profile for profile in (GARCIA_MUSIC_WORKFLOW, GENERIC_WORKFLOW)}
DEFAULT_PROFILE = GARCIA_MUSIC_WORKFLOW.name


def get_profile(name: str) -> HistoryProfile:
    try:
        return PROFILES[name]
    except KeyError as exc:
        raise ValueError(f"unknown history profile: {name}") from exc
