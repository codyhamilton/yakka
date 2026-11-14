import os
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
import unittest
from unittest.mock import patch

import yakka


class ClientConfigTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._env_save = {
            k: os.environ.pop(k, None)
            for k in ("YAKKA_ENDPOINT", "YAKKA_KEY", "YAKKA_MODE", "YAKKA_CLIENT_CONFIG")
        }

    def tearDown(self) -> None:
        for k in ("YAKKA_ENDPOINT", "YAKKA_KEY", "YAKKA_MODE", "YAKKA_CLIENT_CONFIG"):
            os.environ.pop(k, None)
        for k, v in self._env_save.items():
            if v is not None:
                os.environ[k] = v


def write_config(body: str) -> None:
    fd, path = tempfile.mkstemp(suffix=".toml")
    os.close(fd)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, 0o600)
    os.environ["YAKKA_CLIENT_CONFIG"] = path


class TestLoad(ClientConfigTestCase):
    def test_load(self) -> None:
        write_config(
            '# c\n\nendpoint = "http://127.0.0.1:8770"   # local\nother = "x"\nkey = "k\\"1"\n'
        )
        c = yakka.Load()
        self.assertEqual(c.Endpoint, "http://127.0.0.1:8770")
        self.assertEqual(c.Key, 'k"1')
        self.assertEqual(yakka.Path(), os.environ["YAKKA_CLIENT_CONFIG"])


class TestMissingFile(ClientConfigTestCase):
    def test_missing_file(self) -> None:
        os.environ["YAKKA_CLIENT_CONFIG"] = os.path.join(
            tempfile.mkdtemp(), "none.toml"
        )
        with self.assertRaises(yakka.ErrBadConfig) as ctx:
            yakka.Load()
        self.assertIn("yakka is not logged in", str(ctx.exception))
        self.assertIn("/yakka:login", str(ctx.exception))
        self.assertNotIn("127.0.0.1:8770", str(ctx.exception))


class TestExplicitLocal(ClientConfigTestCase):
    def test_local_mode_from_file_and_environment(self) -> None:
        write_config('mode = "local"\n')
        c = yakka.Load()
        self.assertTrue(c.Local)
        self.assertEqual(c.Endpoint, yakka.LocalEndpoint)
        self.assertEqual(c.Key, "")
        os.environ["YAKKA_CLIENT_CONFIG"] = os.path.join(tempfile.mkdtemp(), "missing.toml")
        os.environ["YAKKA_MODE"] = "local"
        self.assertTrue(yakka.Load().Local)

    def test_local_drain_posts_without_bearer_to_loopback_fake(self) -> None:
        seen: dict[str, str] = {}

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt: str, *args: object) -> None:
                pass

            def do_POST(self) -> None:
                seen["path"] = self.path
                seen["authorization"] = self.headers.get("Authorization", "")
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                import json

                count = len(json.loads(body)["facts"])
                result = json.dumps({"results": [{"status": "accepted"} for _ in range(count)]}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(result)))
                self.end_headers()
                self.wfile.write(result)

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            os.environ["YAKKA_MODE"] = "local"
            with patch.object(yakka, "LocalEndpoint", f"http://127.0.0.1:{server.server_address[1]}"):
                sink, err = yakka.ConfigSink()
                self.assertIsNone(err)
                self.assertIsNotNone(sink)
                response, send_err = sink.Send(yakka.DrainContext(), [b'{"kind":"hook_event"}'])
            self.assertIsNone(send_err)
            self.assertEqual(response.Status, 200)
            self.assertEqual(seen, {"path": "/v1/ingest", "authorization": ""})
        finally:
            server.shutdown()
            server.server_close()

    def test_local_file_rejects_remote_fields(self) -> None:
        for body, expected in (
            ('mode = "local"\nkey = "secret"\n', "cannot include key"),
            ('mode = "local"\nendpoint = "http://remote.example"\n', "cannot include endpoint"),
        ):
            write_config(body)
            with self.assertRaises(yakka.ErrBadConfig) as ctx:
                yakka.Load()
            self.assertIn(os.environ["YAKKA_CLIENT_CONFIG"], str(ctx.exception))
            self.assertIn(expected, str(ctx.exception))


