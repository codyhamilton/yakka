"""Fixture-only contracts for the historical trial runner."""
import hashlib
import importlib
import json
import pathlib
import sys
import tempfile
import unittest
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
runner = importlib.import_module("runner")
approval = importlib.import_module("approval")


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
            "history": {"repository": "fixture/repo", "remote": "origin", "remote_url": "fixture/repo",
                        "tip_sha": "a" * 40, "fetched_refs": ["refs/remotes/origin/main"],
                        "shallow": False, "object_complete": True, "enumerated_commits": cases,
                        "verified_count": cases, "shallow_boundary_shas": [], "oldest_enumerated_sha": "a" * 40},
            "settings": {"efforts": ["high", "xhigh", "max"]}}
    return rehash(body)


def rehash(body):
    body["manifest_sha256"] = runner._sha(runner._canonical({k: v for k, v in body.items() if k != "manifest_sha256"}))
    return body


class FakeREST:
    def __init__(self, behavior=None, estimate=0.25, tenant="tenant-trial", scope="read_write",
                 page_size=None, get_handler=None):
        self.behavior = behavior or (lambda case, effort: ("ok", "claude-haiku-5-5"))
        self.estimate = estimate
        self.tenant = tenant
        self.scope = scope
        self.page_size = page_size
        self.get_handler = get_handler
        self.requests = []
        self.records = []
        self.case_ids = {}
        self.events = []
        self.model_calls = 0
        self.new_calls = 0
        self.get_calls = 0
        self.get_urls = []

    def bind(self, case_ids):
        self.case_ids = {runner._sha(cid.encode()): cid for cid in case_ids}

    def _serve_reviews(self, url):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        cursor = params.get("cursor", [None])[0]
        start = int(cursor) if cursor else 0
        size = self.page_size or len(self.records) or 1
        page = self.records[start:start + size]
        end = start + len(page)
        complete = end >= len(self.records)
        return {"reviews": page, "next_cursor": None if complete else str(end), "complete": complete}

    def request(self, method, url, headers, body, timeout):
        if headers.get("Authorization") != "Bearer fixture-auth":
            return 401, b'{"error":"fixture auth missing"}'
        if method == "GET":
            if "/v1/whoami" in url:
                self.events.append("whoami")
                return 200, json.dumps({"tenant": self.tenant, "scope": self.scope, "expires_at": 0}).encode()
            self.events.append("get")
            self.get_calls += 1
            self.get_urls.append(url)
            if self.get_handler is not None:
                return self.get_handler(url, len(self.get_urls))
            return 200, json.dumps(self._serve_reviews(url)).encode()
        payload = json.loads(body)
        self.requests.append(payload)
        tags = payload["tags"]
        effort = next(tag[len("effort:"):] for tag in tags if tag.startswith("effort:"))
        case_hash = next(tag[len("case:"):] for tag in tags if tag.startswith("case:"))
        case_id = self.case_ids[case_hash]
        if payload["dry_run"]:
            self.events.append("post:dry")
            return 200, json.dumps({"status": "dry_run", "estimated_usd": self.estimate}).encode()
        self.events.append("post:run")
        self.model_calls += 1
        status, model = self.behavior(case_id, effort)
        if status == "skipped_duplicate":
            canonical_id = f"canonical-{case_id}-{effort}"
            self.records.append(self.record(tags, "ok", model, canonical_id))
            receipt = {"id": "duplicate-receipt", "status": status, "reason": canonical_id, "cached": True,
                       "original_review_id": canonical_id, "original_status": "ok",
                       "result": {"findings": []}, "coverage": {"state": "complete"}, "finding_counts": {},
                       "model": model, "effort": effort, "tags": tags,
                       "attempts": [{"number": 1, "status": "ok"}], "cost_usd": 0.0}
        else:
            self.new_calls += 1
            receipt = {"id": f"receipt-{case_id}-{effort}", "status": status, "cost_usd": 0.02,
                       "attempts": [{"number": 1, "status": "timeout", "cost_usd": 0.01},
                                    {"number": 2, "status": status, "cost_usd": 0.01}]}
            if status in {"ok", "ok_partial"}:
                self.records.append(self.record(tags, status, model, receipt["id"]))
        return 200, json.dumps(receipt).encode()

    @staticmethod
    def record(tags, status, model, record_id):
        effort = next(tag[len("effort:"):] for tag in tags if tag.startswith("effort:"))
        return {"id": record_id, "tags": tags, "effective_effort": effort, "returned_model": model,
                "status": status}


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.manifest_path = self.root / "manifest.json"
        self.ledger_path = self.root / "run-ledger.json"

    def approval_record(self, summary, ceiling=None, **overrides):
        record = {
            "schema_version": 1,
            "approval_reference": "cody-fixture-approval",
            "tenant_id": summary["tenant_id"],
            "endpoint": "http://fixture.invalid",
            "manifest_sha256": summary["manifest_hash"],
            "run_id": summary["run_id"],
            "preflight_sha256": approval.preflight_digest(summary),
            "authorized_max_usd": 1000.0 if ceiling is None else ceiling,
            "expires_at": "2999-01-01T00:00:00+00:00",
        }
        record.update(overrides)
        path = self.root / "approval.json"
        path.write_text(json.dumps(record), encoding="utf-8")
        return path

    def execute(self, count, fake, cap=1000, execute=True, config_id="default",
                run_id="run-1", tenant_id="tenant-trial", approval_path=None,
                ceiling=None, clock=None, approval_overrides=None):
        data = frozen(count)
        self.manifest_path.write_text(json.dumps(data), encoding="utf-8")
        fake.bind([case["case_id"] for case in data["cases"]])
        client = runner.TrialRunner("http://fixture.invalid", lambda: "fixture-auth", fake)
        if execute and approval_path is None:
            preflight = runner.run(self.manifest_path, self.ledger_path, client, cap, "claude-haiku-5-5",
                                   run_id=run_id, tenant_id=tenant_id, execute=False, config_id=config_id,
                                   clock=clock)
            approval_path = self.approval_record(preflight, ceiling=ceiling,
                                                 **(approval_overrides or {}))
        return runner.run(self.manifest_path, self.ledger_path, client, cap, "claude-haiku-5-5",
                          run_id=run_id, tenant_id=tenant_id, execute=execute, config_id=config_id,
                          approval_path=approval_path, clock=clock)

    def test_dry_run_has_no_model_calls_and_projects_retry_inclusive_all_arms(self):
        fake = FakeREST(estimate=0.25)
        summary = self.execute(2, fake, execute=False)
        self.assertEqual(fake.model_calls, 0)
        self.assertEqual(len(fake.requests), 6)
        self.assertEqual([r["effort"] for r in fake.requests], ["high", "xhigh", "max"] * 2)
        self.assertEqual(summary["projected_usd"], 3.0)
        self.assertEqual(len(summary["estimates"]), 6)
        self.assertTrue(all(r["retry_inclusive_usd"] == 0.5 for r in summary["estimates"]))
        self.assertTrue(summary["readiness"]["ready"])
        self.assertEqual(summary["readiness"]["blocked_efforts"], [])

    def test_build_request_uses_resolved_range_head_and_preserves_head_fixtures(self):
        data = frozen(1)
        case = data["cases"][0]
        checkout_head = "f" * 40
        case["capture"]["head"] = checkout_head
        case["capture"]["resolved_head"] = case["head_sha"]
        request = runner.build_request(data, case, "high", True, "run-1")
        self.assertEqual(request["capture"]["head"], case["head_sha"])
        self.assertEqual(request["capture"]["base"], case["base_sha"])

        del case["capture"]["resolved_head"]
        case["capture"]["head"] = case["head_sha"]
        fixture_request = runner.build_request(data, case, "high", True, "run-1")
        self.assertEqual(fixture_request["capture"]["head"], case["head_sha"])

        case["capture"]["resolved_head"] = "e" * 40
        with self.assertRaisesRegex(runner.RunnerError, "differs from its frozen range"):
            runner.build_request(data, case, "high", True, "run-1")

    def test_effort_arms_change_only_trial_effort_and_cap_refusal_precedes_live_posts(self):
        fake = FakeREST(estimate=0.3)
        summary = self.execute(1, fake, cap=1.79, execute=True)
        self.assertTrue(summary["refused_over_cap"])
        self.assertEqual(fake.model_calls, 0)
        self.assertEqual(len(fake.requests), 3)
        normalized = []
        for request in fake.requests:
            request = json.loads(json.dumps(request))
            for key in ("effort", "tags"):
                request[key] = "ARM"
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
        self.assertEqual(fake.new_calls, 0)
        self.assertEqual(fake.events.count("get"), 2)  # initial read plus final reconciliation only
        entry = next(e for e in json.loads(self.ledger_path.read_text())["entries"].values()
                     if e["effort"] == "high")
        self.assertEqual(entry["duplicate_receipt"]["status"], "skipped_duplicate")
        self.assertEqual(entry["duplicate_receipt"]["original_review_id"], "canonical-case-000-high")
        self.assertEqual(entry["duplicate_receipt"]["attempts"], [{"number": 1, "status": "ok"}])
        self.assertTrue(entry["duplicate_resolved"])
        self.assertEqual(entry["canonical_review_id"], "canonical-case-000-high")
        self.assertEqual(entry["state"], "complete")

    def test_general_request_has_effort_tags_store_and_rejects_disagreeing_tags(self):
        data = frozen(1)
        case = data["cases"][0]
        request = runner.build_request(data, case, "high", True, "run_1")
        self.assertNotIn("trial", request)
        self.assertEqual(request["effort"], "high")
        self.assertIs(request["store"], True)
        expected = {"trial:run_1", "effort:high", "manifest:" + data["manifest_sha256"],
                    "case:" + runner._sha(case["case_id"].encode())}
        self.assertEqual(set(request["tags"]), expected)
        self.assertEqual(request["tags"], sorted(request["tags"]))
        with self.assertRaisesRegex(runner.RunnerError, "effort tag disagrees"):
            runner.build_request(data, case, "high", True, "run_1", tags=["effort:max"])
        with self.assertRaisesRegex(runner.RunnerError, "trial tag disagrees"):
            runner.build_request(data, case, "high", True, "run_1", tags=["trial:other"])
        with self.assertRaisesRegex(runner.RunnerError, "run id"):
            runner.build_request(data, case, "high", True, "bad run id")
        with self.assertRaisesRegex(runner.RunnerError, "tag is not"):
            runner.build_request(data, case, "high", True, "run_1", tags=["bad tag"])

    def test_whoami_tenant_or_scope_mismatch_aborts_before_any_review_post(self):
        mismatch = FakeREST(tenant="other-tenant")
        with self.assertRaisesRegex(runner.RunnerError, "dedicated tenant"):
            self.execute(1, mismatch, execute=False)
        self.assertEqual(mismatch.requests, [])
        self.assertEqual(mismatch.events, ["whoami"])

        read_scope = FakeREST(scope="read")
        data = frozen(1)
        self.manifest_path.write_text(json.dumps(data), encoding="utf-8")
        read_scope.bind([case["case_id"] for case in data["cases"]])
        client = runner.TrialRunner("http://fixture.invalid", lambda: "fixture-auth", read_scope)
        approval_path = self.approval_record({"tenant_id": "tenant-trial",
                                              "manifest_hash": data["manifest_sha256"],
                                              "run_id": "run-1"})
        with self.assertRaisesRegex(runner.RunnerError, "read_write"):
            runner.run(self.manifest_path, self.ledger_path, client, 1000, "claude-haiku-5-5",
                       run_id="run-1", tenant_id="tenant-trial", execute=True,
                       approval_path=approval_path)
        self.assertEqual(read_scope.requests, [])
        self.assertEqual(read_scope.events, ["whoami"])

        matching = FakeREST()
        summary = self.execute(1, matching, execute=False)
        self.assertEqual(matching.events[0], "whoami")
        self.assertTrue(all(request["store"] is True for request in matching.requests))
        self.assertEqual(summary["run_id"], "run-1")
        self.assertEqual(summary["tenant_id"], "tenant-trial")

    def test_ledger_resume_refuses_different_run_tenant_or_manifest(self):
        self.execute(1, FakeREST())
        with self.assertRaisesRegex(runner.RunnerError, "not bound"):
            self.execute(1, FakeREST(), run_id="run-2")
        with self.assertRaisesRegex(runner.RunnerError, "not bound"):
            self.execute(1, FakeREST(tenant="other-tenant"), tenant_id="other-tenant")
        data = frozen(2)
        self.manifest_path.write_text(json.dumps(data), encoding="utf-8")
        fake = FakeREST()
        fake.bind([case["case_id"] for case in data["cases"]])
        client = runner.TrialRunner("http://fixture.invalid", lambda: "fixture-auth", fake)
        approval_path = self.approval_record({"tenant_id": "tenant-trial",
                                              "manifest_hash": data["manifest_sha256"],
                                              "run_id": "run-1"})
        with self.assertRaisesRegex(runner.RunnerError, "not bound"):
            runner.run(self.manifest_path, self.ledger_path, client, 1000, "claude-haiku-5-5",
                       run_id="run-1", tenant_id="tenant-trial", execute=True,
                       approval_path=approval_path)

    def test_uncertified_or_shallow_manifest_is_refused_before_any_review_post(self):
        base = frozen(1)

        def missing(body):
            del body["history"]

        def shallow(body):
            body["history"]["shallow"] = True

        def incomplete(body):
            body["history"]["object_complete"] = False

        def count_mismatch(body):
            body["history"]["verified_count"] += 1

        for mutate in (missing, shallow, incomplete, count_mismatch):
            body = json.loads(json.dumps(base))
            mutate(body)
            self.manifest_path.write_text(json.dumps(rehash(body)), encoding="utf-8")
            fake = FakeREST()
            client = runner.TrialRunner("http://fixture.invalid", lambda: "fixture-auth", fake)
            with self.assertRaisesRegex(runner.RunnerError, "certif"):
                runner.run(self.manifest_path, self.ledger_path, client, 1000, "claude-haiku-5-5",
                           run_id="run-1", tenant_id="tenant-trial", execute=True)
            self.assertEqual(fake.requests, [])

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
        fake.bind([case["case_id"] for case in data["cases"]])
        client = runner.TrialRunner("http://fixture.invalid", lambda: "fixture-auth", fake)
        preflight = runner.run(self.manifest_path, self.ledger_path, client, 100, "claude-haiku-5-5",
                               run_id="run-1", tenant_id="tenant-trial", execute=False)
        approval_path = self.approval_record(preflight)
        runner.run(self.manifest_path, self.ledger_path, client, 100, "claude-haiku-5-5",
                   run_id="run-1", tenant_id="tenant-trial", execute=True, approval_path=approval_path)
        calls = fake.model_calls
        runner.run(self.manifest_path, self.ledger_path, client, 100, "claude-haiku-5-5",
                   run_id="run-1", tenant_id="tenant-trial", execute=True, approval_path=approval_path)
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
        first = self.execute(1, fake, cap=100)
        self.assertEqual(fake.model_calls, 0)
        self.assertEqual(first["readiness"]["blocked_efforts"], ["high", "max", "xhigh"])
        fake.block = False
        result = self.execute(1, fake, cap=200)
        self.assertEqual(result["paired_completed"], 1)
        self.assertEqual(fake.model_calls, 3)

    def _client(self, fake):
        return runner.TrialRunner("http://fixture.invalid", lambda: "fixture-auth", fake)

    def test_paged_read_consumes_over_500_records_once_with_export_evidence(self):
        fake = FakeREST(page_size=100)
        fake.records = [{"id": f"row-{i:04d}"} for i in range(1205)]
        export = self._client(fake).get_reviews("m" * 64, "run-1", "tenant-trial")
        self.assertEqual(len(export["reviews"]), 1205)
        self.assertEqual(len({row["id"] for row in export["reviews"]}), 1205)
        self.assertEqual(export["schema_version"], 1)
        self.assertEqual(export["manifest_sha256"], "m" * 64)
        self.assertEqual(export["run_id"], "run-1")
        self.assertEqual(export["tenant_id"], "tenant-trial")
        self.assertEqual(export["detail"], "full")
        self.assertEqual(export["limit"], 500)
        self.assertEqual(export["filters"], {"tags": ["manifest:" + "m" * 64, "trial:run-1"]})
        self.assertTrue(export["complete"])
        self.assertGreater(len(export["pages"]), 1)
        self.assertIsNone(export["pages"][0]["cursor_in"])
        self.assertEqual(sum(page["row_count"] for page in export["pages"]), 1205)
        for index, page in enumerate(export["pages"]):
            chunk = fake.records[index * 100:(index + 1) * 100]
            self.assertEqual(page["row_ids_sha256"],
                             runner._sha(runner._canonical([row["id"] for row in chunk])))
            if index < len(export["pages"]) - 1:
                self.assertFalse(page["complete"])
                self.assertIsNotNone(page["cursor_out"])
        self.assertTrue(export["pages"][-1]["complete"])
        self.assertIsNone(export["pages"][-1]["cursor_out"])
        for url in fake.get_urls:
            params = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            self.assertEqual(params["detail"], ["full"])
            self.assertEqual(params["limit"], ["500"])
            self.assertEqual(params["tag"], ["manifest:" + "m" * 64, "trial:run-1"])
        self.assertNotIn("cursor", urllib.parse.parse_qs(urllib.parse.urlparse(fake.get_urls[0]).query))
        self.assertIn("cursor", urllib.parse.parse_qs(urllib.parse.urlparse(fake.get_urls[1]).query))

    def test_exact_multiple_and_empty_populations_end_complete(self):
        fake = FakeREST(page_size=50)
        fake.records = [{"id": f"row-{i:04d}"} for i in range(150)]
        export = self._client(fake).get_reviews("m" * 64, "run-1", "tenant-trial")
        self.assertEqual(len(export["pages"]), 3)
        self.assertEqual(len(export["reviews"]), 150)
        self.assertTrue(export["complete"])
        self.assertTrue(export["pages"][-1]["complete"])
        self.assertIsNone(export["pages"][-1]["cursor_out"])

        empty = FakeREST()
        empty_export = self._client(empty).get_reviews("m" * 64, "run-1", "tenant-trial")
        self.assertEqual(empty_export["reviews"], [])
        self.assertEqual(len(empty_export["pages"]), 1)
        self.assertTrue(empty_export["pages"][0]["complete"])
        self.assertIsNone(empty_export["pages"][0]["cursor_out"])

    def test_cycle_missing_cursor_and_missing_completion_fail(self):
        def cycle(_url, _call):
            return 200, json.dumps({"reviews": [], "next_cursor": "same", "complete": False}).encode()
        with self.assertRaisesRegex(runner.RunnerError, "did not advance"):
            self._client(FakeREST(get_handler=cycle)).get_reviews("m" * 64, "run-1")

        def missing_cursor(_url, _call):
            return 200, json.dumps({"reviews": [], "next_cursor": None, "complete": False}).encode()
        with self.assertRaisesRegex(runner.RunnerError, "no advancing cursor"):
            self._client(FakeREST(get_handler=missing_cursor)).get_reviews("m" * 64, "run-1")

        def missing_complete(_url, _call):
            return 200, json.dumps({"reviews": [{"id": "row-1"}], "next_cursor": None}).encode()
        with self.assertRaisesRegex(runner.RunnerError, "boolean complete"):
            self._client(FakeREST(get_handler=missing_complete)).get_reviews("m" * 64, "run-1")

    def test_duplicate_row_identity_across_pages_fails(self):
        def duplicate(url, _call):
            if "cursor=c" in url:
                return 200, json.dumps({"reviews": [{"id": "dup"}], "next_cursor": None,
                                        "complete": True}).encode()
            return 200, json.dumps({"reviews": [{"id": "dup"}], "next_cursor": "c",
                                    "complete": False}).encode()
        with self.assertRaisesRegex(runner.RunnerError, "duplicate review identity"):
            self._client(FakeREST(get_handler=duplicate)).get_reviews("m" * 64, "run-1")

    def test_http_json_and_row_errors_fail_the_read(self):
        def http(_url, _call):
            return 500, b'{"error":"fixture"}'
        with self.assertRaisesRegex(runner.RunnerError, "HTTP 500"):
            self._client(FakeREST(get_handler=http)).get_reviews("m" * 64, "run-1")

        def bad_json(_url, _call):
            return 200, b"not json"
        with self.assertRaisesRegex(runner.RunnerError, "invalid JSON"):
            self._client(FakeREST(get_handler=bad_json)).get_reviews("m" * 64, "run-1")

        def bad_row(_url, _call):
            return 200, json.dumps({"reviews": [42], "next_cursor": None, "complete": True}).encode()
        with self.assertRaisesRegex(runner.RunnerError, "malformed review row"):
            self._client(FakeREST(get_handler=bad_row)).get_reviews("m" * 64, "run-1")

        def no_identity(_url, _call):
            return 200, json.dumps({"reviews": [{"status": "ok"}], "next_cursor": None,
                                    "complete": True}).encode()
        with self.assertRaisesRegex(runner.RunnerError, "no identity"):
            self._client(FakeREST(get_handler=no_identity)).get_reviews("m" * 64, "run-1")

    def test_operator_safety_ceiling_never_reports_complete(self):
        fake = FakeREST(page_size=1)
        fake.records = [{"id": f"row-{i:04d}"} for i in range(10)]
        original = runner.EVIDENCE_MAX_PAGES
        runner.EVIDENCE_MAX_PAGES = 2
        try:
            with self.assertRaisesRegex(runner.RunnerError, "safety ceiling"):
                self._client(fake).get_reviews("m" * 64, "run-1")
        finally:
            runner.EVIDENCE_MAX_PAGES = original

    def test_legacy_bare_500_row_response_cannot_certify_completeness(self):
        def legacy(_url, _call):
            return 200, json.dumps({"reviews": [{"id": f"row-{i:04d}"} for i in range(500)]}).encode()
        with self.assertRaisesRegex(runner.RunnerError, "boolean complete"):
            self._client(FakeREST(get_handler=legacy)).get_reviews("m" * 64, "run-1")

    def test_prior_spend_uses_recorded_attempt_or_receipt_cost(self):
        ledger = {"entries": {
            "a": {"attempts": [{"kind": "run", "receipt": {"cost_usd": 0.3}}]},
            "b": {"attempts": [{"kind": "run", "receipt": {"attempts": [{"cost_usd": 0.2}]}}]},
            "c": {"attempts": [{"kind": "dry_run", "receipt": {"estimated_usd": 9}}]},
        }}
        self.assertAlmostEqual(runner._prior_spend(ledger), 0.5)

    def test_execute_without_approval_aborts_before_any_request(self):
        fake = FakeREST()
        data = frozen(1)
        self.manifest_path.write_text(json.dumps(data), encoding="utf-8")
        fake.bind([case["case_id"] for case in data["cases"]])
        client = runner.TrialRunner("http://fixture.invalid", lambda: "fixture-auth", fake)
        with self.assertRaisesRegex(approval.ApprovalError, "requires an explicit approval"):
            runner.run(self.manifest_path, self.ledger_path, client, 1000, "claude-haiku-5-5",
                       run_id="run-1", tenant_id="tenant-trial", execute=True)
        self.assertEqual(fake.requests, [])
        self.assertEqual(fake.events, [])

    def test_missing_expired_and_mismatched_approvals_abort_with_zero_provider_calls(self):
        fake = FakeREST()
        data = frozen(1)
        self.manifest_path.write_text(json.dumps(data), encoding="utf-8")
        fake.bind([case["case_id"] for case in data["cases"]])
        client = runner.TrialRunner("http://fixture.invalid", lambda: "fixture-auth", fake)
        preflight = runner.run(self.manifest_path, self.ledger_path, client, 1000, "claude-haiku-5-5",
                               run_id="run-1", tenant_id="tenant-trial", execute=False)
        fake.events.clear()
        fake.requests.clear()

        def execute(path, clock=None):
            return runner.run(self.manifest_path, self.ledger_path, client, 1000, "claude-haiku-5-5",
                              run_id="run-1", tenant_id="tenant-trial", execute=True,
                              approval_path=path, clock=clock)

        with self.assertRaisesRegex(approval.ApprovalError, "requires an explicit approval"):
            execute(None)
        self.assertEqual(fake.events, [])

        now = 1_700_000_000.0
        variants = [
            ({"tenant_id": "other-tenant"}, None, "tenant_id"),
            ({"endpoint": "http://other.invalid"}, None, "endpoint"),
            ({"manifest_sha256": "b" * 64}, None, "manifest_sha256"),
            ({"run_id": "run-2"}, None, "run_id"),
            ({"expires_at": "1970-01-01T00:00:01Z"}, now, "expired"),
        ]
        for overrides, clock, message in variants:
            with self.subTest(overrides=overrides):
                path = self.approval_record(preflight, **overrides)
                with self.assertRaisesRegex(approval.ApprovalError, message):
                    execute(path, clock=(lambda: now) if clock else None)
                self.assertEqual(fake.model_calls, 0)
                self.assertEqual(fake.events, [])

        mismatch = self.approval_record(preflight, preflight_sha256="c" * 64)
        with self.assertRaisesRegex(approval.ApprovalError, "preflight_sha256"):
            execute(mismatch)
        self.assertEqual(fake.model_calls, 0)

    def test_exceeded_ceiling_counts_prior_spend_and_unknown_reservations_without_replay(self):
        class InterruptHigh(FakeREST):
            def request(self, method, url, headers, body, timeout):
                if method == "POST" and not json.loads(body).get("dry_run"):
                    if "effort:high" in json.loads(body)["tags"]:
                        self.model_calls += 1
                        raise TimeoutError("fixture timeout")
                return super().request(method, url, headers, body, timeout)

        fake = InterruptHigh(estimate=0.25)
        data = frozen(1)
        self.manifest_path.write_text(json.dumps(data), encoding="utf-8")
        fake.bind([case["case_id"] for case in data["cases"]])
        client = runner.TrialRunner("http://fixture.invalid", lambda: "fixture-auth", fake)
        preflight = runner.run(self.manifest_path, self.ledger_path, client, 1000, "claude-haiku-5-5",
                               run_id="run-1", tenant_id="tenant-trial", execute=False)
        first = runner.run(self.manifest_path, self.ledger_path, client, 1000, "claude-haiku-5-5",
                           run_id="run-1", tenant_id="tenant-trial", execute=True,
                           approval_path=self.approval_record(preflight, ceiling=1000))
        self.assertEqual(first["arms"]["high"]["completed"], 0)
        self.assertEqual(fake.model_calls, 3)
        calls = fake.model_calls
        ledger = json.loads(self.ledger_path.read_text())
        high = next(entry for entry in ledger["entries"].values() if entry["effort"] == "high")
        self.assertEqual(high["state"], "started_unknown")

        low = self.approval_record(preflight, ceiling=1.6)
        with self.assertRaisesRegex(approval.ApprovalError, "below required"):
            runner.run(self.manifest_path, self.ledger_path, client, 1000, "claude-haiku-5-5",
                       run_id="run-1", tenant_id="tenant-trial", execute=True, approval_path=low)
        self.assertEqual(fake.model_calls, calls)

        resumed = runner.run(self.manifest_path, self.ledger_path, client, 1000, "claude-haiku-5-5",
                             run_id="run-1", tenant_id="tenant-trial", execute=True,
                             approval_path=self.approval_record(preflight, ceiling=3.0))
        self.assertEqual(fake.model_calls, calls)
        self.assertEqual(resumed["arms"]["high"]["completed"], 0)
        self.assertAlmostEqual(resumed["approval_required_usd"], 2.04)


if __name__ == "__main__":
    unittest.main()
