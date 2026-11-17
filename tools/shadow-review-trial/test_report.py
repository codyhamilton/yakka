"""Fixture-only tests for report.py; no provider or network access."""
import hashlib
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import report

RUN = "run-1"
TENANT = "tenant-trial"


def freeze(value):
    value["manifest_sha256"] = hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return value


def make_manifest(count, target=None, *, phase3=False, floor=None, censored=None):
    history = {"repository": "codyhamilton/yakka", "tip_sha": "a" * 40,
               "shallow": False, "object_complete": True,
               "enumerated_commits": 3, "verified_count": 3}
    if phase3:
        tiers = ("phase", "unit", "pr")
        cases = [{"case_id": f"case-{i}", "head_sha": f"case-{i}", "eligible": True,
                  "tier": tiers[i % len(tiers)], "stratum": tiers[i % len(tiers)],
                  "outcomes": [], "later_fixes": [], "censored": i == 0,
                  "criteria": {"source": "base_blob"}} for i in range(count)]
        counts = {name: {"candidates": sum(c["tier"] == name for c in cases),
                         "eligible": sum(c["tier"] == name for c in cases),
                         "frozen": sum(c["tier"] == name for c in cases)} for name in tiers}
        target_value = target if target is not None else count
        floor_value = floor if floor is not None else target_value
        manifest = {"schema_version": 1, "seed": 23, "target": target_value,
                    "target_per_effort": target_value, "floor": floor_value,
                    "tiers": counts, "exclusions": {"no_tier": 4}, "excluded_total": 4,
                    "censored": censored if censored is not None else sum(c["censored"] for c in cases),
                    "shortfall_against_floor": max(0, floor_value - count),
                    "history": history, "cases": cases,
                    "comparators": {"curated": [], "pr_export_by_head": {}}}
        return freeze(manifest)
    strata = ("phase", "pr", "unaccompanied")
    cases = []
    for i in range(count):
        cases.append({"case_id": f"case-{i}", "head_sha": f"case-{i}", "eligible": True,
                      "stratum": strata[i % len(strata)]})
    return freeze({"schema_version": 1, "seed": 23, "target_per_effort": target or count,
                   "history": history,
                   "cases": cases, "comparators": {"curated": [], "pr_export_by_head": {}}})


def record(manifest, case_id, effort, *, run_id=RUN, status="ok", rid=None, model=report.REVIEWER_MODEL,
           build_models=None, findings=None, latency=10, cost=0.1, input_tokens=100, output_tokens=20):
    return {"id": rid or f"{case_id}-{effort}",
            "tags": ["trial:" + run_id, "effort:" + effort, "manifest:" + manifest["manifest_sha256"],
                     "case:" + hashlib.sha256(case_id.encode()).hexdigest()],
            "configured_model": report.REVIEWER_MODEL, "returned_model": model,
            "model_mismatch": model != report.REVIEWER_MODEL, "status": status,
            "build_models": build_models or [],
            "attempts": [{"status": "ok" if status in ("ok", "ok_partial") else status,
                          "latency_ms": latency, "cost_usd": cost, "input_tokens": input_tokens,
                          "output_tokens": output_tokens}],
            "payload": {"findings": findings or [], "coverage": "partial" if status == "ok_partial" else "complete"}}


def make_export(manifest, records, *, run_id=RUN, tenant=TENANT, page_size=500):
    rows = list(records)
    pages, cursor, offset = [], None, 0
    while True:
        page_rows = rows[offset:offset + page_size]
        offset += len(page_rows)
        complete = offset >= len(rows)
        cursor_out = None if complete else f"cursor-{offset}"
        pages.append({"cursor_in": cursor, "cursor_out": cursor_out, "complete": complete,
                      "row_count": len(page_rows),
                      "row_ids_sha256": report._canonical_hash([row["id"] for row in page_rows])})
        if complete:
            break
        cursor = cursor_out
    return {"schema_version": 1, "manifest_sha256": manifest["manifest_sha256"], "run_id": run_id,
            "tenant_id": tenant, "filters": {"tags": ["manifest:" + manifest["manifest_sha256"], "trial:" + run_id]},
            "detail": "full", "limit": page_size, "pages": pages, "complete": True, "reviews": rows}


def make_ledger(manifest, refs, *, run_id=RUN, tenant=TENANT):
    entries = {f"entry-{index}": {"case_id": case_id, "effort": effort, "state": "complete",
                                  "canonical_review_id": identity}
               for index, (case_id, effort, identity) in enumerate(refs)}
    return {"schema_version": 1, "manifest_hash": manifest["manifest_sha256"], "run_id": run_id,
            "tenant_id": tenant, "entries": entries}


