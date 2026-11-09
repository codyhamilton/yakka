"""Fixture-only contracts for the historical trial runner."""
import hashlib
import importlib
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
runner = importlib.import_module("runner")


def frozen(cases):
    entries = []
    for index in range(cases):
        cid = f"case-{index:03d}"
        diff = f"diff --git a/pkg/{cid}.py b/pkg/{cid}.py\n+old\n+new {cid}\n"
        entries.append({
            "case_id": cid, "eligible": True, "eligibility_reason": "eligible", "stratum": "unaccompanied",
            "base_sha": "a" * 40, "head_sha": f"{index + 1:040x}",
            "capture": {"repo_id": "fixture/repo", "mode": "range", "view": "combined",
                        "base": "a" * 40, "head": f"{index + 1:040x}", "merge_base": False,
                        "diff": diff, "diff_sha256": hashlib.sha256(diff.encode()).hexdigest(),
                        "files": [], "manifest": [], "complete": True},
            "criteria": {"source": "head_blob", "path": "docs/plans/fixture/DESIGN.md",
                         "content_hash": f"{index + 1:040x}", "text": f"Frozen criterion for {cid}"},
            "build_models": {"source": "unknown", "models": []},
            "settings": {"kind": "range", "merge_base": False, "review_profile": "historical_trial",
                         "trial_id": "phase-6-frozen"},
        })
    body = {"schema_version": 1, "manifest_sha256": None, "target_per_effort": 50,
            "cases": entries, "run_order": [c["case_id"] for c in entries],
            "settings": {"efforts": ["high", "xhigh", "max"]}}
    body["manifest_sha256"] = runner._sha(runner._canonical({k: v for k, v in body.items() if k != "manifest_sha256"}))
    return body


