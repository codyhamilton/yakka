"""Candidate extractor A: trailer- and commit-driven workflow history.

``extract(repo, profile, *, now)`` returns ``sha -> metadata`` for every commit
reachable from the profile's refs. Metadata keys are ``tier`` (``phase``,
``unit``, ``pr`` or ``None``), ``plan``, ``phase``, ``pr``, ``base_sha``,
``outcomes``, ``later_fixes``, ``censored`` and ``window_end``.

The primary signal is commit trailers and subjects: ``Workflow-Phase`` /
``Yakka-Phase`` locate phase closures, commits that add a
``docs/plans/<plan>/reports/*.md`` handoff become unit cases, and squash-merge
commits with a plan marker and a review record become PR cases. Preference is
``phase > unit > pr``; a commit is at most one case. ``now`` is injected and
never read from the wall clock, so a run is deterministic.
"""
from __future__ import annotations

import datetime
import pathlib
import re
import subprocess

import history_profile

NAME = "trailer-commit"

TIER_ORDER = ("phase", "unit", "pr")
_REVIEW_FIX = re.compile(r"blocking review findings|address review", re.I)
_SQUASH = re.compile(r"\(#\d+\)")
_PLAN_FILE = re.compile(r"^(docs/plans/[^/]+)/(?:DESIGN|REVIEW|IMPLEMENTATION)\.md$")
_PLAN_COLLAPSED = re.compile(r"^(docs/plans/[^/]+)\.md$")
_PLAN_REPORT = re.compile(r"^(docs/plans/[^/]+)/reports/[^/]+\.md$")
_PLAN_NUMBER = re.compile(r"^\s*plan[\s_-]*#?(\d+)(?:[\s:_-]+([A-Za-z0-9][A-Za-z0-9-]*))?", re.I)
_SLUG_NUMBER = re.compile(r"^(\d+)-(.+)$")
_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_TABLE_SEP = re.compile(r"^\s*\|[\s:|-]+\|\s*$")
_SEVERITY = re.compile(r"\b(critical|high|medium|low)\b", re.I)
_CLOSE_OUT = re.compile(r"close[\s_-]?out", re.I)
_BULLET = re.compile(r"^\s*[-*]\s+(.*)$")

_GIT_CACHE: dict[tuple, str | None] = {}
_SHOW_CACHE: dict[tuple, str | None] = {}
_HUNK_CACHE: dict[tuple, list[dict]] = {}


def _git(repo: pathlib.Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)
    return result.stdout.decode("utf-8", "replace")


def _try_git(repo: pathlib.Path, *args: str) -> str | None:
    key = (str(repo),) + args
    if key in _GIT_CACHE:
        return _GIT_CACHE[key]
    try:
        value = _git(repo, *args).strip()
    except subprocess.CalledProcessError:
        value = None
    _GIT_CACHE[key] = value
    return value


def _enumeration_refs(repo: pathlib.Path) -> list[str]:
    refs = ["HEAD"]
    listing = _try_git(repo, "for-each-ref", "--format=%(refname)", "refs/remotes") or ""
    refs.extend(sorted(line for line in listing.splitlines() if line))
    return refs


def _history(repo: pathlib.Path) -> list[dict]:
    """One git call: sha, parents, committer time, body and changed paths."""
    output = _git(repo, "log", "--format=%x1e%H%x1f%P%x1f%ct%x1f%B%x1f",
                  "--name-status", *_enumeration_refs(repo))
    commits: dict[str, dict] = {}
    order: list[str] = []
    for chunk in output.split("\x1e"):
        if not chunk.strip():
            continue
        fields = chunk.split("\x1f")
        if len(fields) < 5:
            continue
        sha, parents, stamp, body, changed = fields[0], fields[1], fields[2], fields[3], fields[4]
        if sha in commits:
            continue
        files = []
        for line in changed.splitlines():
            parts = line.strip().split("\t")
            if len(parts) >= 2 and parts[0]:
                files.append((parts[0], parts[-1]))
        subject = body.splitlines()[0].strip() if body.strip() else ""
        commits[sha] = {"sha": sha, "parents": parents.split(), "time": int(stamp or 0),
                        "body": body, "subject": subject, "files": files}
        order.append(sha)
    return [commits[sha] for sha in order]


