"""Offline, immutable historical case manifests and comparator evidence."""
from __future__ import annotations

import datetime
import hashlib
import json
import pathlib
import random
import re
import subprocess
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOOL = pathlib.Path(__file__).resolve().parent
if str(TOOL) not in sys.path:
    sys.path.insert(0, str(TOOL))
import history_profile  # noqa: E402
import history_extract_a  # noqa: E402

# Selected after the phase3-04 comparison; see reports/phase3-04-compare-integrate.md.
SELECTED_EXTRACT = history_extract_a.extract

# The capture client lives in plugins/yakka/client today. Plan 27 (design only
# on design/27-yakka-client-consolidation) would move it to
# plugins/yakka/scripts/libs/ (indicatively capture.py), changing only this path.
CLIENT = ROOT / "plugins" / "yakka" / "client"
if str(CLIENT) not in sys.path:
    sys.path.insert(0, str(CLIENT))
import yakka  # noqa: E402

TIERS = ("phase", "unit", "pr")

CODE_SUFFIXES = {".go", ".py", ".js", ".ts", ".tsx", ".jsx", ".rs", ".java", ".c", ".h", ".sh"}
_DIFF_HEADER = re.compile(r"^diff --git a/(.*?) b/(.*)$")
_COMMIT_EXISTS_CACHE: dict[tuple, bool] = {}
_DIFF_PATHS_CACHE: dict[tuple, list[str]] = {}


class ManifestFrozenError(RuntimeError):
    pass


class HistoryPreparationError(RuntimeError):
    pass


def _git(repo: pathlib.Path, *args: str, text: bool = True) -> str | bytes:
    result = subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)
    return result.stdout.decode("utf-8", "replace").strip() if text else result.stdout


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical_hash(value: Any) -> str:
    return _sha(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())


def _blob(repo: pathlib.Path, path: str, sha: str) -> tuple[str, str] | None:
    try:
        blob = str(_git(repo, "rev-parse", f"{sha}:{path}"))
        content = _git(repo, "show", f"{sha}:{path}", text=False)
        return blob, bytes(content).decode("utf-8", "replace")
    except subprocess.CalledProcessError:
        return None


def _changed_paths(repo: pathlib.Path, base: str, head: str) -> list[str]:
    key = (str(repo), base, head)
    if key not in _DIFF_PATHS_CACHE:
        raw = _git(repo, "diff", "--name-only", "-z", base, head, text=False)
        _DIFF_PATHS_CACHE[key] = [x.decode("utf-8", "replace") for x in bytes(raw).split(b"\0") if x]
    return list(_DIFF_PATHS_CACHE[key])


def _has_code_change(paths: list[str]) -> bool:
    return any(pathlib.PurePosixPath(path).suffix.lower() in CODE_SUFFIXES for path in paths)


def _commit_exists(repo: pathlib.Path, sha: str | None) -> bool:
    if not sha:
        return False
    key = (str(repo), sha)
    if key not in _COMMIT_EXISTS_CACHE:
        try:
            _git(repo, "cat-file", "-e", f"{sha}^{{commit}}")
            _COMMIT_EXISTS_CACHE[key] = True
        except subprocess.CalledProcessError:
            _COMMIT_EXISTS_CACHE[key] = False
    return _COMMIT_EXISTS_CACHE[key]


def _has_blob(repo: pathlib.Path, sha: str, path: str) -> bool:
    try:
        _git(repo, "rev-parse", f"{sha}:{path}")
        return True
    except subprocess.CalledProcessError:
        return False


def _now_reference(repo: pathlib.Path, refs: list[str], run=None) -> str:
    """Deterministic freeze reference: the latest committer time across the refs."""
    git = run or _git
    output = str(git(repo, "log", "--format=%ct", *refs)).split()
    stamps = [int(value) for value in output if value.strip().isdigit()]
    epoch = max(stamps) if stamps else 0
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _diff_sections(diff: str) -> list[str]:
    if not diff:
        return []
    parts = re.split(r"(?m)^(?=diff --git )", diff)
    return [part for part in parts if part]


