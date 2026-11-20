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

from manifest import ManifestFrozenError, compare_candidates, create_manifest
from runner import RunnerError, TrialRunner, run as run_trial
import evidence_check
import history_profile
import report as alignment_report
import summary as report_summary


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
    manifest.add_argument("--target", type=int, default=360)
    manifest.add_argument("--floor", type=int, default=300)
    manifest.add_argument("--comparators", type=pathlib.Path)
    manifest.add_argument("--pr-export", type=pathlib.Path)
    manifest.add_argument("--remote", default="origin", help="configured Git remote to fetch and verify")
    manifest.add_argument("--expected-repository", default="codyhamilton/yakka",
                          help="expected remote repository identity (owner/repo or fixture path)")
    manifest.add_argument("--history-profile", default="garcia-music-workflow",
                          help="named repository history profile for trailers and plan layout")

    run = commands.add_parser("run", help="preflight or run a frozen historical trial")
    run.add_argument("--manifest", type=pathlib.Path, required=True)
    run.add_argument("--ledger", type=pathlib.Path, required=True)
    run.add_argument("--base-url", required=True, help="Yakka REST endpoint (inject a fixture URL in tests)")
    run.add_argument("--auth-token", required=True, help="Yakka bearer token; never printed or saved")
    run.add_argument("--reviewer-model", required=True)
    run.add_argument("--run-id", required=True, help="frozen trial run id (1-32 chars, [A-Za-z0-9_-])")
    run.add_argument("--tenant-id", required=True, help="expected dedicated tenant id confirmed via /v1/whoami")
    run_mode = run.add_mutually_exclusive_group()
    run_mode.add_argument("--dry-run", dest="execute", action="store_false",
                          help="preflight all three effort arms without model calls (default)")
    run_mode.add_argument("--execute", dest="execute", action="store_true",
                          help="run reviews after the identity and dry-run readiness checks")
    run.set_defaults(execute=False)
    run.add_argument("--config-id", default="default")

    report = commands.add_parser("report", help="build a deterministic alignment report from saved inputs")
    report.add_argument("--manifest", type=pathlib.Path, required=True)
    report.add_argument("--records", type=pathlib.Path, required=True, help="certified saved trial export from the paged reader")
    report.add_argument("--ledger", type=pathlib.Path, required=True, help="frozen run ledger/journal")
    report.add_argument("--adjudication", type=pathlib.Path, required=True)
    report.add_argument("--output", type=pathlib.Path, required=True)
    report.add_argument("--comparators", type=pathlib.Path, help="optional saved comparator evidence JSON")
    report.add_argument("--efforts", help="comma-separated efforts to report; omitted efforts become owner-dropped arms")
    report.add_argument("--drop-reason", default="owner_dropped",
                        help="reason recorded for efforts left out by --efforts")
    report.add_argument("--metric-only", action="store_true",
                        help="strip case ids, review ids, paths and finding rows from the output artifact")

    evidence = commands.add_parser("evidence-check", help="reject an evidence folder holding a manifest or export")
    evidence.add_argument("--folder", type=pathlib.Path, required=True)

    commands.add_parser("smoke", help="print fake-endpoint fixture evidence; makes no provider call")

    compare = commands.add_parser("compare", help="read-only comparison of the candidate extractors")
    compare.add_argument("--repo", type=pathlib.Path, default=pathlib.Path.cwd())
    compare.add_argument("--history-profile", default="garcia-music-workflow")
    compare.add_argument("--seed", type=int, default=28)
    compare.add_argument("--sample", type=int, default=30)
    compare.add_argument("--now", help="freeze reference time (ISO-8601); defaults to the latest commit time")
    return parser


def main(argv=None):
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "manifest":
            frozen = create_manifest(args.repo, args.output, seed=args.seed, target=args.target, floor=args.floor,
                                     comparator_path=args.comparators, pr_export_path=args.pr_export,
                                     remote=args.remote, expected_repository=args.expected_repository,
                                     profile=args.history_profile)
            print(json.dumps({"manifest": str(args.output.resolve()), "manifest_sha256": frozen["manifest_sha256"],
                              "candidates": len(frozen["candidates"]), "frozen": len(frozen["cases"]),
                              "target": frozen["target"], "floor": frozen["floor"], "tiers": frozen["tiers"],
                              "exclusions": frozen["exclusions"],
                              "shortfall_against_floor": frozen["shortfall_against_floor"]}, sort_keys=True))
        elif args.command == "run":
            client = TrialRunner(args.base_url, lambda: args.auth_token)
            summary = run_trial(args.manifest, args.ledger, client, args.reviewer_model,
                                run_id=args.run_id, tenant_id=args.tenant_id,
                                execute=args.execute, config_id=args.config_id)
            print(json.dumps(summary, sort_keys=True))
        elif args.command == "report":
            frozen = _json_file(args.manifest, "manifest")
            export = _json_file(args.records, "review export")
            ledger = _json_file(args.ledger, "run ledger")
            adjudication = _json_file(args.adjudication, "adjudication")
            comparators = _json_file(args.comparators, "comparators") if args.comparators else {}
            efforts = [part.strip() for part in args.efforts.split(",") if part.strip()] if args.efforts else None
            result = alignment_report.build_report(frozen, export, ledger, comparators, adjudication,
                                                   efforts=efforts, drop_reason=args.drop_reason)
            if args.metric_only:
                result = alignment_report.metric_only(result)
            _write_json(args.output, result)
            summary_path = args.output.with_suffix(".md")
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            summary_path.write_text(report_summary.render(result), encoding="utf-8")
            print(json.dumps({"report": str(args.output.resolve()), "summary": str(summary_path.resolve()),
                              "manifest_sha256": frozen["manifest_sha256"],
                              "report_sha256": result["reproducibility"]["report_sha256"],
                              "arms": result["arms"], "usage": result["usage"]}, sort_keys=True))
        elif args.command == "evidence-check":
            checked = evidence_check.require_metric_only(args.folder)
            print(json.dumps({"evidence_check": "pass", "folder": str(args.folder.resolve()),
                              "files_checked": checked["files_checked"]}, sort_keys=True))
        elif args.command == "smoke":
            print(json.dumps(smoke_record(), sort_keys=True))
        elif args.command == "compare":
            result = compare_candidates(args.repo, history_profile.get_profile(args.history_profile),
                                        seed=args.seed, now=args.now, sample=args.sample)
            print(json.dumps(result, sort_keys=True, indent=2))
        return 0
    except (ManifestFrozenError, RunnerError, ValueError, OSError, KeyError,
            RuntimeError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    raise SystemExit(main())
