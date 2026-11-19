import hashlib
import os
import pwd
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLUGIN_ROOT = os.path.join(ROOT, "plugins", "yakka")
WRAPPER = os.path.join(PLUGIN_ROOT, "bin", "yakka")
CLIENT = os.path.join(PLUGIN_ROOT, "client", "yakka.py")
BUILD = os.path.join(ROOT, "tools", "release", "build.sh")
GOBIN = os.path.expanduser("~/.local/go/bin")
VERSION = open(os.path.join(PLUGIN_ROOT, "bin", "VERSION")).read().strip()
SYS_PATH = "/usr/bin:/bin"
LINE = re.compile(r"^yakka %s [0-9a-f]{12}$" % re.escape(VERSION))
USAGE = (
    "usage: yakka serve | drain | login [start|wait] [--endpoint URL] | ledger compact --tenant-dir <dir> "
    "| ledger purge-deltas --tenant-dir <dir> | mcp | status | version"
)


def goenv(name):
    # Ask with the real home so a caller's temp HOME does not move the caches.
    env = dict(os.environ, HOME=pwd.getpwuid(os.getuid()).pw_dir)
    out = subprocess.run([os.path.join(GOBIN, "go"), "env", name], capture_output=True, text=True, env=env)
    return out.stdout.strip()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="reltest.")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.home = os.path.join(self.tmp, "home")
        self.cache = os.path.join(self.tmp, "cache")
        os.makedirs(self.home)
        os.makedirs(self.cache)

    def env(self, go=True, **extra):
        path = (GOBIN + ":" + SYS_PATH) if go else SYS_PATH
        e = {"HOME": self.home, "XDG_CACHE_HOME": self.cache, "PATH": path, "TYPESAFE_API_KEY": ""}
        if go:
            e["GOCACHE"] = goenv("GOCACHE")
            e["GOMODCACHE"] = goenv("GOMODCACHE")
        for k in ("TMPDIR", "GOTMPDIR"):  # let a full /tmp be avoided
            if os.environ.get(k):
                e[k] = os.environ[k]
        e.update(extra)
        return e

    def path_without_node(self):
        d = os.path.join(self.tmp, "build-path")
        os.makedirs(d)
        tools = ("go", "git", "tr", "mktemp", "find", "cp", "mkdir", "rm",
                 "sha256sum", "shasum", "sort", "mv", "dirname", "grep")
        for name in tools:
            source = os.path.join(GOBIN, name) if name == "go" else shutil.which(name)
            if source and os.path.exists(source):
                os.symlink(source, os.path.join(d, name))
        return d

    def run_wrapper(self, args=("--version",), wrapper=WRAPPER, **kw):
        return subprocess.run(["bash", wrapper] + list(args), env=self.env(**kw),
                              capture_output=True, text=True, timeout=400)

    def fake_python(self):
        d = os.path.join(self.tmp, "pybin")
        os.makedirs(d)
        stub = os.path.join(d, "python3")
        with open(stub, "w") as fh:
            fh.write(
                '#!/bin/sh\n'
                'echo "PY $*" >> "$YAKKA_PY_LOG"\n'
                'for a in "$@"; do\n'
                '  case "$a" in --version|version) echo "yakka %s unknown"; exit 0;; esac\n'
                'done\n'
                % VERSION
            )
        os.chmod(stub, 0o755)
        return d