def _section_paths(section: str) -> tuple[str, str]:
    first = section.split("\n", 1)[0]
    match = _DIFF_HEADER.match(first)
    return (match.group(1), match.group(2)) if match else ("", "")


def strip_plan_documents(capture: dict[str, Any], plan_root: str | None) -> dict[str, Any]:
    """Remove every ``docs/plans/<plan>/`` section the capture client cannot exclude.

    The client hard-codes ``excluded = False`` for ``docs/`` paths, so the trial's
    plan-folder exclusion is enforced here, after capture and before eligibility.
    """
    if not plan_root:
        return capture
    prefix = plan_root.rstrip("/") + "/"
    kept: list[str] = []
    for section in _diff_sections(capture.get("diff", "")):
        a_path, b_path = _section_paths(section)
        if a_path.startswith(prefix) or b_path.startswith(prefix):
            continue
        kept.append(section)
    diff = "".join(kept)
    stripped = dict(capture)
    stripped["diff"] = diff
    stripped["diff_sha256"] = hashlib.sha256(diff.encode("utf-8")).hexdigest()
    stripped["diff_bytes"] = len(diff.encode("utf-8"))
    stripped["files"] = [p for p in capture.get("files", []) if not str(p).startswith(prefix)]
    stripped["manifest"] = [entry for entry in capture.get("manifest", [])
                            if not str(entry.get("path", "")).startswith(prefix)]
    return stripped


def _criteria(repo: pathlib.Path, base: str | None, plan: str | None,
              profile: history_profile.HistoryProfile) -> dict[str, Any]:
    """Read the plan DESIGN blob at the case base commit; never fall back to head."""
    if not base or not plan:
        return {"source": "unknown", "path": None, "content_hash": None, "text": None}
    for path in profile.design_paths(plan):
        found = _blob(repo, path, base)
        if found:
            blob, content = found
            return {"source": "base_blob", "path": path, "content_hash": blob, "text": content}
    return {"source": "unknown", "path": None, "content_hash": None, "text": None}


def _comparators(repo: pathlib.Path, head: str, plan: str | None, tier: str | None,
                 profile: history_profile.HistoryProfile) -> list[str]:
    if not plan:
        return []
    records = profile.record_paths(plan)
    paths = [records["review"]]
    if tier == "phase":
        paths.insert(0, records["implementation"])
    pointers = []
    for path in paths:
        found = _blob(repo, path, head)
        if found:
            pointers.append(f"{path}@{head}:{found[0]}")
    return pointers