def _deepest_slug(folder: str) -> str:
    base = pathlib.PurePosixPath(folder.rstrip("/")).name
    if base.endswith(".md"):
        base = base[:-3]
    match = _SLUG_NUMBER.match(base)
    return match.group(2) if match else base


def _plan_maps(commits: list[dict]) -> dict[str, dict[str, str]]:
    by_slug: dict[str, str] = {}
    by_number: dict[str, str] = {}
    for commit in commits:
        for _, path in commit["files"]:
            folder = None
            match = _PLAN_REPORT.match(path)
            if match:
                folder = match.group(1)
            else:
                match = _PLAN_FILE.match(path) or _PLAN_COLLAPSED.match(path)
                if match:
                    folder = match.group(1)
            if not folder:
                continue
            slug = _deepest_slug(folder)
            by_slug.setdefault(slug, folder)
            number = _SLUG_NUMBER.match(slug)
            if number:
                by_number.setdefault(number.group(1), folder)
            elif slug.isdigit():
                by_number.setdefault(slug, folder)
    return {"by_slug": by_slug, "by_number": by_number}


def _resolve_plan(value: str | None, maps: dict[str, dict[str, str]]) -> str | None:
    if not value:
        return None
    value = value.strip().rstrip("/")
    if not value:
        return None
    if value.startswith("docs/plans/"):
        return value[:-3] if value.endswith(".md") else value
    base = pathlib.PurePosixPath(value).name
    if base.endswith(".md"):
        base = base[:-3]
    if base in maps["by_slug"]:
        return maps["by_slug"][base]
    if base.isdigit() and base in maps["by_number"]:
        return maps["by_number"][base]
    number = _SLUG_NUMBER.match(base)
    if number and number.group(1) in maps["by_number"]:
        return maps["by_number"][number.group(1)]
    return base


def _plan_keys(plan: str | None) -> set[str]:
    if not plan:
        return set()
    value = plan.rstrip("/")
    base = pathlib.PurePosixPath(value).name
    if base.endswith(".md"):
        base = base[:-3]
    keys = {value, base}
    number = _SLUG_NUMBER.match(base)
    if number:
        keys.update({number.group(1), number.group(2)})
    return keys


def _subject_keys(subject: str) -> set[str]:
    keys: set[str] = set()
    for match in _PLAN_NUMBER.finditer(subject):
        keys.add(match.group(1))
        if match.group(2):
            keys.add(match.group(2).strip("-"))
    return keys


def _trailers(body: str, profile: history_profile.HistoryProfile) -> dict[str, str]:
    keys = (set(profile.plan_trailers) | set(profile.phase_trailers)
            | set(profile.pr_markers) | set(profile.close_out_markers))
    found: dict[str, str] = {}
    for line in body.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            if key.strip() in keys and value.strip():
                found[key.strip()] = value.strip()
    return found


