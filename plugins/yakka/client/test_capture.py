"""Offline fixtures for the local change reader."""
import hashlib
import os
import pathlib
import socket
import subprocess
import tempfile
import json
import unittest
from unittest import mock

import yakka


def git(path, *args, env=None):
    return subprocess.run(["git", "-C", str(path), *args], check=True,
                          capture_output=True, env=env).stdout


class CaptureFixtures(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = pathlib.Path(self.tmp.name) / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.email", "fixture@example.invalid")
        git(self.repo, "config", "user.name", "Fixture")
        (self.repo / "base.txt").write_text("one\n", encoding="utf-8")
        git(self.repo, "add", "base.txt")
        git(self.repo, "commit", "-qm", "initial")
        self.head = git(self.repo, "rev-parse", "HEAD").decode().strip()

    def tearDown(self):
        self.tmp.cleanup()

    def capture(self, **kwargs):
        return yakka.CaptureChange(str(self.repo), **kwargs)

    def test_combined_staged_net_and_staged_only(self):
        (self.repo / "base.txt").write_text("two\n", encoding="utf-8")
        git(self.repo, "add", "base.txt")
        (self.repo / "base.txt").write_text("three\n", encoding="utf-8")
        (self.repo / "staged.txt").write_text("staged\n", encoding="utf-8")
        git(self.repo, "add", "staged.txt")
        combined = self.capture()
        self.assertEqual(combined["diff"].count("diff --git"), 2)
        self.assertIn("+three", combined["diff"])
        self.assertNotIn("+two", combined["diff"])
        staged = self.capture(view="staged")
        self.assertIn("+two", staged["diff"])
        self.assertIn("+staged", staged["diff"])
        self.assertNotIn("+three", staged["diff"])

    def test_untracked_policy_and_safe_inclusion(self):
        (self.repo / "new.txt").write_text("new file\n", encoding="utf-8")
        default = self.capture()
        self.assertNotIn("new.txt", default["diff"])
        self.assertEqual(default["manifest"][0]["reason"], "untracked_not_included")
        included = self.capture(include_untracked=True)
        self.assertIn("+new file", included["diff"])
        (self.repo / "ignored.txt").write_text("ignored\n", encoding="utf-8")
        git(self.repo, "add", ".gitignore") if (self.repo / ".gitignore").exists() else None
        (self.repo / ".gitignore").write_text("ignored.txt\n", encoding="utf-8")
        git(self.repo, "add", ".gitignore")
        git(self.repo, "commit", "-qm", "ignore")
        ignored = self.capture(include_untracked=True)
        self.assertNotIn("ignored.txt", ignored["diff"])
        self.assertIn("ignored", [x["reason"] for x in ignored["manifest"]])

    def test_range_is_resolved_and_object_only(self):
        (self.repo / "base.txt").write_text("committed\n", encoding="utf-8")
        git(self.repo, "commit", "-am", "second", "-q")
        second = git(self.repo, "rev-parse", "HEAD").decode().strip()
        (self.repo / "base.txt").write_text("worktree secret-ish text\n", encoding="utf-8")
        result = self.capture(mode="range", base=self.head, head=second)
        self.assertEqual(result["base"], self.head)
        self.assertEqual(result["resolved_head"], second)
        self.assertNotIn("worktree secret-ish", result["diff"])

    def test_bad_refs_and_arguments_are_structured(self):
        for ref in ("-bad", "has space", "not-a-ref"):
            with self.assertRaises(yakka.CaptureError) as caught:
                self.capture(mode="range", base=ref, head=self.head)
            self.assertEqual(caught.exception.code, "bad_ref")
            self.assertEqual(caught.exception.argument, "base")
        with self.assertRaises(yakka.CaptureError) as caught:
            self.capture(mode="unknown")
        self.assertEqual(caught.exception.code, "bad_argument")
        with self.assertRaises(yakka.CaptureError) as caught:
            yakka.CaptureChange(None)
        self.assertEqual(caught.exception.code, "no_project_dir")

    def test_stable_hash_checkout_and_identity(self):
        (self.repo / "base.txt").write_text("changed\n", encoding="utf-8")
        a = self.capture()
        b = self.capture()
        self.assertEqual(a["diff_sha256"], b["diff_sha256"])
        self.assertEqual(a["diff_sha256"], hashlib.sha256(a["diff"].encode()).hexdigest())
        self.assertEqual(a["branch"], "master" if a["branch"] == "master" else a["branch"])
        self.assertIn("staged", a["dirty_counts"])
        with self.assertRaises(yakka.CaptureError) as caught:
            self.capture(repo_id="other/repo")
        self.assertEqual(caught.exception.code, "wrong_checkout")

    def test_secret_exclusion_file_cap_and_total_cap_withhold_content(self):
        (self.repo / "base.txt").write_text("ordinary change\n", encoding="utf-8")
        (self.repo / "package-lock.json").write_text("noise\n", encoding="utf-8")
        git(self.repo, "add", "package-lock.json")
        (self.repo / "secret.txt").write_text("sk-" + "a1" * 12 + "\n", encoding="utf-8")
        git(self.repo, "add", "secret.txt")
        result = self.capture(include_untracked=True, policy={"max_file_bytes": 10,
                                                               "max_total_bytes": 10,
                                                               "max_files": 1})
        reasons = {x["path"]: x["reason"] for x in result["manifest"]}
        self.assertIn("secret", reasons.values())
        self.assertIn("excluded", reasons.values())
        self.assertTrue(any(x.startswith("truncated_budget") or x == "file_cap" for x in reasons.values()))
        for hidden in ("sk-", "noise"):
            self.assertNotIn(hidden, result["diff"])

    def test_file_and_total_caps_drop_whole_files(self):
        (self.repo / "base.txt").write_text("a" * 200 + "\n", encoding="utf-8")
        (self.repo / "other.txt").write_text("b\n", encoding="utf-8")
        git(self.repo, "add", "other.txt")
        result = self.capture(policy={"max_file_bytes": 1000, "max_total_bytes": 20, "max_files": 1})
        self.assertFalse(result["complete"])
        self.assertEqual(len(result["files"]), 0)
        self.assertIn("truncated_budget", [x["reason"] for x in result["manifest"]])

    def test_binary_and_symlink_are_manifest_only(self):
        (self.repo / "binary.dat").write_bytes(b"\xff\xfe\x00")
        git(self.repo, "add", "binary.dat")
        (self.repo / "link.txt").symlink_to("base.txt")
        result = self.capture(include_untracked=True)
        reasons = {x["path"]: x["reason"] for x in result["manifest"]}
        self.assertEqual(reasons["binary.dat"], "encoding")
        self.assertEqual(reasons["link.txt"], "symlink")
        self.assertNotIn("binary.dat", result["diff"])
        self.assertNotIn("link.txt", result["diff"])

    def test_removed_secret_is_withheld(self):
        secret = "ghp_" + "A1" * 12
        (self.repo / "base.txt").write_text(secret + "\n", encoding="utf-8")
        git(self.repo, "commit", "-am", "fixture secret", "-q")
        (self.repo / "base.txt").write_text("removed\n", encoding="utf-8")
        result = self.capture()
        self.assertNotIn(secret, result["diff"])
        self.assertEqual(result["manifest"][0]["reason"], "secret")

    def test_change_during_capture_is_refused(self):
        original = yakka._capture_state
        states = iter([original(str(self.repo)), ("other-head", b"changed"),
                       original(str(self.repo)), ("other-head", b"changed")])
        with mock.patch.object(yakka, "_capture_state", side_effect=lambda root, filters=(): next(states)):
            with self.assertRaises(yakka.CaptureError) as caught:
                self.capture()
        self.assertEqual(caught.exception.code, "changed_during_capture")

    def test_linked_worktree_and_detached_identity(self):
        wt = pathlib.Path(self.tmp.name) / "linked"
        git(self.repo, "worktree", "add", "-q", "-b", "linked", str(wt), self.head)
        got = yakka.CaptureChange(str(wt))
        self.assertTrue(got["linked_worktree"])
        git(wt, "checkout", "--detach", "-q")
        self.assertEqual(yakka.CaptureChange(str(wt))["branch"], "detached")

    def test_no_network_and_fixed_no_shell_subprocesses(self):
        seen = []
        original = subprocess.run
        def inspect(args, **kwargs):
            if args and args[0] == "git":
                seen.append((args, kwargs))
                self.assertIs(kwargs.get("shell"), False)
            return original(args, **kwargs)
        with mock.patch.object(subprocess, "run", side_effect=inspect), \
             mock.patch.object(socket, "socket", side_effect=AssertionError("network socket opened")):
            self.capture()
        self.assertTrue(seen)
        allowed = {"rev-parse", "status", "remote", "branch", "check-attr", "diff", "ls-files", "rev-list"}
        for args, _ in seen:
            self.assertIn(args[args.index("-C") + 2], allowed)

    def test_external_helpers_are_disabled_and_filter_is_withheld(self):
        marker = pathlib.Path(self.tmp.name) / "ran"
        script = pathlib.Path(self.tmp.name) / "helper"
        script.write_text("#!/bin/sh\ntouch " + str(marker) + "\n", encoding="utf-8")
        script.chmod(0o755)
        (self.repo / ".gitattributes").write_text("filtered.txt filter=canary\n*.txt diff=canary\n", encoding="utf-8")
        (self.repo / "filtered.txt").write_text("content\n", encoding="utf-8")
        (self.repo / "base.txt").write_text("changed\n", encoding="utf-8")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "drivers")
        for key, value in (("diff.external", str(script)), ("core.fsmonitor", str(script)),
                           ("diff.canary.textconv", str(script)), ("filter.canary.clean", str(script))):
            git(self.repo, "config", key, value)
        (self.repo / "base.txt").write_text("change again\n", encoding="utf-8")
        (self.repo / "filtered.txt").write_text("filter change\n", encoding="utf-8")
        result = self.capture()
        self.assertIn("filter_driver", [x["reason"] for x in result["manifest"]])
        self.assertFalse(marker.exists())

    def test_python_pattern_names_match_go_patterns(self):
        module_root = pathlib.Path(__file__).resolve().parents[3] / "packages" / "yakka"
        module = subprocess.run(["go", "list", "-m"], cwd=module_root, check=True,
                                capture_output=True, text=True).stdout.strip()
        with tempfile.NamedTemporaryFile("w", suffix=".go", dir=module_root, delete=False) as fh:
            helper = pathlib.Path(fh.name)
            fh.write(f'''package main
import ("encoding/json"; "os"; "{module}/internal/secrets")
func main() {{ _ = json.NewEncoder(os.Stdout).Encode(secrets.Patterns()) }}
''')
        try:
            output = subprocess.run(["go", "run", str(helper)], cwd=module_root, check=True,
                                    capture_output=True, text=True).stdout
        finally:
            helper.unlink(missing_ok=True)
        self.assertEqual(yakka.Patterns(), json.loads(output))


if __name__ == "__main__":
    unittest.main()
