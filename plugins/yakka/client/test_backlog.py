import contextlib
import io
import json
import os
import re
import shutil
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List, Optional, Tuple
from unittest import mock

import yakka

_SCRATCH = os.path.expanduser("~/workspace/.briefs/q")
_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def _make_scratch() -> str:
    os.makedirs(_SCRATCH, exist_ok=True)
    return tempfile.mkdtemp(dir=_SCRATCH, prefix="plan21-backlog-")


def _write_event(
    dir_path: str,
    name: str,
    harness: str,
    event: str,
    payload: Dict[str, Any],
    ts: int,
) -> None:
    body = (
        json.dumps(
            {"ts": ts, "harness": harness, "event": ""},
            separators=(",", ":"),
        )
        + "\n"
        + json.dumps(payload, separators=(",", ":"))
    )
    with open(os.path.join(dir_path, name), "w", encoding="utf-8") as f:
        f.write(body)


def _fixture(source: str) -> None:
    os.makedirs(os.path.join(source, "rejected"), exist_ok=True)
    base_payload = {
        "hook_event_name": "Stop",
        "session_id": "s1",
        "cwd": source,
        "note": "PAYLOAD_MARKER_ZZZ",
    }
    _write_event(source, "stop-a.evt", "codex", "Stop", base_payload, 100)
    _write_event(
        source,
        "reject-dup.evt",
        "codex",
        "Stop",
        dict(base_payload),
        100,
    )
    _write_event(
        source,
        "post-b.evt",
        "codex",
        "PostToolUse",
        {
            "hook_event_name": "PostToolUse",
            "session_id": "s1",
            "tool_name": "Bash",
            "tool_input": {"command": "echo hi"},
        },
        101,
    )
    _write_event(
        source,
        "post-c.evt",
        "codex",
        "PostToolUse",
        {
            "hook_event_name": "PostToolUse",
            "session_id": "s1",
            "tool_name": "apply_patch",
            "tool_input": {
                "patch": "*** Add File: " + os.path.join(source, "nope-missing") + "\n"
            },
        },
        102,
    )
    _write_event(
        source,
        "pre1.evt",
        "codex",
        "PreToolUse",
        {"hook_event_name": "PreToolUse", "session_id": "s1"},
        103,
    )
    _write_event(
        source,
        "pre2.evt",
        "codex",
        "PreToolUse",
        {"hook_event_name": "PreToolUse", "session_id": "s2"},
        104,
    )
    with open(os.path.join(source, "bad.evt"), "w", encoding="utf-8") as f:
        f.write("not json\n")
    with open(
        os.path.join(source, "rejected", "old.evt"), "w", encoding="utf-8"
    ) as f:
        f.write("not json\n")
    with open(
        os.path.join(source, "rejected", "old.reason"), "w", encoding="utf-8"
    ) as f:
        f.write("secret: pattern\n")


def _source_signature(source: str) -> Tuple[int, int]:
    total = 0
    n = 0
    for name in os.listdir(source):
        p = os.path.join(source, name)
        if name.startswith(".") or not name.endswith(".evt"):
            continue
        if os.path.isfile(p):
            n += 1
            total += os.path.getsize(p)
    return n, total


def _quiet(fn: Any, *args: Any, **kwargs: Any) -> Any:
    with contextlib.redirect_stdout(io.StringIO()):
        with contextlib.redirect_stderr(io.StringIO()):
            return fn(*args, **kwargs)


class _FakeState:
    def __init__(self) -> None:
        self.stored: set[str] = set()
        self.lock = threading.Lock()


