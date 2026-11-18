"""Document- and report-driven candidate extractor for workflow history.

The plan folder is the primary locator: phase closes are read from
``IMPLEMENTATION.md`` phase sections, units from added handoff reports under
``reports/``, and PR cases from a squash commit whose plan review record exists
at that commit. Commit trailers confirm plan identity and phase number but are
not the locator. ``extract`` returns verbatim excerpts in memory only; nothing
here writes a manifest.

``now`` is injected (epoch seconds, numeric string or ISO-8601). ``None`` means
the tip commit's committer time, never the wall clock.
"""
from __future__ import annotations

import datetime
import pathlib
import re
import subprocess

NAME = "document-report"

_TIER_ORDER = ("phase", "unit", "pr")
_SEVERITY = re.compile(r"(?i)\b(critical|blocking|high|medium|low|major|minor|nit)\b")
_PHASE_HEADING = re.compile(r"^(#{1,4})\s*Phase\s+(\d+)\b", re.I)
_COMPLETE = re.compile(r"(?i)\b(complete|completed|done|closed|shipped)\b|✅")
_FINDING_SECTION = re.compile(
    r"^#{1,6}\s*(Findings|Concerns|Carried|Residual|Contradictions|Verification)\b", re.I)
_REVIEW_FINDINGS = re.compile(r"^#{1,6}\s*Findings\b", re.I)
_PR_MARKER = re.compile(r"\(#\d+\)\s*$")
_COMMIT_FINDING = re.compile(r"(?i)(blocking review findings|address(?:ing)? review)")
_CLOSE_OUT = re.compile(r"(?i)close[ -]?out")
_PLAN_NUMBER = re.compile(
    r"(?i)\bplan[\s_-]*#?(\d+)(?:[\s:_-]+([A-Za-z0-9][A-Za-z0-9-]*))?")
_BULLET = re.compile(r"^[-*]\s+(\S.*)")
_BOLD_LEAD = re.compile(r"^\*\*[^*]+\*\*")
_COMMIT_SHA = re.compile(r"`([0-9a-f]{7,40})`")
_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def _git(repo: pathlib.Path, *args: str, data: bytes | None = None) -> bytes:
    result = subprocess.run(["git", "-C", str(repo), *args], input=data, check=True, capture_output=True)
    return result.stdout


def _text(repo: pathlib.Path, *args: str) -> str:
    return _git(repo, *args).decode("utf-8", "replace").strip()


def _enumeration_refs(repo: pathlib.Path) -> list[str]:
    refs = ["HEAD"]
    try:
        listing = _text(repo, "for-each-ref", "--format=%(refname)", "refs/remotes")
    except subprocess.CalledProcessError:
        listing = ""
    refs.extend(sorted(line for line in listing.splitlines() if line))
    return refs


def _read_commits(repo: pathlib.Path, shas: list[str]) -> dict[str, dict]:
    """Read commit headers and bodies in one ``cat-file --batch`` process."""
    raw = _git(repo, "cat-file", "--batch", data=("\n".join(shas) + "\n").encode())
    commits: dict[str, dict] = {}
    position = 0
    while position < len(raw):
        newline = raw.index(b"\n", position)
        header = raw[position:newline].decode("utf-8", "replace")
        position = newline + 1
        parts = header.split()
        if len(parts) < 3 or parts[1] != "commit":
            continue
        size = int(parts[2])
        body = raw[position:position + size].decode("utf-8", "replace")
        position += size + 1
        sha = parts[0]
        head, _, message = body.partition("\n\n")
        parents: list[str] = []
        stamp = 0
        for line in head.splitlines():
            if line.startswith("parent "):
                parents.append(line.split()[1])
            elif line.startswith("committer "):
                fields = line.rsplit(" ", 2)
                if len(fields) == 3 and fields[1].isdigit():
                    stamp = int(fields[1])
        subject = message.splitlines()[0] if message else ""
        commits[sha] = {"parents": parents, "ts": stamp, "subject": subject, "body": message}
    return commits


