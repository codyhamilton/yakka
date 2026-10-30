import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from unittest import mock

import yakka

_SCRIPT = os.path.join(os.path.dirname(__file__), "yakka.py")
_TOKEN = "wk_login_test_plain_token_0123456789ab"
_DEVICE = "dc_secret_device_code_0123456789abcdefghijklmn"
_USER = "WDJB-MJHT"


class Fake:
    """Fake collector. `token_script` is a list of (status, body) answered in order."""

    def __init__(self, code_status: int = 200) -> None:
        self.code_status = code_status
        self.token_script: list = []
        self.requests: list = []
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, fmt: str, *args: object) -> None:
                pass

            def do_POST(self) -> None:
                n = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(n).decode() or "{}")
                fake.requests.append((self.path, body))
                if self.path == "/v1/device/code":
                    if fake.code_status != 200:
                        st, out = fake.code_status, {"error": "nope"}
                    else:
                        st, out = 200, {
                            "device_code": _DEVICE,
                            "user_code": _USER,
                            "verification_uri": fake.url + "/device",
                            "verification_uri_complete": fake.url + "/device?user_code=" + _USER,
                            "expires_in": 600,
                            "interval": 5,
                        }
                elif self.path == "/v1/device/token":
                    st, out = fake.token_script.pop(0)
                else:
                    st, out = 404, {}
                data = json.dumps(out).encode()
                self.send_response(st)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.srv = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.srv.server_address[1]}"
        Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.srv.shutdown()
        self.srv.server_close()

    def ok_token(self) -> tuple:
        return 200, {
            "token": _TOKEN,
            "endpoint": self.url,
            "tenant": "acme",
            "scope": "write",
            "expires_at": "2027-01-01T00:00:00Z",
        }


def _err(error: str) -> tuple:
    return 400, {"error": error}


