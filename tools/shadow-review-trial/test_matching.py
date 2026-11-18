"""Tests for the deterministic matcher and statistics helpers; no I/O, no network."""
import pathlib
import sys
import unittest

TOOL = pathlib.Path(__file__).resolve().parent
if str(TOOL) not in sys.path:
    sys.path.insert(0, str(TOOL))
import matching


def review(path, start, end, title="", evidence=None):
    value = {"path": path, "line_start": start, "line_end": end, "title": title}
    if evidence is not None:
        value["evidence"] = evidence
    return value


def target(path, start, end, excerpt=""):
    return {"path": path, "line_start": start, "line_end": end, "excerpt": excerpt}


class NormaliseTextTest(unittest.TestCase):
    def test_casefolds_collapses_whitespace_and_strips(self):
        self.assertEqual(matching.normalise_text("  Mixed\tCASE \n text  "), "mixed case text")

    def test_leaves_single_spaced_text_unchanged(self):
        self.assertEqual(matching.normalise_text("already normal"), "already normal")


class TextSimilarityTest(unittest.TestCase):
    def test_identical_text_is_one(self):
        self.assertEqual(matching.text_similarity("Null deref in parser", "null  DEREF in parser"), 1.0)

    def test_disjoint_text_is_zero(self):
        self.assertEqual(matching.text_similarity("alpha beta", "gamma delta"), 0.0)

    def test_partial_overlap_is_jaccard(self):
        self.assertAlmostEqual(matching.text_similarity("alpha beta gamma", "beta gamma delta"), 0.5)

    def test_empty_text_is_zero(self):
        self.assertEqual(matching.text_similarity("   ", ""), 0.0)


class ClassifyTest(unittest.TestCase):
    def test_same_path_overlapping_lines_and_similar_text_is_structural(self):
        result = matching.classify(
            review("src/a.py", 10, 20, evidence="missing nil check in loader"),
            target("src/a.py", 15, 25, excerpt="missing nil check in the loader"))
        self.assertEqual(result["band"], "structural")
        self.assertTrue(result["path_match"])
        self.assertTrue(result["line_overlap"])
        self.assertGreaterEqual(result["text_similarity"], matching.STRUCTURAL_SIMILARITY)

    def test_same_path_distant_lines_unrelated_text_is_non_match(self):
        result = matching.classify(
            review("src/a.py", 1, 2, evidence="missing nil check in loader"),
            target("src/a.py", 200, 210, excerpt="rename counter variable"))
        self.assertEqual(result["band"], "non_match")
        self.assertTrue(result["path_match"])
        self.assertFalse(result["line_overlap"])

    def test_different_path_unrelated_text_is_non_match(self):
        result = matching.classify(
            review("src/a.py", 10, 20, evidence="missing nil check in loader"),
            target("src/b.py", 10, 20, excerpt="rename counter variable"))
        self.assertEqual(result["band"], "non_match")
        self.assertFalse(result["path_match"])

    def test_same_path_distant_lines_similar_text_is_uncertain(self):
        result = matching.classify(
            review("src/a.py", 10, 20, evidence="missing nil check in loader"),
            target("src/a.py", 200, 210, excerpt="missing nil check in the loader path"))
        self.assertEqual(result["band"], "uncertain")
        self.assertTrue(result["path_match"])
        self.assertFalse(result["line_overlap"])

    def test_different_path_very_similar_text_is_uncertain(self):
        result = matching.classify(
            review("src/a.py", 10, 20, evidence="missing nil check in loader"),
            target("src/moved_a.py", 10, 20, excerpt="missing nil check in loader"))
        self.assertEqual(result["band"], "uncertain")
        self.assertFalse(result["path_match"])

    def test_missing_evidence_falls_back_to_title(self):
        result = matching.classify(
            review("src/a.py", 10, 20, title="missing nil check in loader"),
            target("src/a.py", 10, 20, excerpt="missing nil check in loader"))
        self.assertEqual(result["band"], "structural")

    def test_target_text_key_is_accepted(self):
        result = matching.classify(
            review("src/a.py", 10, 20, evidence="missing nil check in loader"),
            {"path": "src/a.py", "line_start": 10, "line_end": 20,
             "text": "missing nil check in loader"})
        self.assertEqual(result["band"], "structural")

    def test_point_range_inside_other_range_overlaps(self):
        result = matching.classify(
            review("src/a.py", 15, 15, evidence="missing nil check in loader"),
            target("src/a.py", 10, 20, excerpt="missing nil check in loader"))
        self.assertTrue(result["line_overlap"])
        self.assertEqual(result["band"], "structural")