def _read_changes(repo: pathlib.Path, shas: list[str]) -> dict[str, list[tuple[str, str]]]:
    """Read per-commit name-status in one ``diff-tree --stdin`` process."""
    raw = _git(repo, "diff-tree", "--stdin", "-r", "--root", "--name-status",
               data=("\n".join(shas) + "\n").encode()).decode("utf-8", "replace")
    changes: dict[str, list[tuple[str, str]]] = {}
    current: str | None = None
    for line in raw.splitlines():
        if re.fullmatch(r"[0-9a-f]{40}", line):
            current = line
            changes.setdefault(current, [])
            continue
        if current and "\t" in line:
            status, path = line.split("\t", 1)
            changes[current].append((status[0], path))
    return changes


def _blob(repo: pathlib.Path, sha: str, path: str) -> tuple[str, str] | None:
    try:
        blob = _text(repo, "rev-parse", f"{sha}:{path}")
        content = _git(repo, "show", f"{sha}:{path}").decode("utf-8", "replace")
        return blob, content
    except subprocess.CalledProcessError:
        return None


def _exists(repo: pathlib.Path, sha: str, path: str) -> bool:
    try:
        _text(repo, "cat-file", "-e", f"{sha}:{path}")
        return True
    except subprocess.CalledProcessError:
        return False


def _trailers(body: str, profile) -> dict[str, str]:
    keys = (set(profile.plan_trailers) | set(profile.phase_trailers)
            | set(profile.pr_markers) | set(profile.close_out_markers))
    found: dict[str, str] = {}
    for line in body.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            if key in keys and value.strip():
                found[key] = value.strip()
    return found


