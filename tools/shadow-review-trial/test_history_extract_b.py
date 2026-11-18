"""Fixtures for the document- and report-driven candidate extractor."""
import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOOL = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(TOOL))
import history_profile  # noqa: E402

SPEC = importlib.util.spec_from_file_location("shadow_extract_b", TOOL / "history_extract_b.py")
extract_b = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(extract_b)

PROFILE = history_profile.get_profile("garcia-music-workflow")
PLAN = "docs/plans/demo"
EARLY_NOW = "2000-01-01T00:30:00+00:00"
LATE_NOW = "2001-01-01T00:00:00+00:00"


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True).stdout.decode().strip()


class History:
    def __init__(self, root):
        self.root = root
        self.index = 0
        self.shas = {}
        git(root, "init", "-q")
        git(root, "config", "user.email", "fixture@example.invalid")
        git(root, "config", "user.name", "Fixture")

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit(self, name, message):
        stamp = f"2000-01-01T00:{self.index:02d}:00+0000"
        self.index += 1
        git(self.root, "add", "-A")
        env = dict(os.environ, GIT_AUTHOR_DATE=stamp, GIT_COMMITTER_DATE=stamp)
        subprocess.run(["git", "-C", str(self.root), "commit", "-qm", message],
                       check=True, capture_output=True, env=env)
        sha = git(self.root, "rev-parse", "HEAD")
        self.shas[name] = sha
        return sha


def build_repo(root):
    history = History(root)
    history.write("code.py", "value = 0\n")
    history.write(f"{PLAN}/DESIGN.md", "# Criteria v1\n")
    history.write(f"{PLAN}/IMPLEMENTATION.md", "# Implementation\n")
    history.write(f"{PLAN}/REVIEW.md", "# Review\n\n- **Verdict:** `PASS`\n")
    history.commit("base", "base")

    history.write("code.py", "value = 1\n")
    history.write(f"{PLAN}/IMPLEMENTATION.md",
                  "# Implementation\n\n## Phase 1 — One\n\n**Status:** Complete (2000-01-01)\n\n"
                  "### Verification\n\n- ran tests for one\n")
    history.write(f"{PLAN}/REVIEW.md",
                  "# Review\n\n- **Verdict:** `PASS`\n\n## Findings\n\n- **Blocking** — one finding.\n")
    history.commit("phase1", f"phase 1\n\nWorkflow-Plan: {PLAN}\nWorkflow-Phase: {PLAN}:1")

    history.write("code.py", "value = 2\n")
    history.write(f"{PLAN}/IMPLEMENTATION.md",
                  "# Implementation\n\n## Phase 1 — One\n\n**Status:** Complete (2000-01-01)\n\n"
                  "### Verification\n\n- ran tests for one\n\n## Phase 2 — Two\n\n"
                  "**Status:** Complete (2000-01-01)\n\n### Verification\n\n- two green\n")
    history.write(f"{PLAN}/REVIEW.md",
                  "# Review\n\n- **Verdict:** `PASS_WITH_FOLLOWUPS`\n\n## Findings\n\n"
                  "- **Blocking** — one finding.\n- **Medium** — two finding.\n")
    history.commit("phase2", f"phase 2\n\nWorkflow-Plan: {PLAN}\nWorkflow-Phase: {PLAN}:2")

    history.write("other.py", "other = 1\n")
    history.commit("unit_impl", f"land two.one\n\nWorkflow-Plan: {PLAN}")

    history.write(f"{PLAN}/reports/2-01-thing.md",
                  "# Report: Plan demo Phase 2 — thing\n\n"
                  f"Implementation commit `{history.shas['unit_impl']}`.\n\n"
                  "## Findings\n\n- **Low** — unit note.\n")
    history.commit("unit_report", "add unit report")

    history.write("code.py", "value = 'pr'\n")
    history.commit("pr", f"squash PR (#42)\n\nWorkflow-Plan: {PLAN}\nPull-Request: 42")

    history.write("code.py", "value = 'fixed'\n")
    history.commit("later_fix", f"fix demo thing\n\nWorkflow-Plan: {PLAN}")

    history.write("unrelated.py", "unrelated = True\n")
    history.commit("no_intersection", f"later unrelated path\n\nWorkflow-Plan: {PLAN}")

    history.write(f"{PLAN}/DESIGN.md", "# Criteria v2\n")
    history.commit("design_head", "amend design")
    return history


