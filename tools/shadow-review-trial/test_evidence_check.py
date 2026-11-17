"""Offline contract checks for the metric-only evidence folder gate."""
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "shadow_evidence_check", pathlib.Path(__file__).with_name("evidence_check.py"))
evidence_check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evidence_check)


class EvidenceCheckFixtures(unittest.TestCase):
    def setUp(self):
        tmp_root = ROOT / ".scratch"
        tmp_root.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=tmp_root)
        self.folder = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, relative, text):
        path = self.folder / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def test_empty_folder_passes(self):
        result = evidence_check.check_folder(self.folder)
        self.assertTrue(result["pass"])
        self.assertEqual(result["files_checked"], 0)
        self.assertEqual(result["offenders"], [])

    def test_aggregate_json_and_markdown_pass(self):
        self.write("summary.json", json.dumps({"counts": {"phase": 12}, "rate": 0.4}))
        self.write("REPORT.md", "# Aggregate report\n\ncounts only\n")
        result = evidence_check.check_folder(self.folder)
        self.assertTrue(result["pass"])
        self.assertEqual(result["files_checked"], 2)
        self.assertEqual(result["offenders"], [])

    def test_files_refused_by_name_even_when_unparseable(self):
        self.write("manifest-28.json", "{not json")
        self.write("run-export.json", "also not json")
        self.write("sub/manifest.json", "\x00binary")
        result = evidence_check.check_folder(self.folder)
        self.assertFalse(result["pass"])
        self.assertEqual(result["offenders"], ["manifest-28.json", "run-export.json", "sub/manifest.json"])

    def test_frozen_manifest_shape_refused_by_shape(self):
        self.write("data.json", json.dumps({"manifest_sha256": "abc", "cases": [], "target": 360}))
        result = evidence_check.check_folder(self.folder)
        self.assertFalse(result["pass"])
        self.assertEqual(result["offenders"], ["data.json"])

    def test_saved_export_shape_refused_by_shape(self):
        self.write("data.json", json.dumps({"reviews": [], "pages": []}))
        result = evidence_check.check_folder(self.folder)
        self.assertFalse(result["pass"])
        self.assertEqual(result["offenders"], ["data.json"])

    def test_run_ledger_shape_refused_by_shape(self):
        self.write("nested/ledger.json", json.dumps({"manifest_hash": "abc", "entries": []}))
        result = evidence_check.check_folder(self.folder)
        self.assertFalse(result["pass"])
        self.assertEqual(result["offenders"], ["nested/ledger.json"])

    def test_unreadable_unmatched_file_is_ignored(self):
        self.write("data.json", "not json at all")
        result = evidence_check.check_folder(self.folder)
        self.assertTrue(result["pass"])
        self.assertEqual(result["files_checked"], 1)

    def test_require_metric_only_names_offender_on_refusal(self):
        self.write("sub/manifest.json", "{}")
        with self.assertRaises(ValueError) as caught:
            evidence_check.require_metric_only(self.folder)
        self.assertIn("sub/manifest.json", str(caught.exception))

    def test_require_metric_only_returns_passing_result(self):
        self.write("summary.json", json.dumps({"counts": {"phase": 1}}))
        result = evidence_check.require_metric_only(self.folder)
        self.assertTrue(result["pass"])
        self.assertEqual(result["files_checked"], 1)


if __name__ == "__main__":
    unittest.main()
