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


def refreeze(manifest):
    return freeze({key: value for key, value in manifest.items() if key != "manifest_sha256"})


def phase3_manifest(count):
    """A Phase 3-shaped manifest with every case uncensored until a test says otherwise."""
    manifest = make_manifest(count, target=count, phase3=True)
    for case in manifest["cases"]:
        case["censored"] = False
    manifest["censored"] = 0
    return refreeze(manifest)


def outcome_finding(path, start, end, severity, excerpt, kind="review_finding"):
    return {"kind": kind, "source": "REVIEW.md", "path": path, "commit": "recorded",
            "blob": "blob", "line_start": start, "line_end": end,
            "severity": severity, "excerpt": excerpt}


def later_fix(sha, subject, path, start, end):
    return {"sha": sha, "subject": subject, "paths": [path],
            "hunks": [{"path": path, "start": start, "end": end}]}



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


    def test_comparisons_a_to_e_report_rates_and_nulls(self):
        manifest = phase3_manifest(4)
        cases = {case["case_id"]: case for case in manifest["cases"]}
        cases["case-0"]["outcomes"] = [
            outcome_finding("src/a.py", 10, 20, "High", "missing nil check in loader"),
            outcome_finding("src/b.py", 50, 60, "low", "rename counter variable"),
            outcome_finding("docs/REVIEW.md", 1, 1, None, "Verdict: FAIL", kind="review_verdict"),
        ]
        cases["case-1"]["outcomes"] = [outcome_finding("docs/REVIEW.md", 1, 1, None, "Verdict: PASS",
                                                       kind="review_verdict")]
        cases["case-1"]["later_fixes"] = [
            later_fix("f1", "missing nil check in loader", "src/a.py", 12, 14),
            later_fix("f2", "unrelated cleanup", "src/z.py", 100, 110),
        ]
        cases["case-2"]["censored"] = True
        cases["case-2"]["outcomes"] = [outcome_finding("docs/REVIEW.md", 1, 1, None, "Verdict: PASS",
                                                       kind="review_verdict")]
        cases["case-2"]["later_fixes"] = [later_fix("f3", "unrelated change", "src/a.py", 10, 20)]
        manifest["censored"] = 1
        manifest = refreeze(manifest)

        findings = [
            {"id": "H1", "severity": "high", "path": "src/a.py", "line_start": 10, "line_end": 20,
             "title": "nil check", "evidence": "missing nil check in loader"},
            {"id": "H2", "severity": "medium", "path": "src/c.py", "line_start": 1, "line_end": 5,
             "title": "extra", "evidence": "extra finding about caching"},
            {"id": "H3", "severity": "medium", "path": "src/d.py", "line_start": 1, "line_end": 5,
             "title": "odd", "evidence": "odd finding about logging"},
            {"id": "H4", "severity": "medium", "path": "src/e.py", "line_start": 1, "line_end": 5,
             "title": "misc", "evidence": "misc finding about routing"},
        ]
        rows = [record(manifest, "case-0", "high", findings=findings),
                record(manifest, "case-1", "high", findings=[
                    {"id": "I1", "severity": "medium", "path": "src/a.py", "line_start": 12, "line_end": 14,
                     "title": "nil", "evidence": "missing nil check in loader"}]),
                record(manifest, "case-2", "high", findings=[])]
        refs = [(case_id, "high", f"{case_id}-high") for case_id in ("case-0", "case-1", "case-2")]
        decisions = [
            {"case_id": "case-0", "effort": "high", "finding_id": "H2", "category": "valid"},
            {"case_id": "case-0", "effort": "high", "finding_id": "H3", "category": "unknown"},
        ]
        result = report_for(manifest, rows, refs, decisions=decisions)
        comparisons = result["comparisons"]

        recall = comparisons["finding_recall"]["by_effort"]["high"]
        self.assertEqual((recall["matched"], recall["recorded"], recall["recall"]), (1, 2, 0.5))
        self.assertEqual(recall["null"]["recorded"], 2)
        self.assertEqual(recall["null"]["matched"], 0)
        self.assertEqual(recall["null"]["recall"], 0.0)
        self.assertEqual(comparisons["finding_recall"]["by_tier"]["phase"],
                         {"matched": 1, "recorded": 2, "recall": 0.5,
                          "null": {"matched": 0, "recorded": 0, "recall": None}})

        fix = comparisons["fix_recall"]
        self.assertEqual((fix["uncensored_cases"], fix["censored_excluded"]), (2, 1))
        self.assertEqual(fix["by_effort"]["high"],
                         {"matched": 1, "hunks": 2, "recall": 0.5,
                          "null": {"matched": 0, "hunks": 0, "recall": None}})
        self.assertEqual(fix["by_tier"]["unit"],
                         {"matched": 1, "hunks": 2, "recall": 0.5,
                          "null": {"matched": 0, "hunks": 0, "recall": None}})

        self.assertEqual(comparisons["corroboration"]["by_effort"]["high"],
                         {"findings": 5, "corroborated": 2, "valid": 1, "invalid": 0,
                          "unknown": 1, "unadjudicated": 1, "rate": 0.6})
        verdict = comparisons["verdict_agreement"]["by_effort"]["high"]
        self.assertEqual(verdict["cases"], 3)
        self.assertEqual(verdict["matrix"], {"pass": {"pass": 2, "fail": 0},
                                             "fail": {"pass": 0, "fail": 1}})
        self.assertEqual(verdict["agreement"], 1.0)
        self.assertEqual(comparisons["severity_agreement"]["by_effort"]["high"],
                         {"pairs": 1, "agree": 1, "rate": 1.0})
        self.assertEqual(result["validation"]["matching"]["matches"], 2)
        self.assertEqual(result["validation"]["matching"]["method_counts"],
                         {"structural": 2, "adjudicated": 0})

    def test_validation_method_tags_kappa_and_leak_check(self):
        manifest = phase3_manifest(2)
        cases = {case["case_id"]: case for case in manifest["cases"]}
        cases["case-0"]["outcomes"] = [
            outcome_finding("src/a.py", 10, 20, "medium", "missing nil check in loader"),
            outcome_finding("src/b.py", 30, 40, "low", "unused import cleanup"),
        ]
        for case in manifest["cases"]:
            case["base_sha"] = "b" * 40
            case["criteria"] = {"source": "base_blob", "text": "design criteria", "content_hash": "criteria-hash"}
            case["build_models"] = {"source": "unknown", "models": []}
            case["capture"] = {"repo_id": "repo", "mode": "range", "view": "diff",
                               "base": "b" * 40, "head": case["head_sha"],
                               "diff": "diff --git a/src/a.py b/src/a.py context",
                               "diff_sha256": "d" * 64, "complete": True}
        cases["case-0"]["capture"]["diff"] = "diff with leaked outcome: missing nil check in loader"
        manifest["run_order"] = [case["case_id"] for case in manifest["cases"]]
        manifest = refreeze(manifest)

        rows = [record(manifest, "case-0", "high", findings=[
            {"id": "U1", "severity": "medium", "path": "src/moved_a.py", "line_start": 10, "line_end": 20,
             "title": "nil check", "evidence": "missing nil check in loader"},
            {"id": "U2", "severity": "medium", "path": "src/moved_b.py", "line_start": 30, "line_end": 40,
             "title": "imports", "evidence": "unused import cleanup"}])]
        decisions = {"version": 1, "low_sample_rate": 1.0, "labeler_model": "labeler-a",
                     "second_labeler_model": "labeler-b", "findings": [
                         {"case_id": "case-0", "effort": "high", "finding_id": "U1", "category": "matched",
                          "second_label": "matched"},
                         {"case_id": "case-0", "effort": "high", "finding_id": "U2", "category": "partial",
                          "second_label": "matched"}]}
        export = make_export(manifest, rows)
        ledger = make_ledger(manifest, [("case-0", "high", "case-0-high")])
        result = report.build_report(manifest, export, ledger, {}, decisions)

        matching_validation = result["validation"]["matching"]
        self.assertEqual(matching_validation["matches"], 2)
        self.assertEqual(matching_validation["method_counts"], {"structural": 0, "adjudicated": 2})
        self.assertEqual(matching_validation["uncertain_band"], 2)
        adjudication_validation = result["validation"]["adjudication"]
        self.assertEqual(adjudication_validation["double_labelled"], 2)
        self.assertEqual(adjudication_validation["kappa"], 0.0)
        self.assertEqual(adjudication_validation["labeler_model"], "labeler-a")
        self.assertEqual(adjudication_validation["second_labeler_model"], "labeler-b")
        leak = result["validation"]["leak_check"]
        self.assertFalse(leak["pass"])
        self.assertEqual(leak["request_errors"], [])
        self.assertGreaterEqual(leak["outcome_text_hits"], 1)
        self.assertEqual(result["validation"]["shuffled_null"], {"seed": 23, "method": "shuffled_case_map"})

    def test_deterministic_report_bytes_and_censored_fix_recall(self):
        manifest = phase3_manifest(2)
        cases = {case["case_id"]: case for case in manifest["cases"]}
        cases["case-0"]["later_fixes"] = [later_fix("f1", "missing nil check in loader", "src/a.py", 10, 20)]
        cases["case-1"]["censored"] = True
        cases["case-1"]["later_fixes"] = [later_fix("f2", "missing nil check in loader", "src/a.py", 10, 20),
                                          later_fix("f3", "other fix", "src/a.py", 30, 40)]
        manifest["censored"] = 1
        manifest = refreeze(manifest)
        finding = [{"id": "F1", "severity": "medium", "path": "src/a.py", "line_start": 10, "line_end": 20,
                    "title": "nil", "evidence": "missing nil check in loader"}]
        rows = [record(manifest, "case-0", "high", findings=finding),
                record(manifest, "case-1", "high", findings=finding)]
        refs = [("case-0", "high", "case-0-high"), ("case-1", "high", "case-1-high")]
        one = report_for(manifest, rows, refs)
        two = report_for(manifest, rows, refs)
        self.assertEqual(json.dumps(one, sort_keys=True), json.dumps(two, sort_keys=True))
        fix = one["comparisons"]["fix_recall"]
        self.assertEqual(fix["by_effort"]["high"]["hunks"], 1)
        self.assertEqual(fix["by_effort"]["high"]["matched"], 1)
        self.assertEqual((fix["uncensored_cases"], fix["censored_excluded"]), (1, 1))
        self.assertEqual(fix["by_tier"]["unit"], {"matched": 0, "hunks": 0, "recall": None,
                                                  "null": {"matched": 0, "hunks": 0, "recall": None}})


if __name__ == "__main__":
    unittest.main()
