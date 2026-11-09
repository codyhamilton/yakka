"""Fixture-only tests for report.py; no provider or network access."""
import hashlib
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import report


def freeze(value):
    value["manifest_sha256"] = hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return value


def make_manifest(count, target=None):
    cases = []
    strata = ("phase", "pr", "unaccompanied")
    for i in range(count):
        cases.append({"case_id": f"case-{i}", "head_sha": f"case-{i}", "eligible": True,
                      "stratum": strata[i % len(strata)]})
    return freeze({"schema_version": 1, "seed": 23, "target_per_effort": target or count,
                   "cases": cases, "comparators": {"curated": [], "pr_export_by_head": {}}})


def record(manifest, case_id, effort, *, status="ok", rid=None, model=report.REVIEWER_MODEL,
           build_models=None, findings=None, latency=10, cost=0.1, input_tokens=100, output_tokens=20,
           manifest_hash=None):
    return {"id": rid or f"{case_id}-{effort}", "case_id": case_id, "effective_effort": effort,
            "profile": "historical_trial", "manifest_hash": manifest_hash or manifest["manifest_sha256"],
            "configured_model": report.REVIEWER_MODEL, "returned_model": model,
            "model_mismatch": model != report.REVIEWER_MODEL, "status": status,
            "build_models": build_models or [],
            "attempts": [{"status": "ok" if status in ("ok", "ok_partial") else status,
                          "latency_ms": latency, "cost_usd": cost, "input_tokens": input_tokens,
                          "output_tokens": output_tokens}],
            "payload": {"findings": findings or [], "coverage": "partial" if status == "ok_partial" else "complete"}}


def adjudication(rows=(), rate=1.0):
    return {"version": 1, "low_sample_rate": rate, "findings": list(rows)}


