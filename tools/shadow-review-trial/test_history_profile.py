"""Contract fixtures for named history profiles and synthetic history."""
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOOL = pathlib.Path(__file__).resolve().parent
if str(TOOL) not in sys.path:
    sys.path.insert(0, str(TOOL))
import history_profile
import synthetic_history


class HistoryProfileFixtures(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / ".scratch"
        scratch.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=scratch)

    def tearDown(self):
        self.tmp.cleanup()

    def test_named_profile_carries_workflow_keys_and_plan_paths(self):
        profile = history_profile.get_profile("garcia-music-workflow")
        self.assertEqual(profile.name, "garcia-music-workflow")
        self.assertEqual(set(profile.plan_trailers), {"Workflow-Plan", "Yakka-Plan"})
        self.assertEqual(set(profile.phase_trailers), {"Workflow-Phase", "Yakka-Phase"})
        self.assertEqual(set(profile.pr_markers), {"Pull-Request", "PR"})
        self.assertEqual(profile.later_fix_window_days, 60)
        folder = profile.record_paths("docs/plans/demo")
        self.assertEqual(folder["design"], "docs/plans/demo/DESIGN.md")
        self.assertEqual(folder["review"], "docs/plans/demo/REVIEW.md")
        self.assertEqual(folder["implementation"], "docs/plans/demo/IMPLEMENTATION.md")
        self.assertEqual(folder["reports"], "docs/plans/demo/reports")
        self.assertEqual(profile.record_paths("demo")["design"], "docs/plans/demo/DESIGN.md")
        collapsed = profile.record_paths("docs/plans/23-closed-out.md")
        self.assertEqual(collapsed["design"], "docs/plans/23-closed-out.md")
        self.assertEqual(collapsed["review"], "docs/plans/23-closed-out.md")
        self.assertEqual(collapsed["implementation"], "docs/plans/23-closed-out.md")

    def test_unknown_profile_is_refused(self):
        with self.assertRaises(ValueError):
            history_profile.get_profile("not-a-workflow")

    def test_synthetic_history_is_deterministic(self):
        first = synthetic_history.build_history(pathlib.Path(self.tmp.name) / "one")
        second = synthetic_history.build_history(pathlib.Path(self.tmp.name) / "two")
        self.assertEqual(first["head"], second["head"])
        self.assertEqual(first["pr_head"], second["pr_head"])


if __name__ == "__main__":
    unittest.main()
