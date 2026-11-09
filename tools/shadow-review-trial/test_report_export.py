"""Certified-export provenance, refusal and canonical-cost tests; fixtures only."""
import copy
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import report
import test_report as fixtures

make_manifest = fixtures.make_manifest
record = fixtures.record
make_export = fixtures.make_export
make_ledger = fixtures.make_ledger
adjudication = fixtures.adjudication


class ReportExportTests(unittest.TestCase):
    def test_certified_export_over_500_records_reports_provenance_and_counts(self):
        manifest = make_manifest(170)
        rows, refs = [], []
        for effort in report.EFFORTS:
            for index in range(170):
                case_id = f"case-{index}"
                rows.append(record(manifest, case_id, effort))
                refs.append((case_id, effort, f"{case_id}-{effort}"))
        export = make_export(manifest, rows, page_size=100)
        result = report.build_report(manifest, export, make_ledger(manifest, refs), {}, adjudication())
        self.assertEqual(len(rows), 510)
        for effort in report.EFFORTS:
            self.assertEqual(result["arms"][effort]["completed"], 170)
            self.assertEqual(result["arms"][effort]["shortfall"], 0)
        provenance = result["provenance"]
        self.assertEqual(provenance["page_count"], 6)
        self.assertEqual(provenance["row_count"], 510)
        self.assertEqual(provenance["canonical_records"], 510)
        self.assertEqual(provenance["completed_records"], 510)
        self.assertTrue(provenance["complete"])
        self.assertEqual(provenance["terminal"], {"complete": True, "cursor_out": None})
        self.assertNotIn("record_limit_may_truncate", result)
        self.assertEqual(result["usage"]["cost_usd"], 51.0)
        self.assertEqual(result["denominators"]["canonical_records"], 510)

    def test_partial_looping_missing_truncated_error_and_legacy_exports_refuse(self):
        manifest = make_manifest(3)
        rows = [record(manifest, f"case-{i}", "high") for i in range(3)]
        refs = [(f"case-{i}", "high", f"case-{i}-high") for i in range(3)]
        ledger = make_ledger(manifest, refs)

        def build(**kwargs):
            return make_export(manifest, rows, page_size=1, **kwargs)

        with self.assertRaisesRegex(ValueError, "must be an object"):
            report.build_report(manifest, rows, ledger, {}, adjudication())
        with self.assertRaisesRegex(ValueError, "certified saved export"):
            report.build_report(manifest, {"reviews": rows}, ledger, {}, adjudication())

        partial = build(); partial["complete"] = False
        with self.assertRaisesRegex(ValueError, "not complete"):
            report.build_report(manifest, partial, ledger, {}, adjudication())

        missing = build(); del missing["pages"][0]["complete"]
        with self.assertRaisesRegex(ValueError, "completion metadata"):
            report.build_report(manifest, missing, ledger, {}, adjudication())

        truncated = build(); truncated["pages"][0]["row_count"] = 5
        with self.assertRaisesRegex(ValueError, "row_count"):
            report.build_report(manifest, truncated, ledger, {}, adjudication())

        mismatched = build(); mismatched["pages"][0]["row_ids_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "digest"):
            report.build_report(manifest, mismatched, ledger, {}, adjudication())

        error_page = build(); error_page["pages"][0]["error"] = "read failed"
        with self.assertRaisesRegex(ValueError, "error or truncated"):
            report.build_report(manifest, error_page, ledger, {}, adjudication())

        loop = build(); loop["pages"][1]["cursor_out"] = loop["pages"][0]["cursor_out"]
        loop["pages"][2]["cursor_in"] = loop["pages"][0]["cursor_out"]
        with self.assertRaisesRegex(ValueError, "cycle"):
            report.build_report(manifest, loop, ledger, {}, adjudication())

        no_cursor = build(); no_cursor["pages"][0]["cursor_out"] = None
        with self.assertRaisesRegex(ValueError, "advancing cursor"):
            report.build_report(manifest, no_cursor, ledger, {}, adjudication())

    def test_only_frozen_run_canonical_records_contribute_completion_and_cost(self):
        manifest = make_manifest(2)
        rows = [record(manifest, "case-0", "high"), record(manifest, "case-1", "high")]
        unrelated_tenant = record(manifest, "case-0", "high", rid="tenant-pass", cost=10)
        unrelated_tenant["tenant_id"] = "other-tenant"
        unrelated_run = record(manifest, "case-0", "high", rid="run-pass", run_id="other-run", cost=10)
        duplicate = record(manifest, "case-0", "high", rid="duplicate-pass", cost=99)
        rows.extend([unrelated_tenant, unrelated_run, duplicate])
        export = make_export(manifest, rows)
        ledger = make_ledger(manifest, [("case-0", "high", "case-0-high"), ("case-1", "high", "case-1-high")])
        result = report.build_report(manifest, export, ledger, {}, adjudication())
        self.assertEqual(result["arms"]["high"]["completed"], 2)
        self.assertEqual(result["usage"]["cost_usd"], 0.2)
        self.assertEqual(result["excluded_records"]["unrelated_tenant"], 1)
        self.assertEqual(result["excluded_records"]["unrelated_run"], 1)
        self.assertEqual(result["excluded_records"]["duplicate_receipt"], 1)
        self.assertEqual(result["denominators"]["canonical_records"], 2)

    def test_ledger_canonical_identity_must_be_unique_and_belong_to_the_run(self):
        manifest = make_manifest(1)
        row = record(manifest, "case-0", "high")
        export, ledger = make_export(manifest, [row]), make_ledger(manifest, [("case-0", "high", "case-0-high")])

        missing = make_ledger(manifest, [("case-0", "high", "absent")])
        with self.assertRaisesRegex(ValueError, "missing from the export"):
            report.build_report(manifest, export, missing, {}, adjudication())

        repeated = make_ledger(manifest, [("case-0", "high", "case-0-high"),
                                          ("case-0", "high", "case-0-high")])
        with self.assertRaisesRegex(ValueError, "more than once"):
            report.build_report(manifest, export, repeated, {}, adjudication())

        wrong_run = copy.deepcopy(export)
        wrong_run["reviews"][0]["tags"] = ["trial:other", "effort:high",
                                           "manifest:" + manifest["manifest_sha256"],
                                           report._case_tag("case-0")]
        with self.assertRaisesRegex(ValueError, "does not belong"):
            report.build_report(manifest, wrong_run, ledger, {}, adjudication())

        wrong_tenant = copy.deepcopy(export)
        wrong_tenant["reviews"][0]["tenant_id"] = "other-tenant"
        with self.assertRaisesRegex(ValueError, "another tenant"):
            report.build_report(manifest, wrong_tenant, ledger, {}, adjudication())

        wrong_manifest = copy.deepcopy(export)
        wrong_manifest["manifest_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "manifest_sha256"):
            report.build_report(manifest, wrong_manifest, ledger, {}, adjudication())

        uncertified = make_manifest(1)
        uncertified["history"]["shallow"] = True
        uncertified = fixtures.freeze({k: v for k, v in uncertified.items() if k != "manifest_sha256"})
        with self.assertRaisesRegex(ValueError, "not certified"):
            report.build_report(uncertified, export, ledger, {}, adjudication())

        wrong_ledger_run = make_ledger(manifest, [("case-0", "high", "case-0-high")], run_id="other-run")
        with self.assertRaisesRegex(ValueError, "run_id"):
            report.build_report(manifest, export, wrong_ledger_run, {}, adjudication())


if __name__ == "__main__":
    unittest.main()
