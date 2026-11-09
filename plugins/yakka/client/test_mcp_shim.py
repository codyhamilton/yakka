"""Conformance tests for the stdio to authenticated server relay."""

from __future__ import annotations

import http.client
import copy
import io
import json
import os
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import yakka


KEY = "unit-test-mcp-key"
CORPUS = Path(__file__).resolve().parents[3] / "packages/yakka/internal/serve/testdata/mcp-golden"


class MCPServer:
    """Small authenticated HTTP harness with direct-call and relay observation."""

    def __init__(self, delay: float = 0.0) -> None:
        self.requests: list[tuple[dict, dict]] = []
        self.lock = threading.Lock()
        self.delay = delay
        self.stale_once = False
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_: object) -> None:
                pass

            def do_POST(self) -> None:
                size = int(self.headers.get("Content-Length", "0"))
                request = json.loads(self.rfile.read(size))
                with server.lock:
                    server.requests.append((request, dict(self.headers)))
                if server.delay:
                    time.sleep(server.delay)
                if self.headers.get("Authorization") != "Bearer " + KEY:
                    self.send_response(401)
                    self.end_headers()
                    return
                method = request.get("method")
                if method == "tools/call" and server.stale_once:
                    server.stale_once = False
                    payload = {"jsonrpc": "2.0", "id": request.get("id"), "error": {"code": -32010, "message": "stale", "data": {"code": "stale_declaration"}}}
                elif method == "initialize":
                    payload = None
                    result = {"protocolVersion": "2025-11-25", "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": "yakka", "version": "fixture"}, "_meta": {"yakka/local-actions": yakka._MCP_ACTION_CAPABILITY}}
                elif method == "tools/list":
                    payload = None
                    result = {"tools": [{"name": "fixture", "description": "test-only", "inputSchema": {"type": "object"}, "_meta": {"yakka/tool": DECLARATION}}]}
                else:
                    payload = None
                    result = {"echo": request.get("params")}
                if payload is None:
                    payload = {"jsonrpc": "2.0", "id": request.get("id"), "result": result}
                raw = json.dumps(payload, separators=(",", ":")).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                try:
                    self.wfile.write(raw)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.http.server_port}"

    def close(self) -> None:
        self.http.shutdown()
        self.http.server_close()
        self.thread.join(timeout=2)

    def direct(self, body: bytes) -> bytes:
        conn = http.client.HTTPConnection("127.0.0.1", self.http.server_port, timeout=3)
        conn.request("POST", "/v1/mcp", body=body, headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        return raw


DECLARATION = {"v": 1, "rev": "0123456789abcdef", "scope": "read", "timeout_s": 1, "context": [{"reader": "cwd", "v": 1, "params": {}}]}

# Server-supplied fixture policy; production code contains no exclusion defaults.
CHANGE_PARAMS = {
    "exclusion_policy_version": "review-exclusions-v1",
    "change_max_file_bytes": 262144, "change_max_total_bytes": 2097152,
    "change_max_files": 200, "context_lines": 3, "docs_never_noise": True,
    "change_exclude": ["*.generated", "vendor/*"], "excluded_files": ["REVIEW.md"],
    "excluded_directories": ["reports"], "lockfiles": ["custom.lock"],
    "truncation_order": ["code", "tests", "config", "docs"], "budget_bytes": 2097152,
}


def change_declaration() -> dict:
    return {"v": 1, "rev": DECLARATION["rev"], "context": [
        {"reader": "project_dir", "v": 1, "required": False, "params": {}},
        {"reader": "change", "v": 1, "required": False, "bulk": True, "params": copy.deepcopy(CHANGE_PARAMS)},
    ]}


class RelayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.old_env = {name: os.environ.get(name) for name in ("YAKKA_ENDPOINT", "YAKKA_KEY", "YAKKA_CLIENT_CONFIG", "YAKKA_QUEUE", "YAKKA_HOOKLOG", "YAKKA_BIN")}
        self.temp = tempfile.TemporaryDirectory()
        self.queue = os.path.join(self.temp.name, "queue")
        os.makedirs(self.queue)
        self.server = MCPServer()
        os.environ["YAKKA_ENDPOINT"] = self.server.url
        os.environ["YAKKA_KEY"] = KEY
        os.environ["YAKKA_CLIENT_CONFIG"] = os.path.join(self.temp.name, "missing.toml")
        os.environ["YAKKA_QUEUE"] = self.queue
        os.environ.pop("YAKKA_HOOKLOG", None)
        os.environ.pop("YAKKA_BIN", None)
        self.relay = yakka._McpRelay(yakka.McpOptions(QueueDir=self.queue, Version="test"))
        self.relay.declarations = {"fixture": DECLARATION}

    def tearDown(self) -> None:
        self.server.close()
        self.temp.cleanup()
        for name, value in self.old_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def dispatch(self, request: dict) -> tuple[bytes, bytes]:
        body = json.dumps(request, separators=(",", ":")).encode()
        self.relay.writer = io.BytesIO()
        self.relay._dispatch(body, request, request.get("id"), request.get("method", ""), "id" in request, threading.Event())
        shim_reply = self.relay.writer.getvalue()
        forwarded = next(req for req, _ in reversed(self.server.requests) if req.get("id") == request.get("id"))
        direct_reply = self.server.direct(json.dumps(forwarded, separators=(",", ":")).encode())
        return shim_reply.rstrip(b"\n"), direct_reply

    def test_initialize_list_and_all_phase_corpus_calls_relay_server_reply(self) -> None:
        corpora = [json.loads((CORPUS / name).read_text()) for name in ("stateless-tools.json", "artifact-feedback.json")]
        requests = [
            {"jsonrpc": "2.0", "id": "init", "method": "initialize", "params": {"protocolVersion": "2025-11-25", "capabilities": {}}},
            {"jsonrpc": "2.0", "id": "list", "method": "tools/list"},
        ]
        requests.extend({"jsonrpc": "2.0", "id": f"case-{i}", "method": "tools/call", "params": {"name": "fixture", "arguments": row["arguments"]}} for i, row in enumerate(call for corpus in corpora for call in corpus["calls"]))
        # Use a descriptor matching the test tool's declaration for all fixture calls.
        self.relay.declarations["fixture"] = DECLARATION
        for request in requests:
            with self.subTest(method=request["method"], ident=request["id"]):
                shim_reply, direct_reply = self.dispatch(request)
                self.assertEqual(json.loads(shim_reply)["id"], request["id"])
                self.assertEqual(shim_reply, direct_reply)
        self.assertTrue(all(headers.get("Authorization") == "Bearer " + KEY for _, headers in self.server.requests))

    def test_reader_context_overwrites_agent_local_and_enforces_failures(self) -> None:
        request = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "fixture", "arguments": {"_local": {"forged": True}}}}
        outbound, local, _, _ = yakka._mcp_context_call(json.dumps(request).encode(), "tools/call", request, DECLARATION, self.queue, getwd=lambda: ("/injected/cwd", None))
        injected = json.loads(outbound)["params"]["arguments"]["_local"]
        self.assertEqual(injected, {"cwd": {"path": "/injected/cwd"}, "_v": 1, "_rev": DECLARATION["rev"]})
        self.assertNotIn("forged", local)
        no_context, _, _, _ = yakka._mcp_context_call(json.dumps(request).encode(), "tools/call", request, None, self.queue)
        self.assertNotIn("_local", json.loads(no_context)["params"]["arguments"])

        for declaration, code in (
            ({"v": 1, "rev": DECLARATION["rev"], "context": [{"reader": "future_reader", "v": 1, "params": {}}]}, "unsupported_reader"),
            ({"v": 1, "rev": DECLARATION["rev"], "context": [{"reader": "cwd", "v": 2, "params": {}}]}, "unsupported_reader_version"),
            ({"v": 3, "rev": DECLARATION["rev"], "context": [{"reader": "cwd", "v": 1, "params": {}}]}, "unsupported_declaration"),
        ):
            local, _ = yakka._mcp_readers(request, declaration, self.queue)
            self.assertEqual(local[next(iter(local))], {"_failed": {"code": code}})

    def test_stale_declaration_refreshes_and_retries_once(self) -> None:
        self.server.stale_once = True
        self.relay.declarations["fixture"] = DECLARATION
        request = {"jsonrpc": "2.0", "id": "retry", "method": "tools/call", "params": {"name": "fixture", "arguments": {}}}
        self.relay.writer = io.BytesIO()
        self.relay._dispatch(json.dumps(request).encode(), request, "retry", "tools/call", True, threading.Event())
        self.assertEqual(json.loads(self.relay.writer.getvalue())["id"], "retry")
        methods = [item[0]["method"] for item in self.server.requests]
        self.assertEqual(methods, ["tools/call", "tools/list", "tools/call"])

    def test_change_capture_is_forwarded_under_reserved_local(self) -> None:
        self.relay.declarations["fixture"] = change_declaration()
        request = {"jsonrpc": "2.0", "id": "change", "method": "tools/call", "params": {
            "name": "fixture", "arguments": {"mode": "range", "base": "base", "head": "head",
            "_local": {"change": {"diff": "forged"}, "project_dir": {"path": "/forged"}}}}}
        captured = {"repo_id": "fixture", "diff": "captured", "complete": True}
        with mock.patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": self.temp.name}), mock.patch.object(yakka, "CaptureChange", return_value=captured) as capture:
            shim_reply, direct_reply = self.dispatch(request)
        self.assertEqual(shim_reply, direct_reply)
        injected = json.loads(shim_reply)["result"]["echo"]["arguments"]["_local"]
        self.assertEqual(injected["change"], captured)
        self.assertEqual(injected["project_dir"], {"path": self.temp.name})
        self.assertNotIn("forged", json.dumps(injected))
        self.assertEqual(capture.call_args.args, (self.temp.name,))
        self.assertEqual(capture.call_args.kwargs["policy"]["max_files"], CHANGE_PARAMS["change_max_files"])

    def test_static_subprocesses_are_only_fixed_reader_and_spool_entrypoints(self) -> None:
        section = (Path(yakka.__file__).read_text().split("# --- mcp ---", 1)[1].split("# --- login ---", 1)[0])
        self.assertEqual(section.count("subprocess.run("), 2)
        self.assertNotIn("shell=True", section)
        self.assertIn('[git, "-C", os.path.dirname(path), *args]', section)
        self.assertIn('"--harness", "codex", "--event", "PostToolUse"', section)

    def test_reader_withholds_external_symlink_and_content(self) -> None:
        repo = os.path.join(self.temp.name, "repo")
        os.makedirs(repo)
        path = os.path.join(repo, "secret.md")
        outside = os.path.join(self.temp.name, "outside.md")
        Path(outside).write_text("private file contents")
        subprocess.run(["git", "-C", repo, "init", "-q"], check=True)
        os.symlink(outside, path)
        declaration = {"v": 1, "rev": "0123456789abcdef", "context": [
            {"reader": "cwd", "v": 1, "params": {}},
            {"reader": "resolved_path", "v": 1, "params": {"path_arg": "path", "bases": ["cwd"]}},
            {"reader": "file", "v": 1, "params": {"of": "resolved_path"}},
            {"reader": "git", "v": 1, "params": {"of": "resolved_path"}},
        ]}
        request = {"params": {"arguments": {"path": path}}}
        facts, _ = yakka._mcp_readers(request, declaration, self.queue, getwd=lambda: (repo, None))
        self.assertEqual(facts["file"]["withheld"], "symlink_out")
        self.assertNotIn("private file contents", json.dumps(facts))

    def test_timeout_and_cancel_close_slow_http_call(self) -> None:
        self.server.close()
        self.server = MCPServer(delay=0.4)
        os.environ["YAKKA_ENDPOINT"] = self.server.url
        request = {"jsonrpc": "2.0", "id": "slow", "method": "ping"}
        with mock.patch.object(self.relay, "_timeout", return_value=0.1):
            self.relay.writer = io.BytesIO()
            self.relay._dispatch(json.dumps(request).encode(), request, "slow", "ping", True, threading.Event())
            timeout_reply = json.loads(self.relay.writer.getvalue())
            self.assertEqual(timeout_reply["id"], "slow")
            self.assertEqual(timeout_reply["error"]["data"]["code"], "timeout")
        self.relay.writer = io.BytesIO()
        cancelled = threading.Event()
        worker = threading.Thread(target=self.relay._dispatch, args=(json.dumps(request).encode(), request, "slow", "ping", True, cancelled))
        worker.start()
        time.sleep(0.05)
        cancelled.set()
        self.relay.cancel("slow")
        worker.join(timeout=1)
        self.assertFalse(worker.is_alive())
        self.assertEqual(self.relay.writer.getvalue(), b"")

    def test_missing_file_is_a_fact_and_absent_git_does_not_hide_it(self) -> None:
        repo = os.path.join(self.temp.name, "missing-repo")
        os.makedirs(repo)
        present = os.path.join(repo, "design.md")
        Path(present).write_text("present")
        missing = os.path.join(repo, "gone.md")
        declaration = {"v": 1, "rev": "0123456789abcdef", "context": [
            {"reader": "cwd", "v": 1, "params": {}},
            {"reader": "resolved_path", "v": 1, "params": {"path_arg": "path", "bases": ["cwd"]}},
            {"reader": "file", "v": 1, "params": {"of": "resolved_path"}},
            {"reader": "git", "v": 1, "params": {"of": "resolved_path"}},
        ]}
        facts, _ = yakka._mcp_readers({"params": {"arguments": {"path": missing}}}, declaration, self.queue, getwd=lambda: (repo, None))
        self.assertEqual(facts["file"], {"exists": False, "is_file": False, "size": None, "mtime": None, "content_hash": None, "withheld": None, "read_error": None})
        self.assertNotIn("_failed", facts["file"])
        with mock.patch.object(yakka, "_mcp_real_repo", side_effect=FileNotFoundError("git")):
            facts, _ = yakka._mcp_readers({"params": {"arguments": {"path": present}}}, declaration, self.queue, getwd=lambda: (repo, None))
        self.assertTrue(facts["file"]["exists"])
        self.assertIsNone(facts["file"]["content_hash"])
        self.assertEqual(facts["git"]["error"], "git_unavailable")

    def test_unresolved_queue_entry_is_not_treated_as_absent(self) -> None:
        payload = {"hook_event_name": "PostToolUse", "conversation_id": "c", "cwd": "/tmp", "tool_name": "Write", "tool_input": {"file_path": "/somewhere/else.md"}}
        raw = b'{"ts":1,"harness":"codex","event":"PostToolUse"}\n' + json.dumps(payload).encode()
        with open(os.path.join(self.queue, "c-1.evt"), "wb") as fh:
            fh.write(raw)
        with mock.patch.object(yakka, "_mcp_real_repo", side_effect=OSError("git failed")) as git:
            with self.assertRaises(OSError) as raised:
                yakka._mcp_queue_entries(self.queue, "repo", "docs/a.md", "/work/docs/a.md", 0, time.monotonic() + 5)
        self.assertEqual(str(raised.exception), "incomplete queue")
        self.assertTrue(git.called)

    def test_cancel_does_not_collapse_string_and_number_ids(self) -> None:
        self.assertNotEqual(yakka._mcp_id_key(1), yakka._mcp_id_key("1"))
        number_conn = mock.Mock()
        string_conn = mock.Mock()
        self.relay.active[yakka._mcp_id_key(1)] = number_conn
        self.relay.active[yakka._mcp_id_key("1")] = string_conn
        self.relay.cancel(1)
        number_conn.close.assert_called_once()
        string_conn.close.assert_not_called()

    def test_same_target_enqueue_serializes_coverage_and_appends_once(self) -> None:
        repo = os.path.join(self.temp.name, "enqueue-repo")
        os.makedirs(repo)
        target = os.path.join(repo, "design.md")
        Path(target).write_text("reviewed")
        subprocess.run(["git", "-C", repo, "init", "-q"], check=True)
        subprocess.run(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@x", "add", "design.md"], check=True)
        subprocess.run(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@x", "commit", "-qm", "fixture"], check=True)
        request = {"params": {"arguments": {"path": target}}}
        action_decl = {"v": 2, "rev": "0123456789abcdef", "local_actions": [yakka._MCP_ACTION], "context": [
            {"reader": "cwd", "v": 1, "params": {}, "required": True},
            {"reader": "resolved_path", "v": 1, "params": {"path_arg": "path", "bases": ["cwd"]}, "required": True},
            {"reader": "file", "v": 1, "params": {"of": "resolved_path"}, "required": True},
            {"reader": "git", "v": 1, "params": {"of": "resolved_path"}, "required": True},
            {"reader": "queue", "v": 2, "params": {"of": "git", "path": "resolved_path"}, "required": True},
            {"reader": "drain", "v": 1, "params": {}, "required": True},
        ]}
        _, _, guards, _ = yakka._mcp_context_call(json.dumps(request).encode(), "tools/call", request, action_decl, self.queue, getwd=lambda: (repo, None))
        scans = 0
        scan_lock = threading.Lock()

        def coverage(*args, **kwargs):
            nonlocal scans
            with scan_lock:
                scans += 1
                n = scans
            fact = {"complete": True, "pending_covering": 0 if n == 1 else 1, "rejected_covering": 0, "oldest_covering_age_s": None}
            return [], [], fact

        real_run = subprocess.run
        spool_calls = 0
        def spool(argv, *args, **kwargs):
            nonlocal spool_calls
            if argv[0] == os.path.realpath(os.path.join(os.path.dirname(yakka.__file__), "..", "script", "spool.sh")):
                self.assertEqual(argv, [os.path.realpath(os.path.join(os.path.dirname(yakka.__file__), "..", "script", "spool.sh")), "--harness", "codex", "--event", "PostToolUse"])
                spool_calls += 1
                return subprocess.CompletedProcess(argv, 0, b"entry.evt\n", b"")
            return real_run(argv, *args, **kwargs)

        gate = threading.Barrier(3)
        outcomes = []
        def run() -> None:
            gate.wait()
            outcomes.append(yakka._mcp_enqueue(guards, target, self.queue, "call", threading.Event(), time.monotonic() + 3, "action"))
        with mock.patch.object(yakka, "_mcp_queue_entries", side_effect=coverage), mock.patch.object(yakka.subprocess, "run", side_effect=spool):
            threads = [threading.Thread(target=run) for _ in range(2)]
            for thread in threads: thread.start()
            gate.wait()
            for thread in threads: thread.join(timeout=4)
            self.assertEqual(spool_calls, 1)
        self.assertEqual(sorted(item["outcome"] for item in outcomes), ["covered", "enqueued"])


class ChangeReaderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.env = mock.patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(self.repo), "CODEX_PROJECT_DIR": "", "CURSOR_PROJECT_DIR": ""})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.declaration = change_declaration()

    def read(self, **args) -> dict:
        values, _ = yakka._mcp_readers({"params": {"arguments": args}}, self.declaration, str(self.repo / "queue"))
        return values["change"]

    def git(self, *args: str) -> str:
        return subprocess.run(["git", "-C", str(self.repo), "-c", "user.name=fixture", "-c", "user.email=fixture@example.test", *args], check=True, capture_output=True, text=True).stdout.strip()

    def init_repo(self) -> None:
        self.git("init", "-q")
        (self.repo / "code.py").write_text("initial\n")
        self.git("add", "code.py")
        self.git("commit", "-qm", "initial")

    def test_real_capture_combined_staged_untracked_and_range(self) -> None:
        self.init_repo()
        (self.repo / "code.py").write_text("staged\n")
        self.git("add", "code.py")
        (self.repo / "code.py").write_text("working\n")
        (self.repo / "new.py").write_text("untracked\n")
        (self.repo / "skip.generated").write_text("excluded\n")
        combined = self.read(mode="uncommitted", view="combined")
        self.assertIn("+working", combined["diff"])
        self.assertNotIn("+staged", combined["diff"])
        self.assertTrue(any(x["reason"] == "untracked_not_included" for x in combined["manifest"]))
        staged = self.read(mode="uncommitted", view="staged")
        self.assertIn("+staged", staged["diff"])
        self.assertNotIn("+working", staged["diff"])
        untracked = self.read(mode="uncommitted", include_untracked=True)
        self.assertIn("+untracked", untracked["diff"])
        self.assertNotIn("+excluded", untracked["diff"])
        self.assertTrue(any(x["path"] == "skip.generated" and x["reason"] == "excluded" for x in untracked["manifest"]))
        self.git("commit", "-qm", "staged change")
        for merge_base in (False, True):
            with self.subTest(merge_base=merge_base):
                ranged = self.read(mode="range", base="HEAD~1", head="HEAD", merge_base=merge_base)
                self.assertIn("+staged", ranged["diff"])
                self.assertNotIn("+working", ranged["diff"])
                self.assertEqual(ranged["merge_base"], merge_base)
                self.assertEqual(ranged["resolved_head"], self.git("rev-parse", "HEAD"))

    def test_policy_and_call_arguments_reach_capture_without_agent_policy(self) -> None:
        params = self.declaration["context"][-1]["params"]
        params.update(change_max_file_bytes=123, change_max_total_bytes=456, change_max_files=2, context_lines=0, docs_never_noise=False)
        args = {"mode": "range", "view": "combined", "include_untracked": True,
                "base": "a", "head": "b", "merge_base": True, "repo_id": "expected"}
        with mock.patch.object(yakka, "CaptureChange", return_value={"diff": "ok"}) as capture:
            self.assertEqual(self.read(**args, policy={"exclude": []}, change_max_files=999), {"diff": "ok"})
        kwargs = capture.call_args.kwargs
        self.assertEqual({k: kwargs[k] for k in args}, args)
        self.assertEqual(capture.call_args.args, (str(self.repo),))
        policy = kwargs["policy"]
        self.assertEqual({k: policy[k] for k in params}, params)
        self.assertEqual([policy[k] for k in ("max_file_bytes", "max_total_bytes", "max_files", "context_lines")], [123, 456, 2, 0])
        self.assertEqual(policy["exclude"], params["change_exclude"])

    def test_malformed_policy_fails_closed_before_capture(self) -> None:
        bad = []
        for key in CHANGE_PARAMS:
            p = copy.deepcopy(CHANGE_PARAMS)
            del p[key]
            bad.append(p)
        integer_limits = {"change_max_file_bytes": (1, 262144), "change_max_total_bytes": (1, 2097152),
                          "change_max_files": (1, 200), "context_lines": (0, 100), "budget_bytes": (2097152, 2097152)}
        for key, (lo, hi) in integer_limits.items():
            for value in (True, False, "1", 1.0, None, lo - 1, hi + 1):
                bad.append({**CHANGE_PARAMS, key: value})
        for value in (1, "true", None, [], {}):
            bad.append({**CHANGE_PARAMS, "docs_never_noise": value})
        for value in ("future", 1, None, ["review-exclusions-v1"]):
            bad.append({**CHANGE_PARAMS, "exclusion_policy_version": value})
        for key in ("change_exclude", "excluded_files", "excluded_directories", "lockfiles", "truncation_order"):
            for value in ([], "*.py", None, [1], [True], [""], ["../outside"], ["/absolute"], ["https://host"], ["bad\\path"], ["a\nb"], ["a b"], ["$(command)"], ["[abc]"]):
                bad.append({**CHANGE_PARAMS, key: value})
        bad.extend([{**CHANGE_PARAMS, "command": "git"}, {**CHANGE_PARAMS, "truncation_order": ["docs", "config", "tests", "code"]}])
        with mock.patch.object(yakka, "CaptureChange") as capture:
            for i, params in enumerate(bad):
                with self.subTest(case=i, params=params):
                    self.declaration["context"][-1]["params"] = params
                    self.assertEqual(self.read(), {"_failed": {"code": "bad_params"}})
            capture.assert_not_called()

    def test_declaration_shape_and_versions_fail_closed(self) -> None:
        cases = [({"bulk": False}, "bad_params"), ({"bulk": 1}, "bad_params"),
                 ({"content": True}, "bad_params"), ({"required": "false"}, "bad_params"),
                 ({"v": 2}, "unsupported_reader_version"), ({"v": True}, "unsupported_reader_version")]
        with mock.patch.object(yakka, "CaptureChange") as capture:
            for patch, code in cases:
                with self.subTest(patch=patch):
                    self.declaration = change_declaration()
                    self.declaration["context"][-1].update(patch)
                    self.assertEqual(self.read(), {"_failed": {"code": code}})
            self.declaration = change_declaration()
            del self.declaration["context"][-1]["bulk"]
            self.assertEqual(self.read(), {"_failed": {"code": "bad_params"}})
            self.declaration = change_declaration()
            self.declaration["v"] = 3
            self.assertEqual(self.read(), {"_failed": {"code": "unsupported_declaration"}})
            capture.assert_not_called()

    def test_capture_errors_are_typed_failures(self) -> None:
        for code in ("bad_ref", "no_project_dir", "wrong_checkout", "changed_during_capture", "not_a_repository", "git_unavailable", "over_budget", "bad_argument"):
            with self.subTest(code=code), mock.patch.object(yakka, "CaptureChange", side_effect=yakka.CaptureError(code)):
                self.assertEqual(self.read(), {"_failed": {"code": "bad_input" if code == "bad_argument" else code}})
        for error, code in ((TimeoutError(), "timeout"), (OSError(), "io_error")):
            with mock.patch.object(yakka, "CaptureChange", side_effect=error):
                self.assertEqual(self.read(), {"_failed": {"code": code}})

    def test_missing_project_dir_has_no_cwd_or_agent_fallback(self) -> None:
        with mock.patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": "", "CODEX_PROJECT_DIR": "", "CURSOR_PROJECT_DIR": ""}):
            self.assertEqual(self.read(project_dir=str(self.repo), _local={"project_dir": {"path": str(self.repo)}}), {"_failed": {"code": "no_project_dir"}})
        self.declaration["context"] = self.declaration["context"][1:]
        self.assertEqual(self.read(), {"_failed": {"code": "no_project_dir"}})

    def test_real_capture_argument_and_checkout_errors(self) -> None:
        self.init_repo()
        for args, code in (({"mode": "invalid"}, "bad_input"), ({"include_untracked": "true"}, "bad_input"),
                           ({"mode": "range", "base": "-unsafe", "head": "HEAD"}, "bad_ref"),
                           ({"repo_id": "wrong"}, "wrong_checkout")):
            with self.subTest(args=args):
                self.assertEqual(self.read(**args), {"_failed": {"code": code}})

    def test_serialized_capture_budget_replaces_nonbulk_limit(self) -> None:
        for size, ok in ((65537, True), (2097141, True), (2097142, False)):
            value = {"diff": "x" * size}
            with self.subTest(size=size), mock.patch.object(yakka, "CaptureChange", return_value=value):
                self.assertEqual(self.read(), value if ok else {"_failed": {"code": "over_budget"}})
        with mock.patch.object(yakka, "CaptureChange", return_value={"diff": "é" * 1048576}):
            self.assertEqual(self.read(), {"_failed": {"code": "over_budget"}})

    def test_bearer_key_scan_still_withholds_capture(self) -> None:
        with mock.patch.object(yakka, "CaptureChange", return_value={"diff": KEY}), mock.patch.object(yakka, "Load", return_value=yakka.Config(Key=KEY)):
            self.assertEqual(self.read(), {"_failed": {"code": "secret_in_context"}})

    def test_capture_git_uses_reader_deadline_and_cleans_up(self) -> None:
        def capture(*args, **kwargs):
            yakka._capture_git(str(self.repo), "rev-parse", "--show-toplevel")
            return {"diff": "ok"}
        with mock.patch.object(yakka, "CaptureChange", side_effect=capture), mock.patch.object(yakka.subprocess, "run", side_effect=subprocess.TimeoutExpired("git", 5)) as run:
            self.assertEqual(self.read(), {"_failed": {"code": "timeout"}})
            self.assertGreater(run.call_args.kwargs["timeout"], 0)
            self.assertLessEqual(run.call_args.kwargs["timeout"], 5)
        self.assertIsNone(yakka._capture_deadline.get())
        with mock.patch.object(yakka, "_MCP_READER_TIMEOUT_S", 0), mock.patch.object(yakka.subprocess, "run") as run:
            self.assertEqual(self.read(), {"_failed": {"code": "timeout"}})
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
