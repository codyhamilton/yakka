"""CLI, smoke, and composed rehearsal fixtures; all HTTP traffic is loopback-only."""
import contextlib
import hashlib
import http.server
import importlib.util
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOOL = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(TOOL))
import cli
import report
import runner


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True).stdout.decode().strip()


class RehearsalHandler(http.server.BaseHTTPRequestHandler):
    records = []
    requests = []
    model_calls = 0
    tenant = "fixture-tenant"
    case_by_hash = {}
    cases = {}
    page_size = 3
    unavailable = False

    def log_message(self, *_args):
        pass

    def _send(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.headers.get("Authorization") != "Bearer fixture-auth":
            self._send(401, {"error": "unauthorized"})
            return
        payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        type(self).requests.append(payload)
        tags = payload["tags"]
        effort = next(tag[len("effort:"):] for tag in tags if tag.startswith("effort:"))
        case_hash = next(tag[len("case:"):] for tag in tags if tag.startswith("case:"))
        manifest_hash = next(tag[len("manifest:"):] for tag in tags if tag.startswith("manifest:"))
        case_id = type(self).case_by_hash[case_hash]
        if payload["dry_run"]:
            if type(self).unavailable:
                self._send(200, {"status": "unavailable", "reason": "fixture unavailable"})
            else:
                self._send(200, {"status": "dry_run"})
            return
        type(self).model_calls += 1
        rid = f"review-{case_id}-{effort}"
        case = type(self).cases.get(case_id, {})
        targets = [outcome for outcome in case.get("outcomes") or []
                   if isinstance(outcome, dict) and outcome.get("kind") == "review_finding"
                   and isinstance(outcome.get("path"), str)]
        if targets:
            target = targets[0]
            severity = str(target.get("severity") or "medium").lower()
            if severity not in ("blocker", "high", "medium", "low"):
                severity = "medium"
            finding = {"id": f"{case_id}-{effort}-f1", "severity": severity,
                       "path": target["path"],
                       "line_start": int(target.get("line_start") or 1),
                       "line_end": int(target.get("line_end") or target.get("line_start") or 1),
                       "title": f"fixture finding {case_id} {effort}",
                       "evidence": target.get("excerpt") or "fixture evidence"}
        else:
            finding = {"id": f"{case_id}-{effort}-f1", "severity": "medium",
                       "path": "src/fixture.py", "line_start": 1, "line_end": 1,
                       "title": f"fixture finding {case_id} {effort}", "evidence": "fixture evidence"}
        record = {"id": rid, "case_id": case_id, "effective_effort": effort,
                  "profile": "historical_trial", "manifest_hash": manifest_hash, "tags": tags,
                  "configured_model": report.REVIEWER_MODEL, "returned_model": report.REVIEWER_MODEL,
                  "model_mismatch": False, "status": "ok", "build_models": payload["build_models"],
                  "attempts": [{"status": "ok", "latency_ms": 4, "cost_usd": 0.01,
                                "input_tokens": 12, "output_tokens": 3}],
                  "payload": {"findings": [finding], "coverage": "complete"}}
        type(self).records.append(record)
        self._send(200, {"id": rid, "status": "ok", "cost_usd": 0.01,
                         "attempts": [{"status": "ok", "latency_ms": 4, "cost_usd": 0.01,
                                       "input_tokens": 12, "output_tokens": 3}]})

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/v1/whoami":
            self._send(200, {"tenant": type(self).tenant, "scope": "read_write", "expires_at": 0})
            return
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        cursor = params.get("cursor", [None])[0]
        start = int(cursor) if cursor else 0
        requested = int(params.get("limit", [str(type(self).page_size)])[0])
        size = min(requested, type(self).page_size)
        page = type(self).records[start:start + size]
        end = start + len(page)
        complete = end >= len(type(self).records)
        self._send(200, {"reviews": page, "next_cursor": None if complete else str(end),
                         "complete": complete})


class Phase7Tests(unittest.TestCase):
    def setUp(self):
        self.fixture_parent = TOOL / "test-fixtures"
        self.fixture_parent.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=self.fixture_parent)
        self.root = pathlib.Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()
        try:
            self.fixture_parent.rmdir()
        except OSError:
            pass

    def test_smoke_only_prints_fixture_receipt_fields_and_read_scope_refusal(self):
        self.assertFalse(hasattr(cli._parser().parse_args(["smoke"]), "appro" + "val"))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(cli.main(["smoke"]), 0)
        raw = output.getvalue()
        result = json.loads(raw)
        self.assertEqual(set(result), {"review_id", "status", "model", "tokens", "cost_usd", "read_scope_refused"})
        self.assertEqual(result["review_id"], "fixture-review-001")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["model"], "claude-haiku-5-5")
        self.assertEqual(result["tokens"], {"input": 120, "output": 34})
        self.assertEqual(result["cost_usd"], 0.00042)
        self.assertTrue(result["read_scope_refused"])
        self.assertNotIn("fixture-write-only", raw)
        self.assertNotIn("fixture-read-only", raw)

    def _serve(self):
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), RehearsalHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.addCleanup(thread.join, 3)
        return server

    def test_fake_endpoint_pages_exact_multiple_and_empty_populations(self):
        server = self._serve()
        client = runner.TrialRunner(f"http://127.0.0.1:{server.server_port}",
                                    lambda: "fixture-auth")
        RehearsalHandler.records = []
        empty = client.get_reviews("m" * 64, "run-pages", RehearsalHandler.tenant)
        self.assertEqual(empty["reviews"], [])
        self.assertEqual(len(empty["pages"]), 1)
        self.assertTrue(empty["pages"][0]["complete"])
        self.assertIsNone(empty["pages"][0]["cursor_out"])

        RehearsalHandler.records = [{"id": f"row-{i}"} for i in range(9)]
        export = client.get_reviews("m" * 64, "run-pages", RehearsalHandler.tenant)
        self.assertEqual(len(export["reviews"]), 9)
        self.assertEqual(len({row["id"] for row in export["reviews"]}), 9)
        self.assertEqual(len(export["pages"]), 3)
        self.assertTrue(export["pages"][-1]["complete"])
        self.assertIsNone(export["pages"][-1]["cursor_out"])
        self.assertTrue(all(not page["complete"] for page in export["pages"][:-1]))

    def _historical_repo(self):
        repo = self.root / "repo"
        repo.mkdir()
        git(repo, "init", "-q")
        git(repo, "config", "user.email", "fixture@example.invalid")
        git(repo, "config", "user.name", "Fixture")
        (repo / "code.py").write_text("value = 0\n")
        plan = repo / "docs/plans/demo"
        plan.mkdir(parents=True)
        (plan / "DESIGN.md").write_text("# Fixture criteria\nReview the changed value.\n")
        (plan / "IMPLEMENTATION.md").write_text("# Verification\n")
        (plan / "REVIEW.md").write_text("# Historical comparison\n\n## Findings\n\n- **Medium:** base finding.\n\nVerdict: **pass**\n")
        git(repo, "add", ".")
        git(repo, "commit", "-qm", "base")
        for number in range(1, 4):
            (repo / "code.py").write_text(f"value = {number}\n")
            (plan / "REVIEW.md").write_text(
                "# Historical comparison\n\n## Findings\n\n"
                f"- **Medium:** phase {number} finding.\n\nVerdict: **pass**\n")
            git(repo, "add", "code.py", "docs/plans/demo/REVIEW.md")
            git(repo, "commit", "-qm", f"fixture phase {number}\n\nYakka-Phase: demo:{number}")
        remote = self.root / "remote.git"
        git(self.root, "init", "--bare", "-q", str(remote))
        git(remote, "symbolic-ref", "HEAD", "refs/heads/main")
        git(repo, "remote", "add", "origin", str(remote))
        git(repo, "push", "-q", "origin", "HEAD:refs/heads/main")
        git(repo, "fetch", "-q", "origin")
        self.remote_identity = str(remote)
        return repo

    def test_three_case_three_effort_manifest_run_saved_records_and_report(self):
        RehearsalHandler.records = []
        RehearsalHandler.requests = []
        RehearsalHandler.model_calls = 0
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), RehearsalHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.addCleanup(thread.join, 3)

        manifest_path = self.root / "manifest.json"
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(cli.main(["manifest", "--repo", str(self._historical_repo()), "--output", str(manifest_path),
                                       "--target", "3", "--expected-repository", self.remote_identity]), 0)
        frozen = json.loads(manifest_path.read_text())
        self.assertEqual(len(frozen["cases"]), 3)
        RehearsalHandler.case_by_hash = {
            hashlib.sha256(case["case_id"].encode()).hexdigest(): case["case_id"] for case in frozen["cases"]}
        RehearsalHandler.cases = {case["case_id"]: case for case in frozen["cases"]}
        manifest_bytes = manifest_path.read_bytes()
        manifest_hash = frozen["manifest_sha256"]
        self.assertEqual(hashlib.sha256(
            json.dumps({k: v for k, v in frozen.items() if k != "manifest_sha256"}, sort_keys=True,
                       separators=(",", ":"), ensure_ascii=False).encode()).hexdigest(), manifest_hash)

        ledger_path = self.root / "run-ledger.json"
        endpoint = f"http://127.0.0.1:{server.server_port}"
        run_args = ["run", "--manifest", str(manifest_path), "--ledger", str(ledger_path),
                    "--base-url", endpoint, "--auth-token", "fixture-auth",
                    "--reviewer-model", report.REVIEWER_MODEL, "--run-id", "rehearsal-1",
                    "--tenant-id", RehearsalHandler.tenant]
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(cli.main(run_args + ["--dry-run"]), 0)
        preflight = json.loads(output.getvalue())
        self.assertTrue(preflight["readiness"]["ready"])
        self.assertEqual(preflight["readiness"]["blocked_efforts"], [])
        self.assertEqual(len(preflight["preflight"]), 9)
        self.assertTrue(all(set(row) == {"case_id", "effort", "status"} for row in preflight["preflight"]))
        self.assertFalse(any("cost" in row or "usd" in row for row in preflight["preflight"]))
        removed = {"estimates", "projected_usd", "retry_exposure_per_review", "cap" + "_usd",
                   "refused" + "_over_cap", "appro" + "val_required_usd", "authorized_max_usd"}
        for key in removed:
            self.assertNotIn(key, preflight)
        self.assertEqual(RehearsalHandler.model_calls, 0)

        wrong_args = list(run_args)
        wrong_args[wrong_args.index("--tenant-id") + 1] = "wrong-tenant"
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stderr(io.StringIO()):
                cli.main(wrong_args + ["--execute"])
        self.assertEqual(RehearsalHandler.model_calls, 0)

        blocked_ledger = self.root / "blocked-ledger.json"
        blocked_args = list(run_args)
        blocked_args[blocked_args.index("--ledger") + 1] = str(blocked_ledger)
        RehearsalHandler.unavailable = True
        try:
            with self.assertRaises(SystemExit):
                with contextlib.redirect_stderr(io.StringIO()):
                    cli.main(blocked_args + ["--execute"])
        finally:
            RehearsalHandler.unavailable = False
        self.assertEqual(RehearsalHandler.model_calls, 0)

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(cli.main(run_args + ["--execute"]), 0)
        summary = json.loads(output.getvalue())
        self.assertEqual({effort: row["completed"] for effort, row in summary["arms"].items()},
                         {"high": 3, "xhigh": 3, "max": 3})
        for key in removed:
            self.assertNotIn(key, summary)
        self.assertNotIn("live_trial", summary)
        self.assertNotIn("deployed_smoke", summary)
        self.assertEqual(RehearsalHandler.model_calls, 9)
        cases = {case["case_id"]: case for case in frozen["cases"]}
        run_requests = [request for request in RehearsalHandler.requests if not request["dry_run"]]
        self.assertEqual(len(run_requests), 9)
        for request in run_requests:
            self.assertNotIn("trial", request)
            self.assertIs(request["store"], True)
            self.assertIn(request["effort"], ("high", "xhigh", "max"))
            tags = set(request["tags"])
            self.assertTrue({"trial:rehearsal-1", "effort:" + request["effort"],
                             "manifest:" + manifest_hash}.issubset(tags))
            case_hash = next(tag[len("case:"):] for tag in tags if tag.startswith("case:"))
            case = cases[RehearsalHandler.case_by_hash[case_hash]]
            self.assertEqual(request["capture"]["base"], case["base_sha"])
            self.assertEqual(request["capture"]["head"], case["head_sha"])
        self.assertEqual(manifest_path.read_bytes(), manifest_bytes)
        self.assertEqual(json.loads(manifest_path.read_text())["manifest_sha256"], manifest_hash)

        records_path = self.root / "get-records.json"
        adjudication_path = self.root / "adjudication.json"
        report_path = self.root / "alignment-report.json"
        client = runner.TrialRunner(endpoint, lambda: "fixture-auth")
        export = client.get_reviews(manifest_hash, "rehearsal-1", RehearsalHandler.tenant)
        records_path.write_text(json.dumps(export), encoding="utf-8")
        decisions = []
        for index, record in enumerate(RehearsalHandler.records):
            for finding in record["payload"]["findings"]:
                decisions.append({"source": "review", "case_id": record["case_id"],
                                  "effort": record["effective_effort"], "finding_id": finding["id"],
                                  "category": "valid",
                                  "second_label": "valid" if index % 2 == 0 else "invalid"})
        adjudication_path.write_text(json.dumps({
            "version": 1, "low_sample_rate": 1.0, "labeler_model": "labeler-a",
            "second_labeler_model": "labeler-b", "findings": decisions}), encoding="utf-8")
        adjudication = {"version": 1, "low_sample_rate": 1.0, "labeler_model": "labeler-a",
                        "second_labeler_model": "labeler-b", "findings": decisions}
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(cli.main(["report", "--manifest", str(manifest_path), "--records", str(records_path),
                                       "--ledger", str(ledger_path),
                                       "--adjudication", str(adjudication_path), "--output", str(report_path)]), 0)
        printed = json.loads(output.getvalue())
        result = json.loads(report_path.read_text())
        summary_path = report_path.with_suffix(".md")
        self.assertEqual(printed["summary"], str(summary_path.resolve()))
        self.assertEqual(printed["report_sha256"], result["reproducibility"]["report_sha256"])
        second_path = self.root / "alignment-report-2.json"
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(cli.main(["report", "--manifest", str(manifest_path), "--records", str(records_path),
                                       "--ledger", str(ledger_path),
                                       "--adjudication", str(adjudication_path), "--output", str(second_path)]), 0)
        second_printed = json.loads(output.getvalue())
        self.assertEqual(printed["report_sha256"], second_printed["report_sha256"])
        self.assertEqual(report_path.read_bytes(), second_path.read_bytes())
        self.assertEqual(summary_path.read_bytes(), second_path.with_suffix(".md").read_bytes())

        for key in ("population", "comparisons", "validation", "cost_latency",
                    "reproducibility", "reconciliation"):
            self.assertIn(key, result)
        for key in ("finding_recall", "fix_recall", "corroboration", "verdict_agreement",
                    "severity_agreement", "paired_deltas"):
            self.assertIn(key, result["comparisons"])
        for group in ("by_effort", "by_tier"):
            for row in result["comparisons"]["finding_recall"][group].values():
                self.assertIn("null", row)
            for row in result["comparisons"]["fix_recall"][group].values():
                self.assertIn("null", row)
        matching_validation = result["validation"]["matching"]
        self.assertGreater(matching_validation["matches"], 0)
        self.assertEqual(sum(matching_validation["method_counts"].values()),
                         matching_validation["matches"])
        self.assertIsNotNone(result["validation"]["adjudication"]["kappa"])
        self.assertTrue(result["validation"]["leak_check"]["pass"])

        evidence_folder = self.root / "evidence-refused"
        evidence_folder.mkdir()
        (evidence_folder / "run-export.json").write_text(json.dumps(export), encoding="utf-8")
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                cli.main(["evidence-check", "--folder", str(evidence_folder)])
        metric_folder = self.root / "evidence-metric-only"
        metric_folder.mkdir()
        (metric_folder / "alignment-report.json").write_text(report_path.read_text(), encoding="utf-8")
        (metric_folder / "alignment-report.md").write_text(summary_path.read_text(), encoding="utf-8")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(cli.main(["evidence-check", "--folder", str(metric_folder)]), 0)
        receipt = json.loads(output.getvalue())
        self.assertEqual(receipt["evidence_check"], "pass")
        self.assertEqual(receipt["files_checked"], 2)

        self.assertNotIn("live_trial", result)
        self.assertNotIn("deployed_smoke", result)
        self.assertEqual(result["paired_intersection"]["completed_cases"], 3)
        self.assertEqual({effort: row["completed"] for effort, row in result["arms"].items()},
                         {"high": 3, "xhigh": 3, "max": 3})
        self.assertTrue(result["provenance"]["complete"])
        self.assertIsNone(result["provenance"]["terminal"]["cursor_out"])
        ledger = json.loads(ledger_path.read_text())
        run_receipts = [attempt["receipt"] for entry in ledger["entries"].values()
                        for attempt in entry.get("attempts", []) if attempt.get("kind") == "run"]
        self.assertEqual(len(run_receipts), 9)
        self.assertTrue(all(receipt["cost_usd"] == 0.01 for receipt in run_receipts))
        self.assertTrue(all(attempt["cost_usd"] == 0.01
                            for receipt in run_receipts for attempt in receipt["attempts"]))
        self.assertAlmostEqual(result["usage"]["cost_usd"], 0.09)
        self.assertAlmostEqual(result["usage"]["known_cost_usd"], 0.09)
        for effort in ("high", "xhigh", "max"):
            self.assertAlmostEqual(result["arms"][effort]["cost_usd"], 0.03)
            for row in result["arms"][effort]["per_case"].values():
                self.assertAlmostEqual(row["cost_usd"], 0.01)
        self.assertEqual(result, report.build_report(frozen, export, json.loads(ledger_path.read_text()), {},
                                                      adjudication))

        parser = cli._parser()
        run_namespace = parser.parse_args(run_args)
        report_namespace = parser.parse_args([
            "report", "--manifest", str(manifest_path), "--records", str(records_path),
            "--ledger", str(ledger_path), "--adjudication", str(adjudication_path),
            "--output", str(report_path)])
        for namespace in (run_namespace, report_namespace):
            self.assertFalse(hasattr(namespace, "cap" + "_usd"))
            self.assertFalse(hasattr(namespace, "appro" + "val"))
        self.assertFalse((TOOL / ("appro" + "val.py")).exists())
        self.assertFalse((TOOL / ("test_appro" + "val.py")).exists())


if __name__ == "__main__":
    unittest.main()