def adjudication(rows=(), rate=1.0):
    return {"version": 1, "low_sample_rate": rate, "findings": list(rows)}


def report_for(manifest, records, refs, comparators=None, decisions=None, **export_kwargs):
    return report.build_report(manifest, make_export(manifest, records, **export_kwargs),
                               make_ledger(manifest, refs), comparators or {},
                               adjudication(decisions or ()))


class AlignmentReportTests(unittest.TestCase):
    def test_50_per_effort_attains_target_and_49_shortfall_is_one(self):
        manifest50 = make_manifest(50)
        rows50 = [record(manifest50, f"case-{i}", e) for e in report.EFFORTS for i in range(50)]
        refs50 = [(f"case-{i}", e, f"case-{i}-{e}") for e in report.EFFORTS for i in range(50)]
        result50 = report_for(manifest50, rows50, refs50)
        for e in report.EFFORTS:
            self.assertEqual(result50["arms"][e]["completed"], 50)
            self.assertEqual(result50["arms"][e]["shortfall"], 0)
        manifest49 = make_manifest(49, target=50)
        rows49 = [record(manifest49, f"case-{i}", e) for e in report.EFFORTS for i in range(49)]
        refs49 = [(f"case-{i}", e, f"case-{i}-{e}") for e in report.EFFORTS for i in range(49)]
        result49 = report_for(manifest49, rows49, refs49)
        for e in report.EFFORTS:
            self.assertEqual(result49["arms"][e]["shortfall"], 1)

    def test_asymmetric_failures_duplicates_and_model_mismatch_do_not_pad(self):
        manifest = make_manifest(3)
        rows = [record(manifest, "case-0", "high"), record(manifest, "case-0", "high", rid="duplicate"),
                record(manifest, "case-1", "high", status="timeout"),
                record(manifest, "case-0", "xhigh"), record(manifest, "case-1", "xhigh"),
                record(manifest, "case-2", "max"),
                record(manifest, "case-1", "max", model="claude-haiku-5-5-20251001"),
                record(manifest, "case-2", "high", run_id="other-run")]
        refs = [("case-0", "high", "case-0-high"), ("case-1", "high", "case-1-high"),
                ("case-0", "xhigh", "case-0-xhigh"), ("case-1", "xhigh", "case-1-xhigh"),
                ("case-2", "max", "case-2-max"), ("case-1", "max", "case-1-max")]
        result = report_for(manifest, rows, refs)
        self.assertEqual([result["arms"][e]["completed"] for e in report.EFFORTS], [1, 2, 1])
        self.assertEqual(result["paired_intersection"]["completed_cases"], 0)
        self.assertEqual(result["records_by_status"]["timeout"], 1)
        self.assertEqual(result["attempts_by_status"]["ok"], 4)
        self.assertEqual(result["excluded_records"]["duplicate_receipt"], 1)
        self.assertEqual(result["excluded_records"]["mismatched_model"], 1)
        self.assertEqual(result["excluded_records"]["non_completed_status"], 1)
        self.assertEqual(result["excluded_records"]["unrelated_run"], 1)

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
        reviews, refs = [], []
        for effort in report.EFFORTS:
            reviews.extend([record(manifest, "case-0", effort, findings=[f_medium], build_models=[]),
                            record(manifest, "case-1", effort, status="ok_partial", findings=[f_low], latency=20,
                                   build_models=[{"id": "builder-a"}]),
                            record(manifest, "case-2", effort, findings=[], latency=30, cost=0.2)])
            refs.extend([("case-0", effort, "case-0-" + effort), ("case-1", effort, "case-1-" + effort),
                         ("case-2", effort, "case-2-" + effort)])
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
        one = report_for(manifest, reviews, refs, comps, decisions)
        two = report_for(manifest, reviews, refs, comps, decisions)
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
        self.assertEqual(one["outcomes"]["by_build_model"]["unknown"]["records"], 6)
        self.assertEqual(one["outcomes"]["by_build_model"]["builder-a"]["records"], 3)
        self.assertEqual(one["arms"]["high"]["partial_records"], 1)

    def test_invalid_categories_unknown_identity_and_bad_manifest_are_rejected(self):
        manifest = make_manifest(1)
        row = record(manifest, "case-0", "high", findings=[{"id": "F1", "severity": "high"}])
        export, ledger = make_export(manifest, [row]), make_ledger(manifest, [("case-0", "high", "case-0-high")])
        with self.assertRaisesRegex(ValueError, "category"):
            report.build_report(manifest, export, ledger, {},
                                adjudication([{"case_id": "case-0", "effort": "high", "finding_id": "F1", "category": "unmatched"}]))
        with self.assertRaisesRegex(ValueError, "does not match"):
            report.build_report(manifest, export, ledger, {},
                                adjudication([{"case_id": "case-0", "effort": "high", "finding_id": "F2", "category": "new-valid"}]))
        bad = dict(manifest); bad["seed"] = 9
        with self.assertRaisesRegex(ValueError, "manifest_sha256"):
            report.build_report(bad, export, ledger, {}, adjudication())

    def test_skipped_busy_and_legacy_skipped_budget_are_visible_and_not_completions(self):
        manifest = make_manifest(2)
        busy = record(manifest, "case-0", "high", status="skipped_busy", rid="busy")
        legacy = record(manifest, "case-1", "high", status="skipped_budget", rid="legacy")
        for row in (busy, legacy):
            row["attempts"] = [{"status": row["status"]}]
        result = report_for(manifest, [busy, legacy], [("case-0", "high", "busy"), ("case-1", "high", "legacy")])
        self.assertEqual(result["records_by_status"]["skipped_busy"], 1)
        self.assertEqual(result["records_by_status"]["skipped_budget"], 1)
        self.assertEqual(result["arms"]["high"]["completed"], 0)
        self.assertEqual(result["usage"]["cost_usd"], 0.0)
        self.assertEqual(result["usage"]["unknown_cost_entries"], 0)

    def test_missing_usage_is_not_reported_as_zero(self):
        manifest = make_manifest(1)
        row = record(manifest, "case-0", "high")
        del row["attempts"][0]["input_tokens"]
        result = report_for(manifest, [row], [("case-0", "high", "case-0-high")])
        self.assertIsNone(result["usage"]["input_tokens"])
        self.assertEqual(result["usage"]["missing_data"]["input_token_fields"], 1)
        self.assertEqual(result["arms"]["high"]["missing_usage_fields"]["input_tokens"], 1)

    def test_phase3_manifest_population_and_floor_shortfall(self):
        manifest = make_manifest(3, target=6, phase3=True, floor=5, censored=2)
        rows = [record(manifest, f"case-{i}", e) for e in report.EFFORTS for i in range(3)]
        rows.append(record(manifest, "case-0", "high", rid="duplicate-case-0-high"))
        refs = [(f"case-{i}", e, f"case-{i}-{e}") for e in report.EFFORTS for i in range(3)]
        result = report_for(manifest, rows, refs)
        population = result["population"]
        self.assertEqual(population["eligible"], 3)
        self.assertEqual(population["frozen"], 3)
        self.assertEqual(population["target"], 6)
        self.assertEqual(population["floor"], 5)
        self.assertEqual(population["censored"], 2)
        self.assertEqual(population["shortfall_against_floor"], 2)
        self.assertEqual(population["by_tier"],
                         {"phase": {"eligible": 1, "frozen": 1},
                          "unit": {"eligible": 1, "frozen": 1},
                          "pr": {"eligible": 1, "frozen": 1}})
        self.assertEqual(population["exclusions"]["manifest"], {"no_tier": 4})
        self.assertEqual(population["exclusions"]["run"]["duplicate_receipt"], 1)
        for effort in report.EFFORTS:
            self.assertEqual(result["arms"][effort]["floor"], 5)
            self.assertEqual(result["arms"][effort]["shortfall_against_floor"], 2)
            self.assertEqual(population["by_effort"][effort]["completed"], 3)
            self.assertEqual(population["by_effort"][effort]["shortfall_against_floor"], 2)
        self.assertEqual(population["by_effort"]["high"]["attempted"], 4)
        self.assertEqual(population["by_effort"]["high"]["failed"], 1)
        self.assertEqual(population["by_effort"]["high"]["by_tier"]["phase"],
                         {"attempted": 2, "completed": 1})

    def test_legacy_manifest_aliases_still_read(self):
        manifest = make_manifest(3, target=50)
        rows = [record(manifest, f"case-{i}", e) for e in report.EFFORTS for i in range(3)]
        refs = [(f"case-{i}", e, f"case-{i}-{e}") for e in report.EFFORTS for i in range(3)]
        result = report_for(manifest, rows, refs)
        self.assertEqual(result["population"]["target"], 50)
        self.assertEqual(result["population"]["floor"], 50)
        self.assertEqual(result["population"]["shortfall_against_floor"], 47)
        self.assertEqual(result["population"]["by_tier"],
                         {"phase": {"eligible": 1, "frozen": 1},
                          "unit": {"eligible": 0, "frozen": 0},
                          "pr": {"eligible": 1, "frozen": 1},
                          "unaccompanied": {"eligible": 1, "frozen": 1}})
        for effort in report.EFFORTS:
            self.assertEqual(result["arms"][effort]["floor"], 50)
            self.assertEqual(result["arms"][effort]["completed"], 3)


if __name__ == "__main__":
    unittest.main()