def _first(mapping: dict[str, str], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        if mapping.get(key):
            return mapping[key]
    return None


def _plan_from_paths(paths: list[str], profile) -> str | None:
    root = profile.plans_root.rstrip("/")
    for path in paths:
        pure = pathlib.PurePosixPath(path)
        parts = pure.parts
        if len(parts) >= 3 and "/".join(parts[:2]) == root:
            if parts[2].endswith(".md"):
                return "/".join(parts[:3])
            return "/".join(parts[:3])
    return None


def _plan_slug(plan: str | None) -> tuple[str | None, str | None]:
    if not plan:
        return None, None
    name = pathlib.PurePosixPath(plan).name
    if name.endswith(".md"):
        name = name[:-3]
    match = re.match(r"^(\d+)-(.+)$", name)
    return (match.group(1), match.group(2)) if match else (None, name)


def _plan_keys(plan: str | None) -> set[str]:
    if not plan:
        return set()
    value = plan.rstrip("/")
    name = pathlib.PurePosixPath(value).name
    if name.endswith(".md"):
        name = name[:-3]
    keys = {value, name}
    number, slug = _plan_slug(plan)
    if number:
        keys.update({number, slug})
    return keys


def _subject_keys(subject: str) -> set[str]:
    keys: set[str] = set()
    for match in _PLAN_NUMBER.finditer(subject):
        keys.add(match.group(1))
        if match.group(2):
            keys.add(match.group(2).strip("-"))
    for match in re.finditer(r"\b(\d{1,3}-[a-z0-9][a-z0-9-]+)", subject, re.I):
        keys.add(match.group(1))
    return keys


def _parse_now(now, default_ts: int) -> int:
    if now is None:
        return default_ts
    if isinstance(now, (int, float)):
        return int(now)
    value = str(now).strip()
    if value.isdigit():
        return int(value)
    try:
        return int(datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return default_ts


def _lines(text: str) -> list[str]:
    return text.splitlines()


def _finding_outcomes(text: str, *, source: str, path: str, commit: str, blob: str) -> list[dict]:
    """Extract findings/verdicts from a markdown record, skipping fenced code."""
    lines = _lines(text)
    outcomes: list[dict] = []
    in_fence = False
    section = False
    section_level = 0
    severity: str | None = None
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        heading = re.match(r"^(#{1,6})\s*(.*)$", line)
        if heading:
            level = len(heading.group(1))
            title = heading.group(2)
            if section and level <= section_level:
                section, section_level, severity = False, 0, None
            if _REVIEW_FINDINGS.match(line) or _FINDING_SECTION.match(line):
                section, section_level = True, level
                severity = None
                continue
            if section:
                found = _SEVERITY.search(title)
                severity = found.group(1).lower() if found else None
                if level >= section_level and _BOLD_LEAD.search(title):
                    outcomes.append(_outcome(source, path, commit, blob, index + 1, index + 1,
                                             severity, stripped))
                continue
        if not section:
            continue
        bullet = _BULLET.match(line)
        if bullet:
            start, end = _extend(lines, index)
            body = "\n".join(part.strip() for part in lines[start:end + 1])
            found = _SEVERITY.search(body) or (_SEVERITY.search(severity or "") if severity else None)
            outcomes.append(_outcome(source, path, commit, blob, start + 1, end + 1,
                                     found.group(1).lower() if found else severity, body))
        elif _BOLD_LEAD.match(stripped):
            outcomes.append(_outcome(source, path, commit, blob, index + 1, index + 1,
                                     severity, stripped))
    return outcomes


def _extend(lines: list[str], start: int) -> tuple[int, int]:
    end = start
    while end + 1 < len(lines):
        nxt = lines[end + 1]
        if not nxt.strip() or nxt.lstrip().startswith(("#", "- ", "* ")):
            break
        end += 1
    return start, end


def _outcome(source, path, commit, blob, start, end, severity, text) -> dict:
    return {"source": source, "path": path, "commit": commit, "blob": blob,
            "line_start": start, "line_end": end, "severity": severity,
            "text": text.strip()}


def _verdict_outcome(text: str, *, path: str, commit: str, blob: str) -> list[dict]:
    for index, line in enumerate(_lines(text)):
        if "verdict" not in line.lower():
            continue
        match = re.search(r"`([^`]+)`", line) or re.search(r"(?i)verdict[:\s|*]+([A-Za-z_ -]+)", line)
        if match:
            value = match.group(1).strip().strip("*| ")
            if value:
                return [_outcome("review_verdict", path, commit, blob, index + 1, index + 1,
                                 None, line.strip())]
    return []


def _implementation_outcomes(text: str, *, path: str, commit: str, blob: str) -> list[dict]:
    outcomes: list[dict] = []
    for index, line in enumerate(_lines(text)):
        stripped = line.strip()
        bullet = _BULLET.match(line)
        carried = stripped.lower().startswith("carried:")
        status = _COMPLETE.search(stripped)
        if bullet or carried or status:
            found = _SEVERITY.search(stripped)
            outcomes.append(_outcome("implementation", path, commit, blob, index + 1, index + 1,
                                     found.group(1).lower() if found else None, stripped))
    return outcomes


def _commit_outcomes(commits: dict[str, dict], shas: list[str]) -> list[dict]:
    outcomes = []
    for sha in shas:
        meta = commits.get(sha)
        if meta and _COMMIT_FINDING.search(meta["subject"]):
            outcomes.append({"source": "commit", "path": None, "commit": sha, "blob": None,
                             "line_start": None, "line_end": None, "severity": None,
                             "text": meta["subject"]})
    return outcomes


def _phase_sections(text: str) -> dict[int, bool]:
    """Phase number -> whether its IMPLEMENTATION section records completion.

    A phase closes when a ``Phase N`` heading marks it done, or when the
    section under that heading carries a completion status line. Prose and
    bullets are ignored so a stray "complete" elsewhere does not close a phase.
    """
    result: dict[int, bool] = {}
    current: int | None = None
    level = 0
    in_fence = False
    for line in _lines(text):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            heading_level = len(heading.group(1))
            title = heading.group(2)
            match = _PHASE_HEADING.match(line)
            if match:
                current = int(match.group(2))
                level = heading_level
                result.setdefault(current, False)
                if _COMPLETE.search(title):
                    result[current] = True
                continue
            if current is not None and heading_level <= level:
                current = None
            continue
        if current is not None and re.match(r"^\*?\*?status", stripped, re.I):
            if _COMPLETE.search(stripped):
                result[current] = True
    return result


def _diff_paths(repo: pathlib.Path, base: str, head: str) -> list[str]:
    raw = _git(repo, "diff", "--name-only", "-z", base, head)
    return [item.decode("utf-8", "replace") for item in raw.split(b"\0") if item]


def _hunks(repo: pathlib.Path, parent: str | None, sha: str, path: str) -> list[list[int]]:
    args = ["show", "--format=", "-U0", "--no-color", sha] if not parent else [
        "diff", "-U0", "--no-color", parent, sha]
    try:
        raw = _text(repo, *args, "--", path)
    except subprocess.CalledProcessError:
        return []
    ranges = []
    for line in raw.splitlines():
        match = _HUNK.match(line)
        if match:
            start = int(match.group(1))
            count = int(match.group(2)) if match.group(2) is not None else 1
            if count:
                ranges.append([start, start + count - 1])
    return ranges


class _Extraction:
    def __init__(self, repo: pathlib.Path, profile, now):
        self.repo = pathlib.Path(repo)
        self.profile = profile
        self.shas = _text(self.repo, "rev-list", "--parents", "--topo-order", "--reverse",
                          *_enumeration_refs(self.repo)).splitlines()
        self.order: list[str] = []
        self.parents: dict[str, list[str]] = {}
        for row in self.shas:
            parts = row.split()
            self.order.append(parts[0])
            self.parents[parts[0]] = parts[1:]
        self.commits = _read_commits(self.repo, self.order)
        self.changes = _read_changes(self.repo, self.order)
        self.documents: dict[tuple[str, str], tuple[str, str] | None] = {}
        self._index()
        tip_sha = _text(self.repo, "rev-parse", "HEAD")
        tip = self.commits.get(tip_sha, {})
        tip_ts = tip.get("ts") or (self.commits[self.order[-1]]["ts"] if self.order else 0)
        self.now = _parse_now(now, tip_ts)

    def document(self, sha: str, path: str):
        key = (sha, path)
        if key not in self.documents:
            self.documents[key] = _blob(self.repo, sha, path)
        return self.documents[key]

    def plan_of(self, sha: str) -> str | None:
        trailers = _trailers(self.commits[sha]["body"], self.profile)
        plan = _first(trailers, self.profile.plan_trailers)
        if not plan:
            phase = _first(trailers, self.profile.phase_trailers)
            if phase:
                plan = phase.rsplit(":", 1)[0] if ":" in phase else phase
        if not plan:
            plan = _plan_from_paths([path for _, path in self.changes.get(sha, [])], self.profile)
        return plan

    def _record(self, sha: str, key: str, plan: str | None = None) -> tuple[str | None, str | None]:
        plan = plan or self.plan.get(sha)
        if not plan:
            return None, None
        path = self.profile.record_paths(plan).get(key)
        if not path:
            return None, None
        found = self.document(sha, path)
        return (path, found[1]) if found else (None, None)

    def _index(self) -> None:
        self.plan: dict[str, str | None] = {}
        self.phase_heads: dict[tuple[str, int], str] = {}
        self.first_impl: dict[str, str] = {}
        self.closeout_events: list[tuple[int, str, set[str]]] = []
        self.unit_reports: dict[str, tuple[str, str]] = {}
        self.pr_heads: dict[str, str] = {}
        for sha in self.order:
            plan = self.plan_of(sha)
            self.plan[sha] = plan
            self._index_closeout(sha)
            if not plan:
                continue
            records = self.profile.record_paths(plan)
            for status, path in self.changes.get(sha, []):
                if path == records.get("implementation") and status == "A":
                    self.first_impl.setdefault(plan, sha)
                if records.get("implementation") == path and status != "D":
                    self._index_phase(sha, plan)
                reports = records.get("reports")
                if reports and status == "A" and path.startswith(reports + "/") and path.endswith(".md"):
                    self.unit_reports.setdefault(sha, (plan, path))
            self._index_pr(sha, plan)

    def _index_phase(self, sha: str, plan: str) -> None:
        path, content = self._record(sha, "implementation")
        if not content:
            return
        for number, complete in _phase_sections(content).items():
            if complete:
                self.phase_heads.setdefault((plan, number), sha)

    def _index_closeout(self, sha: str) -> None:
        subject = self.commits[sha]["subject"]
        trailers = _trailers(self.commits[sha]["body"], self.profile)
        marked = bool(_first(trailers, self.profile.close_out_markers)) or _CLOSE_OUT.search(subject)
        if not marked:
            return
        keys = _subject_keys(subject)
        plan = _first(trailers, self.profile.plan_trailers)
        if plan:
            keys |= _plan_keys(plan)
        if keys:
            self.closeout_events.append((self.commits[sha]["ts"], sha, keys))

    def _index_pr(self, sha: str, plan: str) -> None:
        if sha in self.unit_reports:
            return
        if self._is_phase_head(sha):
            return
        trailers = _trailers(self.commits[sha]["body"], self.profile)
        marker = _first(trailers, self.profile.pr_markers) or self.commits[sha]["subject"]
        if not (trailers.get("Pull-Request") or trailers.get("PR") or _PR_MARKER.search(marker)):
            return
        review = self.profile.record_paths(plan).get("review")
        if review and _exists(self.repo, sha, review):
            self.pr_heads[sha] = plan

    def _is_phase_head(self, sha: str) -> bool:
        return sha in self.phase_heads.values()

    def _first_plan_commit(self, plan: str) -> str | None:
        if plan in self.first_impl:
            return self.first_impl[plan]
        for sha in self.order:
            if self.plan.get(sha) == plan:
                return sha
        return None

    def _phase_base(self, plan: str, number: int) -> str | None:
        previous = [n for (p, n) in self.phase_heads if p == plan and n < number]
        if previous:
            return self.phase_heads[(plan, max(previous))]
        return self._first_plan_commit(plan)

    def _report_attribution(self, sha: str, plan: str, path: str) -> tuple[int | None, str | None]:
        found = self.document(sha, path)
        if not found:
            return None, None
        content = found[1]
        phase = None
        head = "\n".join(_lines(content)[:12])
        match = re.search(r"(?i)phase\s+(\d+)", head)
        if match:
            phase = int(match.group(1))
        commit = None
        for match in _COMMIT_SHA.finditer(content):
            candidate = match.group(1)
            if len(candidate) >= 7 and any(s.startswith(candidate) for s in self.order):
                commit = next(s for s in self.order if s.startswith(candidate))
                break
        return phase, commit

    def _unit_base(self, sha: str, plan: str, path: str) -> str | None:
        _, reported = self._report_attribution(sha, plan, path)
        if reported and self.parents.get(reported):
            return self.parents[reported][0]
        parents = self.parents.get(sha) or []
        return parents[0] if parents else None

    def case_metadata(self, sha: str, tier: str, plan: str, base: str | None,
                      phase: int | None = None, pr: str | None = None) -> dict:
        paths = _diff_paths(self.repo, base, sha) if base else []
        case_paths = [p for p in paths if not p.startswith(self.profile.plans_root.rstrip("/") + "/")]
        outcomes = self.outcomes(sha, base, plan, case_paths, tier, phase)
        later, window_end = self.later_fixes(sha, base, plan, case_paths)
        if base is None:
            exclusion = "no_base_commit"
        else:
            exclusion = "eligible" if outcomes else "no_recorded_outcome"
        return {"tier": tier, "plan": plan, "phase": phase, "pr": pr, "base_sha": base,
                "outcomes": outcomes, "later_fixes": later,
                "censored": window_end is not None and window_end > self.now,
                "window_end": window_end, "exclusion": exclusion}

    def outcomes(self, sha: str, base: str | None, plan: str, case_paths: list[str],
                 tier: str, phase: int | None) -> list[dict]:
        outcomes: list[dict] = []
        for key, source in (("review", "review"), ("implementation", "implementation")):
            path, content = self._record(sha, key)
            if not content:
                continue
            found = self.document(sha, path)
            blob = found[0] if found else None
            if source == "review":
                outcomes.extend(_verdict_outcome(content, path=path, commit=sha, blob=blob))
                outcomes.extend(_finding_outcomes(content, source=source, path=path, commit=sha, blob=blob))
            else:
                outcomes.extend(_implementation_outcomes(content, path=path, commit=sha, blob=blob))
        reports = self.profile.record_paths(plan).get("reports")
        report_paths: list[str] = []
        if tier == "unit" and sha in self.unit_reports:
            report_paths.append(self.unit_reports[sha][1])
        elif reports:
            report_paths.extend(sorted(p for p in case_paths if p.startswith(reports + "/")))
        for path in report_paths:
            found = self.document(sha, path)
            if found:
                outcomes.extend(_finding_outcomes(found[1], source="report", path=path,
                                                  commit=sha, blob=found[0]))
        range_shas = [sha]
        if base:
            range_shas = _text(self.repo, "rev-list", f"{base}..{sha}").splitlines() or [sha]
        outcomes.extend(_commit_outcomes(self.commits, range_shas))
        unique: dict[tuple, dict] = {}
        for outcome in outcomes:
            key = (outcome["source"], outcome["path"], outcome["commit"], outcome["line_start"], outcome["text"])
            unique.setdefault(key, outcome)
        return sorted(unique.values(), key=lambda o: (o["source"], o["path"] or "", o["line_start"] or 0, o["text"]))

    def _attributed(self, sha: str, plan: str) -> bool:
        if self.plan.get(sha) == plan:
            return True
        number, slug = _plan_slug(plan)
        subject = self.commits[sha]["subject"]
        if number and re.search(rf"(?i)\bplan\s+{re.escape(number)}\b", subject):
            return True
        return bool(slug and slug.lower() in subject.lower())

    def later_fixes(self, sha: str, base: str | None, plan: str, case_paths: list[str]):
        head_ts = self.commits[sha]["ts"]
        case_keys = _plan_keys(plan)
        candidates = [ts for ts, _, keys in self.closeout_events
                      if ts >= head_ts and (keys & case_keys)]
        window_end = head_ts + self.profile.later_fix_window_days * 86400
        if candidates:
            window_end = min(window_end, min(candidates))
        fixes = []
        for other in self.order:
            meta = self.commits[other]
            if other == sha or meta["ts"] <= head_ts or meta["ts"] > window_end:
                continue
            if not self._attributed(other, plan):
                continue
            changed = {path for _, path in self.changes.get(other, [])}
            intersecting = sorted(changed & set(case_paths))
            if not intersecting:
                continue
            parent = self.parents.get(other, [None])[0] if self.parents.get(other) else None
            fixes.append({"sha": other, "subject": meta["subject"], "paths": intersecting,
                          "hunks": {path: _hunks(self.repo, parent, other, path) for path in intersecting}})
        return fixes, window_end


def extract(repo, profile, *, now=None) -> dict[str, dict]:
    """Return ``sha -> metadata`` for every enumerated commit.

    Metadata keys: ``tier``, ``plan``, ``phase``, ``pr``, ``base_sha``,
    ``outcomes``, ``later_fixes``, ``censored``, ``window_end`` and ``exclusion``.
    """
    state = _Extraction(repo, profile, now)
    result: dict[str, dict] = {}
    phase_heads = {}
    for (plan, number), sha in state.phase_heads.items():
        phase_heads.setdefault(sha, (plan, number))
    for sha in state.order:
        parents = state.parents.get(sha) or []
        default_base = parents[0] if parents else None
        if sha in phase_heads:
            plan, number = phase_heads[sha]
            base = state._phase_base(plan, number)
            result[sha] = state.case_metadata(sha, "phase", plan, base, phase=number)
            continue
        if sha in state.unit_reports:
            plan, path = state.unit_reports[sha]
            report_phase, _ = state._report_attribution(sha, plan, path)
            result[sha] = state.case_metadata(sha, "unit", plan, state._unit_base(sha, plan, path),
                                              phase=report_phase)
            continue
        if sha in state.pr_heads:
            plan = state.pr_heads[sha]
            trailers = _trailers(state.commits[sha]["body"], state.profile)
            pr = _first(trailers, state.profile.pr_markers) or state.commits[sha]["subject"]
            result[sha] = state.case_metadata(sha, "pr", plan, default_base, pr=pr)
            continue
        trailers = _trailers(state.commits[sha]["body"], state.profile)
        phase_value = _first(trailers, state.profile.phase_trailers)
        phase = None
        if phase_value:
            tail = phase_value.rsplit(":", 1)[-1]
            phase = int(tail) if tail.isdigit() else None
        pr_value = _first(trailers, state.profile.pr_markers)
        reason = "no_base_commit" if not default_base else "no_tier"
        result[sha] = {"tier": None, "plan": state.plan.get(sha), "phase": phase, "pr": pr_value,
                       "base_sha": default_base, "outcomes": [], "later_fixes": [],
                       "censored": False, "window_end": None, "exclusion": reason}
    return result


def scan(repo, profile, *, now=None) -> dict:
    """Read-only aggregate counts; no excerpts, paths or SHAs are returned."""
    metadata = extract(repo, profile, now=now)
    tiers = {tier: {"candidates": 0, "with_plan": 0, "with_outcome": 0,
                    "with_later_fixes": 0, "censored": 0} for tier in _TIER_ORDER}
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
        reason = meta.get("exclusion")
        if reason and reason != "eligible":
            exclusions[reason] = exclusions.get(reason, 0) + 1
    return {"tiers": tiers, "exclusions": dict(sorted(exclusions.items())),
            "commits": len(metadata)}
