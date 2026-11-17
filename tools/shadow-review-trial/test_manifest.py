"""Offline contract fixtures for historical manifest freezing."""
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("shadow_manifest", pathlib.Path(__file__).with_name("manifest.py"))
manifest = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(manifest)


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True).stdout.decode().strip()


class ManifestFixtures(unittest.TestCase):
    def setUp(self):
        tmp_root = pathlib.Path(os.environ.get("TMPDIR", ROOT))
        tmp_root.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=tmp_root)
        self.repo = pathlib.Path(self.tmp.name) / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "-q")
        git(self.repo, "config", "user.email", "fixture@example.invalid")
        git(self.repo, "config", "user.name", "Fixture")
        (self.repo / "code.py").write_text("base = 1\n")
        (self.repo / "docs/plans/demo").mkdir(parents=True)
        (self.repo / "docs/plans/demo/DESIGN.md").write_text("# Criteria at head\n")
        (self.repo / "docs/plans/demo/IMPLEMENTATION.md").write_text("# Phase verification\n")
        (self.repo / "docs/plans/demo/REVIEW.md").write_text("# Historical review\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "base")
        self.base = git(self.repo, "rev-parse", "HEAD")
        (self.repo / "code.py").write_text("base = 2\n")
        git(self.repo, "add", "code.py")
        git(self.repo, "commit", "-qm", "reviewed change\n\nYakka-Plan: docs/plans/demo\nYakka-Phase: llm-review-shadow:6")
        self.head = git(self.repo, "rev-parse", "HEAD")
        (self.repo / "code.py").write_text("base = 3\n")
        git(self.repo, "add", "code.py")
        git(self.repo, "commit", "-qm", "PR change\n\nYakka-Plan: docs/plans/demo\nPull-Request: 23")
        self.pr_head = git(self.repo, "rev-parse", "HEAD")
        (self.repo / "code.py").write_text("base = 4 # created after phase head\n")
        git(self.repo, "add", "code.py")
        git(self.repo, "commit", "-qm", "later change")
        self.out = pathlib.Path(self.tmp.name) / "manifest.json"
        self.remote = pathlib.Path(self.tmp.name) / "remote.git"
        git(self.tmp.name, "init", "--bare", "-q", str(self.remote))
        git(self.remote, "symbolic-ref", "HEAD", "refs/heads/main")
        git(self.repo, "remote", "add", "origin", str(self.remote))
        git(self.repo, "push", "-q", "origin", "HEAD:refs/heads/main")
        git(self.repo, "fetch", "-q", "origin")
        self.identity = str(self.remote)

    def tearDown(self):
        self.tmp.cleanup()

    def test_freeze_capture_criteria_shortages_and_seeded_order(self):
        frozen = manifest.create_manifest(self.repo, self.out, seed=19, target=50, expected_repository=self.identity)
        case = next(c for c in frozen["cases"] if c["head_sha"] == self.head)
        self.assertTrue(case["eligible"], case["eligibility_reason"])
        self.assertEqual(case["base_sha"], self.base)
        self.assertEqual(case["capture"]["base"], case["base_sha"])
        self.assertEqual(case["capture"]["resolved_head"], case["head_sha"])
        self.assertEqual(case["capture"]["diff_sha256"], hashlib.sha256(case["capture"]["diff"].encode()).hexdigest())
        self.assertNotIn("created after phase head", case["capture"]["diff"])
        self.assertEqual(case["criteria"]["source"], "head_blob")
        self.assertEqual(case["criteria"]["content_hash"], git(self.repo, "rev-parse", f"{self.head}:docs/plans/demo/DESIGN.md"))
        self.assertEqual(case["build_models"]["source"], "unknown")
        self.assertNotIn("docs/plans/demo/IMPLEMENTATION.md", case["capture"]["diff"])
        self.assertNotIn("docs/plans/demo/REVIEW.md", case["capture"]["diff"])
        self.assertEqual(frozen["shortages"]["high"]["eligible_shortfall"], 48)
        self.assertEqual(frozen["shortages"]["max"]["eligible_shortfall"], 48)
        self.assertEqual(frozen["shortages"]["xhigh"]["eligible_shortfall"], 48)
        self.assertEqual(frozen["settings"]["shared_case_set"], True)
        self.assertEqual(frozen["settings"]["non_effort"]["kind"], "range")
        self.assertEqual(frozen["settings"]["non_effort"]["review_profile"], "historical_trial")
        self.assertEqual(frozen["strata"]["phase"]["eligible"], 1)
        self.assertEqual(frozen["strata"]["pr"]["eligible"], 1)
        self.assertEqual(frozen["strata"]["unaccompanied"]["eligible"], 0)
        unaccompanied = next(c for c in frozen["candidates"] if c["stratum"] == "unaccompanied" and c["head_sha"] != self.base)
        self.assertFalse(unaccompanied["eligible"])
        self.assertEqual(unaccompanied["eligibility_reason"], "criteria_unavailable")
        pr_case = next(c for c in frozen["cases"] if c["head_sha"] == self.pr_head)
        self.assertTrue(all("IMPLEMENTATION.md" not in p for p in pr_case["comparator_pointers"]))
        self.assertTrue(any("REVIEW.md" in p for p in pr_case["comparator_pointers"]))
        self.assertNotIn("docs/plans/demo/REVIEW.md", pr_case["capture"]["diff"])
        self.assertFalse(frozen["history"]["shallow"])
        self.assertTrue(frozen["history"]["object_complete"])
        self.assertEqual(frozen["history"]["enumerated_commits"], frozen["history"]["verified_count"])
        persisted = json.loads(self.out.read_text())
        self.assertEqual(persisted["run_order"], frozen["run_order"])
        with self.assertRaises(manifest.ManifestFrozenError):
            manifest.create_manifest(self.repo, self.out, seed=20, target=50, expected_repository=self.identity)
        second = manifest.create_manifest(self.repo, pathlib.Path(self.tmp.name) / "same-seed.json", seed=19, target=50, expected_repository=self.identity)
        self.assertEqual(second["run_order"], persisted["run_order"])

    def test_comparator_citations_are_blob_and_line_bound_and_hashed(self):
        blob = git(self.repo, "rev-parse", f"{self.head}:docs/plans/demo/REVIEW.md")
        citations = [{"path": "docs/plans/demo/REVIEW.md", "sha": self.head, "blobhash": blob, "line_start": 1, "line_end": 1}]
        curated = {"version": 1, "findings": [{"id": "f1", "stratum": "phase", "head_sha": self.head, "text": "criterion", "citations": citations}],
                   "build_models": {self.head: ["fixture-model"]}}
        (pathlib.Path(self.tmp.name) / "comparators.json").write_text(json.dumps(curated))
        frozen = manifest.create_manifest(self.repo, self.out, seed=3, target=50, expected_repository=self.identity,
                                          comparator_path=pathlib.Path(self.tmp.name) / "comparators.json")
        self.assertEqual(frozen["comparators"]["curated_sha256"], hashlib.sha256((pathlib.Path(self.tmp.name) / "comparators.json").read_bytes()).hexdigest())
        phase_case = next(c for c in frozen["cases"] if c["head_sha"] == self.head)
        self.assertTrue(any(x.startswith("docs/plans/demo/REVIEW.md@") for x in phase_case["comparator_pointers"]))
        self.assertEqual(phase_case["build_models"]["source"], "curated")

    def test_pr_export_is_independently_hashed_by_head(self):
        export = {"reviews": [{"head_sha": self.pr_head, "body": "PR review finding"}]}
        path = pathlib.Path(self.tmp.name) / "pr-export.json"
        path.write_text(json.dumps(export))
        normalized = manifest.load_pr_export(self.repo, path, {self.head: "phase", self.pr_head: "pr"})
        self.assertEqual(normalized["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(normalized["by_head"][self.pr_head][0]["body"], "PR review finding")

    def test_phase_trailers_supply_plan_and_support_workflow_alias(self):
        phase_heads = []
        for marker, number in (("Yakka-Phase", 7), ("Workflow-Phase", 8)):
            code = self.repo / "code.py"
            code.write_text(f"phase = {number}\n")
            git(self.repo, "add", "code.py")
            git(self.repo, "commit", "-qm", f"phase {number}\n\n{marker}: demo:{number}")
            phase_heads.append((git(self.repo, "rev-parse", "HEAD"), number))

        frozen = manifest.create_manifest(self.repo, self.out, seed=2, target=50, expected_repository=self.identity)
        for head, number in phase_heads:
            case = next(c for c in frozen["cases"] if c["head_sha"] == head)
            self.assertEqual(case["stratum"], "phase")
            self.assertEqual(case["plan"], "demo")
            self.assertEqual(case["phase"], number)
            self.assertEqual(case["criteria"]["source"], "head_blob")
            self.assertTrue(any("IMPLEMENTATION.md" in pointer for pointer in case["comparator_pointers"]))

    def test_cli_freezes_fixture_repository(self):
        output = pathlib.Path(self.tmp.name) / "cli-manifest.json"
        result = subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name("cli.py")), "manifest",
                                 "--repo", str(self.repo), "--output", str(output), "--seed", "7",
                                 "--remote", "origin", "--expected-repository", self.identity],
                                capture_output=True, text=True, check=True)
        self.assertIn('"eligible": 2', result.stdout)
        self.assertEqual(json.loads(output.read_text())["seed"], 7)

    def test_shallow_clone_from_complete_remote_is_unshallowed_and_frozen(self):
        shallow = pathlib.Path(self.tmp.name) / "shallow-full"
        subprocess.run(["git", "clone", "--quiet", "--depth", "1", f"file://{self.repo}", str(shallow)],
                       capture_output=True, check=True)
        self.assertEqual(git(shallow, "rev-parse", "--is-shallow-repository"), "true")
        output = pathlib.Path(self.tmp.name) / "shallow-full-manifest.json"
        frozen = manifest.create_manifest(shallow, output, expected_repository=str(self.repo))
        history = frozen["history"]
        self.assertFalse(history["shallow"])
        self.assertTrue(history["object_complete"])
        self.assertEqual(history["tip_sha"], git(shallow, "rev-parse", "HEAD"))
        self.assertEqual(history["verified_count"], int(git(shallow, "rev-list", "--count", "HEAD")))
        self.assertEqual(history["enumerated_commits"], history["verified_count"])
        self.assertEqual(len(frozen["candidates"]), history["enumerated_commits"])
        self.assertTrue(history["fetched_refs"])
        self.assertEqual(history["repository"], manifest._repository_identity(str(self.repo)))
        self.assertEqual(history["remote"], "origin")
        self.assertEqual(git(shallow, "rev-parse", "--is-shallow-repository"), "false")
        self.assertEqual(json.loads(output.read_text())["history"], history)

    def test_fetch_failure_refuses_before_writing(self):
        def run(repo, *args, text=True):
            if args and args[0] == "fetch":
                raise subprocess.CalledProcessError(1, ["git", "fetch"])
            return manifest._git(repo, *args, text=text)
        with self.assertRaises(manifest.HistoryPreparationError):
            manifest.create_manifest(self.repo, self.out, expected_repository=self.identity, run=run)
        self.assertFalse(self.out.exists())

    def test_wrong_remote_identity_refuses_before_writing(self):
        with self.assertRaises(manifest.HistoryPreparationError):
            manifest.create_manifest(self.repo, self.out, expected_repository="someone/else")
        self.assertFalse(self.out.exists())

    def test_still_shallow_history_refuses_before_writing(self):
        shallow = pathlib.Path(self.tmp.name) / "still-shallow"
        subprocess.run(["git", "clone", "--quiet", "--depth", "1", f"file://{self.repo}", str(shallow)],
                       capture_output=True, check=True)

        def run(repo, *args, text=True):
            if args and args[0] == "fetch":
                return ""
            return manifest._git(repo, *args, text=text)
        with self.assertRaises(manifest.HistoryPreparationError):
            manifest.create_manifest(shallow, self.out, expected_repository=str(self.repo), run=run)
        self.assertFalse(self.out.exists())

    def test_missing_verified_count_refuses_before_writing(self):
        def run(repo, *args, text=True):
            if args[:2] == ("rev-list", "--count"):
                return ""
            return manifest._git(repo, *args, text=text)
        with self.assertRaises(manifest.HistoryPreparationError):
            manifest.create_manifest(self.repo, self.out, expected_repository=self.identity, run=run)
        self.assertFalse(self.out.exists())

    def test_count_mismatch_refuses_before_writing(self):
        def run(repo, *args, text=True):
            if args[:2] == ("rev-list", "--count"):
                return "999"
            return manifest._git(repo, *args, text=text)
        with self.assertRaises(manifest.HistoryPreparationError):
            manifest.create_manifest(self.repo, self.out, expected_repository=self.identity, run=run)
        self.assertFalse(self.out.exists())

    def test_old_shallow_checkout_cannot_be_relabeled_as_certified(self):
        old_remote = pathlib.Path(self.tmp.name) / "old-remote.git"
        subprocess.run(["git", "clone", "--quiet", "--bare", "--depth", "1", f"file://{self.repo}", str(old_remote)],
                       capture_output=True, check=True)
        old = pathlib.Path(self.tmp.name) / "old-shallow"
        subprocess.run(["git", "clone", "--quiet", "--depth", "1", f"file://{old_remote}", str(old)],
                       capture_output=True, check=True)
        self.assertEqual(git(old, "rev-parse", "--is-shallow-repository"), "true")
        with self.assertRaises(manifest.HistoryPreparationError):
            manifest.create_manifest(old, self.out, expected_repository=str(old_remote))
        self.assertFalse(self.out.exists())


if __name__ == "__main__":
    unittest.main()