class AlignmentReportTests(unittest.TestCase):
    def test_50_per_effort_attains_target_and_49_shortfall_is_one(self):
        manifest50 = make_manifest(50)
        rows50 = [record(manifest50, f"case-{i}", e) for e in report.EFFORTS for i in range(50)]
        result50 = report.build_report(manifest50, rows50, {}, adjudication(), 100)
        for e in report.EFFORTS:
            self.assertEqual(result50["arms"][e]["completed"], 50)
            self.assertEqual(result50["arms"][e]["shortfall"], 0)
        manifest49 = make_manifest(49, target=50)
        rows49 = [record(manifest49, f"case-{i}", e) for e in report.EFFORTS for i in range(49)]
        result49 = report.build_report(manifest49, rows49, {}, adjudication())
        for e in report.EFFORTS:
            self.assertEqual(result49["arms"][e]["shortfall"], 1)

    def test_asymmetric_failures_duplicates_and_model_mismatch_do_not_pad(self):
        manifest = make_manifest(3)
        rows = [record(manifest, "case-0", "high"), record(manifest, "case-0", "high", rid="duplicate"),
                record(manifest, "case-1", "high", status="timeout"),
                record(manifest, "case-0", "xhigh"), record(manifest, "case-1", "xhigh"),
                record(manifest, "case-2", "max"),
                record(manifest, "case-1", "max", model="claude-haiku-5-5-20251001"),
                record(manifest, "case-2", "high", manifest_hash="wrong")]
        result = report.build_report(manifest, rows, {}, adjudication())
        self.assertEqual([result["arms"][e]["completed"] for e in report.EFFORTS], [1, 2, 1])
        self.assertEqual(result["paired_intersection"]["completed_cases"], 0)
        self.assertEqual(result["records_by_status"]["timeout"], 1)
        self.assertEqual(result["attempts_by_status"]["ok"], 7)
        self.assertEqual(result["excluded_records"]["duplicate_completed_case_effort"], 1)
        self.assertEqual(result["excluded_records"]["mismatched_model"], 1)
        self.assertEqual(result["excluded_records"]["wrong_manifest"], 1)

    def test_three_case_comparators_adjudication_usage_and_determinism(self):
        manifest = make_manifest(3, target=3)
        manifest["comparators"] = {"curated": [{"id": "hist-phase", "head_sha": "case-0", "stratum": "phase",
                                                "text": "historical", "citations": [{"path": "impl.md"}]},
                                               {"id": "hist-unmatched", "head_sha": "case-0", "stratum": "phase",
                                                "text": "unmatched historical", "citations": []}],
                                   "pr_export_by_head": {"case-1": [{"id": "pr-review", "body": "PR historical"}]}}
        manifest = freeze({k: v for k, v in manifest.items() if k != "manifest_sha256"})
        f_medium = {"id": "F1", "severity": "medium", "title": "medium finding"}
        f_low = {"id": "F2", "severity": "low", "title": "low finding"}
        reviews = []
        for effort in report.EFFORTS:
            reviews.extend([record(manifest, "case-0", effort, findings=[f_medium], build_models=[]),
                            record(manifest, "case-1", effort, status="ok_partial", findings=[f_low], latency=20,
                                   build_models=[{"id": "builder-a"}]),
                            record(manifest, "case-2", effort, findings=[], latency=30, cost=0.2)])
        comps = {"curated": manifest["comparators"]["curated"],
                 "pr_export_by_head": manifest["comparators"]["pr_export_by_head"]}
        decisions = [
            {"case_id": "case-0", "finding_id": "hist-phase", "source": "curated", "category": "matched", "evidence_refs": ["impl.md:1"]},
            {"case_id": "case-0", "finding_id": "hist-unmatched", "source": "curated", "category": "unmatched"},
            {"case_id": "case-1", "finding_id": "pr-review", "source": "pr_export", "category": "partial", "context_tags": ["missing_context"]},
            {"case_id": "case-0", "effort": "high", "finding_id": "F1", "category": "new-valid"},
            {"case_id": "case-1", "effort": "high", "finding_id": "F2", "category": "disputed"},
            {"case_id": "case-0", "effort": "xhigh", "finding_id": "F1", "category": "partial"},
            {"case_id": "case-0", "effort": "max", "finding_id": "F1", "category": "matched"},
        ]
        one = report.build_report(manifest, reviews, comps, adjudication(decisions, rate=1), 5)
        two = report.build_report(manifest, reviews, comps, adjudication(decisions, rate=1), 5)
        self.assertEqual(one, two)
        self.assertEqual(one["historical_findings"]["by_category"]["matched"], 1)
        self.assertEqual(one["historical_findings"]["by_category"]["partial"], 1)
        self.assertEqual(one["historical_findings"]["by_category"]["unmatched"], 1)
        self.assertEqual(one["historical_findings"]["items"][0]["source"], "curated")
        self.assertIn("pr_export", {item["source"] for item in one["historical_findings"]["items"]})
        self.assertEqual(one["new_findings"]["by_category"]["new-valid"], 1)
        self.assertEqual(one["new_findings"]["by_category"]["disputed"], 1)
        self.assertEqual(one["new_findings"]["by_category"]["unadjudicated"], 2)
        self.assertEqual(one["denominators"]["unadjudicated_required"], 2)
        self.assertEqual(one["usage"]["input_tokens"], 900)
        self.assertEqual(one["usage"]["output_tokens"], 180)
        self.assertEqual(one["usage"]["cost_usd"], 1.2)
        self.assertEqual(one["usage"]["latency_ms"], {"count": 9, "min": 10, "p50": 20, "p90": 30, "max": 30})
        self.assertEqual(one["usage"]["cap_comparison"], "within")
        self.assertEqual(one["outcomes"]["by_build_model"]["unknown"]["records"], 6)
        self.assertEqual(one["outcomes"]["by_build_model"]["builder-a"]["records"], 3)
        self.assertEqual(one["arms"]["high"]["partial_records"], 1)

    def test_invalid_categories_unknown_identity_and_bad_manifest_are_rejected(self):
        manifest = make_manifest(1)
        row = record(manifest, "case-0", "high", findings=[{"id": "F1", "severity": "high"}])
        with self.assertRaisesRegex(ValueError, "category"):
            report.build_report(manifest, [row], {}, adjudication([{"case_id": "case-0", "effort": "high", "finding_id": "F1", "category": "unmatched"}]))
        with self.assertRaisesRegex(ValueError, "does not match"):
            report.build_report(manifest, [row], {}, adjudication([{"case_id": "case-0", "effort": "high", "finding_id": "F2", "category": "new-valid"}]))
        bad = dict(manifest); bad["seed"] = 9
        with self.assertRaisesRegex(ValueError, "manifest_sha256"):
            report.build_report(bad, [], {}, adjudication())

    def test_missing_usage_is_not_reported_as_zero(self):
        manifest = make_manifest(1)
        row = record(manifest, "case-0", "high")
        del row["attempts"][0]["input_tokens"]
        result = report.build_report(manifest, [row], {}, adjudication())
        self.assertIsNone(result["usage"]["input_tokens"])
        self.assertEqual(result["usage"]["missing_data"]["input_token_fields"], 1)
        self.assertEqual(result["arms"]["high"]["missing_usage_fields"]["input_tokens"], 1)


if __name__ == "__main__":
    unittest.main()