class WrapperTests(Base):
    def test_1_dispatches_drain_to_python(self):
        log = os.path.join(self.tmp, "py.log")
        pydir = self.fake_python()
        r = self.run_wrapper(("drain",), go=False, PATH=pydir + ":" + SYS_PATH, YAKKA_PY_LOG=log)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(log) as fh:
            self.assertIn("PY %s drain" % CLIENT, fh.read())

    def test_2_dispatches_mcp_to_python(self):
        log = os.path.join(self.tmp, "py.log")
        pydir = self.fake_python()
        r = self.run_wrapper(("mcp",), go=False, PATH=pydir + ":" + SYS_PATH, YAKKA_PY_LOG=log)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(log) as fh:
            self.assertIn("PY %s mcp" % CLIENT, fh.read())

    def test_3_version_via_python(self):
        pydir = self.fake_python()
        r = self.run_wrapper(("--version",), go=False, PATH=pydir + ":" + SYS_PATH,
                             YAKKA_PY_LOG=os.path.join(self.tmp, "py.log"))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertRegex(r.stdout.strip(), r"^yakka %s " % VERSION)

    def test_4_serve_refused(self):
        r = self.run_wrapper(("serve",), go=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertRegex(r.stderr, r"(?i)go|collector")
        yakka_cache = os.path.join(self.cache, "yakka")
        self.assertFalse(os.path.exists(yakka_cache))

    def test_5_ledger_refused(self):
        r = self.run_wrapper(("ledger", "compact", "--tenant-dir", "/tmp/x"), go=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertRegex(r.stderr, r"(?i)go|collector")

    def test_6_no_args_usage(self):
        r = self.run_wrapper((), go=False)
        self.assertEqual(r.returncode, 2)
        self.assertIn(USAGE, r.stderr.strip())

    def test_7_unknown_usage(self):
        r = self.run_wrapper(("nope",), go=False)
        self.assertEqual(r.returncode, 2)
        self.assertIn(USAGE, r.stderr.strip())

    def test_10_yakka_bin(self):
        stub = os.path.join(self.tmp, "stub")
        with open(stub, "w") as fh:
            fh.write("#!/bin/sh\necho stub $YAKKA_ROOT $1\n")
        os.chmod(stub, 0o755)
        r = self.run_wrapper(go=False, YAKKA_BIN=stub)
        self.assertEqual(r.stdout.strip(), "stub %s --version" % PLUGIN_ROOT)

    def test_8_bash32_lint(self):
        with open(WRAPPER) as fh:
            src = fh.read()
        for pat in ["read -N", "mapfile", ",,}", "EPOCHREALTIME", "flock", "[[ -v"]:
            self.assertNotIn(pat, src)


class BuildTests(Base):
    def test_7_build_sh(self):
        out = os.path.join(self.tmp, "dist")
        sums = os.path.join(self.tmp, "SUMS")
        env = self.env(OUT_DIR=out, SUMS_FILE=sums)
        env["PATH"] = self.path_without_node()
        env["GOMAXPROCS"] = "3"
        self.assertIsNone(shutil.which("node", path=env["PATH"]))
        self.assertIsNone(shutil.which("npm", path=env["PATH"]))
        r = subprocess.run(["/bin/bash", BUILD], env=env,
                           capture_output=True, text=True, timeout=600, cwd=ROOT)
        self.assertEqual(r.returncode, 0, r.stderr)
        dirty = subprocess.run(["git", "status", "--porcelain", "packages/yakka/internal/serve/site"],
                               capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(dirty.stdout, "")
        names = sorted(os.listdir(out))
        self.assertEqual(names, ["yakka-darwin-amd64", "yakka-darwin-arm64",
                                 "yakka-linux-amd64", "yakka-linux-arm64"])
        with open(sums) as fh:
            lines = fh.read().splitlines()
        self.assertEqual(len(lines), 4)
        self.assertEqual([l.split("  ")[1] for l in lines], names)
        c = subprocess.run(["sha256sum", "-c", sums], cwd=out, capture_output=True, text=True)
        # sums hold bare names; check in OUT_DIR
        self.assertEqual(c.returncode, 0, c.stderr)
        for n in names:
            with open(os.path.join(out, n), "rb") as fh:
                data = fh.read()
            magic = data[:4]
            # The built site is embedded, not the placeholder (whose marker is also a Go string
            # constant, so assert on a built-asset path instead).
            self.assertIn(b"site/js/app.js", data, n)
            self.assertIn(b"site/vendor/uplot-1.6.32/uPlot.esm.js", data, n)
            self.assertNotIn(b"site/_headers", data, n)
            if "linux" in n:
                self.assertEqual(magic, b"\x7fELF")
            else:
                self.assertIn(magic, (b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe"))

    def test_8_build_sh_restores_placeholder_on_failure(self):
        source = os.path.join(self.tmp, "bad-site")
        os.makedirs(source)
        with open(os.path.join(source, "index.html"), "w") as fh:
            fh.write("<p>yakka-analytics-placeholder</p>")
        env = self.env(SITE_SRC=source)
        env["PATH"] = self.path_without_node()
        self.assertIsNone(shutil.which("node", path=env["PATH"]))
        self.assertIsNone(shutil.which("npm", path=env["PATH"]))
        r = subprocess.run(["/bin/bash", BUILD], env=env, capture_output=True, text=True,
                           timeout=30, cwd=ROOT)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("still the placeholder", r.stderr)
        self.assert_placeholder_restored()

        # Fail after the valid site has replaced site/: the exit trap must still restore it.
        valid = os.path.join(self.tmp, "valid-site")
        os.makedirs(os.path.join(valid, "js"))
        with open(os.path.join(valid, "index.html"), "w") as fh:
            fh.write("<!doctype html><script type=module src=/js/app.js></script>")
        with open(os.path.join(valid, "js", "app.js"), "w") as fh:
            fh.write("export {}")
        fake_go = os.path.join(self.tmp, "build-path", "go")
        os.unlink(fake_go)
        with open(fake_go, "w") as fh:
            fh.write("#!/bin/sh\necho 'fake go failure' >&2\nexit 1\n")
        os.chmod(fake_go, 0o755)
        env = self.env(SITE_SRC=valid, OUT_DIR=os.path.join(self.tmp, "dist"),
                       SUMS_FILE=os.path.join(self.tmp, "SUMS"))
        env["PATH"] = os.path.join(self.tmp, "build-path")
        env["GOMAXPROCS"] = "3"
        r = subprocess.run(["/bin/bash", BUILD], env=env, capture_output=True, text=True,
                           timeout=30, cwd=ROOT)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("fake go failure", r.stderr)
        self.assert_placeholder_restored()

    def assert_placeholder_restored(self):
        with open(os.path.join(ROOT, "packages/yakka/internal/serve/site/index.html")) as fh:
            self.assertIn("yakka-analytics-placeholder", fh.read())
        dirty = subprocess.run(["git", "status", "--porcelain", "packages/yakka/internal/serve/site"],
                               capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(dirty.stdout, "")


if __name__ == "__main__":
    unittest.main()