class TestDefaultPath(ClientConfigTestCase):
    def test_default_path(self) -> None:
        os.environ["YAKKA_CLIENT_CONFIG"] = ""
        os.environ["HOME"] = "/h"
        self.assertEqual(yakka.Path(), "/h/.config/yakka/client.toml")


class TestEnvOverridesFile(ClientConfigTestCase):
    def test_env_overrides_file(self) -> None:
        write_config('endpoint = "http://file.example"\nkey = "file-key"\n')
        os.environ["YAKKA_ENDPOINT"] = "http://env.example"
        os.environ["YAKKA_KEY"] = "env-key"
        c = yakka.Load()
        self.assertFalse(c.Local)
        self.assertEqual(c.Endpoint, "http://env.example")
        self.assertEqual(c.Key, "env-key")


class TestEnvRemoteNoFile(ClientConfigTestCase):
    def test_env_remote_no_file(self) -> None:
        os.environ["YAKKA_CLIENT_CONFIG"] = os.path.join(
            tempfile.mkdtemp(), "missing.toml"
        )
        os.environ["YAKKA_ENDPOINT"] = "http://collector.example"
        os.environ["YAKKA_KEY"] = "wk_test"
        c = yakka.Load()
        self.assertFalse(c.Local)
        self.assertEqual(c.Endpoint, "http://collector.example")
        self.assertEqual(c.Key, "wk_test")


class TestPartialEnv(ClientConfigTestCase):
    def test_partial_env(self) -> None:
        secret = "super-secret-key-value"
        os.environ["YAKKA_KEY"] = secret
        with self.assertRaises(yakka.ErrPartialEnv) as ctx:
            yakka.Load()
        self.assertNotIn(secret, str(ctx.exception))
        os.environ["YAKKA_KEY"] = ""
        os.environ["YAKKA_ENDPOINT"] = "http://only-endpoint.example"
        with self.assertRaises(yakka.ErrPartialEnv):
            yakka.Load()

    def test_local_mode_conflicts_with_remote_environment(self) -> None:
        os.environ["YAKKA_MODE"] = "local"
        os.environ["YAKKA_ENDPOINT"] = "http://remote.example"
        os.environ["YAKKA_KEY"] = "wk_test"
        with self.assertRaises(yakka.ErrBadConfig) as ctx:
            yakka.Load()
        self.assertIn("conflicts", str(ctx.exception))


class TestPartialFile(ClientConfigTestCase):
    def test_partial_file_names_missing_field(self) -> None:
        for body, expected in (
            ('key = "wk_test"\n', "missing endpoint"),
            ('endpoint = "http://remote.example"\n', "missing key"),
        ):
            write_config(body)
            with self.assertRaises(ValueError) as ctx:
                yakka.Load()
            self.assertIn(os.environ["YAKKA_CLIENT_CONFIG"], str(ctx.exception))
            self.assertIn(expected, str(ctx.exception))


class TestMalformed(ClientConfigTestCase):
    def test_malformed(self) -> None:
        write_config("endpoint = \"e\"\nkey = hunter2secret\n")
        with self.assertRaises(ValueError) as ctx:
            yakka.Load()
        self.assertIn("line 2", str(ctx.exception))
        self.assertNotIn("hunter2", str(ctx.exception))

        write_config('endpoint = "e"\n')
        with self.assertRaises(ValueError) as ctx:
            yakka.Load()
        self.assertIn("missing key", str(ctx.exception))

        write_config('key = "k"\n')
        with self.assertRaises(ValueError) as ctx:
            yakka.Load()
        self.assertIn("missing endpoint", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
