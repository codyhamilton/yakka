"""Conformance tests for the stdio to authenticated server relay."""

from __future__ import annotations

import http.client
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


if __name__ == "__main__":
    unittest.main()
