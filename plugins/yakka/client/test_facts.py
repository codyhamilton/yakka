import json
import os
import pwd
import subprocess
import tempfile
import unittest
from typing import Any
from unittest import mock

import yakka

_REPO_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(__file__), os.pardir, os.pardir, os.pardir)
)
_FIXTURES = os.path.join(_REPO_ROOT, "packages", "hooklog", "tests", "fixtures")
_YAKKA_PKG = os.path.join(_REPO_ROOT, "packages", "yakka")

NOTES = "line one\nline two\nline three\nline four\nline five\nline six\n"


def _run_git(dir_path: str, *args: str) -> str:
    env = os.environ.copy()
    env.update(
        {
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_AUTHOR_NAME": "t",
            "GIT_AUTHOR_EMAIL": "t@x",
            "GIT_COMMITTER_NAME": "t",
            "GIT_COMMITTER_EMAIL": "t@x",
        }
    )
    cmd = ["git", "-C", dir_path, *args]
    out = subprocess.run(cmd, check=True, capture_output=True, text=True, env=env)
    return out.stdout.strip()


def _put(dir_path: str, rel: str, body: str) -> None:
    p = os.path.join(dir_path, rel)
    os.makedirs(os.path.dirname(p), mode=0o755, exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(body)


def _new_repo() -> tuple[str, str, str]:
    dir_path = os.path.realpath(tempfile.mkdtemp())
    _run_git(dir_path, "init", "-q")
    _put(dir_path, "notes/old.txt", NOTES)
    _put(dir_path, "docs/plans/x/briefs/gone.md", "# gone\n")
    _run_git(dir_path, "add", ".")
    _run_git(dir_path, "commit", "-q", "-m", "first")
    _put(dir_path, "docs/plans/x/DESIGN.md", "# Design\n")
    _put(dir_path, "docs/plans/x/briefs/a.md", "# Brief\n")
    _put(dir_path, "other.txt", "x\n")
    _run_git(dir_path, "mv", "notes/old.txt", "notes/new.txt")
    _run_git(dir_path, "add", ".")
    _run_git(dir_path, "commit", "-q", "-m", "second")
    repo_id, err = yakka.RepoID(dir_path)
    if err:
        raise err
    sha = _run_git(dir_path, "rev-parse", "HEAD")
    return dir_path, sha, repo_id


def _queue_file(name: str, harness: str, payload: dict[str, Any]) -> yakka.File:
    b = json.dumps(payload, separators=(",", ":"))
    event = payload["hook_event_name"]
    data = (
        f'{{"ts":1700000000.5,"harness":{json.dumps(harness)},"event":{json.dumps(event)}}}\n'
        + b
    ).encode()
    return yakka.File(Name=name, Data=data)


def _decode(out: yakka.Output) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for f in out.Facts:
        raw = f if isinstance(f, (bytes, bytearray)) else f.encode()
        result.append(json.loads(raw))
    return result


def _load_fixtures(file: str, *repl: str) -> list[dict[str, Any]]:
    path = os.path.join(_FIXTURES, file)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    for i in range(0, len(repl), 2):
        text = text.replace(repl[i], repl[i + 1])
    obj = json.loads(text)
    if isinstance(obj, list):
        return obj
    return obj["fixtures"]


_GO_INGEST_BRIDGE = r"""
package facts

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/codyhamilton/yakka/packages/yakka/internal/ingest"
	"github.com/codyhamilton/yakka/packages/yakka/internal/store"
)

func TestPythonIngestBridge(t *testing.T) {
	factsPath := os.Getenv("YAKKA_FACTS_FILE")
	storeDir := os.Getenv("YAKKA_STORE_DIR")
	if factsPath == "" || storeDir == "" {
		t.Skip("bridge env not set")
	}
	b, err := os.ReadFile(factsPath)
	if err != nil {
		t.Fatal(err)
	}
	var facts []json.RawMessage
	if err := json.Unmarshal(b, &facts); err != nil {
		t.Fatal(err)
	}
	ten, err := store.Open(storeDir, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer ten.Close()
	res, err := ingest.Ingest(context.Background(), ten, facts)
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != len(facts) {
		t.Fatalf("results %d for %d facts", len(res), len(facts))
	}
	for _, x := range res {
		if x.Status == ingest.Rejected {
			t.Fatalf("rejected: %+v", x)
		}
	}
}
"""

_FACTS_BRIDGE_GO = os.path.join(
    _YAKKA_PKG, "internal", "facts", "z_python_ingest_bridge_test.go"
)


def _assert_ingest(facts: list) -> None:
    raw_facts: list[bytes] = []
    for f in facts:
        if isinstance(f, (bytes, bytearray)):
            raw_facts.append(bytes(f))
        elif isinstance(f, dict):
            raw_facts.append(json.dumps(f, separators=(",", ":")).encode())
        else:
            raw_facts.append(f)
    with tempfile.TemporaryDirectory() as store_dir:
        with tempfile.NamedTemporaryFile("wb", suffix=".json", delete=False) as tf:
            tf.write(b"[" + b",".join(raw_facts) + b"]")
            facts_path = tf.name
        wrote_bridge = False
        try:
            if not os.path.exists(_FACTS_BRIDGE_GO):
                with open(_FACTS_BRIDGE_GO, "w", encoding="utf-8") as gf:
                    gf.write(_GO_INGEST_BRIDGE)
                wrote_bridge = True
            home = pwd.getpwuid(os.getuid()).pw_dir
            base_env = {
                k: v
                for k, v in os.environ.items()
                if k not in ("HOME", "GOPATH", "GOMODCACHE", "GOCACHE")
            }
            base_env["HOME"] = home
            env = dict(base_env)
            for key, go_key in (
                ("GOPATH", "GOPATH"),
                ("GOMODCACHE", "GOMODCACHE"),
                ("GOCACHE", "GOCACHE"),
            ):
                proc_env = subprocess.run(
                    ["go", "env", go_key],
                    capture_output=True,
                    text=True,
                    check=True,
                    env=base_env,
                )
                env[key] = proc_env.stdout.strip()
            env["HOME"] = home
            env["YAKKA_FACTS_FILE"] = facts_path
            env["YAKKA_STORE_DIR"] = store_dir
            proc = subprocess.run(
                ["go", "test", "-run", "^TestPythonIngestBridge$", "./internal/facts"],
                cwd=_YAKKA_PKG,
                capture_output=True,
                text=True,
                env=env,
            )
        finally:
            os.unlink(facts_path)
            if wrote_bridge:
                try:
                    os.unlink(_FACTS_BRIDGE_GO)
                except OSError:
                    pass
        if proc.returncode != 0:
            raise AssertionError(
                f"ingest bridge exit {proc.returncode}: {proc.stdout}\n{proc.stderr}"
            )


class TestWritesFixtures(unittest.TestCase):
    def test_writes_fixtures(self) -> None:
        rdir, _, repo_id = _new_repo()
        fx = _load_fixtures("artifact_writes.json")
        self.assertEqual(len(fx), 11)
        _put(rdir, "docs/plans/example/DESIGN.md", "# Design example\n")
        _put(rdir, "docs/plans/example/briefs/01.md", "# Brief example\n")
        all_facts: list = []
        for i, f in enumerate(fx):
            f["payload"]["cwd"] = rdir
            out = yakka.Build(
                None, [_queue_file(f"q{i}", f["harness"], f["payload"])]
            )[0]
            fs = _decode(out)
            self.assertEqual(len(fs), 2)
            self.assertEqual(len(out.Reasons), 0)
            self.assertEqual(fs[0]["type"], "hook_event")
            self.assertEqual(fs[0]["id"], f"q{i}#0")
            v = fs[1]
            path = v["path"]
            with open(os.path.join(rdir, path), "rb") as rf:
                body = rf.read()
            self.assertEqual(v["type"], "artifact_version")
            self.assertEqual(v["source"], "worktree")
            self.assertEqual(v["repo_id"], repo_id)
            self.assertEqual(v["content_hash"], yakka.ContentHash(body))
            self.assertEqual(v["content"], body.decode())
            self.assertTrue(path.startswith("docs/plans/example/"))
            all_facts.extend(out.Facts)
        _assert_ingest(all_facts)


class TestWritesCoalesceAndMissing(unittest.TestCase):
    def test_writes_coalesce_and_missing(self) -> None:
        rdir, _, _ = _new_repo()
        _put(rdir, "docs/plans/example/DESIGN.md", "# D\n")
        p1 = {
            "hook_event_name": "postToolUse",
            "tool_name": "write",
            "conversation_id": "c",
            "cwd": rdir,
            "tool_input": {"file_path": "docs/plans/example/DESIGN.md"},
        }
        p2 = {
            "hook_event_name": "afterFileEdit",
            "conversation_id": "c",
            "cwd": rdir,
            "file_path": "docs/plans/example/DESIGN.md",
        }
        outs = yakka.Build(
            None,
            [
                _queue_file("a", "cursor", p1),
                _queue_file("b", "cursor", p2),
            ],
        )
        self.assertEqual(len(outs[0].Facts), 1)
        self.assertEqual(len(outs[1].Facts), 2)
        p3 = {
            "hook_event_name": "afterFileEdit",
            "conversation_id": "d",
            "cwd": rdir,
            "file_path": "docs/plans/example/DESIGN.md",
        }
        outs = yakka.Build(
            None,
            [
                _queue_file("a", "cursor", p1),
                _queue_file("b", "cursor", p3),
            ],
        )
        self.assertEqual(len(outs[0].Facts), 2)
        self.assertEqual(len(outs[1].Facts), 2)
        os.remove(os.path.join(rdir, "docs/plans/example/DESIGN.md"))
        outs = yakka.Build(None, [_queue_file("a", "cursor", p1)])
        self.assertEqual(len(outs[0].Facts), 1)
        self.assertEqual(len(outs[0].Reasons), 0)


class TestBadFiles(unittest.TestCase):
    def test_bad_files(self) -> None:
        outs = yakka.Build(
            None,
            [
                yakka.File(Name="a", Data=b"nope\n{}"),
                yakka.File(Name="b", Data=b'{"ts":1,"harness":"claude"}\n[1]'),
                yakka.File(
                    Name="c",
                    Data=b'{"ts":1,"harness":"claude"}\n{"tool_name":"x"}',
                ),
                yakka.File(Name="d", Data=b'{"ts":1,"harness":"claude"}\n{not json'),
            ],
        )
        want = [
            "unparseable: envelope is not JSON",
            "unparseable: payload is not an object",
            "invalid: no conversation id",
            "unparseable: payload is not JSON",
        ]
        for i, o in enumerate(outs):
            self.assertEqual(len(o.Facts), 0)
            self.assertEqual(len(o.Reasons), 1)
            self.assertEqual(o.Reasons[0], want[i])


class TestCommitFixtures(unittest.TestCase):
    def test_commit_fixtures(self) -> None:
        rdir, sha, repo_id = _new_repo()
        fx = _load_fixtures(
            "commit_calls.json", "{{DIR}}", rdir, "{{SHA7}}", sha[:7]
        )
        self.assertEqual(len(fx), 7)
        all_facts: list = []
        for i, f in enumerate(fx):
            out = yakka.Build(
                None, [_queue_file(f"c{i}", f["harness"], f["payload"])]
            )[0]
            fs = _decode(out)
            if not f["expect_commit"]:
                self.assertEqual(len(fs), 1)
                self.assertEqual(fs[0]["type"], "hook_event")
                continue
            self.assertEqual(len(fs), 4)
            c = fs[1]
            self.assertEqual(c["type"], "commit")
            self.assertEqual(c["sha"], sha)
            self.assertEqual(c["repo_id"], repo_id)
            self.assertEqual(
                "[" + " ".join(c["paths"]) + "]",
                "[docs/plans/x/DESIGN.md docs/plans/x/briefs/a.md notes/new.txt other.txt]",
            )
            rn = c["renames"]
            self.assertEqual(len(rn), 1)
            self.assertEqual(rn[0]["from"], "notes/old.txt")
            self.assertEqual(rn[0]["to"], "notes/new.txt")
            got2: dict[str, bool] = {}
            for v in fs[2:]:
                self.assertEqual(v["type"], "artifact_version")
                self.assertEqual(v["source"], "commit")
                self.assertEqual(v["sha"], sha)
                body = _run_git(rdir, "show", f"{sha}:{v['path']}")
                self.assertEqual(v["content"].strip(), body.strip())
                self.assertEqual(
                    v["content_hash"], yakka.ContentHash(v["content"].encode())
                )
                got2[v["path"]] = True
            self.assertTrue(got2.get("docs/plans/x/DESIGN.md"))
            self.assertTrue(got2.get("docs/plans/x/briefs/a.md"))
            self.assertEqual(len(got2), 2)
            all_facts.extend(out.Facts)
        _assert_ingest(all_facts)


class TestCommitDedupeInBatch(unittest.TestCase):
    def test_commit_dedupe_in_batch(self) -> None:
        rdir, sha, _ = _new_repo()
        fx = _load_fixtures(
            "commit_calls.json", "{{DIR}}", rdir, "{{SHA7}}", sha[:7]
        )
        a = _queue_file("a", fx[1]["harness"], fx[1]["payload"])
        b = _queue_file("b", fx[1]["harness"], fx[1]["payload"])
        outs = yakka.Build(None, [a, b])
        self.assertEqual(len(outs[0].Facts), 4)
        self.assertEqual(len(outs[1].Facts), 1)


def _fake_secret() -> str:
    return "gh" + "p_" + "a1B2" * 9


class TestSecretScrub(unittest.TestCase):
    def test_secret_scrub(self) -> None:
        rdir, _, _ = _new_repo()
        sec = _fake_secret()
        _put(rdir, "docs/plans/example/DESIGN.md", "# D\nok\ntoken: " + sec + "\n")
        p = {
            "hook_event_name": "PostToolUse",
            "tool_name": "Write",
            "session_id": "s",
            "cwd": rdir,
            "tool_input": {
                "file_path": "docs/plans/example/DESIGN.md",
                "content": "token: " + sec,
            },
        }
        out = yakka.Build(None, [_queue_file("q", "claude", p)])[0]
        self.assertEqual(len(out.Facts), 1)
        self.assertEqual(len(out.Reasons), 1)
        self.assertIn("secret: ", out.Reasons[0])
        self.assertIn(
            "at line 3 in docs/plans/example/DESIGN.md", out.Reasons[0]
        )
        raw = out.Facts[0]
        hv = json.loads(raw)
        self.assertEqual(hv["type"], "hook_event")
        self.assertNotIn(sec.encode(), raw)
        self.assertIn(b"[REDACTED", raw)
        self.assertNotIn(sec, str(out.Reasons))


class TestSecretInCommittedBlob(unittest.TestCase):
    def test_secret_in_committed_blob(self) -> None:
        rdir, _, _ = _new_repo()
        sec = _fake_secret()
        _put(rdir, "docs/plans/x/briefs/s.md", "key " + sec + "\n")
        _run_git(rdir, "add", ".")
        _run_git(rdir, "commit", "-q", "-m", "secret")
        sha = _run_git(rdir, "rev-parse", "HEAD")
        p = {
            "hook_event_name": "PostToolUse",
            "tool_name": "Bash",
            "session_id": "s",
            "cwd": rdir,
            "tool_input": {"command": "git commit -m secret"},
            "tool_response": {"stdout": f"[main {sha[:8]}] secret\n"},
        }
        out = yakka.Build(None, [_queue_file("q", "claude", p)])[0]
        self.assertEqual(len(out.Facts), 2)
        self.assertEqual(len(out.Reasons), 1)
        self.assertIn("in docs/plans/x/briefs/s.md", out.Reasons[0])
        for f in out.Facts:
            s = f if isinstance(f, (bytes, bytearray)) else json.dumps(f).encode()
            self.assertNotIn(sec.encode(), s)


class TestArtifactSnapshot(unittest.TestCase):
    def _snap(
        self,
        name: str,
        rdir: str,
        conv: str,
        path: str,
        ts: float = 1700000000.0,
    ) -> yakka.File:
        env = {"ts": ts, "harness": "claude", "event": "artifact_snapshot"}
        payload = {"session_id": conv, "cwd": rdir, "path": path}
        data = (
            json.dumps(env, separators=(",", ":"))
            + "\n"
            + json.dumps(payload, separators=(",", ":"))
        ).encode()
        return yakka.File(Name=name, Data=data)

    def test_one_fact_with_mtime_and_no_hook_event(self) -> None:
        rdir, _, repo_id = _new_repo()
        path = os.path.join(rdir, "docs/plans/x/DESIGN.md")
        _put(rdir, "docs/plans/x/DESIGN.md", "# Design body\n")
        mtime = 1700000100.25
        os.utime(path, (mtime, mtime))
        out = yakka.Build(
            None,
            [self._snap("s.evt", rdir, "feedback-" + repo_id, path)],
        )[0]
        self.assertEqual(len(out.Facts), 1)
        self.assertEqual(len(out.Reasons), 0)
        v = _decode(out)[0]
        self.assertEqual(v["type"], "artifact_version")
        self.assertEqual(v["conversation_id"], "feedback-" + repo_id)
        self.assertEqual(v["harness"], "claude")
        self.assertEqual(v["event"], "artifact_snapshot")
        self.assertEqual(v["source"], "worktree")
        self.assertEqual(v["repo_id"], repo_id)
        self.assertEqual(v["path"], "docs/plans/x/DESIGN.md")
        self.assertEqual(v["ts"], mtime)
        self.assertEqual(v["content"], "# Design body\n")
        self.assertNotIn("hook_event", v)
        self.assertEqual(v["id"], "s.evt#0")

    def test_same_content_and_mtime_has_equal_row_hash(self) -> None:
        rdir, _, repo_id = _new_repo()
        path = os.path.join(rdir, "docs/plans/x/DESIGN.md")
        _put(rdir, "docs/plans/x/DESIGN.md", "# Same\n")
        mtime = 1700000200.5
        os.utime(path, (mtime, mtime))
        conv = "feedback-" + repo_id
        outs = yakka.Build(
            None,
            [
                self._snap("a.evt", rdir, conv, path),
                self._snap("b.evt", rdir, conv, path),
            ],
        )
        h1, e1 = yakka.RowHash(outs[0].Facts[0])
        h2, e2 = yakka.RowHash(outs[1].Facts[0])
        self.assertIsNone(e1)
        self.assertIsNone(e2)
        self.assertEqual(h1, h2)

    def test_nul_path_is_unreadable(self) -> None:
        out = yakka.Build(
            None,
            [self._snap("s.evt", "/tmp", "feedback-x", "docs/plans/x/DESIGN.md\x00")],
        )[0]
        self.assertEqual(len(out.Facts), 0)
        self.assertEqual(len(out.Reasons), 1)
        self.assertIn("unreadable", out.Reasons[0])

    def test_non_utf8_is_unreadable(self) -> None:
        rdir, _, repo_id = _new_repo()
        path = os.path.join(rdir, "docs/plans/x/briefs/bin.md")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(b"\xff\xfe\x00")
        out = yakka.Build(
            None,
            [self._snap("s.evt", rdir, "feedback-" + repo_id, path)],
        )[0]
        self.assertEqual(len(out.Facts), 0)
        self.assertEqual(len(out.Reasons), 1)
        self.assertIn("unreadable", out.Reasons[0])

    def test_outside_repo_is_rejected(self) -> None:
        outside = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(outside, ignore_errors=True))
        path = os.path.join(outside, "docs/plans/x/DESIGN.md")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write("# Outside\n")
        out = yakka.Build(
            None,
            [self._snap("s.evt", outside, "feedback-x", path)],
        )[0]
        self.assertEqual(len(out.Facts), 0)
        self.assertEqual(len(out.Reasons), 1)
        self.assertIn("not_in_repo", out.Reasons[0])

    def test_not_scored_kind_is_rejected(self) -> None:
        rdir, _, repo_id = _new_repo()
        path = os.path.join(rdir, "other.txt")
        _put(rdir, "other.txt", "x\n")
        out = yakka.Build(
            None,
            [self._snap("s.evt", rdir, "feedback-" + repo_id, path)],
        )[0]
        self.assertEqual(len(out.Facts), 0)
        self.assertEqual(len(out.Reasons), 1)
        self.assertIn("not_scored_kind", out.Reasons[0])

    def test_secret_yields_no_fact(self) -> None:
        rdir, _, repo_id = _new_repo()
        sec = _fake_secret()
        _put(rdir, "docs/plans/x/DESIGN.md", "# D\nok\ntoken: " + sec + "\n")
        path = os.path.join(rdir, "docs/plans/x/DESIGN.md")
        out = yakka.Build(
            None,
            [self._snap("s.evt", rdir, "feedback-" + repo_id, path)],
        )[0]
        self.assertEqual(len(out.Facts), 0)
        self.assertEqual(len(out.Reasons), 1)
        self.assertIn("secret: ", out.Reasons[0])
        self.assertIn("at line 3 in docs/plans/x/DESIGN.md", out.Reasons[0])
        self.assertNotIn(sec, str(out.Reasons))