def _validate_curated(repo: pathlib.Path, data: dict[str, Any], candidates: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if data.get("version") != 1 or not isinstance(data.get("findings"), list):
        raise ValueError("curated comparators require version 1 and a findings array")
    build_models = data.get("build_models", {})
    if not isinstance(build_models, dict) or any(not isinstance(v, list) or not v or not all(isinstance(m, str) and m for m in v) for v in build_models.values()):
        raise ValueError("curated build_models must map commit SHAs to non-empty model id lists")
    if any(sha not in candidates for sha in build_models):
        raise ValueError("curated build_models contains a head SHA outside the manifest candidates")
    finding_ids: set[str] = set()
    for finding in data["findings"]:
        if not isinstance(finding, dict) or not isinstance(finding.get("id"), str) or not finding.get("id") or not isinstance(finding.get("text"), str):
            raise ValueError("each curated finding requires a unique id and text")
        if finding["id"] in finding_ids:
            raise ValueError(f"duplicate curated finding id: {finding['id']}")
        finding_ids.add(finding["id"])
        candidate = candidates.get(finding.get("head_sha"))
        if finding.get("stratum") not in {"phase", "pr"} or not candidate or candidate["stratum"] != finding["stratum"]:
            raise ValueError(f"comparator {finding.get('id')} must cite a phase/PR candidate head")
        if not candidate.get("plan"):
            raise ValueError(f"comparator {finding.get('id')} candidate has no plan identity")
        citations = finding.get("citations")
        if not citations:
            raise ValueError(f"comparator {finding.get('id')} has no citations")
        for citation in citations:
            if not isinstance(citation, dict):
                raise ValueError(f"invalid citation in comparator {finding.get('id')}")
            path, sha = citation.get("path"), citation.get("sha")
            start, end = citation.get("line_start"), citation.get("line_end")
            if not path or sha != finding["head_sha"] or not isinstance(start, int) or not isinstance(end, int) or start < 1 or end < start:
                raise ValueError(f"invalid citation in comparator {finding.get('id')}")
            if not path.startswith(candidate["plan"].rstrip("/") + "/") or not (path.endswith("/REVIEW.md") or finding["stratum"] == "phase" and path.endswith("/IMPLEMENTATION.md")):
                raise ValueError(f"citation is not a comparator source for {finding.get('stratum')}: {path}")
            found = _blob(repo, path, sha)
            if not found or found[0] != citation.get("blobhash"):
                raise ValueError(f"citation blob mismatch: {path}@{sha}")
            if end > len(found[1].splitlines()):
                raise ValueError(f"citation line outside blob: {path}@{sha}")
    return {"findings": data["findings"], "sha256": _canonical_hash(data)}


def load_pr_export(repo: pathlib.Path, path: pathlib.Path, candidate_strata: dict[str, str] | None = None) -> dict[str, Any]:
    raw = path.read_bytes()
    data = json.loads(raw)
    reviews = data.get("reviews") if isinstance(data, dict) else None
    if not isinstance(reviews, list):
        raise ValueError("PR export must contain a reviews array")
    by_head: dict[str, list[dict[str, Any]]] = {}
    for review in reviews:
        head = review.get("head_sha") if isinstance(review, dict) else None
        if not isinstance(head, str):
            raise ValueError("each PR export review must be keyed by a local head SHA")
        try:
            _git(repo, "cat-file", "-e", f"{head}^{{commit}}")
        except subprocess.CalledProcessError as exc:
            raise ValueError(f"PR export head is not a local commit: {head}") from exc
        if candidate_strata is not None and candidate_strata.get(head) != "pr":
            raise ValueError(f"PR export head is not a PR manifest candidate: {head}")
        by_head.setdefault(head, []).append(review)
    return {"sha256": _sha(raw), "by_head": by_head}


def _repository_identity(url: str) -> str:
    value = url.strip().rstrip("/")
    if value.startswith("file://"):
        value = value[len("file://"):]
    elif "://" in value:
        value = value.split("://", 1)[1]
        if "@" in value.split("/", 1)[0]:
            value = value.split("@", 1)[1]
        value = value.split("/", 1)[1] if "/" in value else value
    elif ":" in value and not value.startswith("/"):
        value = value.split(":", 1)[1]
    if value.endswith(".git"):
        value = value[:-4]
    return value.rstrip("/") if value.startswith("/") else value.strip("/")


def prepare_history(repo: pathlib.Path, remote: str = "origin",
                    expected_repository: str = "codyhamilton/yakka", run=None) -> dict[str, Any]:
    """Fetch and verify complete, non-shallow history from the configured remote."""
    run = run or _git
    try:
        remote_url = str(run(repo, "remote", "get-url", remote)).strip()
        identity = _repository_identity(remote_url)
        expected = _repository_identity(expected_repository)
        if identity != expected:
            raise HistoryPreparationError(
                f"remote repository identity {identity!r} does not match expected {expected!r}")
        shallow = str(run(repo, "rev-parse", "--is-shallow-repository")).strip() == "true"
        run(repo, *(("fetch", "--unshallow", remote) if shallow else ("fetch", remote)))
        run(repo, "fetch", remote, "HEAD")
        if str(run(repo, "rev-parse", "--is-shallow-repository")).strip() == "true":
            raise HistoryPreparationError("history is still shallow after fetching the remote")
        fetched_refs = [line for line in str(
            run(repo, "for-each-ref", "--format=%(refname)", f"refs/remotes/{remote}")).splitlines() if line]
        tip = str(run(repo, "rev-parse", "HEAD")).strip()
        enumerated_refs = ["HEAD"] + sorted(fetched_refs)
        object_listing = str(run(repo, "rev-list", "--objects", "--missing=print", *enumerated_refs))
        if any(line.startswith(("?", "!")) for line in object_listing.splitlines()):
            raise HistoryPreparationError("repository has missing objects after fetching the remote")
        raw_count = str(run(repo, "rev-list", "--count", *enumerated_refs)).strip()
        if not raw_count.isdigit():
            raise HistoryPreparationError("verified commit count is missing")
        verified_count = int(raw_count)
        enumerated_commits = len([line for line in str(run(repo, "rev-list", *enumerated_refs)).splitlines() if line])
        if enumerated_commits != verified_count:
            raise HistoryPreparationError(
                f"verified count {verified_count} disagrees with enumeration {enumerated_commits}")
        ref_commit_counts = {ref: int(str(run(repo, "rev-list", "--count", ref)).strip()) for ref in enumerated_refs}
    except subprocess.CalledProcessError as exc:
        raise HistoryPreparationError(f"history preparation failed: {' '.join(exc.cmd)}") from exc
    return {"repository": identity, "remote": remote, "remote_url": remote_url, "tip_sha": tip,
            "fetched_refs": fetched_refs, "enumerated_refs": enumerated_refs,
            "ref_commit_counts": ref_commit_counts, "shallow": False, "object_complete": True,
            "enumerated_commits": enumerated_commits, "verified_count": verified_count}


def create_manifest(repo: pathlib.Path, output: pathlib.Path, seed: int = 1, target: int = 360,
                    floor: int = 300, comparator_path: pathlib.Path | None = None,
                    pr_export_path: pathlib.Path | None = None,
                    remote: str = "origin", expected_repository: str = "codyhamilton/yakka",
                    profile: str = history_profile.DEFAULT_PROFILE, extractor=None,
                    now: str | None = None, run=None) -> dict[str, Any]:
    repo, output = repo.resolve(), output.resolve()
    if target < 1:
        raise ValueError("target must be a positive integer")
    if floor < 1:
        raise ValueError("floor must be a positive integer")
    if output.exists():
        raise ManifestFrozenError(f"manifest already exists; refusing to refresh: {output}")
    resolved_profile = history_profile.get_profile(profile)
    evidence = prepare_history(repo, remote=remote, expected_repository=expected_repository, run=run)
    git = run or _git
    revs = str(git(repo, "rev-list", "--reverse", "--parents", *evidence["enumerated_refs"])).splitlines()
    if len(revs) != evidence["enumerated_commits"]:
        raise HistoryPreparationError(
            f"verified count {evidence['verified_count']} disagrees with manifest enumeration {len(revs)}")
    now_reference = now
    if now_reference is None:
        now_reference = _now_reference(repo, evidence["enumerated_refs"], run=run)
    metadata = (extractor or SELECTED_EXTRACT)(repo, resolved_profile, now=now_reference)
    boundaries: list[str] = []
    policy = json.loads((ROOT / "packages/yakka/internal/review/policy.json").read_text())
    candidates = []
    for row in revs:
        parts = row.split()
        head, parents = parts[0], parts[1:]
        meta = metadata.get(head, {})
        tier = meta.get("tier") if meta.get("tier") in TIERS else None
        plan = meta.get("plan")
        base = meta.get("base_sha")
        if base is None and parents:
            base = parents[0]
        reason = "eligible"
        capture = None
        if tier is None:
            reason = "no_tier"
        elif not base:
            reason = "no_base_commit"
        elif base in boundaries:
            reason = "shallow_history_boundary"
            base = None
        else:
            try:
                _git(repo, "cat-file", "-e", f"{base}^{{commit}}")
            except subprocess.CalledProcessError:
                reason = "shallow_history_boundary"
                base = None
        crit = _criteria(repo, base, plan, resolved_profile)
        pointers = _comparators(repo, head, plan, tier, resolved_profile)
        eligible = reason == "eligible"
        if eligible and not meta.get("outcomes"):
            eligible, reason = False, "no_recorded_outcome"
        if eligible and crit["source"] == "unknown":
            eligible, reason = False, "criteria_unavailable"
        if eligible and not _has_code_change(_changed_paths(repo, base, head)):
            eligible, reason = False, "no_code_change"
        if eligible:
            excluded = list(policy["change_exclude"])
            prefix = resolved_profile.plan_root(plan) if plan else ""
            if prefix:
                excluded += [f"{prefix}/IMPLEMENTATION.md", f"{prefix}/REVIEW.md", f"{prefix}/QA.md"]
            capture_policy = {"exclude": tuple(excluded), "max_file_bytes": policy["change_max_file_bytes"],
                              "max_total_bytes": policy["change_max_total_bytes"], "max_files": policy["change_max_files"],
                              "context_lines": policy["context_lines"], "truncation_order": tuple(policy["truncation_order"])}
            try:
                capture = yakka.CaptureChange(str(repo), mode="range", base=base, head=head, policy=capture_policy)
                base = capture["base"]
                capture = strip_plan_documents(capture, prefix)
                if not capture["diff"]:
                    eligible, reason = False, "empty_capture"
            except yakka.CaptureError as exc:
                eligible, reason = False, f"capture_{exc.code}"
        candidates.append({"case_id": head, "eligible": eligible, "eligibility_reason": reason,
                           "tier": tier, "stratum": tier or "unaccompanied",
                           "plan": plan or None, "phase": meta.get("phase"), "pr": meta.get("pr"),
                           "base_sha": base, "head_sha": head,
                           "outcomes": list(meta.get("outcomes") or []),
                           "later_fixes": list(meta.get("later_fixes") or []),
                           "censored": bool(meta.get("censored", False)), "window_end": meta.get("window_end"),
                           "capture": capture, "criteria": crit,
                           "build_models": {"source": "unknown", "models": []},
                           "comparator_pointers": pointers, "settings": {"kind": "range", "merge_base": False,
                           "review_profile": "historical_trial", "trial_id": "phase-6-frozen"}})
    eligible_candidates = [c for c in candidates if c["eligible"]]
    rng = random.Random(seed)
    selected: list[dict[str, Any]] = []
    for tier in TIERS:
        pool = [c for c in eligible_candidates if c["tier"] == tier]
        rng.shuffle(pool)
        room = target - len(selected)
        if room <= 0:
            break
        selected.extend(pool[:room])
    order = [c["case_id"] for c in selected]
    rng.shuffle(order)
    tiers = {name: {"candidates": sum(c["tier"] == name for c in candidates),
                    "eligible": sum(c["tier"] == name and c["eligible"] for c in candidates),
                    "frozen": sum(c["tier"] == name for c in selected)}
             for name in TIERS}
    exclusions: dict[str, int] = {}
    for candidate in candidates:
        if not candidate["eligible"]:
            exclusions[candidate["eligibility_reason"]] = exclusions.get(candidate["eligibility_reason"], 0) + 1
    excluded_total = sum(exclusions.values())
    censored = sum(1 for case in selected if case["censored"])
    comparators = {"curated": None, "curated_sha256": None, "pr_export_sha256": None, "pr_export_by_head": {}}
    if comparator_path:
        curated = json.loads(comparator_path.read_text())
        checked = _validate_curated(repo, curated, {c["head_sha"]: c for c in candidates})
        comparators.update(curated=checked["findings"], curated_sha256=_sha(comparator_path.read_bytes()))
        for case in candidates:
            models = curated.get("build_models", {}).get(case["head_sha"])
            if models:
                case["build_models"] = {"source": "curated", "models": models, "evidence_sha256": comparators["curated_sha256"]}
    if pr_export_path:
        exported = load_pr_export(repo, pr_export_path, {c["head_sha"]: c["stratum"] for c in candidates})
        comparators.update(pr_export_sha256=exported["sha256"], pr_export_by_head=exported["by_head"])
    frozen = {"schema_version": 1, "repository": str(repo),
               "history": {"repository": evidence["repository"], "remote": evidence["remote"],
                           "remote_url": evidence["remote_url"], "tip_sha": evidence["tip_sha"],
                           "fetched_refs": evidence["fetched_refs"],
                           "enumerated_refs": evidence["enumerated_refs"],
                           "ref_commit_counts": evidence["ref_commit_counts"],
                           "shallow": evidence["shallow"],
                           "object_complete": evidence["object_complete"],
                           "enumerated_commits": len(revs), "verified_count": evidence["verified_count"],
                           "shallow_boundary_shas": boundaries,
                           "oldest_enumerated_sha": revs[0].split()[0] if revs else None},
               "seed": seed, "target": target, "floor": floor, "target_per_effort": target,
               "candidates": candidates, "cases": selected, "tiers": tiers,
               "exclusions": exclusions, "excluded_total": excluded_total, "censored": censored,
               "shortfall_against_floor": max(0, floor - len(selected)),
               "window_reference": now_reference, "run_order": order,
               "settings": {"shared_case_set": True, "non_effort": {"kind": "range", "review_profile": "historical_trial",
               "trial_id": "phase-6-frozen", "merge_base": False}, "efforts": ["high", "xhigh", "max"]},
               "comparators": comparators}
    frozen["manifest_sha256"] = _canonical_hash(frozen)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(frozen, indent=2, sort_keys=True) + "\n")
    return frozen


