"""Offline contract checks for the request-level leak check; no network or live server."""
import hashlib
import json
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOOL = pathlib.Path(__file__).resolve().parent
if str(TOOL) not in sys.path:
    sys.path.insert(0, str(TOOL))
import leak_check

CLEAN_DIFF = (
    "diff --git a/src/app.py b/src/app.py\n"
    "--- a/src/app.py\n"
    "+++ b/src/app.py\n"
    "@@ -1 +1 @@\n"
    "-value = 1\n"
    "+value = 2\n"
)
EXCERPT = "the changed value is unchecked"


def make_case(case_id="case-1", plan="docs/plans/demo", diff=CLEAN_DIFF,
              criteria="Implement value handling.", outcomes=None, eligible=True,
              capture=True):
    case = {
        "case_id": case_id,
        "eligible": eligible,
        "plan": plan,
        "base_sha": "base-sha",
        "head_sha": "head-sha",
        "outcomes": [{"kind": "review_finding", "excerpt": EXCERPT}] if outcomes is None else outcomes,
        "criteria": {"source": "base_blob", "path": "docs/plans/demo/DESIGN.md",
                     "text": criteria, "content_hash": "criteria-hash"},
        "build_models": {"source": "unknown", "models": []},
    }
    if capture:
        case["capture"] = {
            "repo_id": "fixture",
            "mode": "range",
            "view": "changes",
            "base": "base-sha",
            "head": "head-sha",
            "diff": diff,
            "diff_sha256": hashlib.sha256(diff.encode("utf-8")).hexdigest(),
            "complete": True,
        }
    else:
        case["capture"] = None
    return case


def make_manifest(cases):
    return {"manifest_sha256": "0" * 64, "cases": cases,
            "run_order": [case["case_id"] for case in cases]}


def with_section(path, added="new line\n"):
    return CLEAN_DIFF + (
        f"diff --git a/{path} b/{path}\n"
        f"--- a/{path}\n"
        f"+++ b/{path}\n"
        "@@ -1 +1 @@\n"
        "-old line\n"
        f"+{added}")


class LeakCheckTest(unittest.TestCase):
    def setUp(self):
        tmp_root = ROOT / ".scratch"
        tmp_root.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=tmp_root)
        self.folder = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def manifest(self, cases):
        path = self.folder / "manifest.json"
        path.write_text(json.dumps(make_manifest(cases)), encoding="utf-8")
        return json.loads(path.read_text(encoding="utf-8"))

    def test_clean_manifest_passes_with_zero_hits(self):
        result = leak_check.check_requests(self.manifest([make_case()]), "run-1")
        self.assertTrue(result["pass"])
        self.assertEqual(result["requests_checked"], 3)
        self.assertEqual(result["request_errors"], [])
        self.assertEqual(result["own_plan_document_hits"], 0)
        self.assertEqual(result["outcome_text_hits"], 0)
        self.assertEqual(result["foreign_plan_document_captures"], 0)
        self.assertEqual(result["short_excerpts_skipped"], 0)
        self.assertEqual(result["min_excerpt_words"], 5)
        self.assertEqual(result["scope"], "case_plan_and_outcome_excerpts")

    def test_bare_own_plan_path_reference_does_not_fail(self):
        diff = with_section("src/app.py", "see docs/plans/demo/REVIEW.md for details\n")
        result = leak_check.check_requests(self.manifest([make_case(diff=diff)]), "run-1")
        self.assertTrue(result["pass"])
        self.assertEqual(result["own_plan_document_hits"], 0)

    def test_own_plan_review_document_fails(self):
        diff = with_section("docs/plans/demo/REVIEW.md")
        result = leak_check.check_requests(self.manifest([make_case(diff=diff)]), "run-1")
        self.assertFalse(result["pass"])
        self.assertGreater(result["own_plan_document_hits"], 0)
        self.assertEqual(result["outcome_text_hits"], 0)

    def test_own_plan_implementation_document_fails(self):
        diff = with_section("docs/plans/demo/IMPLEMENTATION.md")
        result = leak_check.check_requests(self.manifest([make_case(diff=diff)]), "run-1")
        self.assertFalse(result["pass"])
        self.assertGreater(result["own_plan_document_hits"], 0)

    def test_outcome_excerpt_in_diff_fails(self):
        diff = with_section("src/app.py", EXCERPT + "\n")
        result = leak_check.check_requests(self.manifest([make_case(diff=diff)]), "run-1")
        self.assertFalse(result["pass"])
        self.assertGreater(result["outcome_text_hits"], 0)
        self.assertEqual(result["own_plan_document_hits"], 0)

    def test_outcome_excerpt_in_criteria_fails(self):
        result = leak_check.check_requests(
            self.manifest([make_case(criteria="Context. " + EXCERPT + " More.")]), "run-1")
        self.assertFalse(result["pass"])
        self.assertGreater(result["outcome_text_hits"], 0)

    def test_whitespace_only_excerpt_is_skipped(self):
        case = make_case(outcomes=[{"kind": "review_verdict", "excerpt": "   \n\t "}])
        result = leak_check.check_requests(self.manifest([case]), "run-1")
        self.assertTrue(result["pass"])
        self.assertEqual(result["outcome_text_hits"], 0)
        self.assertGreater(result["short_excerpts_skipped"], 0)

    def test_short_verdict_excerpt_is_skipped_and_counted(self):
        case = make_case(outcomes=[{"kind": "review_verdict", "excerpt": "pass"}])
        result = leak_check.check_requests(self.manifest([case]), "run-1")
        self.assertTrue(result["pass"])
        self.assertEqual(result["outcome_text_hits"], 0)
        self.assertEqual(result["short_excerpts_skipped"], 3)
        self.assertEqual(result["min_excerpt_words"], 5)

    def test_foreign_plan_document_is_counted_but_passes(self):
        diff = with_section("docs/plans/other/REVIEW.md")
        result = leak_check.check_requests(self.manifest([make_case(diff=diff)]), "run-1")
        self.assertTrue(result["pass"])
        self.assertEqual(result["own_plan_document_hits"], 0)
        self.assertEqual(result["outcome_text_hits"], 0)
        self.assertEqual(result["foreign_plan_document_captures"], 1)

    def test_outcome_excerpt_in_foreign_plan_document_is_foreign_not_a_leak(self):
        diff = with_section("docs/plans/other/IMPLEMENTATION.md", EXCERPT + "\n")
        result = leak_check.check_requests(self.manifest([make_case(diff=diff)]), "run-1")
        self.assertTrue(result["pass"])
        self.assertEqual(result["own_plan_document_hits"], 0)
        self.assertEqual(result["outcome_text_hits"], 0)
        self.assertEqual(result["foreign_plan_document_captures"], 1)

    def test_null_plan_makes_every_plan_path_foreign(self):
        diff = with_section("docs/plans/demo/REVIEW.md")
        case = make_case(plan=None, diff=diff)
        result = leak_check.check_requests(self.manifest([case]), "run-1")
        self.assertTrue(result["pass"])
        self.assertEqual(result["own_plan_document_hits"], 0)
        self.assertEqual(result["foreign_plan_document_captures"], 1)

    def test_capture_less_case_reports_a_request_error_and_fails(self):
        case = make_case(case_id="broken", capture=False)
        result = leak_check.check_requests(self.manifest([case]), "run-1")
        self.assertFalse(result["pass"])
        self.assertEqual(result["request_errors"], ["broken"])
        self.assertEqual(result["requests_checked"], 0)


if __name__ == "__main__":
    unittest.main()
