import os
import tempfile
import unittest

import yakka


class ClientConfigTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._env_save = {
            k: os.environ.pop(k, None)
            for k in ("YAKKA_ENDPOINT", "YAKKA_KEY", "YAKKA_CLIENT_CONFIG")
        }

    def tearDown(self) -> None:
        for k in ("YAKKA_ENDPOINT", "YAKKA_KEY", "YAKKA_CLIENT_CONFIG"):
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
        c = yakka.Load()
        self.assertTrue(c.Local)
        self.assertEqual(c.Endpoint, yakka.LocalEndpoint)
        self.assertEqual(c.Key, "")
        self.assertEqual(c.Mode(), "local")


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
    def test_env_placeholder_treated_as_unset(self) -> None:
        write_config('endpoint = "https://file.example"\nkey = "k"\n')
        os.environ["YAKKA_ENDPOINT"] = "${env:YAKKA_ENDPOINT}"
        os.environ["YAKKA_KEY"] = "${env:YAKKA_KEY}"
        c = yakka.Load()
        self.assertEqual(c.Endpoint, "https://file.example")
        self.assertEqual(c.Key, "k")

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


class TestEmptyEnvFallsBack(ClientConfigTestCase):
    def test_empty_env_uses_client_toml(self) -> None:
        write_config('endpoint = "https://file.example"\nkey = "file-key"\n')
        os.environ["YAKKA_ENDPOINT"] = ""
        os.environ["YAKKA_KEY"] = ""
        c = yakka.Load()
        self.assertEqual(c.Endpoint, "https://file.example")
        self.assertEqual(c.Key, "file-key")

    def test_literal_env_placeholders_use_client_toml(self) -> None:
        write_config('endpoint = "https://file.example"\nkey = "file-key"\n')
        os.environ["YAKKA_ENDPOINT"] = "${env:YAKKA_ENDPOINT}"
        os.environ["YAKKA_KEY"] = "${env:YAKKA_KEY}"
        c = yakka.Load()
        self.assertEqual(c.Endpoint, "https://file.example")
        self.assertEqual(c.Key, "file-key")

    def test_literal_env_placeholders_loadmcp(self) -> None:
        write_config('endpoint = "https://file.example"\nkey = "file-key"\n')
        os.environ["YAKKA_ENDPOINT"] = "${env:YAKKA_ENDPOINT}"
        os.environ["YAKKA_KEY"] = "${env:YAKKA_KEY}"
        c = yakka.LoadMCP()
        self.assertEqual(c.Endpoint, "https://file.example")
        self.assertEqual(c.Key, "file-key")


class TestLoadMCP(ClientConfigTestCase):
    def test_missing_file_defaults_remote(self) -> None:
        os.environ["YAKKA_CLIENT_CONFIG"] = os.path.join(
            tempfile.mkdtemp(), "none.toml"
        )
        c = yakka.LoadMCP()
        self.assertEqual(c.Endpoint, yakka.DefaultEndpoint)
        self.assertEqual(c.Key, "")
        self.assertFalse(c.Local)

    def test_endpoint_override_without_key(self) -> None:
        write_config('endpoint = "http://file.example"\nkey = "file-key"\n')
        os.environ["YAKKA_ENDPOINT"] = "http://override.example"
        c = yakka.LoadMCP()
        self.assertEqual(c.Endpoint, "http://override.example")
        self.assertEqual(c.Key, "")

    def test_key_only_uses_file_then_default_endpoint(self) -> None:
        write_config('endpoint = "https://file.example"\nkey = "file-key"\n')
        os.environ["YAKKA_KEY"] = "env-key"
        c = yakka.LoadMCP()
        self.assertEqual(c.Endpoint, "https://file.example")
        self.assertEqual(c.Key, "env-key")

    def test_key_only_no_file_uses_default_endpoint(self) -> None:
        os.environ["YAKKA_CLIENT_CONFIG"] = os.path.join(
            tempfile.mkdtemp(), "none.toml"
        )
        os.environ["YAKKA_KEY"] = "solo-key"
        c = yakka.LoadMCP()
        self.assertEqual(c.Endpoint, yakka.DefaultEndpoint)
        self.assertEqual(c.Key, "solo-key")

    def test_partial_file_fields_ok(self) -> None:
        write_config('endpoint = "http://only-ep.example"\n')
        c = yakka.LoadMCP()
        self.assertEqual(c.Endpoint, "http://only-ep.example")
        self.assertEqual(c.Key, "")

    def test_partial_env_does_not_raise(self) -> None:
        os.environ["YAKKA_ENDPOINT"] = "http://only-endpoint.example"
        c = yakka.LoadMCP()
        self.assertEqual(c.Endpoint, "http://only-endpoint.example")
        self.assertEqual(c.Key, "")


if __name__ == "__main__":
    unittest.main()