class TestNumberLiteralRoundTrip(unittest.TestCase):
    def test_ts_nanosecond_literal_in_build_and_httpsink(self) -> None:
        ts = "1729000000.123456789"
        payload = {"hook_event_name": "Stop", "session_id": "s1"}
        event = payload["hook_event_name"]
        data = (
            f'{{"ts":{ts},"harness":"claude","event":{json.dumps(event)}}}\n'
            + json.dumps(payload, separators=(",", ":"))
        ).encode()
        out = yakka.Build(None, [yakka.File(Name="conv-1", Data=data)])[0]
        self.assertEqual(len(out.Facts), 1)
        fact = out.Facts[0]
        if not isinstance(fact, (bytes, bytearray)):
            fact = fact.encode()
        self.assertIn(f'"ts":{ts}'.encode(), fact)

        captured: list[bytes] = []
        resp_body = b'{"results":[{"id":"conv-1#0","status":"accepted"}]}'

        class _FakeResp:
            status = 200
            headers: dict[str, str] = {}

            def read(self, n: int) -> bytes:
                return resp_body

        def fake_urlopen(req: Any, timeout: float = 30.0) -> _FakeResp:
            captured.append(req.data)
            return _FakeResp()

        sink = yakka.HTTPSink(Endpoint="http://127.0.0.1:9", Key="k")
        ctx = yakka.DrainContext.with_timeout(30.0)
        with mock.patch("yakka._urlopen", fake_urlopen):
            resp, err = sink.Send(ctx, [bytes(fact)])
        self.assertIsNone(err)
        self.assertEqual(resp.Status, 200)
        self.assertEqual(len(captured), 1)
        self.assertIn(ts.encode(), captured[0])
        self.assertIn(f'"ts":{ts}'.encode(), captured[0])