class TagMethodTest(unittest.TestCase):
    def test_structural_band_is_structural(self):
        self.assertEqual(matching.tag_method("structural", False), "structural")
        self.assertEqual(matching.tag_method("structural", True), "structural")

    def test_adjudicated_uncertain_band_is_adjudicated(self):
        self.assertEqual(matching.tag_method("uncertain", True), "adjudicated")

    def test_other_bands_have_no_method(self):
        self.assertEqual(matching.tag_method("uncertain", False), "")
        self.assertEqual(matching.tag_method("non_match", True), "")


class ShuffledCaseMapTest(unittest.TestCase):
    CASES = ["case-c", "case-a", "case-d", "case-b", "case-e"]

    def test_has_no_fixed_points(self):
        mapping = matching.shuffled_case_map(self.CASES, seed=7)
        self.assertEqual(set(mapping), set(self.CASES))
        for case_id, other in mapping.items():
            self.assertNotEqual(case_id, other)
            self.assertIn(other, self.CASES)

    def test_is_identical_for_same_seed(self):
        self.assertEqual(matching.shuffled_case_map(self.CASES, seed=7),
                         matching.shuffled_case_map(list(reversed(self.CASES)), seed=7))

    def test_differs_for_another_seed(self):
        self.assertNotEqual(matching.shuffled_case_map(self.CASES, seed=7),
                            matching.shuffled_case_map(self.CASES, seed=8))

    def test_single_case_has_no_derangement(self):
        self.assertEqual(matching.shuffled_case_map(["only"], seed=7), {})


class CohenKappaTest(unittest.TestCase):
    def test_identical_labels_are_one(self):
        self.assertEqual(matching.cohen_kappa([("yes", "yes"), ("no", "no"), ("yes", "yes")]), 1.0)

    def test_classic_chance_agreement_is_zero(self):
        table = [("yes", "yes")] * 10 + [("yes", "no")] * 10
        table += [("no", "yes")] * 10 + [("no", "no")] * 10
        self.assertAlmostEqual(matching.cohen_kappa(table), 0.0)

    def test_degenerate_sample_is_none(self):
        self.assertIsNone(matching.cohen_kappa([("yes", "yes"), ("yes", "yes")]))

    def test_fewer_than_two_pairs_is_none(self):
        self.assertIsNone(matching.cohen_kappa([]))
        self.assertIsNone(matching.cohen_kappa([("yes", "no")]))


class BootstrapIntervalTest(unittest.TestCase):
    VALUES = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]

    def test_same_values_and_seed_return_identical_bounds(self):
        first = matching.bootstrap_interval(self.VALUES, seed=11)
        second = matching.bootstrap_interval(self.VALUES, seed=11)
        self.assertEqual(first, second)

    def test_interval_brackets_the_mean(self):
        result = matching.bootstrap_interval(self.VALUES, seed=11)
        self.assertEqual(result["n"], len(self.VALUES))
        self.assertAlmostEqual(result["mean"], 4.5)
        self.assertLessEqual(result["low"], result["mean"])
        self.assertGreaterEqual(result["high"], result["mean"])
        self.assertEqual(result["resamples"], 2000)

    def test_empty_input_returns_nulls(self):
        self.assertEqual(matching.bootstrap_interval([], seed=11),
                         {"n": 0, "mean": None, "low": None, "high": None, "resamples": 2000})

    def test_constant_values_have_a_point_interval(self):
        result = matching.bootstrap_interval([2.5, 2.5, 2.5], seed=3)
        self.assertEqual((result["low"], result["mean"], result["high"]), (2.5, 2.5, 2.5))


if __name__ == "__main__":
    unittest.main()
