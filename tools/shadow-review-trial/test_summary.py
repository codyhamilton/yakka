"""Fixture-only tests for the deterministic rendered report summary."""
import pathlib
import re
import sys
import unittest

TOOL = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(TOOL))
import report
import summary
import test_report as fixtures


def full_report():
    manifest = fixtures.phase3_manifest(3)
    cases = {case["case_id"]: case for case in manifest["cases"]}
    for index, case in enumerate(cases.values()):
        case["outcomes"] = [fixtures.outcome_finding(
            "src/a.py", 10, 20, "Medium", f"missing nil check {index}")]
    manifest = fixtures.refreeze(manifest)
    rows, refs, decisions = [], [], []
    for effort in report.EFFORTS:
        for index in range(3):
            finding_id = f"F{index}"
            rows.append(fixtures.record(manifest, f"case-{index}", effort, findings=[{
                "id": finding_id, "severity": "medium", "path": "src/a.py",
                "line_start": 10, "line_end": 20, "title": f"nil check {index}",
                "evidence": f"missing nil check {index}"}]))
            refs.append((f"case-{index}", effort, f"case-{index}-{effort}"))
            decisions.append({"source": "review", "case_id": f"case-{index}", "effort": effort,
                              "finding_id": finding_id, "category": "valid",
                              "second_label": "valid" if index % 2 == 0 else "invalid"})
    return fixtures.report_for(manifest, rows, refs, decisions=decisions)


class SummaryTests(unittest.TestCase):
    def test_fixed_sections_in_order_with_recall_beside_null(self):
        built = full_report()
        text = summary.render(built)
        headings = ["## Population", "## Comparisons", "## Validation controls",
                    "## Reproducibility", "## Reconciliation"]
        positions = [text.index(heading) for heading in headings]
        self.assertEqual(positions, sorted(positions))
        recall = built["comparisons"]["finding_recall"]["by_effort"]["high"]
        self.assertIn(f"{recall['recall']:.4f}", text)
        self.assertIn(f"{recall['null']['recall']:.4f}", text)
        self.assertIn("null", text)
        self.assertIn(built["reproducibility"]["report_sha256"], text)
        self.assertIn(f"{built['validation']['adjudication']['kappa']:.4f}", text)

    def test_render_is_deterministic_and_carries_no_run_time_content(self):
        built = full_report()
        first = summary.render(built)
        self.assertEqual(first, summary.render(built))
        for line in first.splitlines():
            self.assertEqual(line, line.rstrip())
        self.assertNotIn("\x1b", first)
        self.assertNotIn("<table", first)
        self.assertIsNone(re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", first))
        self.assertNotIn(str(pathlib.Path.cwd()), first)
        self.assertNotIn("/home/", first)

    def test_build_report_phase3_fixture_renders(self):
        text = summary.render(full_report())
        self.assertIsInstance(text, str)
        self.assertGreater(len(text), 0)
        self.assertTrue(text.endswith("\n"))


if __name__ == "__main__":
    unittest.main()