class LoginEnv(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.mkdtemp()
        self._env_save = {
            k: os.environ.pop(k, None)
            for k in ("YAKKA_ENDPOINT", "YAKKA_KEY", "YAKKA_CLIENT_CONFIG", "YAKKA_LOGIN_BROWSER")
        }
        self._cfg = os.path.join(self._tmpdir, "client.toml")
        self._pending = self._cfg + ".pending"
        os.environ["YAKKA_CLIENT_CONFIG"] = self._cfg
        self.fake = Fake()
        self.addCleanup(self.fake.close)
        self.sleeps: list = []
        self._t0 = time.time()

    def tearDown(self) -> None:
        for k in ("YAKKA_ENDPOINT", "YAKKA_KEY", "YAKKA_CLIENT_CONFIG", "YAKKA_LOGIN_BROWSER"):
            os.environ.pop(k, None)
        for k, v in self._env_save.items():
            if v is not None:
                os.environ[k] = v

    def clock(self) -> float:
        return self._t0 + sum(self.sleeps)

    def start(self, endpoint: str = None):
        out, err = io.StringIO(), io.StringIO()
        rc = yakka.login_start(self.fake.url if endpoint is None else endpoint, out, err)
        return rc, out.getvalue(), err.getvalue()

    def wait(self):
        err = io.StringIO()
        rc = yakka.login_wait(err, sleep=self.sleeps.append, clock=self.clock)
        return rc, err.getvalue()


class TestStart(LoginEnv):
    def test_start_prints_three_lines_and_writes_pending(self) -> None:
        rc, out, err = self.start()
        self.assertEqual(rc, 0)
        lines = out.splitlines()
        self.assertEqual(len(lines), 3)
        self.assertEqual(lines[0], f"url: {self.fake.url}/device?user_code={_USER}")
        self.assertEqual(lines[1], f"code: {_USER}")
        self.assertRegex(lines[2], r"^expires: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertEqual(stat.S_IMODE(os.stat(self._pending).st_mode), 0o600)
        with open(self._pending) as f:
            p = json.load(f)
        self.assertEqual(
            sorted(p), ["device_code", "endpoint", "expires_at", "interval", "target", "user_code"]
        )
        self.assertEqual(p["endpoint"], self.fake.url)
        self.assertEqual(p["interval"], 5)
        self.assertEqual([r[0] for r in self.fake.requests], ["/v1/device/code"])
        self.assertEqual(self.fake.requests[0][1], {})
        self.assertFalse(os.path.exists(self._cfg))

    def test_404_and_replacement(self) -> None:
        rc, out, err = self.start()
        with open(self._pending) as f:
            first = f.read()
        time.sleep(1.1)
        rc, out, err = self.start()
        with open(self._pending) as f:
            self.assertNotEqual(f.read(), first)
        self.fake.code_status = 404
        rc, out, err = self.start()
        self.assertEqual(rc, 1)
        self.assertEqual(out, "")
        self.assertEqual(len(err.strip().splitlines()), 1)
        self.assertIn("this endpoint has no device login", err)


class TestWait(LoginEnv):
    def test_pending_slow_down_then_success(self) -> None:
        self.start()
        self.fake.token_script = [
            _err("authorization_pending"),
            _err("slow_down"),
            _err("authorization_pending"),
            self.fake.ok_token(),
        ]
        rc, err = self.wait()
        self.assertEqual(rc, 0)
        self.assertEqual(self.sleeps, [5, 5, 10, 10])
        self.assertIn(f"wrote {self._cfg}", err)
        self.assertIn("tenant: acme", err)
        self.assertEqual(stat.S_IMODE(os.stat(self._cfg).st_mode), 0o600)
        with open(self._cfg) as f:
            data = f.read()
        self.assertIn(f'endpoint = "{self.fake.url}"', data)
        self.assertIn(f'key = "{_TOKEN}"', data)
        self.assertFalse(os.path.exists(self._pending))
        self.assertTrue(
            all(r[1] == {"device_code": _DEVICE} for r in self.fake.requests[1:])
        )

    def test_denied_and_expired(self) -> None:
        for name in ("access_denied", "expired_token"):
            with self.subTest(name):
                self.start()
                self.fake.token_script = [_err("authorization_pending"), _err(name)]
                rc, err = self.wait()
                self.assertEqual(rc, 1)
                self.assertEqual(len(err.strip().splitlines()), 1)
                self.assertFalse(os.path.exists(self._pending))
                self.assertFalse(os.path.exists(self._cfg))

    def test_network_errors_retried_until_expiry(self) -> None:
        self.start()
        self.fake.close()
        rc, err = self.wait()
        self.assertEqual(rc, 1)
        self.assertGreater(len(self.sleeps), 3)
        self.assertFalse(os.path.exists(self._pending))

    def test_no_pending_file(self) -> None:
        rc, err = self.wait()
        self.assertEqual(rc, 1)
        self.assertEqual(len(err.strip().splitlines()), 1)
        self.assertEqual(self.fake.requests, [])


class TestNoSecretsPrinted(LoginEnv):
    def test_no_token_or_device_code(self) -> None:
        rc, out, err1 = self.start()
        self.fake.token_script = [self.fake.ok_token()]
        rc2, err2 = self.wait()
        self.assertEqual((rc, rc2), (0, 0))
        for text in (out, err1, err2):
            self.assertNotIn(_TOKEN, text)
            self.assertNotIn(_DEVICE, text)
            self.assertNotIn("wk_", text)

    def test_failure_paths_print_no_secrets(self) -> None:
        self.start()
        self.fake.token_script = [_err("access_denied")]
        _, err = self.wait()
        self.assertNotIn(_DEVICE, err)


class TestEndpointResolution(LoginEnv):
    def _capture(self) -> list:
        seen: list = []

        def fake_open(req, timeout=30.0):
            seen.append(req.full_url)
            raise OSError("no network in tests")

        self._patch = mock.patch.object(yakka, "_urlopen_noredir", fake_open)
        self._patch.start()
        self.addCleanup(self._patch.stop)
        return seen

    def test_default_endpoint(self) -> None:
        seen = self._capture()
        rc = yakka.login_start("", io.StringIO(), io.StringIO())
        self.assertEqual(rc, 1)
        self.assertEqual(seen, ["https://api.yakka.build/v1/device/code"])

    def test_endpoint_from_client_toml(self) -> None:
        with open(self._cfg, "w", encoding="utf-8") as f:
            f.write('endpoint = "https://old.example"\nkey = "wk_old"\n')
        seen = self._capture()
        yakka.login_start("", io.StringIO(), io.StringIO())
        self.assertEqual(seen, ["https://old.example/v1/device/code"])

    def test_flag_beats_config_and_is_normalized(self) -> None:
        seen = self._capture()
        yakka.login_start("https://user:s3cret@flag.example", io.StringIO(), io.StringIO())
        self.assertEqual(seen, ["https://flag.example/v1/device/code"])
        rc = yakka.login_start("https://flag.example/path", io.StringIO(), io.StringIO())
        self.assertEqual(rc, 1)


class TestRunLogin(LoginEnv):
    def _recorder(self, exit_code: int) -> str:
        self.rec = os.path.join(self._tmpdir, "rec.txt")
        script = os.path.join(self._tmpdir, "opener.sh")
        with open(script, "w") as f:
            f.write(f'#!/bin/sh\necho "$1" > "{self.rec}"\nexit {exit_code}\n')
        os.chmod(script, 0o755)
        return script

    def _run(self):
        out, err = io.StringIO(), io.StringIO()
        self.fake.token_script = [_err("authorization_pending"), self.fake.ok_token()]
        rc = yakka.run_login(
            self.fake.url, out, err, sleep=self.sleeps.append, clock=self.clock
        )
        return rc, out.getvalue(), err.getvalue()

    def test_browser_recorder(self) -> None:
        os.environ["YAKKA_LOGIN_BROWSER"] = self._recorder(0)
        rc, out, err = self._run()
        self.assertEqual(rc, 0)
        self.assertEqual(len(out.splitlines()), 3)
        url = f"{self.fake.url}/device?user_code={_USER}"
        for _ in range(100):
            if os.path.exists(self.rec) and os.path.getsize(self.rec):
                break
            time.sleep(0.05)
        with open(self.rec) as f:
            self.assertEqual(f.read().strip(), url)
        self.assertTrue(os.path.exists(self._cfg))
        self.assertFalse(os.path.exists(self._pending))
        self.assertNotIn(_TOKEN, out + err)

    def test_failing_opener_still_completes(self) -> None:
        os.environ["YAKKA_LOGIN_BROWSER"] = self._recorder(1)
        rc, _, _ = self._run()
        self.assertEqual(rc, 0)
        self.sleeps.clear()
        os.environ["YAKKA_LOGIN_BROWSER"] = os.path.join(self._tmpdir, "does-not-exist")
        rc, _, _ = self._run()
        self.assertEqual(rc, 0)


class TestNormalizeStripsUserinfo(unittest.TestCase):
    def test_normalize_strips_userinfo(self) -> None:
        ep, err = yakka.normalize_origin("https://user:s3cret@collector.example")
        self.assertIsNone(err)
        self.assertEqual(ep, "https://collector.example")
        self.assertNotIn("s3cret", ep)
        _, bad = yakka.normalize_origin("https://collector.example/v1/ingest")
        self.assertIsNotNone(bad)
        ep6, err6 = yakka.normalize_origin("http://[::1]:8770")
        self.assertIsNone(err6)
        self.assertEqual(ep6, "http://[::1]:8770")


class TestReloginTightensMode(LoginEnv):
    def test_relogin_tightens_mode(self) -> None:
        with open(self._cfg, "w", encoding="utf-8") as f:
            f.write("old\n")
        os.chmod(self._cfg, 0o644)
        err = yakka.write_client_config(self._cfg, "http://127.0.0.1:9", "wk_plain_token")
        self.assertIsNone(err)
        self.assertEqual(os.stat(self._cfg).st_mode & 0o777, 0o600)


class TestCommand(LoginEnv):
    def test_wait_without_pending_exits_1(self) -> None:
        proc = subprocess.run(
            [sys.executable, _SCRIPT, "login", "wait"], capture_output=True, text=True
        )
        self.assertEqual(proc.returncode, 1)
        self.assertEqual(len(proc.stderr.strip().splitlines()), 1)
        self.assertEqual(proc.stdout, "")

    def test_start_subcommand_via_main(self) -> None:
        proc = subprocess.run(
            [sys.executable, _SCRIPT, "login", "start", "--endpoint", self.fake.url],
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(len(proc.stdout.splitlines()), 3)


class TestSyncLogin(LoginEnv):
    """`login --sync` writes sync.toml and never touches client.toml (the drain's login)."""

    def setUp(self) -> None:
        super().setUp()
        self._sync = os.path.join(self._tmpdir, "sync.toml")
        patcher = mock.patch.dict(os.environ, {"YAKKA_SYNC_CONFIG": self._sync})
        patcher.start()
        self.addCleanup(patcher.stop)

    def _read(self, path: str) -> str:
        with open(path, encoding="utf-8") as f:
            return f.read()

    def test_sync_path_default_and_override(self) -> None:
        self.assertEqual(yakka.SyncPath(), self._sync)
        with mock.patch.dict(os.environ, {"YAKKA_SYNC_CONFIG": "", "HOME": "/home/x"}):
            self.assertEqual(yakka.SyncPath(), "/home/x/.config/yakka/sync.toml")

    def test_sync_login_writes_sync_toml_only(self) -> None:
        with open(self._cfg, "w", encoding="utf-8") as f:
            f.write('endpoint = "https://drain.example"\nkey = "wk_drain"\n')
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(yakka.login_start(self.fake.url, out, err, sync=True), 0)
        self.assertEqual(json.load(open(self._pending))["target"], "sync")
        self.fake.token_script = [self.fake.ok_token()]
        rc, err = self.wait()
        self.assertEqual(rc, 0, err)
        self.assertIn(f"wrote {self._sync}", err)
        self.assertNotIn(_TOKEN, err)
        self.assertEqual(
            self._read(self._sync), f'endpoint = "{self.fake.url}"\nkey = "{_TOKEN}"\n'
        )
        self.assertEqual(stat.S_IMODE(os.stat(self._sync).st_mode), 0o600)
        self.assertEqual(
            self._read(self._cfg), 'endpoint = "https://drain.example"\nkey = "wk_drain"\n'
        )
        self.assertFalse(os.path.exists(self._pending))

    def test_normal_login_does_not_write_sync_toml(self) -> None:
        self.assertEqual(self.start()[0], 0)
        self.assertEqual(json.load(open(self._pending))["target"], "client")
        self.fake.token_script = [self.fake.ok_token()]
        self.assertEqual(self.wait()[0], 0)
        self.assertTrue(os.path.exists(self._cfg))
        self.assertFalse(os.path.exists(self._sync))

    def test_pending_without_target_is_a_normal_login(self) -> None:
        self.assertEqual(self.start()[0], 0)
        info = json.load(open(self._pending))
        del info["target"]
        json.dump(info, open(self._pending, "w"))
        self.fake.token_script = [self.fake.ok_token()]
        self.assertEqual(self.wait()[0], 0)
        self.assertTrue(os.path.exists(self._cfg))
        self.assertFalse(os.path.exists(self._sync))

    def test_unknown_target_is_rejected(self) -> None:
        self.assertEqual(self.start()[0], 0)
        info = json.load(open(self._pending))
        info["target"] = "elsewhere"
        json.dump(info, open(self._pending, "w"))
        rc, err = self.wait()
        self.assertEqual(rc, 1)
        self.assertIn("invalid pending", err)
        self.assertFalse(os.path.exists(self._sync))
        self.assertFalse(os.path.exists(self._cfg))

    def test_sync_login_ignores_client_toml_endpoint(self) -> None:
        with open(self._cfg, "w", encoding="utf-8") as f:
            f.write('endpoint = "https://old.example"\nkey = "wk_old"\n')
        self.assertEqual(yakka.resolve_endpoint("", sync=True), ("https://api.yakka.build", None))
        self.assertEqual(yakka.resolve_endpoint("", sync=False), ("https://old.example", None))
        self.assertEqual(
            yakka.resolve_endpoint("https://flag.example", sync=True), ("https://flag.example", None)
        )

    def test_run_login_sync_end_to_end(self) -> None:
        self.fake.token_script = [self.fake.ok_token()]
        rc = yakka.run_login(
            self.fake.url,
            io.StringIO(),
            io.StringIO(),
            open_browser=lambda url: None,
            sleep=self.sleeps.append,
            clock=self.clock,
            sync=True,
        )
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.exists(self._sync))
        self.assertFalse(os.path.exists(self._cfg))

    def test_command_sync_flag(self) -> None:
        with mock.patch.object(yakka, "login_start", return_value=0) as ls:
            self.assertEqual(yakka.cmd_login(["yakka", "login", "start", "--sync"]), 0)
        ls.assert_called_once_with("", sync=True)
        with mock.patch.object(yakka, "login_wait", return_value=0) as lw:
            self.assertEqual(yakka.cmd_login(["yakka", "login", "wait"]), 0)
            self.assertEqual(yakka.cmd_login(["yakka", "login", "wait", "--sync"]), 2)
        lw.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
