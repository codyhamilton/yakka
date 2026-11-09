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

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOOL = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(TOOL))
import cli
import report


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True).stdout.decode().strip()


class RehearsalHandler(http.server.BaseHTTPRequestHandler):
    records = []
    requests = []
    model_calls = 0

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
        trial = payload["trial"]
        if payload["dry_run"]:
            self._send(200, {"status": "dry_run", "estimated_usd": 0.01})
            return
        type(self).model_calls += 1
        rid = f"review-{trial['case_id']}-{trial['effort']}"
        record = {"id": rid, "case_id": trial["case_id"], "effective_effort": trial["effort"],
                  "profile": "historical_trial", "manifest_hash": trial["manifest_hash"],
                  "configured_model": report.REVIEWER_MODEL, "returned_model": report.REVIEWER_MODEL,
                  "model_mismatch": False, "status": "ok", "build_models": payload["build_models"],
                  "attempts": [{"status": "ok", "latency_ms": 4, "cost_usd": 0.01,
                                "input_tokens": 12, "output_tokens": 3}],
                  "payload": {"findings": [], "coverage": "complete"}}
        type(self).records.append(record)
        self._send(200, {"id": rid, "status": "ok"})

    def do_GET(self):
        self._send(200, {"reviews": type(self).records})


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
        (plan / "REVIEW.md").write_text("# Historical comparison\n")
        git(repo, "add", ".")
        git(repo, "commit", "-qm", "base")
        for number in range(1, 4):
            (repo / "code.py").write_text(f"value = {number}\n")
            git(repo, "add", "code.py")
            git(repo, "commit", "-qm", f"fixture phase {number}\n\nYakka-Phase: demo:{number}")
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
            self.assertEqual(cli.main(["manifest", "--repo", str(self._historical_repo()), "--output", str(manifest_path), "--target", "3"]), 0)
        frozen = json.loads(manifest_path.read_text())
        self.assertEqual(len(frozen["cases"]), 3)
        manifest_bytes = manifest_path.read_bytes()
        manifest_hash = frozen["manifest_sha256"]
        self.assertEqual(hashlib.sha256(
            json.dumps({k: v for k, v in frozen.items() if k != "manifest_sha256"}, sort_keys=True,
                       separators=(",", ":"), ensure_ascii=False).encode()).hexdigest(), manifest_hash)

        ledger_path = self.root / "run-ledger.json"
        endpoint = f"http://127.0.0.1:{server.server_port}"
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(cli.main(["run", "--manifest", str(manifest_path), "--ledger", str(ledger_path),
                                       "--base-url", endpoint, "--auth-token", "fixture-auth", "--cap-usd", "1",
                                       "--reviewer-model", report.REVIEWER_MODEL, "--execute"]), 0)
        summary = json.loads(output.getvalue())
        self.assertEqual({effort: row["completed"] for effort, row in summary["arms"].items()},
                         {"high": 3, "xhigh": 3, "max": 3})
        self.assertEqual(RehearsalHandler.model_calls, 9)
        cases = {case["case_id"]: case for case in frozen["cases"]}
        run_requests = [request for request in RehearsalHandler.requests if not request["dry_run"]]
        self.assertEqual(len(run_requests), 9)
        for request in run_requests:
            case = cases[request["trial"]["case_id"]]
            self.assertEqual(request["capture"]["base"], case["base_sha"])
            self.assertEqual(request["capture"]["head"], case["head_sha"])
        self.assertEqual(manifest_path.read_bytes(), manifest_bytes)
        self.assertEqual(json.loads(manifest_path.read_text())["manifest_sha256"], manifest_hash)

        records_path = self.root / "get-records.json"
        adjudication_path = self.root / "adjudication.json"
        report_path = self.root / "alignment-report.json"
        records_path.write_text(json.dumps({"reviews": RehearsalHandler.records}), encoding="utf-8")
        adjudication_path.write_text(json.dumps({"version": 1, "low_sample_rate": 1.0, "findings": []}), encoding="utf-8")
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(cli.main(["report", "--manifest", str(manifest_path), "--records", str(records_path),
                                       "--adjudication", str(adjudication_path), "--output", str(report_path)]), 0)
        result = json.loads(report_path.read_text())
        self.assertEqual(result["paired_intersection"]["completed_cases"], 3)
        self.assertEqual({effort: row["completed"] for effort, row in result["arms"].items()},
                         {"high": 3, "xhigh": 3, "max": 3})
        self.assertEqual(result, report.build_report(frozen, RehearsalHandler.records, {},
                                                      {"version": 1, "low_sample_rate": 1.0, "findings": []}))


if __name__ == "__main__":
    unittest.main()
