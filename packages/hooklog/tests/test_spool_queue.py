"""spool.sh: conversation-ID file names, the Go queue path and the YAKKA_BIN kick. Temp dirs only."""
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPOOL = HERE.parent / "spool.sh"
FIXTURE = json.loads((HERE / "fixtures" / "artifact_writes.json").read_text())


def env(**kw):
    e = {k: v for k, v in os.environ.items() if k not in ("YAKKA_BIN", "YAKKA_QUEUE")}
    e.update(YAKKA_HOOKLOG_KICK="0", YAKKA_QUALITY_URL="")
    e.update(kw)
    return e


def run_spool(payload, harness="claude", event=None, **kw):
    cmd = ["bash", str(SPOOL), "--harness", harness] + (["--event", event] if event else [])
    return subprocess.run(cmd, input=payload, capture_output=True, text=True, env=env(**kw))


def evts(d):
    return sorted(Path(d).glob("*.evt"))



class Base(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d, True)


class QueueDefault(Base):
    def q(self):
        return os.path.join(self.d, "queue")

    def test_fixture_payloads_named_by_id(self):
        for item in FIXTURE:
            r = run_spool(json.dumps(item["payload"]), item["harness"], YAKKA_QUEUE=self.q(),
                          HOME=self.d, YAKKA_HOOKLOG_DIR=os.path.join(self.d, "legacy"))
            self.assertEqual(r.returncode, 0)
        files = evts(self.q())
        self.assertEqual(len(files), len(FIXTURE))
        for item in FIXTURE:
            p = item["payload"]
            i = p.get("session_id") or p.get("conversation_id")
            self.assertEqual(len([f for f in files if f.name.startswith(i + "-") and f.name[len(i) + 1].isdigit()]), 1, i)

    def test_default_is_the_queue(self):
        legacy = os.path.join(self.d, "legacy")
        r = run_spool('{"session_id":"s1"}', "claude", YAKKA_QUEUE=self.q(), YAKKA_HOOKLOG_DIR=legacy, HOME=self.d)
        self.assertEqual(r.returncode, 0)
        files = evts(self.q())
        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].name.startswith("s1-"))
        self.assertFalse(os.path.exists(legacy))

    def test_default_queue_under_home(self):
        run_spool('{"session_id":"s1"}', "claude", HOME=self.d)
        self.assertEqual(len(evts(os.path.join(self.d, ".local/share/yakka/queue"))), 1)

    def test_no_id_dropped(self):
        r = run_spool('{"hook_event_name":"Stop"}', YAKKA_QUEUE=self.q(), HOME=self.d)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(evts(self.q()), [])
        self.assertEqual(list(Path(self.q()).glob("*.evt")), [])

    def test_auto_and_missing_harness_spool_nothing(self):
        for harness in ("auto", None):
            cmd = ["bash", str(SPOOL)] + (["--harness", harness] if harness else [])
            r = subprocess.run(cmd, input='{"session_id":"s1"}', capture_output=True, text=True,
                               env=env(YAKKA_QUEUE=self.q(), HOME=self.d))
            self.assertEqual((r.returncode, r.stdout), (0, ""))
            self.assertEqual(evts(self.q()), [])
        r = run_spool('{"conversation_id":"c1"}', "auto", "preToolUse", YAKKA_QUEUE=self.q(), HOME=self.d)
        self.assertEqual(r.stdout, "")  # not cursor, so no response
        r = run_spool('{"conversation_id":"c1"}', "cursor", "preToolUse", YAKKA_QUEUE=self.q(), HOME=self.d)
        self.assertEqual(json.loads(r.stdout), {"permission": "allow"})
        self.assertEqual(len(evts(self.q())), 1)

    def test_sanitised_prefix(self):
        run_spool('{"hook_event_name":"Stop","session_id" : "a/b c"}', YAKKA_QUEUE=self.q(), HOME=self.d)
        files = evts(self.q())
        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].name.startswith("a_b_c-"), files[0].name)

    def test_key_preference(self):
        run_spool('{"conversation_id":"c1","session_id":"s1"}', YAKKA_QUEUE=self.q(), HOME=self.d)
        self.assertTrue(evts(self.q())[0].name.startswith("s1-"))

    def test_cursor_response(self):
        r = run_spool('{"conversation_id":"c1"}', "cursor", "preToolUse", YAKKA_QUEUE=self.q(), HOME=self.d)
        self.assertEqual(json.loads(r.stdout), {"permission": "allow"})
        self.assertEqual(r.returncode, 0)

    def test_dedupe_drops_repeat_within_window(self):
        payload = '{"session_id":"s-dedupe","n":1}'
        q = self.q()
        run_spool(payload, "cursor", "sessionStart", YAKKA_QUEUE=q, HOME=self.d)
        self.assertEqual(len(evts(q)), 1)
        run_spool(payload, "cursor", "sessionStart", YAKKA_QUEUE=q, HOME=self.d)
        self.assertEqual(len(evts(q)), 1)
        run_spool('{"session_id":"s-dedupe","n":2}', "cursor", "sessionStart", YAKKA_QUEUE=q, HOME=self.d)
        self.assertEqual(len(evts(q)), 2)

    def test_bash32_lint(self):
        text = SPOOL.read_text()
        for pat in (r"read -r -N", r"read -N", "EPOCHREALTIME", "mapfile", ",,}", r"[[ -v"):
            self.assertNotIn(pat, text, pat)