class TestWritePaths(unittest.TestCase):
    def test_write_paths(self) -> None:
        rdir, _, _ = _new_repo()
        p = {
            "hook_event_name": "postToolUse",
            "tool_name": "write",
            "conversation_id": "c",
            "cwd": rdir,
            "tool_input": {"file_path": "docs/plans/x/DESIGN.md"},
        }
        f = _queue_file("a", "cursor", p)
        got = yakka.WritePaths(f.Data)
        want = os.path.join(rdir, "docs/plans/x/DESIGN.md")
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0], want)
        self.assertIsNone(yakka.WritePaths(b"not json\n{}"))
        self.assertIsNone(yakka.WritePaths(None))
        bash = _queue_file(
            "b",
            "cursor",
            {
                "hook_event_name": "postToolUse",
                "tool_name": "shell",
                "conversation_id": "c",
                "cwd": rdir,
            },
        )
        self.assertIsNone(yakka.WritePaths(bash.Data))
        snap_abs = yakka.File(
            Name="s1",
            Data=(
                b'{"ts":1,"harness":"claude","event":"artifact_snapshot"}\n'
                + json.dumps(
                    {
                        "session_id": "feedback-r",
                        "cwd": rdir,
                        "path": os.path.join(rdir, "docs/plans/x/DESIGN.md"),
                    }
                ).encode()
            ),
        )
        self.assertEqual(
            yakka.WritePaths(snap_abs.Data),
            [os.path.join(rdir, "docs/plans/x/DESIGN.md")],
        )
        snap_rel = yakka.File(
            Name="s2",
            Data=(
                b'{"ts":1,"harness":"claude","event":"artifact_snapshot"}\n'
                + json.dumps(
                    {
                        "session_id": "feedback-r",
                        "cwd": rdir,
                        "path": "docs/plans/x/DESIGN.md",
                    }
                ).encode()
            ),
        )
        self.assertEqual(
            yakka.WritePaths(snap_rel.Data),
            [os.path.join(rdir, "docs/plans/x/DESIGN.md")],
        )


if __name__ == "__main__":
    unittest.main()
