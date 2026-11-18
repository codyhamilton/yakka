"""Smoke tests for scan_residual_names.py."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCAN = ROOT / "tools" / "release" / "scan_residual_names.py"


class ScanResidualNamesTests(unittest.TestCase):
    def test_phase5_clean_in_repo(self):
        r = subprocess.run([sys.executable, str(SCAN), "--scope", "phase5"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_phase6_clean_in_repo(self):
        r = subprocess.run([sys.executable, str(SCAN), "--scope", "phase6"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_all_clean_in_repo(self):
        r = subprocess.run([sys.executable, str(SCAN), "--scope", "all"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_fixture_hit(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location("scan_residual_names", SCAN)
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader
        spec.loader.exec_module(mod)
        bad = b"packages/" + b"work" + b"flow\n"
        hits = mod.scan_file("packages/yakka/x.txt", bad)
        self.assertTrue(hits)
        self.assertIn("packages/" + "work" + "flow", hits[0][1])

    def test_phase12_workflow_symbols_not_residual(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location("scan_residual_names", SCAN)
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader
        spec.loader.exec_module(mod)
        path = "packages/yakka-analytics/web/js/panels/p12-workflow.js"
        wf = "WORK" + "FLOW_"
        current = (
            "import { P12_" + wf + "PANELS, " + wf + "SPECS, " + wf + "PRESET_ID } from './p12.js';\n"
            "export const P12_" + wf + "PANEL_IDS = [];\n"
            "export const " + wf + "PANEL_IDS = [];\n"
        ).encode()
        self.assertEqual(mod.scan_file(path, current), [])
        stale = (
            "const a = " + wf + "OLD_SPECS;\n"
            "const b = P12_" + wf + "PANELS_OLD;\n"
            "const c = " + wf + "SPECS_OLD;\n"
        ).encode()
        self.assertEqual(len(mod.scan_file(path, stale)), 3)


if __name__ == "__main__":
    unittest.main()