class ExtractorFixtures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        scratch = ROOT / ".scratch"
        scratch.mkdir(parents=True, exist_ok=True)
        cls.tmp = tempfile.TemporaryDirectory(dir=scratch)
        cls.repo = pathlib.Path(cls.tmp.name) / "repo"
        cls.repo.mkdir()
        cls.history = build_repo(cls.repo)
        cls.result = extract_b.extract(cls.repo, PROFILE, now=LATE_NOW)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_one_case_per_tier(self):
        tiers = [meta["tier"] for meta in self.result.values() if meta["tier"]]
        self.assertEqual(sorted(tiers), ["phase", "phase", "pr", "unit"])
        self.assertEqual(self.result[self.history.shas["phase1"]]["tier"], "phase")
        self.assertEqual(self.result[self.history.shas["unit_report"]]["tier"], "unit")
        self.assertEqual(self.result[self.history.shas["pr"]]["tier"], "pr")

    def test_phase_locator_and_base(self):
        phase1 = self.result[self.history.shas["phase1"]]
        phase2 = self.result[self.history.shas["phase2"]]
        self.assertEqual(phase1["phase"], 1)
        self.assertEqual(phase1["base_sha"], self.history.shas["base"])
        self.assertEqual(phase2["phase"], 2)
        self.assertEqual(phase2["base_sha"], self.history.shas["phase1"])

    def test_unit_report_attribution(self):
        unit = self.result[self.history.shas["unit_report"]]
        self.assertEqual(unit["phase"], 2)
        self.assertEqual(unit["base_sha"], self.history.shas["phase2"])

    def test_pr_squash_base(self):
        pr = self.result[self.history.shas["pr"]]
        self.assertEqual(pr["pr"], "42")
        self.assertEqual(pr["base_sha"], self.history.shas["unit_report"])

    def test_no_commit_in_two_cases(self):
        heads = [sha for sha, meta in self.result.items() if meta["tier"]]
        self.assertEqual(len(heads), len(set(heads)))

    def test_outcomes_cite_review_and_implementation_lines(self):
        phase1 = self.result[self.history.shas["phase1"]]
        review_path = f"{PLAN}/REVIEW.md"
        texts = [outcome["text"] for outcome in phase1["outcomes"]]
        self.assertIn("- **Blocking** — one finding.", texts)
        finding = next(o for o in phase1["outcomes"] if o["text"] == "- **Blocking** — one finding.")
        self.assertEqual(finding["source"], "review")
        self.assertEqual(finding["path"], review_path)
        self.assertEqual(finding["severity"], "blocking")
        self.assertEqual(finding["line_start"], 7)
        self.assertEqual(finding["line_end"], 7)
        self.assertEqual(finding["blob"], git(self.repo, "rev-parse", f"{self.history.shas['phase1']}:{review_path}"))
        self.assertIn("- ran tests for one", texts)
        self.assertTrue(any(o["source"] == "review_verdict" for o in phase1["outcomes"]))

    def test_later_fix_intersects_and_hunk_ranges(self):
        pr = self.result[self.history.shas["pr"]]
        fixes = pr["later_fixes"]
        self.assertEqual([fix["sha"] for fix in fixes], [self.history.shas["later_fix"]])
        self.assertEqual(fixes[0]["paths"], ["code.py"])
        self.assertEqual(fixes[0]["hunks"]["code.py"], [[1, 1]])

    def test_non_intersecting_later_commit_absent(self):
        for meta in self.result.values():
            self.assertNotIn(self.history.shas["no_intersection"], [f["sha"] for f in meta["later_fixes"]])

    def test_window_closed_by_late_now(self):
        for sha in ("phase1", "phase2", "unit_report", "pr"):
            self.assertFalse(self.result[self.history.shas[sha]]["censored"])

    def test_open_window_is_censored(self):
        early = extract_b.extract(self.repo, PROFILE, now=EARLY_NOW)
        for sha in ("phase1", "phase2", "unit_report", "pr"):
            self.assertTrue(early[self.history.shas[sha]]["censored"])

    def test_now_none_uses_tip_commit_time(self):
        default = extract_b.extract(self.repo, PROFILE, now=None)
        reference = extract_b.extract(self.repo, PROFILE, now=git(self.repo, "log", "-1", "--format=%ct"))
        self.assertEqual(default, reference)

    def test_deterministic_for_same_now(self):
        first = extract_b.extract(self.repo, PROFILE, now=LATE_NOW)
        second = extract_b.extract(self.repo, PROFILE, now=LATE_NOW)
        self.assertEqual(first, second)

    def test_every_candidate_has_one_exclusion(self):
        allowed = {"eligible", "no_tier", "no_base_commit", "no_recorded_outcome"}
        for meta in self.result.values():
            self.assertIn(meta["exclusion"], allowed)
            self.assertEqual(meta["exclusion"] == "eligible", bool(meta["tier"]))

    def test_scan_counts_tiers_and_exclusions(self):
        counts = extract_b.scan(self.repo, PROFILE, now=LATE_NOW)
        self.assertEqual(counts["commits"], len(self.result))
        self.assertEqual(counts["tiers"]["phase"]["candidates"], 2)
        self.assertEqual(counts["tiers"]["unit"]["candidates"], 1)
        self.assertEqual(counts["tiers"]["pr"]["candidates"], 1)
        included = sum(1 for meta in self.result.values() if meta["tier"])
        self.assertEqual(sum(counts["exclusions"].values()), len(self.result) - included)
        self.assertIn("no_tier", counts["exclusions"])

    def test_untiered_commit_is_no_tier(self):
        meta = self.result[self.history.shas["no_intersection"]]
        self.assertIsNone(meta["tier"])
        self.assertEqual(meta["exclusion"], "no_tier")

    def test_root_commit_has_no_base(self):
        meta = self.result[self.history.shas["base"]]
        self.assertIsNone(meta["base_sha"])
        self.assertEqual(meta["exclusion"], "no_base_commit")

    def test_design_changes_at_head_but_base_is_earlier(self):
        base_design = git(self.repo, "rev-parse", f"{self.history.shas['base']}:{PLAN}/DESIGN.md")
        head_design = git(self.repo, "rev-parse", f"{self.history.shas['design_head']}:{PLAN}/DESIGN.md")
        self.assertNotEqual(base_design, head_design)
        phase1 = self.result[self.history.shas["phase1"]]
        self.assertEqual(git(self.repo, "rev-parse", f"{phase1['base_sha']}:{PLAN}/DESIGN.md"), base_design)


if __name__ == "__main__":
    unittest.main()
