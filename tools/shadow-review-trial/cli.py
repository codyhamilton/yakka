#!/usr/bin/env python3
"""CLI for freezing, running, smoking, and reporting shadow review trials."""
from __future__ import annotations

import argparse
import http.server
import json
import pathlib
import threading
import urllib.error
import urllib.request

from manifest import ManifestFrozenError, create_manifest
from runner import RunnerError, TrialRunner, run as run_trial
import report as alignment_report


def _json_file(path: pathlib.Path, label: str):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read {label} JSON: {path}") from exc


def _write_json(path: pathlib.Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


class _SmokeHandler(http.server.BaseHTTPRequestHandler):
    server_version = "ShadowReviewFixture/1"

    def log_message(self, *_args):
        pass

    def do_POST(self):
        if self.path != "/v1/reviews":
            self.send_error(404)
            return
        auth = self.headers.get("Authorization", "")
        if auth == "Bearer fixture-read-only":
            payload = {"error": "insufficient_scope", "detail": "read_write scope required"}
            self._send(403, payload)
            return
        if auth != "Bearer fixture-write-only":
            self._send(401, {"error": "unauthorized"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length:
            self.rfile.read(length)
        self._send(200, {"id": "fixture-review-001", "status": "ok", "returned_model": "claude-haiku-5-5",
                         "input_tokens": 120, "output_tokens": 34, "cost_usd": 0.00042})

    def _send(self, status, value):
        body = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def smoke_record() -> dict:
    """Exercise success and read-scope refusal against a loopback-only fake REST server."""
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _SmokeHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        client = TrialRunner(base_url, lambda: "fixture-write-only")
        receipt = client.post_review({"fixture": True})
        request = urllib.request.Request(base_url + "/v1/reviews", data=b"{}",
                                        headers={"Authorization": "Bearer fixture-read-only",
                                                 "Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                refusal_status, refusal = response.status, json.loads(response.read())
        except urllib.error.HTTPError as exc:
            try:
                refusal_status, refusal = exc.code, json.loads(exc.read())
            finally:
                exc.close()
        if refusal_status != 403 or refusal.get("error") != "insufficient_scope":
            raise RuntimeError("fake endpoint did not refuse read-scope POST")
        return {"review_id": receipt["id"], "status": receipt["status"], "model": receipt["returned_model"],
                "tokens": {"input": receipt["input_tokens"], "output": receipt["output_tokens"]},
                "cost_usd": receipt["cost_usd"], "read_scope_refused": True}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def _parser():
    parser = argparse.ArgumentParser(prog="shadow-review-trial")
    commands = parser.add_subparsers(dest="command", required=True)

    manifest = commands.add_parser("manifest", help="freeze historical cases and comparator evidence")
    manifest.add_argument("--repo", type=pathlib.Path, default=pathlib.Path.cwd())
    manifest.add_argument("--output", type=pathlib.Path, required=True)
    manifest.add_argument("--seed", type=int, default=1)
    manifest.add_argument("--target", type=int, default=50)
    manifest.add_argument("--comparators", type=pathlib.Path)
    manifest.add_argument("--pr-export", type=pathlib.Path)

    run = commands.add_parser("run", help="estimate or run a frozen historical trial")
    run.add_argument("--manifest", type=pathlib.Path, required=True)
    run.add_argument("--ledger", type=pathlib.Path, required=True)
    run.add_argument("--base-url", required=True, help="Yakka REST endpoint (inject a fixture URL in tests)")
    run.add_argument("--auth-token", required=True, help="Yakka bearer token; never printed or saved")
    run.add_argument("--cap-usd", type=float, required=True)
    run.add_argument("--reviewer-model", required=True)
    run_mode = run.add_mutually_exclusive_group()
    run_mode.add_argument("--dry-run", dest="execute", action="store_false",
                          help="estimate all three effort arms without model calls (default)")
    run_mode.add_argument("--execute", dest="execute", action="store_true",
                          help="run reviews after dry-run preflight")
    run.set_defaults(execute=False)
    run.add_argument("--config-id", default="default")

    report = commands.add_parser("report", help="build a deterministic alignment report from saved inputs")
    report.add_argument("--manifest", type=pathlib.Path, required=True)
    report.add_argument("--records", type=pathlib.Path, required=True, help="saved GET /v1/reviews response or reviews array")
    report.add_argument("--adjudication", type=pathlib.Path, required=True)
    report.add_argument("--output", type=pathlib.Path, required=True)
    report.add_argument("--comparators", type=pathlib.Path, help="optional saved comparator evidence JSON")
    report.add_argument("--cap-usd", type=float)

    commands.add_parser("smoke", help="print fake-endpoint fixture evidence; makes no provider call")
    return parser


def main(argv=None):
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "manifest":
            frozen = create_manifest(args.repo, args.output, args.seed, args.target, args.comparators, args.pr_export)
            print(json.dumps({"manifest": str(args.output.resolve()), "manifest_sha256": frozen["manifest_sha256"],
                              "candidates": len(frozen["candidates"]), "eligible": len(frozen["cases"]),
                              "shortages": frozen["shortages"]}, sort_keys=True))
        elif args.command == "run":
            client = TrialRunner(args.base_url, lambda: args.auth_token)
            summary = run_trial(args.manifest, args.ledger, client, args.cap_usd, args.reviewer_model,
                                execute=args.execute, config_id=args.config_id)
            print(json.dumps(summary, sort_keys=True))
        elif args.command == "report":
            frozen = _json_file(args.manifest, "manifest")
            raw_records = _json_file(args.records, "review records")
            records = raw_records.get("reviews") if isinstance(raw_records, dict) else raw_records
            if not isinstance(records, list):
                raise ValueError("review records must be a list or an object with a reviews list")
            adjudication = _json_file(args.adjudication, "adjudication")
            comparators = _json_file(args.comparators, "comparators") if args.comparators else {}
            result = alignment_report.build_report(frozen, records, comparators, adjudication, args.cap_usd)
            _write_json(args.output, result)
            print(json.dumps({"report": str(args.output.resolve()), "manifest_sha256": frozen["manifest_sha256"],
                              "arms": result["arms"], "usage": result["usage"]}, sort_keys=True))
        elif args.command == "smoke":
            print(json.dumps(smoke_record(), sort_keys=True))
        return 0
    except (ManifestFrozenError, RunnerError, ValueError, OSError, KeyError, RuntimeError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
