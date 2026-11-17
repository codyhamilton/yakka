"""Offline, immutable historical case manifests and comparator evidence."""
from __future__ import annotations

import hashlib
import json
import pathlib
import random
import subprocess
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[2]
CLIENT = ROOT / "plugins" / "yakka" / "client"
if str(CLIENT) not in sys.path:
    sys.path.insert(0, str(CLIENT))
import yakka  # noqa: E402


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


def _trailers(repo: pathlib.Path, sha: str) -> dict[str, str]:
    body = str(_git(repo, "show", "-s", "--format=%B", sha))
    result: dict[str, str] = {}
    for line in body.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            if key in {"Yakka-Plan", "Yakka-Phase", "Workflow-Plan", "Workflow-Phase", "Pull-Request", "PR"}:
                result[key] = value.strip()
    return result


def _plan_identity(trailers: dict[str, str]) -> str:
    plan = trailers.get("Yakka-Plan") or trailers.get("Workflow-Plan")
    if plan:
        return plan
    phase = trailers.get("Yakka-Phase") or trailers.get("Workflow-Phase") or ""
    return phase.rsplit(":", 1)[0] if ":" in phase else ""


def _phase_number(trailers: dict[str, str]) -> int | None:
    phase = trailers.get("Yakka-Phase") or trailers.get("Workflow-Phase") or ""
    value = phase.rsplit(":", 1)[-1]
    return int(value) if value.isdigit() else None


def _blob(repo: pathlib.Path, path: str, sha: str) -> tuple[str, str] | None:
    try:
        blob = str(_git(repo, "rev-parse", f"{sha}:{path}"))
        content = _git(repo, "show", f"{sha}:{path}", text=False)
        return blob, bytes(content).decode("utf-8", "replace")
    except subprocess.CalledProcessError:
        return None


def _changed_paths(repo: pathlib.Path, base: str, head: str) -> list[str]:
    raw = _git(repo, "diff", "--name-only", "-z", base, head, text=False)
    return [x.decode("utf-8", "replace") for x in bytes(raw).split(b"\0") if x]


def _case_stratum(trailers: dict[str, str]) -> str:
    if trailers.get("Yakka-Phase") or trailers.get("Workflow-Phase"):
        return "phase"
    if (trailers.get("Pull-Request") or trailers.get("PR") or trailers.get("Yakka-Plan")
            or trailers.get("Workflow-Plan")):
        return "pr"
    return "unaccompanied"


def _criteria(repo: pathlib.Path, head: str, plan: str) -> dict[str, Any]:
    if plan:
        path = f"{plan}/DESIGN.md" if plan.startswith("docs/plans/") else f"docs/plans/{plan}/DESIGN.md"
        found = _blob(repo, path, head)
        if found:
            blob, content = found
            return {"source": "head_blob", "path": path, "content_hash": blob, "text": content}
    return {"source": "unknown", "path": None, "content_hash": None, "text": None}


def _comparators(repo: pathlib.Path, head: str, plan: str, stratum: str) -> list[str]:
    if not plan:
        return []
    prefix = plan.rstrip("/") if plan.startswith("docs/plans/") else f"docs/plans/{plan}"
    paths = [f"{prefix}/REVIEW.md"]
    if stratum == "phase":
        paths.insert(0, f"{prefix}/IMPLEMENTATION.md")
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
        object_listing = str(run(repo, "rev-list", "--objects", "--missing=print", tip))
        if any(line.startswith(("?", "!")) for line in object_listing.splitlines()):
            raise HistoryPreparationError("repository has missing objects after fetching the remote")
        raw_count = str(run(repo, "rev-list", "--count", tip)).strip()
        if not raw_count.isdigit():
            raise HistoryPreparationError("verified commit count is missing")
        verified_count = int(raw_count)
        enumerated_commits = len([line for line in str(run(repo, "rev-list", tip)).splitlines() if line])
        if enumerated_commits != verified_count:
            raise HistoryPreparationError(
                f"verified count {verified_count} disagrees with enumeration {enumerated_commits}")
    except subprocess.CalledProcessError as exc:
        raise HistoryPreparationError(f"history preparation failed: {' '.join(exc.cmd)}") from exc
    return {"repository": identity, "remote": remote, "remote_url": remote_url, "tip_sha": tip,
            "fetched_refs": fetched_refs, "shallow": False, "object_complete": True,
            "enumerated_commits": enumerated_commits, "verified_count": verified_count}