class GoPath(Base):
    def setUp(self):
        super().setUp()
        self.q = os.path.join(self.d, "queue")
        self.legacy = os.path.join(self.d, "legacy")
        self.home = os.path.join(self.d, "home")
        self.log = os.path.join(self.d, "stub.log")
        self.bin = os.path.join(self.d, "stub.sh")
        Path(self.bin).write_text(f'#!/bin/sh\necho "$* q=$YAKKA_QUEUE" >> "{self.log}"\n')
        os.chmod(self.bin, 0o755)

    def spool(self, payload, **kw):
        return run_spool(payload, YAKKA_BIN=self.bin, YAKKA_QUEUE=self.q,
                         YAKKA_HOOKLOG_DIR=self.legacy, HOME=self.home, **kw)

    def calls(self, wait=False):
        for _ in range(30 if wait else 1):
            if os.path.exists(self.log):
                return Path(self.log).read_text().splitlines()
            time.sleep(0.1)
        return []

    def test_files_land_in_queue(self):
        r = self.spool('{"session_id":"s1"}')
        self.assertEqual(r.returncode, 0)
        files = evts(self.q)
        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].name.startswith("s1-"))
        self.assertFalse(os.path.exists(self.legacy))

    def test_no_id_not_spooled(self):
        r = self.spool('{"hook_event_name":"Stop"}')
        self.assertEqual(r.returncode, 0)
        self.assertEqual(evts(self.q), [])
        self.assertEqual(list(Path(self.q, "tmp").iterdir()), [])
        self.assertEqual(self.calls(), [])

    def test_kick_invokes_stub(self):
        run_spool(
            '{"session_id":"s1"}', YAKKA_BIN=self.bin, YAKKA_QUEUE=self.q, YAKKA_HOOKLOG_KICK="1")
        self.assertEqual(self.calls(True), [f"drain q={self.q}"])

    def test_lock_held_no_kick(self):
        os.makedirs(self.q)
        lock = os.path.join(self.q, ".drain.lock")
        Path(lock).touch()
        holder = subprocess.Popen(["flock", lock, "sleep", "5"])
        try:
            time.sleep(0.3)
            run_spool('{"session_id":"s1"}', YAKKA_BIN=self.bin, YAKKA_QUEUE=self.q, YAKKA_HOOKLOG_KICK="1")
            time.sleep(0.5)
            self.assertEqual(self.calls(), [])
        finally:
            holder.kill()
            holder.wait()

    def test_kick_off_no_kick(self):
        self.spool('{"session_id":"s1"}')
        time.sleep(0.5)
        self.assertEqual(self.calls(), [])

    def test_concurrent(self):
        with ThreadPoolExecutor(20) as ex:
            rs = list(ex.map(lambda i: self.spool(json.dumps({"session_id": "s1", "n": i})), range(20)))
        self.assertTrue(all(r.returncode == 0 for r in rs))
        self.assertEqual(len({f.name for f in evts(self.q)}), 20)
        self.assertEqual(list(Path(self.q, "tmp").iterdir()), [])

    def fallback(self, payload='{"session_id":"s1"}', **kw):
        return run_spool(payload, YAKKA_BIN=self.sleeper, YAKKA_QUEUE=self.q, YAKKA_HOOKLOG_KICK="1",
                         YAKKA_SPOOL_NOFLOCK="1", HOME=self.home, **kw)

    def make_sleeper(self):
        self.sleeper = os.path.join(self.d, "sleeper.sh")
        Path(self.sleeper).write_text(f'#!/bin/sh\necho "$* $$" >> "{self.log}"\nsleep 2\n')
        os.chmod(self.sleeper, 0o755)

    def wait_gone(self):
        for _ in range(60):
            if subprocess.run(["pgrep", "-f", self.sleeper], capture_output=True).returncode != 0:
                return
            time.sleep(0.1)

    def test_default_kick_target(self):
        root = os.path.join(self.d, "repo")
        shutil.copytree(SPOOL.parent, os.path.join(root, "packages", "hooklog"), ignore=shutil.ignore_patterns("tests", "__pycache__"))
        plugin_bin = os.path.join(root, "plugins", "yakka", "bin")
        os.makedirs(plugin_bin)
        stub = os.path.join(plugin_bin, "yakka")
        Path(stub).write_text(f'#!/bin/sh\necho "$* q=$YAKKA_QUEUE" >> "{self.log}"\n')
        os.chmod(stub, 0o755)
        cmd = ["bash", os.path.join(root, "packages", "hooklog", "spool.sh"), "--harness", "claude"]
        subprocess.run(cmd, input='{"session_id":"s1"}', capture_output=True, text=True,
                       env=env(YAKKA_QUEUE=self.q, YAKKA_HOOKLOG_KICK="1", HOME=self.home))
        self.assertEqual(self.calls(True), [f"drain q={self.q}"])

    def test_mkdir_fallback_single_drain(self):
        self.make_sleeper()
        try:
            with ThreadPoolExecutor(10) as ex:
                rs = list(ex.map(lambda i: self.fallback(json.dumps({"session_id": "s1", "n": i})), range(10)))
            self.assertTrue(all(r.returncode == 0 for r in rs))
            time.sleep(0.5)
            self.assertEqual(len(self.calls()), 1, self.calls())
        finally:
            self.wait_gone()

    def test_mkdir_fallback_dead_pid_retaken(self):
        self.make_sleeper()
        kick = Path(self.q, ".kick.d")
        kick.mkdir(parents=True)
        dead = subprocess.Popen(["true"])
        dead.wait()
        (kick / "pid").write_text(str(dead.pid))
        try:
            self.fallback()
            self.assertEqual(len(self.calls(True)), 1)
            self.assertNotEqual((kick / "pid").read_text().strip(), str(dead.pid))
        finally:
            self.wait_gone()

    def test_mkdir_fallback_no_pid_blocks_when_young(self):
        self.make_sleeper()
        Path(self.q, ".kick.d").mkdir(parents=True)
        self.fallback()
        time.sleep(0.5)
        self.assertEqual(self.calls(), [])

    def test_mkdir_fallback_no_pid_old_is_retaken(self):
        self.make_sleeper()
        kick = Path(self.q, ".kick.d")
        kick.mkdir(parents=True)
        old = time.time() - 300
        os.utime(kick, (old, old))
        try:
            self.fallback()
            self.assertEqual(len(self.calls(True)), 1)
        finally:
            self.wait_gone()


if __name__ == "__main__":
    unittest.main()
