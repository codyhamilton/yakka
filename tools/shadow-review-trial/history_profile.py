"""Named repository histories and the candidate-extractor seam.

A history profile names the commit-trailer keys, plan-record paths, close
markers and later-fix window one repository's workflow uses. Manifest
construction selects a profile by name so trailer and layout assumptions are
not baked into the manifest.

Extractor seam (implemented by later units, not here)::

    extract(repo, profile, *, now) -> dict[sha, metadata]

Every metadata value carries ``tier`` (``phase``, ``unit``, ``pr`` or ``None``),
``plan``, ``phase``, ``pr``, ``base_sha``, ``outcomes``, ``later_fixes``,
``censored`` and ``window_end``. ``now`` is injected; the default extractor is
deterministic and never reads the wall clock. The temporary ``default_extract``
preserves the trailer-derived phase/PR/unclassified classification and leaves
outcomes and later fixes empty until the real extractors replace it.
"""
from __future__ import annotations

import dataclasses
import pathlib
import subprocess

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


def _git(repo: pathlib.Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)
    return result.stdout.decode("utf-8", "replace").strip()


def _enumeration_refs(repo: pathlib.Path) -> list[str]:
    refs = ["HEAD"]
    try:
        listing = _git(repo, "for-each-ref", "--format=%(refname)", "refs/remotes")
    except subprocess.CalledProcessError:
        listing = ""
    refs.extend(sorted(line for line in listing.splitlines() if line))
    return refs


def _trailers(repo: pathlib.Path, sha: str, profile: HistoryProfile) -> dict[str, str]:
    keys = set(profile.plan_trailers) | set(profile.phase_trailers) | set(profile.pr_markers)
    body = _git(repo, "show", "-s", "--format=%B", sha)
    result: dict[str, str] = {}
    for line in body.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            if key in keys:
                result[key] = value.strip()
    return result


def _first(trailers: dict[str, str], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = trailers.get(key)
        if value:
            return value
    return None


def default_extract(repo: pathlib.Path, profile: HistoryProfile, *, now: str | None) -> dict[str, dict]:
    """Temporary extractor: trailer-derived tiers, no outcomes or later fixes.

    Phase and PR tiers come from the profile's trailer keys; a commit with
    neither is unclassified (``tier`` is ``None``) and is recorded only for
    exclusion accounting. ``now`` is accepted for the seam but never consulted.
    """
    extracted: dict[str, dict] = {}
    rows = _git(repo, "rev-list", "--parents", *_enumeration_refs(repo)).splitlines()
    for row in rows:
        parts = row.split()
        sha, parents = parts[0], parts[1:]
        trailers = _trailers(repo, sha, profile)
        plan = _first(trailers, profile.plan_trailers)
        phase_value = _first(trailers, profile.phase_trailers)
        if not plan and phase_value and ":" in phase_value:
            plan = phase_value.rsplit(":", 1)[0]
        pr_value = _first(trailers, profile.pr_markers)
        phase = None
        if phase_value:
            value = phase_value.rsplit(":", 1)[-1]
            phase = int(value) if value.isdigit() else None
        if phase_value:
            tier = "phase"
        elif pr_value or plan:
            tier = "pr"
        else:
            tier = None
        extracted[sha] = {"tier": tier, "plan": plan, "phase": phase, "pr": pr_value,
                          "base_sha": parents[0] if parents else None, "outcomes": [],
                          "later_fixes": [], "censored": False, "window_end": None}
    return extracted