def create_manifest(repo: pathlib.Path, output: pathlib.Path, seed: int = 1, target: int = 50,
                    comparator_path: pathlib.Path | None = None, pr_export_path: pathlib.Path | None = None,
                    remote: str = "origin", expected_repository: str = "codyhamilton/yakka",
                    run=None) -> dict[str, Any]:
    repo, output = repo.resolve(), output.resolve()
    if target < 1:
        raise ValueError("target must be a positive integer")
    if output.exists():
        raise ManifestFrozenError(f"manifest already exists; refusing to refresh: {output}")
    evidence = prepare_history(repo, remote=remote, expected_repository=expected_repository, run=run)
    git = run or _git
    revs = str(git(repo, "rev-list", "--reverse", "--parents", evidence["tip_sha"])).splitlines()
    if len(revs) != evidence["enumerated_commits"]:
        raise HistoryPreparationError(
            f"verified count {evidence['verified_count']} disagrees with manifest enumeration {len(revs)}")
    shallow = False
    boundaries: list[str] = []
    policy = json.loads((ROOT / "packages/yakka/internal/review/policy.json").read_text())
    candidates = []
    for row in revs:
        parts = row.split()
        head, parents = parts[0], parts[1:]
        trailers = _trailers(repo, head)
        stratum = _case_stratum(trailers)
        plan = _plan_identity(trailers)
        base = parents[0] if parents else None
        reason = "eligible"
        capture = None
        if not base:
            reason = "shallow_history_boundary" if head in boundaries else "no_base_commit"
        elif base in boundaries:
            reason = "shallow_history_boundary"
            base = None
        else:
            try:
                _git(repo, "cat-file", "-e", f"{base}^{{commit}}")
            except subprocess.CalledProcessError:
                reason = "shallow_history_boundary"
                base = None
            if not base:
                changed = []
            else:
                changed = _changed_paths(repo, parents[0], head)
            if not base:
                reason = "shallow_history_boundary"
            else:
                code_paths = [p for p in changed if pathlib.PurePosixPath(p).suffix.lower() in {".go", ".py", ".js", ".ts", ".tsx", ".jsx", ".rs", ".java", ".c", ".h", ".sh"}]
                if not code_paths:
                    reason = "no_code_change"
                else:
                    excluded = list(policy["change_exclude"])
                    prefix = plan.rstrip("/") if plan.startswith("docs/plans/") else f"docs/plans/{plan}" if plan else ""
                    if prefix:
                        excluded += [f"{prefix}/IMPLEMENTATION.md", f"{prefix}/REVIEW.md", f"{prefix}/QA.md"]
                    capture_policy = {"exclude": tuple(excluded), "max_file_bytes": policy["change_max_file_bytes"],
                                      "max_total_bytes": policy["change_max_total_bytes"], "max_files": policy["change_max_files"],
                                      "context_lines": policy["context_lines"], "truncation_order": tuple(policy["truncation_order"])}
                    try:
                        capture = yakka.CaptureChange(str(repo), mode="range", base=parents[0], head=head, policy=capture_policy)
                        base = capture["base"]
                        if not capture["diff"]:
                            reason = "empty_capture"
                    except yakka.CaptureError as exc:
                        reason = f"capture_{exc.code}"
        crit = _criteria(repo, head, plan)
        pointers = _comparators(repo, head, plan, stratum)
        eligible = reason == "eligible" and bool(capture and capture["diff"])
        if eligible and crit["source"] == "unknown":
            eligible, reason = False, "criteria_unavailable"
        if eligible and stratum in {"phase", "pr"} and not pointers:
            eligible, reason = False, "missing_comparator_source"
        candidates.append({"case_id": head, "eligible": eligible, "eligibility_reason": reason,
                           "stratum": stratum, "plan": plan or None, "phase": _phase_number(trailers),
                           "pr": trailers.get("Pull-Request") or trailers.get("PR"), "base_sha": base,
                           "head_sha": head, "capture": capture, "criteria": crit,
                           "build_models": {"source": "unknown", "models": []},
                           "comparator_pointers": pointers, "settings": {"kind": "range", "merge_base": False,
                           "review_profile": "historical_trial", "trial_id": "phase-6-frozen"}})
    eligible = [c for c in candidates if c["eligible"]]
    rng = random.Random(seed)
    order = [c["case_id"] for c in eligible]
    rng.shuffle(order)
    strata = {name: {"candidates": sum(c["stratum"] == name for c in candidates),
                     "eligible": sum(c["stratum"] == name and c["eligible"] for c in candidates)}
              for name in ("phase", "pr", "unaccompanied")}
    shortages = {effort: {"target": target, "eligible": len(eligible), "eligible_shortfall": max(0, target - len(eligible)),
                          "completed": 0, "completed_shortfall": target}
                 for effort in ("high", "xhigh", "max")}
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
                           "fetched_refs": evidence["fetched_refs"], "shallow": shallow,
                           "object_complete": evidence["object_complete"],
                           "enumerated_commits": len(revs), "verified_count": evidence["verified_count"],
                           "shallow_boundary_shas": boundaries,
                           "oldest_enumerated_sha": revs[0].split()[0] if revs else None},
               "seed": seed, "target_per_effort": target, "candidates": candidates, "cases": eligible,
               "strata": strata, "shortages": shortages, "run_order": order,
               "settings": {"shared_case_set": True, "non_effort": {"kind": "range", "review_profile": "historical_trial",
               "trial_id": "phase-6-frozen", "merge_base": False}, "efforts": ["high", "xhigh", "max"]},
               "comparators": comparators}
    frozen["manifest_sha256"] = _canonical_hash(frozen)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(frozen, indent=2, sort_keys=True) + "\n")
    return frozen