class FakeREST:
    def __init__(self, behavior=None, estimate=0.25):
        self.behavior = behavior or (lambda case, effort: ("ok", "claude-haiku-5-5"))
        self.estimate = estimate
        self.requests = []
        self.records = []
        self.model_calls = 0
        self.get_calls = 0

    def request(self, method, url, headers, body, timeout):
        if headers.get("Authorization") != "Bearer fixture-auth":
            return 401, b'{"error":"fixture auth missing"}'
        if method == "POST":
            payload = json.loads(body)
            self.requests.append(payload)
            trial = payload["trial"]
            if payload["dry_run"]:
                return 200, json.dumps({"status": "dry_run", "estimated_usd": self.estimate}).encode()
            self.model_calls += 1
            status, model = self.behavior(trial["case_id"], trial["effort"])
            if status == "skipped_duplicate":
                canonical_id = f"canonical-{trial['case_id']}-{trial['effort']}"
                self.records.append(self.record(trial, "ok", model, canonical_id))
                receipt = {"id": "duplicate-receipt", "status": status, "reason": canonical_id}
            else:
                receipt = {"id": f"receipt-{trial['case_id']}-{trial['effort']}", "status": status,
                           "attempts": [{"number": 1, "status": "timeout"}, {"number": 2, "status": status}]}
                if status in {"ok", "ok_partial"}:
                    self.records.append(self.record(trial, status, model, receipt["id"]))
            return 200, json.dumps(receipt).encode()
        self.get_calls += 1
        return 200, json.dumps({"reviews": self.records}).encode()

    @staticmethod
    def record(trial, status, model, record_id):
        return {"id": record_id, "manifest_hash": trial["manifest_hash"], "case_id": trial["case_id"],
                "effective_effort": trial["effort"], "returned_model": model, "status": status}


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.manifest_path = self.root / "manifest.json"
        self.ledger_path = self.root / "run-ledger.json"

    def execute(self, count, fake, cap=1000, execute=True, config_id="default"):
        data = frozen(count)
        self.manifest_path.write_text(json.dumps(data), encoding="utf-8")
        client = runner.TrialRunner("http://fixture.invalid", lambda: "fixture-auth", fake)
        return runner.run(self.manifest_path, self.ledger_path, client, cap, "claude-haiku-5-5",
                          execute=execute, config_id=config_id)

    def test_dry_run_has_no_model_calls_and_projects_retry_inclusive_all_arms(self):
        fake = FakeREST(estimate=0.25)
        summary = self.execute(2, fake, execute=False)
        self.assertEqual(fake.model_calls, 0)
        self.assertEqual(len(fake.requests), 6)
        self.assertEqual([r["trial"]["effort"] for r in fake.requests], ["high", "xhigh", "max"] * 2)
        self.assertEqual(summary["projected_usd"], 3.0)
        self.assertEqual(len(summary["estimates"]), 6)
        self.assertTrue(all(r["retry_inclusive_usd"] == 0.5 for r in summary["estimates"]))

    def test_build_request_uses_resolved_range_head_and_preserves_head_fixtures(self):
        data = frozen(1)
        case = data["cases"][0]
        checkout_head = "f" * 40
        case["capture"]["head"] = checkout_head
        case["capture"]["resolved_head"] = case["head_sha"]
        request = runner.build_request(data, case, "high", True)
        self.assertEqual(request["capture"]["head"], case["head_sha"])
        self.assertEqual(request["capture"]["base"], case["base_sha"])

        del case["capture"]["resolved_head"]
        case["capture"]["head"] = case["head_sha"]
        fixture_request = runner.build_request(data, case, "high", True)
        self.assertEqual(fixture_request["capture"]["head"], case["head_sha"])

        case["capture"]["resolved_head"] = "e" * 40
        with self.assertRaisesRegex(runner.RunnerError, "differs from its frozen range"):
            runner.build_request(data, case, "high", True)

    def test_effort_arms_change_only_trial_effort_and_cap_refusal_precedes_live_posts(self):
        fake = FakeREST(estimate=0.3)
        summary = self.execute(1, fake, cap=1.79, execute=True)
        self.assertTrue(summary["refused_over_cap"])
        self.assertEqual(fake.model_calls, 0)
        self.assertEqual(len(fake.requests), 3)
        normalized = []
        for request in fake.requests:
            request = json.loads(json.dumps(request))
            request["trial"]["effort"] = "ARM"
            request["dry_run"] = False
            normalized.append(request)
        self.assertEqual(normalized[0], normalized[1])
        self.assertEqual(normalized[1], normalized[2])
        self.assertEqual(fake.requests[0]["allow_superseded"], True)

    def test_fifty_cases_complete_each_arm_without_padding(self):
        summary = self.execute(50, FakeREST())
        self.assertEqual(summary["paired_completed"], 50)
        self.assertEqual({k: v["completed"] for k, v in summary["arms"].items()},
                         {"high": 50, "xhigh": 50, "max": 50})
        self.assertTrue(all(v["shortfall"] == 0 for v in summary["arms"].values()))

    def test_forty_nine_cases_report_shortfall_without_padding(self):
        summary = self.execute(49, FakeREST())
        self.assertEqual(summary["paired_completed"], 49)
        self.assertTrue(all(v["eligible"] == 49 and v["completed"] == 49 and v["shortfall"] == 1
                            for v in summary["arms"].values()))

    def test_asymmetric_failures_partial_model_mismatch_and_retries_remain_visible(self):
        def behavior(case, effort):
            if case == "case-000" and effort == "high":
                return "timeout", "claude-haiku-5-5"
            if case == "case-001" and effort == "xhigh":
                return "ok_partial", "claude-haiku-5-5"
            if case == "case-002" and effort == "max":
                return "ok", "wrong-model"
            return "ok", "claude-haiku-5-5"
        fake = FakeREST(behavior)
        summary = self.execute(3, fake)
        self.assertEqual({k: v["completed"] for k, v in summary["arms"].items()},
                         {"high": 2, "xhigh": 3, "max": 2})
        self.assertEqual(summary["paired_completed"], 1)
        ledger = json.loads(self.ledger_path.read_text())
        entries = list(ledger["entries"].values())
        timeout = next(e for e in entries if e["case_id"] == "case-000" and e["effort"] == "high")
        partial = next(e for e in entries if e["case_id"] == "case-001" and e["effort"] == "xhigh")
        mismatch = next(e for e in entries if e["case_id"] == "case-002" and e["effort"] == "max")
        self.assertEqual(timeout["last_status"], "timeout")
        self.assertEqual(len(timeout["attempts"][-1]["receipt"]["attempts"]), 2)
        self.assertEqual(partial["last_status"], "ok_partial")
        self.assertEqual(mismatch["state"], "model_mismatch")

    def test_duplicate_receipt_resolves_canonical_record_without_counting_receipt(self):
        fake = FakeREST(lambda case, effort: ("skipped_duplicate", "claude-haiku-5-5"))
        summary = self.execute(1, fake)
        self.assertEqual(summary["arms"]["high"]["completed"], 1)
        entry = next(e for e in json.loads(self.ledger_path.read_text())["entries"].values()
                     if e["effort"] == "high")
        self.assertEqual(entry["duplicate_receipt"]["status"], "skipped_duplicate")
        self.assertTrue(entry["duplicate_resolved"])
        self.assertEqual(entry["canonical_review_id"], "canonical-case-000-high")

    def test_started_request_is_never_replayed_after_ambiguous_transport_failure(self):
        class Interrupting(FakeREST):
            def request(self, method, url, headers, body, timeout):
                if method == "POST" and json.loads(body).get("dry_run") is False:
                    self.model_calls += 1
                    raise TimeoutError("fixture timeout")
                return super().request(method, url, headers, body, timeout)
        fake = Interrupting()
        data = frozen(1)
        self.manifest_path.write_text(json.dumps(data))
        client = runner.TrialRunner("http://fixture.invalid", lambda: "fixture-auth", fake)
        runner.run(self.manifest_path, self.ledger_path, client, 100, "claude-haiku-5-5", execute=True)
        calls = fake.model_calls
        runner.run(self.manifest_path, self.ledger_path, client, 100, "claude-haiku-5-5", execute=True)
        self.assertEqual(fake.model_calls, calls)

    def test_preflight_block_is_rechecked_when_budget_configuration_changes(self):
        class BlockThenAllow(FakeREST):
            block = True
            def request(self, method, url, headers, body, timeout):
                if method == "POST" and json.loads(body).get("dry_run"):
                    payload = {"status": "skipped_budget" if self.block else "dry_run",
                               "estimated_usd": self.estimate}
                    return 200, json.dumps(payload).encode()
                return super().request(method, url, headers, body, timeout)
        fake = BlockThenAllow()
        data = frozen(1)
        self.manifest_path.write_text(json.dumps(data))
        client = runner.TrialRunner("http://fixture.invalid", lambda: "fixture-auth", fake)
        runner.run(self.manifest_path, self.ledger_path, client, 100, "claude-haiku-5-5", execute=True)
        self.assertEqual(fake.model_calls, 0)
        fake.block = False
        result = runner.run(self.manifest_path, self.ledger_path, client, 200, "claude-haiku-5-5", execute=True)
        self.assertEqual(result["paired_completed"], 1)
        self.assertEqual(fake.model_calls, 3)


if __name__ == "__main__":
    unittest.main()