def _project_reason(repo: pathlib.Path, profile: history_profile.HistoryProfile,
                    head: str, meta: dict[str, Any]) -> str:
    """Project manifest eligibility without capturing any diff."""
    tier = meta.get("tier")
    if tier not in TIERS:
        return "no_tier"
    base = meta.get("base_sha")
    if not base:
        return "no_base_commit"
    if not _commit_exists(repo, base):
        return "shallow_history_boundary"
    if not meta.get("outcomes"):
        return "no_recorded_outcome"
    if _criteria(repo, base, meta.get("plan"), profile)["source"] == "unknown":
        return "criteria_unavailable"
    if not _has_code_change(_changed_paths(repo, base, head)):
        return "no_code_change"
    return "eligible"


def _normalise(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _resolve_outcome(repo: pathlib.Path, outcome: dict[str, Any]) -> bool:
    """True when an outcome's citation resolves to a real blob/commit and line range."""
    commit = outcome.get("commit")
    path = outcome.get("path")
    blob = outcome.get("blob")
    text = _normalise(outcome.get("excerpt") if outcome.get("excerpt") is not None else outcome.get("text"))
    if outcome.get("source") in {"commit", "commit_subject"} or (path is None and blob is None):
        if not _commit_exists(repo, commit):
            return False
        try:
            subject = _normalise(_git(repo, "show", "-s", "--format=%s", commit))
        except subprocess.CalledProcessError:
            return False
        return bool(text) and (text == subject or subject in text or text in subject)
    if not commit or not path or not blob:
        return False
    if not _commit_exists(repo, commit):
        return False
    try:
        blob_type = str(_git(repo, "cat-file", "-t", blob)).strip()
        content = _git(repo, "show", f"{commit}:{path}", text=False)
    except subprocess.CalledProcessError:
        return False
    if blob_type != "blob":
        return False
    lines = bytes(content).decode("utf-8", "replace").splitlines()
    try:
        start = int(outcome.get("line_start"))
        end = int(outcome.get("line_end"))
    except (TypeError, ValueError):
        return False
    if start < 1 or end < start or end > len(lines):
        return False
    if not text:
        return False
    return text in _normalise("\n".join(lines))


def _resolve_later_fix(repo: pathlib.Path, base: str, head: str, fix: dict[str, Any]) -> bool:
    if not _commit_exists(repo, fix.get("sha")):
        return False
    case_paths = set(_changed_paths(repo, base, head))
    cited = set(fix.get("paths") or [])
    return bool(cited & case_paths)


def compare_candidates(repo: pathlib.Path, profile: history_profile.HistoryProfile,
                       *, seed: int = 1, now: str | None = None, sample: int = 30) -> dict[str, Any]:
    """Read-only comparison of the two candidate extractors over one history.

    Returns aggregate counts, rates and tier labels only; never a diff, finding
    text, path list or case SHA. Caches per-commit facts so repeated base/head
    lookups are read once. ``now`` defaults to the latest committer time.
    """
    import history_extract_a
    import history_extract_b

    repo = pathlib.Path(repo).resolve()
    if now is None:
        base_refs = ["HEAD"]
        listing = _git(repo, "for-each-ref", "--format=%(refname)", "refs/remotes")
        base_refs.extend(sorted(line for line in listing.splitlines() if line))
        now = _now_reference(repo, base_refs)

    report: dict[str, Any] = {"now": now, "seed": seed, "sample": sample, "candidates": {}}
    for label, module in (("A", history_extract_a), ("B", history_extract_b)):
        metadata = module.extract(repo, profile, now=now)
        tiers = {tier: {"candidates": 0, "with_plan": 0, "with_outcome": 0,
                        "with_later_fixes": 0, "censored": 0, "projected_eligible": 0}
                 for tier in TIERS}
        exclusions: dict[str, int] = {}
        outcome_bearing: list[str] = []
        projected = 0
        for sha, meta in metadata.items():
            tier = meta.get("tier")
            if tier in tiers:
                bucket = tiers[tier]
                bucket["candidates"] += 1
                bucket["with_plan"] += bool(meta.get("plan"))
                bucket["with_outcome"] += bool(meta.get("outcomes"))
                bucket["with_later_fixes"] += bool(meta.get("later_fixes"))
                bucket["censored"] += bool(meta.get("censored"))
            if meta.get("outcomes"):
                outcome_bearing.append(sha)
            reason = _project_reason(repo, profile, sha, meta)
            if tier in tiers and reason == "eligible":
                tiers[tier]["projected_eligible"] += 1
                projected += 1
            else:
                exclusions[reason] = exclusions.get(reason, 0) + 1
        rng = random.Random(seed)
        chosen = sorted(outcome_bearing)
        rng.shuffle(chosen)
        chosen = chosen[:sample]
        outcomes_total = outcomes_resolved = cases_resolved = fixes_total = fixes_resolved = 0
        for sha in chosen:
            meta = metadata[sha]
            case_ok = True
            for outcome in meta.get("outcomes") or []:
                outcomes_total += 1
                if _resolve_outcome(repo, outcome):
                    outcomes_resolved += 1
                else:
                    case_ok = False
            if meta.get("base_sha"):
                for fix in meta.get("later_fixes") or []:
                    fixes_total += 1
                    if _resolve_later_fix(repo, meta["base_sha"], sha, fix):
                        fixes_resolved += 1
            cases_resolved += case_ok
        report["candidates"][label] = {
            "name": getattr(module, "NAME", label), "commits": len(metadata),
            "tiers": tiers, "with_outcome_total": len(outcome_bearing),
            "exclusions": dict(sorted(exclusions.items())), "projected_eligible": projected,
            "projected_shortfall_against_300": max(0, 300 - projected),
            "sampled_cases": len(chosen), "sampled_outcomes": outcomes_total,
            "outcome_resolution_rate": (outcomes_resolved / outcomes_total) if outcomes_total else None,
            "case_resolution_rate": (cases_resolved / len(chosen)) if chosen else None,
            "sampled_later_fixes": fixes_total,
            "later_fix_resolution_rate": (fixes_resolved / fixes_total) if fixes_total else None,
        }
    return report
