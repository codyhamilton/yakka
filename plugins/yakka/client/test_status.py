import fcntl
import os
import socket
import subprocess
import sys
import tempfile
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

import yakka

_SCRIPT = os.path.join(os.path.dirname(__file__), "yakka.py")
_API_KEY = "k-test-key-9f3a"


def _free_port() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    addr = s.getsockname()
    s.close()
    return f"{addr[0]}:{addr[1]}"


class StatusEnv(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.mkdtemp()
        self._queue = os.path.join(self._tmpdir, "queue")
        self._cfg = os.path.join(self._tmpdir, "client.toml")
        self._home = os.path.join(self._tmpdir, "home")
        os.makedirs(self._home, exist_ok=True)
        self._env_save = {
            k: os.environ.pop(k, None)
            for k in ("YAKKA_ENDPOINT", "YAKKA_KEY", "YAKKA_CLIENT_CONFIG", "YAKKA_QUEUE", "HOME")
        }
        self._base = os.environ.copy()
        self._base["HOME"] = self._home
        self._base["YAKKA_QUEUE"] = self._queue
        self._base["YAKKA_CLIENT_CONFIG"] = self._cfg
        self._base.pop("YAKKA_ENDPOINT", None)
        self._base.pop("YAKKA_KEY", None)

    def tearDown(self) -> None:
        for k in ("YAKKA_ENDPOINT", "YAKKA_KEY", "YAKKA_CLIENT_CONFIG", "YAKKA_QUEUE", "HOME"):
            os.environ.pop(k, None)
        for k, v in self._env_save.items():
            if v is not None:
                os.environ[k] = v

    def _status(self, env: dict[str, str] | None = None) -> tuple[str, int]:
        run_env = self._base if env is None else env
        proc = subprocess.run(
            [sys.executable, _SCRIPT, "status"],
            env=run_env,
            capture_output=True,
            text=True,
        )
        out = proc.stdout + proc.stderr
        return out, proc.returncode

    def _write_config(self, addr: str) -> None:
        body = f'endpoint = "http://{addr}"\nkey = "{_API_KEY}"\n'
        with open(self._cfg, "w", encoding="utf-8") as f:
            f.write(body)
        os.chmod(self._cfg, 0o600)


class TestStatus(StatusEnv):
    def test_status(self) -> None:
        os.makedirs(os.path.join(self._queue, "tmp"), mode=0o700, exist_ok=True)
        os.makedirs(os.path.join(self._queue, "rejected"), mode=0o700, exist_ok=True)
        for name in ("a-1.evt", "b-2.evt"):
            with open(os.path.join(self._queue, name), "w", encoding="utf-8") as f:
                f.write("x")
        with open(
            os.path.join(self._queue, "rejected", "r.evt"), "w", encoding="utf-8"
        ) as f:
            f.write("x")
        with open(
            os.path.join(self._queue, "rejected", "r.evt.reason"),
            "w",
            encoding="utf-8",
        ) as f:
            f.write("r.evt: 413\n")
        with open(self._cfg, "w", encoding="utf-8") as f:
            f.write("not toml\n")
        os.chmod(self._cfg, 0o600)
        out, code = self._status()
        for want in (
            f"queue: {self._queue}",
            "queued: 2",
            "rejected: 1",
            "drain: not running",
            f"config: {self._cfg} (invalid)",
            "endpoint: -",
        ):
            self.assertIn(want + "\n", out, msg=out)
        self.assertEqual(code, 0)

        os.remove(self._cfg)
        out, _ = self._status()
        self.assertIn(
            "config: none (local mode)\nendpoint: http://127.0.0.1:8770 ",
            out,
            msg=out,
        )
        self.assertIn(f"mcp: {yakka.DefaultEndpoint} no-credential\n", out, msg=out)

        lock_path = os.path.join(self._queue, ".drain.lock")
        lock = open(lock_path, "a+b")
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            out, _ = self._status()
            self.assertIn("drain: running\n", out, msg=out)
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
            lock.close()

        self._write_config(_free_port())
        out, code = self._status()
        self.assertEqual(code, 1)
        self.assertIn("unreachable\n", out, msg=out)
        self.assertNotIn(_API_KEY, out)

        class HealthHandler(BaseHTTPRequestHandler):
            def log_message(self, fmt: str, *args: object) -> None:
                pass

            def do_GET(self) -> None:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"ok":true}')

        srv = HTTPServer(("127.0.0.1", 0), HealthHandler)
        host, port = srv.server_address
        th = Thread(target=srv.serve_forever, daemon=True)
        th.start()
        try:
            self._write_config(f"127.0.0.1:{port}")
            out, code = self._status()
        finally:
            srv.shutdown()
        self.assertEqual(code, 0)
        self.assertIn(" reachable\n", out, msg=out)
        self.assertNotIn(_API_KEY, out)


class TestEnvOverrideStatus(StatusEnv):
    def test_env_remote_mode(self) -> None:
        self._write_config(_free_port())
        env = dict(self._base)
        env["YAKKA_ENDPOINT"] = "http://127.0.0.1:1"
        env["YAKKA_KEY"] = _API_KEY
        out, _ = self._status(env)
        self.assertIn("config: env (remote mode)\n", out, msg=out)
        self.assertNotIn(_API_KEY, out)
        out, _ = self._status()
        self.assertIn(f"config: {self._cfg} (remote mode)\n", out, msg=out)


class TestHalfSetEnvRefusalStatus(StatusEnv):
    def test_half_set_env_refusal_status(self) -> None:
        if os.path.exists(self._cfg):
            os.remove(self._cfg)
        env = dict(self._base)
        env["YAKKA_CLIENT_CONFIG"] = os.path.join(self._tmpdir, "absent.toml")
        env["YAKKA_ENDPOINT"] = "http://collector.example"
        out, code = self._status(env)
        self.assertEqual(code, 1, msg=out)
        self.assertNotIn("127.0.0.1:8770", out, msg=out)
        self.assertIn("YAKKA_ENDPOINT", out, msg=out)
        self.assertIn("mcp: http://collector.example no-credential\n", out, msg=out)


if __name__ == "__main__":
    unittest.main()
