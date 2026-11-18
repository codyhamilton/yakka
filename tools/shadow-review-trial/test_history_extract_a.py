"""Fixtures for the trailer- and commit-driven candidate extractor."""
import os
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOOL = pathlib.Path(__file__).resolve().parent
if str(TOOL) not in sys.path:
    sys.path.insert(0, str(TOOL))
import history_extract_a
import history_profile

_IDENTITY = {
    "GIT_AUTHOR_NAME": "Fixture",
    "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
    "GIT_COMMITTER_NAME": "Fixture",
    "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
}


def _git(repo, *args, env=None):
    merged = dict(os.environ)
    merged.update(_IDENTITY)
    if env:
        merged.update(env)
    import subprocess
    result = subprocess.run(["git", "-C", str(repo), *args], check=True,
                            capture_output=True, env=merged)
    return result.stdout.decode("utf-8", "replace").strip()


def _write(root, relative, text):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def _commit(repo, index, message):
    stamp = f"2000-01-01T00:{index:02d}:00+0000"
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", message,
         env={"GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp})
    return _git(repo, "rev-parse", "HEAD")


def _build(root):
    root.mkdir(parents=True, exist_ok=True)
    _git(root, "init", "-q")
    _git(root, "config", "user.email", "fixture@example.invalid")
    _git(root, "config", "user.name", "Fixture")
    _write(root, "code.py", "value = 0\n")
    _write(root, "code2.py", "second = 0\n")
    _write(root, "docs/plans/demo/DESIGN.md", "# Criteria\nValue must be positive.\n")
    _write(root, "docs/plans/demo/REVIEW.md", (
        "# Demo Review\n\n"
        "- **Verdict:** `PASS_WITH_FOLLOWUPS`\n\n"
        "## Findings\n\n"
        "### High — briefed\n\n"
        "**First finding.** The value is wrong.\n\n"
        "### Low — follow-up\n\n"
        "**Second finding.** A minor fallback gap.\n"
    ))
    _write(root, "docs/plans/demo/IMPLEMENTATION.md", (
        "# Implementation\n\n"
        "## Verification\n\n"
        "- Verified the value is zero.\n"
        "- Concern: live check deferred.\n\n"
        "## Carried\n\n"
        "- None.\n"
    ))
    built = {}
    built["base"] = _commit(root, 0, "base")
    _write(root, "code.py", "value = 1\n")
    built["phase1"] = _commit(root, 1, (
        "phase 1\n\nWorkflow-Plan: docs/plans/demo\nWorkflow-Phase: demo:1"))
    _write(root, "docs/plans/demo/reports/unit-1-1.md", "# Unit handoff 1.1\n")
    _write(root, "code2.py", "second = 1\n")
    built["unit"] = _commit(root, 2, "land unit 1.1")
    _write(root, "code.py", "value = 2\n")
    _write(root, "docs/plans/demo/DESIGN.md", "# Criteria\nValue must equal two.\n")
    built["phase2"] = _commit(root, 3, (
        "phase 2\n\nWorkflow-Plan: docs/plans/demo\nWorkflow-Phase: demo:2"))
    _write(root, "code.py", "value = 3\n")
    built["pr"] = _commit(root, 4, (
        "squash PR\n\nWorkflow-Plan: docs/plans/demo\nPull-Request: 7"))
    _write(root, "code.py", "value = 4\n")
    built["later_fix"] = _commit(root, 5, (
        "fix: address review of demo\n\nWorkflow-Plan: docs/plans/demo"))
    _write(root, "notes.txt", "unrelated\n")
    built["non_intersecting"] = _commit(root, 6, (
        "fix: address review notes\n\nWorkflow-Plan: docs/plans/demo"))
    _write(root, "close.txt", "done\n")
    built["close_out"] = _commit(root, 7, (
        "docs: close out demo\n\nWorkflow-Plan: docs/plans/demo\nWorkflow-Close-Out: docs/plans/demo"))
    return built


class ExtractorFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        scratch = ROOT / ".scratch"
        scratch.mkdir(parents=True, exist_ok=True)
        cls._tmp = tempfile.TemporaryDirectory(dir=scratch)
        cls.repo = pathlib.Path(cls._tmp.name) / "repo"
        cls.built = _build(cls.repo)
        cls.profile = history_profile.get_profile("garcia-music-workflow")
        cls.now_far = "2099-01-01T00:00:00Z"
        cls.metadata = history_extract_a.extract(cls.repo, cls.profile, now=cls.now_far)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_one_case_per_tier(self):
        cases = {sha: meta for sha, meta in self.metadata.items() if meta["tier"]}
        self.assertEqual(cases[self.built["phase1"]]["tier"], "phase")
        self.assertEqual(cases[self.built["phase2"]]["tier"], "phase")
        self.assertEqual(cases[self.built["unit"]]["tier"], "unit")
        self.assertEqual(cases[self.built["pr"]]["tier"], "pr")
        heads = [sha for sha, meta in self.metadata.items() if meta["tier"]]
        self.assertEqual(len(heads), len(set(heads)))
        self.assertNotIn(self.built["later_fix"], heads)
        self.assertNotIn(self.built["non_intersecting"], heads)

    def test_base_and_head_bounds(self):
        phase1 = self.metadata[self.built["phase1"]]
        phase2 = self.metadata[self.built["phase2"]]
        unit = self.metadata[self.built["unit"]]
        pr = self.metadata[self.built["pr"]]
        self.assertEqual(phase1["base_sha"], self.built["base"])
        self.assertEqual(phase1["phase"], 1)
        self.assertEqual(phase2["base_sha"], self.built["phase1"])
        self.assertEqual(phase2["phase"], 2)
        self.assertEqual(unit["base_sha"], self.built["phase1"])
        self.assertEqual(pr["base_sha"], self.built["phase2"])
        self.assertEqual(pr["pr"], "7")
        self.assertEqual(phase2["plan"], "docs/plans/demo")

    def test_review_verdict_and_findings_are_cited(self):
        outcomes = self.metadata[self.built["phase2"]]["outcomes"]
        verdicts = [o for o in outcomes if o["kind"] == "review_verdict"]
        self.assertEqual(len(verdicts), 1)
        self.assertIn("PASS_WITH_FOLLOWUPS", verdicts[0]["excerpt"])
        self.assertEqual(verdicts[0]["path"], "docs/plans/demo/REVIEW.md")
        blob = _git(self.repo, "rev-parse", f"{self.built['phase2']}:docs/plans/demo/REVIEW.md")
        self.assertEqual(verdicts[0]["blob"], blob)
        findings = [o for o in outcomes if o["kind"] == "review_finding"]
        self.assertEqual(len(findings), 2)
        self.assertEqual([f["severity"] for f in findings], ["High", "Low"])
        for finding in findings:
            self.assertGreaterEqual(finding["line_start"], 1)
            self.assertLessEqual(finding["line_start"], finding["line_end"])
            self.assertFalse(finding["excerpt"].lstrip().startswith(("#", "|")))

    def test_implementation_and_fix_subject_outcomes(self):
        outcomes = self.metadata[self.built["phase2"]]["outcomes"]
        self.assertTrue(any(o["source"] == "IMPLEMENTATION.md" for o in outcomes))
        fixes = {o["commit"] for o in outcomes if o["kind"] == "fix_commit"}
        self.assertEqual(fixes, {self.built["later_fix"], self.built["non_intersecting"]})

    def test_later_fix_intersection_and_hunks(self):
        case = self.metadata[self.built["phase2"]]
        fixes = {f["sha"]: f for f in case["later_fixes"]}
        self.assertEqual(set(fixes), {self.built["pr"], self.built["later_fix"]})
        fix = fixes[self.built["later_fix"]]
        self.assertIn("code.py", fix["paths"])
        self.assertTrue(fix["hunks"])
        for hunk in fix["hunks"]:
            self.assertEqual(hunk["path"], "code.py")
            self.assertGreaterEqual(hunk["start"], 1)
            self.assertGreaterEqual(hunk["end"], hunk["start"])
        self.assertNotIn(self.built["non_intersecting"], fixes)
        self.assertFalse(case["censored"])

    def test_open_window_is_censored(self):
        early = history_extract_a.extract(
            self.repo, self.profile, now="2000-01-01T00:00:05Z")
        self.assertTrue(early[self.built["phase2"]]["censored"])
        self.assertFalse(self.metadata[self.built["phase2"]]["censored"])

    def test_deterministic_for_same_now(self):
        again = history_extract_a.extract(self.repo, self.profile, now=self.now_far)
        self.assertEqual(again, self.metadata)

    def test_scan_counts_exclusions(self):
        counts = history_extract_a.scan(self.repo, self.profile, now=self.now_far)
        self.assertEqual(counts["tiers"]["phase"]["candidates"], 2)
        self.assertEqual(counts["tiers"]["unit"]["candidates"], 1)
        self.assertEqual(counts["tiers"]["pr"]["candidates"], 1)
        self.assertGreaterEqual(counts["exclusions"].get("no_tier", 0), 3)
        self.assertEqual(counts["tiers"]["phase"]["with_outcome"], 2)
        self.assertEqual(counts["tiers"]["phase"]["with_later_fixes"], 2)


if __name__ == "__main__":
    unittest.main()