class _Handler(BaseHTTPRequestHandler):
    state: _FakeState

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def version_string(self) -> str:
        return "FakeHTTP/1.0"

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        req = json.loads(self.rfile.read(length))
        results = []
        for fact in req.get("facts", []):
            fid = fact.get("id", "")
            harness = fact.get("harness", "")
            event = fact.get("event", "")
            if (harness, event) in yakka._POLICY_REMOVE:
                results.append({"id": fid, "status": "accepted"})
                continue
            if fid.startswith("reject-dup"):
                results.append(
                    {
                        "id": fid,
                        "status": "rejected",
                        "reason": "designated rejection",
                    }
                )
                continue
            raw = json.dumps(
                fact, separators=(",", ":"), sort_keys=True
            ).encode("utf-8")
            h, _ = yakka.RowHash(raw)
            with self.state.lock:
                if h in self.state.stored:
                    results.append({"id": fid, "status": "duplicate"})
                else:
                    self.state.stored.add(h)
                    results.append({"id": fid, "status": "accepted"})
        body = json.dumps({"results": results}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _start_fake() -> Tuple[str, _FakeState, HTTPServer]:
    state = _FakeState()

    class Handler(_Handler):
        pass

    Handler.state = state
    srv = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    host, port = srv.server_address
    return f"http://{host}:{port}", state, srv


class BacklogTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dirs: List[str] = []
        self.servers: List[HTTPServer] = []

    def tearDown(self) -> None:
        for srv in self.servers:
            srv.shutdown()
            srv.server_close()
        for d in self.dirs:
            shutil.rmtree(d, ignore_errors=True)

    def _scratch(self) -> str:
        d = _make_scratch()
        self.dirs.append(d)
        return d

    def _stage_fixture(self) -> Tuple[str, str]:
        source = os.path.join(self._scratch(), "source")
        os.makedirs(source)
        _fixture(source)
        stage = os.path.join(self._scratch(), "stage")
        rc = _quiet(yakka._backlog_stage, source, stage)
        self.assertEqual(rc, 0)
        return source, stage

    def _manifest(self, stage: str) -> Dict[str, Any]:
        rc = _quiet(yakka._backlog_manifest, stage)
        self.assertEqual(rc, 0)
        with open(os.path.join(stage, "manifest.json"), encoding="utf-8") as f:
            return json.load(f)

    def _fake(self) -> Tuple[str, _FakeState]:
        url, state, srv = _start_fake()
        self.servers.append(srv)
        return url, state

    def _sink(self, url: str) -> Any:
        return lambda: (
            yakka.HTTPSink(Endpoint=url, Key="KEY-SHOULD-NOT-APPEAR"),
            None,
        )

    def test_stage_copies_only_top_level_evt_and_leaves_source(self) -> None:
        source = os.path.join(self._scratch(), "source")
        os.makedirs(source)
        _fixture(source)
        before = _source_signature(source)
        stage = os.path.join(self._scratch(), "stage")
        self.assertEqual(_quiet(yakka._backlog_stage, source, stage), 0)
        staged = sorted(
            n for n in os.listdir(os.path.join(stage, "queue"))
        )
        self.assertEqual(
            staged,
            [
                "bad.evt",
                "post-b.evt",
                "post-c.evt",
                "pre1.evt",
                "pre2.evt",
                "reject-dup.evt",
                "stop-a.evt",
            ],
        )
        self.assertEqual(_source_signature(source), before)
        self.assertFalse(os.path.exists(os.path.join(stage, "queue", "rejected")))
        with open(os.path.join(stage, "manifest.json"), encoding="utf-8") as f:
            m = json.load(f)
        self.assertEqual(m["source"]["file_count"], before[0])
        self.assertEqual(m["source"]["bytes"], before[1])
        self.assertEqual(m["source"]["rejected_evt"], 1)
        self.assertEqual(m["source"]["rejected_reason"], 1)
        self.assertEqual(m["staged"]["file_count"], before[0])
        self.assertEqual(m["staged"]["bytes"], before[1])

    def test_stage_inside_source_refused(self) -> None:
        source = os.path.join(self._scratch(), "source")
        os.makedirs(source)
        _fixture(source)
        stage = os.path.join(source, "stage")
        self.assertEqual(_quiet(yakka._backlog_stage, source, stage), 2)
        self.assertFalse(os.path.exists(os.path.join(stage, "queue")))

    def test_stage_nonempty_queue_refused(self) -> None:
        source = os.path.join(self._scratch(), "source")
        os.makedirs(source)
        _fixture(source)
        stage = os.path.join(self._scratch(), "stage")
        queue = os.path.join(stage, "queue")
        os.makedirs(queue)
        with open(os.path.join(queue, "old.evt"), "w", encoding="utf-8") as f:
            f.write("x")
        self.assertEqual(_quiet(yakka._backlog_stage, source, stage), 2)

    def test_manifest_counts_and_no_artifact_reads(self) -> None:
        source, stage = self._stage_fixture()
        with mock.patch.object(
            yakka, "_read_file", side_effect=AssertionError("file read")
        ):
            m = self._manifest(stage)
        self.assertEqual(m["files"], 7)
        self.assertEqual(m["facts"], 6)
        self.assertEqual(m["facts_by_type"], {"hook_event": 6})
        self.assertNotIn("artifact_version", m["facts_by_type"])
        self.assertNotIn("commit", m["facts_by_type"])
        self.assertEqual(m["local_rejected_files"], {"unparseable": 1})
        self.assertEqual(m["policy_dropped"], 2)
        self.assertEqual(m["distinct_row_hashes"], 5)
        self.assertEqual(m["duplicate_facts"], 1)
        self.assertEqual(m["expected_stored"], 3)
        self.assertEqual(m["rejected_dir"], {"evt": 1, "reason": 1})

    def test_events_only_skips_snapshot_without_reading(self) -> None:
        source = os.path.join(self._scratch(), "source")
        os.makedirs(source)
        target = os.path.join(self._scratch(), "design.md")
        with open(target, "w", encoding="utf-8") as f:
            f.write("# design\n")
        _write_event(
            source,
            "stop-a.evt",
            "codex",
            "Stop",
            {"hook_event_name": "Stop", "session_id": "s1", "cwd": source},
            100,
        )
        body = (
            json.dumps(
                {"ts": 101, "harness": "codex", "event": "artifact_snapshot"},
                separators=(",", ":"),
            )
            + "\n"
            + json.dumps(
                {"session_id": "s1", "cwd": source, "path": target},
                separators=(",", ":"),
            )
        )
        with open(os.path.join(source, "snap.evt"), "w", encoding="utf-8") as f:
            f.write(body)
        stage = os.path.join(self._scratch(), "stage")
        self.assertEqual(_quiet(yakka._backlog_stage, source, stage), 0)
        with mock.patch.object(
            yakka, "_read_file", side_effect=AssertionError("file read")
        ):
            m = self._manifest(stage)
        self.assertEqual(m["facts"], 1)
        self.assertEqual(m["facts_by_type"], {"hook_event": 1})
        self.assertEqual(m["local_rejected_files"], {"not_hook_event": 1})
        url, state = self._fake()
        self.assertEqual(
            _quiet(yakka._backlog_upload, stage, self._sink(url)), 0
        )
        with open(os.path.join(stage, "report.json"), encoding="utf-8") as f:
            report = json.load(f)
        self.assertEqual(report["facts_sent"], 1)
        self.assertEqual(report["files_sent"], 1)
        self.assertEqual(report["files_local_rejected"], 1)
        self.assertEqual(len(state.stored), 1)
        self.assertTrue(
            os.path.exists(
                os.path.join(stage, "queue", "rejected", "snap.evt")
            )
        )

    def test_upload_first_run(self) -> None:
        _source, stage = self._stage_fixture()
        self._manifest(stage)
        url, state = self._fake()
        rc = _quiet(yakka._backlog_upload, stage, self._sink(url))
        self.assertEqual(rc, 0)
        with open(os.path.join(stage, "report.json"), encoding="utf-8") as f:
            text = f.read()
        report = json.loads(text)
        self.assertEqual(report["run_kind"], "first")
        self.assertTrue(report["verified"])
        self.assertEqual(report["facts_sent"], 6)
        self.assertEqual(report["facts_by_type"], {"hook_event": 6})
        self.assertEqual(report["accepted"], 5)
        self.assertEqual(report["duplicate"], 0)
        self.assertEqual(report["rejected"], 1)
        self.assertEqual(report["stored"], 3)
        self.assertEqual(report["manifest_expected_stored"], 3)
        self.assertEqual(report["files_sent"], 5)
        self.assertEqual(report["files_local_rejected"], 1)
        self.assertEqual(report["server_side_count"], "gate")
        self.assertEqual(len(state.stored), 3)
        self.assertNotIn("PAYLOAD_MARKER_ZZZ", text)
        self.assertNotIn("KEY-SHOULD-NOT-APPEAR", text)
        self.assertNotIn("Authorization", text)
        self.assertNotIn("Bearer", text)

    def test_upload_rerun_stores_zero_new_rows(self) -> None:
        source = os.path.join(self._scratch(), "source")
        os.makedirs(source)
        _fixture(source)
        url, state = self._fake()
        stage1 = os.path.join(self._scratch(), "stage1")
        self.assertEqual(_quiet(yakka._backlog_stage, source, stage1), 0)
        self._manifest(stage1)
        self.assertEqual(
            _quiet(yakka._backlog_upload, stage1, self._sink(url)), 0
        )
        stored_after_first = set(state.stored)
        self.assertEqual(len(stored_after_first), 3)

        stage2 = os.path.join(self._scratch(), "stage2")
        self.assertEqual(_quiet(yakka._backlog_stage, source, stage2), 0)
        self._manifest(stage2)
        self.assertEqual(
            _quiet(yakka._backlog_upload, stage2, self._sink(url)), 0
        )
        with open(os.path.join(stage2, "report.json"), encoding="utf-8") as f:
            report = json.load(f)
        self.assertEqual(report["run_kind"], "rerun")
        self.assertTrue(report["verified"])
        self.assertTrue(report["zero_new_rows"])
        self.assertEqual(report["accepted"], 2)
        self.assertEqual(report["duplicate"], 3)
        self.assertEqual(report["rejected"], 1)
        self.assertEqual(report["stored"], 0)
        self.assertEqual(state.stored, stored_after_first)

    def test_upload_refuses_missing_and_stale_manifest(self) -> None:
        _source, stage = self._stage_fixture()
        url, _state = self._fake()
        self.assertEqual(
            _quiet(yakka._backlog_upload, stage, self._sink(url)), 2
        )
        m = self._manifest(stage)
        m["files"] = m["files"] + 1
        with open(os.path.join(stage, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(m, f)
        self.assertEqual(
            _quiet(yakka._backlog_upload, stage, self._sink(url)), 2
        )

    def test_upload_refuses_existing_report(self) -> None:
        _source, stage = self._stage_fixture()
        self._manifest(stage)
        with open(os.path.join(stage, "report.json"), "w", encoding="utf-8") as f:
            f.write("{}")
        url, _state = self._fake()
        self.assertEqual(
            _quiet(yakka._backlog_upload, stage, self._sink(url)), 2
        )

    def test_policy_remove_matches_server_table(self) -> None:
        path = os.path.join(
            _REPO, "packages", "yakka", "internal", "ingest", "policy.go"
        )
        with open(path, encoding="utf-8") as f:
            text = f.read()
        pairs = set(
            re.findall(r'\{"([^"]+)",\s*"([^"]+)"\}:\s*Remove', text)
        )
        self.assertEqual(pairs, set(yakka._POLICY_REMOVE))


if __name__ == "__main__":
    unittest.main()