def _first(values: dict[str, str], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        if values.get(key):
            return values[key]
    return None


def _plan_from_trailers(trailers: dict[str, str], profile: history_profile.HistoryProfile) -> str | None:
    direct = _first(trailers, profile.plan_trailers)
    if direct:
        return direct
    phase = _first(trailers, profile.phase_trailers)
    if phase and ":" in phase:
        return phase.rsplit(":", 1)[0]
    return None


def _canonical(plan: str | None, extra: str | None = None) -> str | None:
    for value in (plan, extra):
        if value:
            return _deepest_slug(value)
    return None


def _blob(repo: pathlib.Path, sha: str, path: str) -> str | None:
    return _try_git(repo, "rev-parse", f"{sha}:{path}")


def _show(repo: pathlib.Path, sha: str, path: str) -> str | None:
    key = (str(repo), sha, path)
    if key not in _SHOW_CACHE:
        try:
            _SHOW_CACHE[key] = _git(repo, "show", f"{sha}:{path}")
        except subprocess.CalledProcessError:
            _SHOW_CACHE[key] = None
    return _SHOW_CACHE[key]


def _to_epoch(value) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return 0.0
    if text.isdigit():
        return float(text)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    return datetime.datetime.fromisoformat(text).timestamp()


def _outcome(kind, source, path, commit, blob, start, end, severity, excerpt):
    return {"kind": kind, "source": source, "path": path, "commit": commit,
            "blob": blob, "line_start": start, "line_end": end,
            "severity": severity, "excerpt": excerpt}


def _parse_review(repo, sha, path) -> list[dict]:
    text = _show(repo, sha, path)
    if text is None:
        return []
    blob = _blob(repo, sha, path)
    lines = text.splitlines()
    outcomes: list[dict] = []
    for index, line in enumerate(lines):
        match = re.search(r"verdict[^:\n]*:\s*(.+)", line, re.I)
        if match and "**" in line:
            excerpt = match.group(1).strip().strip("`*_ ")
            if excerpt:
                outcomes.append(_outcome("review_verdict", "REVIEW.md", path, sha, blob,
                                         index + 1, index + 1, None, excerpt))
            break
    findings: list[dict] = []
    in_findings = False
    severity = None
    index = 0
    while index < len(lines):
        line = lines[index]
        heading = _HEADING.match(line)
        if heading:
            level, title = len(heading.group(1)), heading.group(2)
            if level <= 2:
                in_findings = "finding" in title.lower()
                severity = None
            found = _SEVERITY.search(title)
            if found:
                severity = found.group(1).capitalize()
            index += 1
            continue
        if not in_findings:
            index += 1
            continue
        if line.strip().startswith("|"):
            start = index
            rows = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                rows.append((index, lines[index]))
                index += 1
            data = 2 if len(rows) >= 2 and _TABLE_SEP.match(rows[1][1]) else 0
            for row_index, row in rows[data:]:
                if _TABLE_SEP.match(row):
                    continue
                cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
                row_severity = severity
                if cells and _SEVERITY.search(cells[0]) and len(cells[0]) <= 12:
                    row_severity = _SEVERITY.search(cells[0]).group(1).capitalize()
                findings.append(_outcome("review_finding", "REVIEW.md", path, sha, blob,
                                         row_index + 1, row_index + 1, row_severity, row.strip()))
            continue
        if line.strip():
            start = index
            block = []
            while (index < len(lines) and lines[index].strip()
                   and not lines[index].lstrip().startswith(("#", "|"))):
                block.append(lines[index])
                index += 1
            excerpt = " ".join(part.strip() for part in block).strip()
            if excerpt and not excerpt.startswith("→") and not re.match(r"^\[.*\]\(.*\)$", excerpt):
                findings.append(_outcome("review_finding", "REVIEW.md", path, sha, blob,
                                         start + 1, index, severity, excerpt))
            continue
        index += 1
    outcomes.extend(findings)
    return outcomes


def _parse_implementation(repo, sha, path) -> list[dict]:
    text = _show(repo, sha, path)
    if text is None:
        return []
    blob = _blob(repo, sha, path)
    lines = text.splitlines()
    outcomes: list[dict] = []
    section = ""
    for index, line in enumerate(lines):
        heading = _HEADING.match(line)
        if heading:
            section = heading.group(2).lower()
            continue
        interesting = any(word in section for word in
                          ("verification", "concern", "carried", "residual", "validation", "contradiction"))
        if not interesting:
            continue
        bullet = _BULLET.match(line)
        if bullet:
            excerpt = bullet.group(1).strip()
            if excerpt:
                outcomes.append(_outcome("implementation_note", "IMPLEMENTATION.md", path,
                                         sha, blob, index + 1, index + 1, None, excerpt))
            continue
        labelled = re.match(r"^\s*\*{0,2}(Validation|Concerns?|Carried|Residual)\*{0,2}:\s*(.+)",
                            line, re.I)
        if labelled:
            outcomes.append(_outcome("implementation_note", "IMPLEMENTATION.md", path,
                                     sha, blob, index + 1, index + 1, None, labelled.group(2).strip()))
    return outcomes


def _hunks(repo, sha: str, paths: list[str]) -> list[dict]:
    key = (str(repo), sha, tuple(paths))
    if key in _HUNK_CACHE:
        return _HUNK_CACHE[key]
    arguments = ["diff", "--unified=0", "--no-color", "--no-ext-diff", f"{sha}^", sha, "--", *paths]
    try:
        output = _git(repo, *arguments)
    except subprocess.CalledProcessError:
        output = ""
    hunks: list[dict] = []
    current = None
    for line in output.splitlines():
        if line.startswith("+++ b/"):
            current = line[6:]
        elif line.startswith("@@"):
            match = re.search(r"\+(\d+)(?:,(\d+))?", line)
            if match and current:
                start = int(match.group(1))
                count = int(match.group(2) or 1)
                hunks.append({"path": current, "start": start,
                              "end": start + max(count, 1) - 1})
    _HUNK_CACHE[key] = hunks
    return hunks


def _diff_paths(repo, base: str, head: str) -> set[str]:
    result = _try_git(repo, "diff", "--name-only", base, head) or ""
    return {line for line in result.splitlines() if line}


def _close_out_time(commits, case_commit, case_keys, profile, canonical) -> int | None:
    horizon = case_commit["time"] + profile.later_fix_window_days * 86400
    best = None
    for commit in commits:
        if commit["time"] <= case_commit["time"]:
            continue
        if best is not None and commit["time"] >= best:
            continue
        trailers = _trailers(commit["body"], profile)
        marked = bool(_first(trailers, profile.close_out_markers))
        if not marked and not _CLOSE_OUT.search(commit["subject"]):
            continue
        keys = _plan_keys(_plan_from_trailers(trailers, profile)) | _subject_keys(commit["subject"])
        if keys & case_keys or (canonical and _deepest_slug(canonical) in keys):
            best = commit["time"]
    if best is None:
        best = horizon
    return min(best, horizon)


def _case_plan_parts(commit, profile, maps):
    trailers = _trailers(commit["body"], profile)
    raw = _plan_from_trailers(trailers, profile)
    resolved = _resolve_plan(raw, maps)
    keys = _plan_keys(resolved) | _plan_keys(raw) | _subject_keys(commit["subject"])
    inferred = None
    if not resolved:
        for key in sorted(keys):
            inferred = _resolve_plan(key, maps)
            if inferred:
                break
        resolved = inferred
    return trailers, resolved, keys


def extract(repo, profile, *, now) -> dict[str, dict]:
    repo = pathlib.Path(repo)
    commits = _history(repo)
    maps = _plan_maps(commits)
    tip = max((commit["time"] for commit in commits), default=0)
    now_epoch = _to_epoch(tip if now is None else now)

    plan_of: dict[str, str | None] = {}
    commit_keys: dict[str, set[str]] = {}
    commit_trailers: dict[str, dict[str, str]] = {}
    for commit in commits:
        trailers, plan, keys = _case_plan_parts(commit, profile, maps)
        plan_of[commit["sha"]] = _canonical(plan) if plan else None
        commit_keys[commit["sha"]] = keys
        commit_trailers[commit["sha"]] = trailers

    by_sha = {commit["sha"]: commit for commit in commits}
    phase_heads: dict[str, dict] = {}
    groups: dict[tuple[str, int], list[dict]] = {}
    for commit in commits:
        phase_value = _first(commit_trailers[commit["sha"]], profile.phase_trailers)
        if not phase_value or ":" not in phase_value:
            continue
        raw_plan, raw_phase = phase_value.rsplit(":", 1)
        if not raw_phase.isdigit():
            continue
        canonical = _canonical(_resolve_plan(raw_plan, maps), raw_plan)
        if not canonical:
            continue
        groups.setdefault((canonical, int(raw_phase)), []).append(commit)

    assigned: dict[str, str] = {}
    for (canonical, number), members in sorted(groups.items(), key=lambda item: (item[0][0], item[0][1])):
        head = max(members, key=lambda commit: (commit["time"], commit["sha"]))
        previous = [other for (plan_name, phase), heads in groups.items()
                    if plan_name == canonical and phase < number
                    for other in [max(heads, key=lambda c: (c["time"], c["sha"]))]]
        if previous:
            base = max(previous, key=lambda commit: commit["time"])["sha"]
        else:
            earlier = [commit for commit in commits
                       if plan_of[commit["sha"]] == canonical and commit["time"] < head["time"]]
            if earlier:
                base = min(earlier, key=lambda commit: (commit["time"], commit["sha"]))["sha"]
            else:
                base = head["parents"][0] if head["parents"] else None
        if base == head["sha"] and head["parents"]:
            base = head["parents"][0]
        phase_heads[head["sha"]] = {"plan": _resolve_plan(canonical, maps) or canonical,
                                    "phase": number, "base_sha": base,
                                    "canonical": canonical, "keys": commit_keys[head["sha"]]}
        assigned[head["sha"]] = "phase"

    unit_heads: dict[str, dict] = {}
    for commit in commits:
        if commit["sha"] in assigned:
            continue
        reports = [path for status, path in commit["files"]
                   if status.startswith("A") and _PLAN_REPORT.match(path)]
        if not reports:
            continue
        folder = _PLAN_REPORT.match(sorted(reports)[0]).group(1)
        plan = _resolve_plan(folder, maps) or folder
        trailer_plan = _plan_from_trailers(commit_trailers[commit["sha"]], profile)
        if trailer_plan:
            plan = _resolve_plan(trailer_plan, maps) or plan
        base = commit["parents"][0] if commit["parents"] else None
        unit_heads[commit["sha"]] = {"plan": plan, "phase": None, "base_sha": base,
                                     "canonical": _canonical(plan), "keys": commit_keys[commit["sha"]]}
        assigned[commit["sha"]] = "unit"

    pr_heads: dict[str, dict] = {}
    for commit in commits:
        if commit["sha"] in assigned:
            continue
        trailers = commit_trailers[commit["sha"]]
        pr_value = _first(trailers, profile.pr_markers)
        plan = _resolve_plan(_plan_from_trailers(trailers, profile), maps)
        if not plan:
            for key in sorted(commit_keys[commit["sha"]]):
                plan = _resolve_plan(key, maps)
                if plan and plan.startswith("docs/plans/"):
                    break
            else:
                plan = None
        if not plan:
            continue
        if not (pr_value or _SQUASH.search(commit["subject"])):
            continue
        review_path = profile.record_paths(plan).get("review")
        if not review_path or _blob(repo, commit["sha"], review_path) is None:
            continue
        base = commit["parents"][0] if commit["parents"] else None
        pr_heads[commit["sha"]] = {"plan": plan, "phase": None, "base_sha": base,
                                   "pr": pr_value or _SQUASH.search(commit["subject"]).group(0)[2:-1],
                                   "canonical": _canonical(plan), "keys": commit_keys[commit["sha"]]}
        assigned[commit["sha"]] = "pr"

    cases: dict[str, dict] = {}
    cases.update({sha: dict(info, tier="phase") for sha, info in phase_heads.items()})
    cases.update({sha: dict(info, tier="unit") for sha, info in unit_heads.items()})
    cases.update({sha: dict(info, tier="pr") for sha, info in pr_heads.items()})

    metadata: dict[str, dict] = {}
    for commit in commits:
        sha = commit["sha"]
        trailers = commit_trailers[sha]
        phase_value = _first(trailers, profile.phase_trailers)
        phase = None
        if phase_value and ":" in phase_value:
            value = phase_value.rsplit(":", 1)[1]
            phase = int(value) if value.isdigit() else None
        pr_value = _first(trailers, profile.pr_markers)
        case = cases.get(sha)
        base = case["base_sha"] if case else (commit["parents"][0] if commit["parents"] else None)
        metadata[sha] = {"tier": case["tier"] if case else None,
                         "plan": case["plan"] if case else _resolve_plan(
                             _plan_from_trailers(trailers, profile), maps),
                         "phase": case.get("phase") if case else phase,
                         "pr": case.get("pr") if case else pr_value,
                         "base_sha": base, "outcomes": [], "later_fixes": [],
                         "censored": False, "window_end": None}

    review_cache: dict[tuple[str, str], tuple[str, str] | None] = {}

    def _record_at(head: str, deadline: int, path: str) -> tuple[str, str] | None:
        key = (head, path)
        if key in review_cache:
            return review_cache[key]
        found = None
        if _blob(repo, head, path) is not None:
            found = (head, _blob(repo, head, path))
        else:
            for commit in commits:
                if commit["time"] <= by_sha[head]["time"] or commit["time"] > deadline:
                    continue
                blob = _blob(repo, commit["sha"], path)
                if blob is not None:
                    found = (commit["sha"], blob)
                    break
        review_cache[key] = found
        return found

    for sha, case in sorted(cases.items(), key=lambda item: (by_sha[item[0]]["time"], item[0])):
        commit = by_sha[sha]
        paths = profile.record_paths(case["plan"])
        window_end = _close_out_time(commits, commit, case["keys"], profile, case["canonical"])
        censored = window_end is not None and window_end > now_epoch
        outcomes: list[dict] = []
        review_path = paths.get("review")
        if review_path:
            record = _record_at(sha, window_end or commit["time"], review_path)
            if record:
                outcomes.extend(_parse_review(repo, record[0], review_path))
        implementation_path = paths.get("implementation")
        if implementation_path:
            record = _record_at(sha, window_end or commit["time"], implementation_path)
            if record:
                outcomes.extend(_parse_implementation(repo, record[0], implementation_path))
        if case["base_sha"]:
            base_time = by_sha.get(case["base_sha"], {}).get("time", 0)
        else:
            base_time = 0
        for other in commits:
            if not _REVIEW_FIX.search(other["subject"]):
                continue
            if not (base_time <= other["time"] <= (window_end or commit["time"])):
                continue
            if not (commit_keys[other["sha"]] & case["keys"]):
                continue
            outcomes.append(_outcome("fix_commit", "commit_subject", None, other["sha"], None,
                                     1, 1, None, other["subject"]))
        case_diff = _diff_paths(repo, case["base_sha"], sha) if case["base_sha"] else set()
        later: list[dict] = []
        for other in commits:
            if not (commit["time"] < other["time"] <= (window_end or commit["time"])):
                continue
            if not (commit_keys[other["sha"]] & case["keys"]):
                continue
            touched = {path for _, path in other["files"]}
            intersecting = sorted(touched & case_diff)
            if not intersecting:
                continue
            later.append({"sha": other["sha"], "subject": other["subject"],
                          "paths": intersecting,
                          "hunks": _hunks(repo, other["sha"], intersecting)})
        later.sort(key=lambda item: (by_sha[item["sha"]]["time"], item["sha"]))
        outcomes.sort(key=lambda item: (item["line_start"], item["kind"], item["path"] or "",
                                        item["commit"] or ""))
        metadata[sha]["outcomes"] = outcomes
        metadata[sha]["later_fixes"] = later
        metadata[sha]["censored"] = censored
        metadata[sha]["window_end"] = (datetime.datetime.fromtimestamp(
            window_end, datetime.timezone.utc).isoformat().replace("+00:00", "Z")
            if window_end is not None else None)
    return metadata


def scan(repo, profile, *, now) -> dict:
    """Read-only aggregate counts; no excerpts, paths or SHAs are returned."""
    metadata = extract(repo, profile, now=now)
    tiers = {tier: {"candidates": 0, "with_plan": 0, "with_outcome": 0,
                    "with_later_fixes": 0, "censored": 0} for tier in TIER_ORDER}
    exclusions: dict[str, int] = {}
    for meta in metadata.values():
        tier = meta.get("tier")
        if tier in tiers:
            bucket = tiers[tier]
            bucket["candidates"] += 1
            bucket["with_plan"] += bool(meta.get("plan"))
            bucket["with_outcome"] += bool(meta.get("outcomes"))
            bucket["with_later_fixes"] += bool(meta.get("later_fixes"))
            bucket["censored"] += bool(meta.get("censored"))
        if tier not in TIER_ORDER:
            reason = "no_tier"
        elif not meta.get("base_sha"):
            reason = "no_base_commit"
        elif not meta.get("outcomes"):
            reason = "no_recorded_outcome"
        else:
            continue
        exclusions[reason] = exclusions.get(reason, 0) + 1
    return {"tiers": tiers, "exclusions": dict(sorted(exclusions.items())),
            "commits": len(metadata)}
