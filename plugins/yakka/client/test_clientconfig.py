import os
import tempfile
import unittest

import yakka


class ClientConfigTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._env_save = {
            k: os.environ.pop(k, None)
            for k in ("YAKKA_ENDPOINT", "YAKKA_KEY", "YAKKA_CLIENT_CONFIG",
                      "YAKKA_ACTION_KIND", "YAKKA_ACTION_SUBJECT_TYPE",
                      "YAKKA_ACTION_SUBJECT_ID", "YAKKA_ACTION_PHASE",
                      "YAKKA_ACTION_REPO", "YAKKA_ACTION_PR")
        }

    def tearDown(self) -> None:
        for k in self._env_save:
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


class TestActionEnvIsolation(ClientConfigTestCase):
    def test_action_vars_do_not_affect_client_config(self) -> None:
        os.environ.update({
            "YAKKA_ACTION_KIND": "build", "YAKKA_ACTION_SUBJECT_TYPE": "plan",
            "YAKKA_ACTION_SUBJECT_ID": "owner/repo:plan/example",
        })
        os.environ["YAKKA_CLIENT_CONFIG"] = os.path.join(
            tempfile.mkdtemp(), "missing.toml"
        )
        cfg = yakka.Load()
        self.assertTrue(cfg.Local)
        self.assertEqual(cfg.Endpoint, yakka.LocalEndpoint)


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
