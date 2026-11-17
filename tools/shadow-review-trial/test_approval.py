"""Fixture-only contracts for the local Cody paid-spend approval record."""
import importlib
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
approval = importlib.import_module("approval")

SUMMARY = {
    "manifest_hash": "a" * 64,
    "run_id": "run-1",
    "tenant_id": "tenant-trial",
    "estimates": [{"case_id": "case-000", "effort": "high", "estimated_usd": 0.25,
                   "retry_inclusive_usd": 0.5, "status": "dry_run"}],
    "retry_exposure_per_review": 2,
    "projected_usd": 0.5,
    "cap_usd": 10.0,
    "refused_over_cap": False,
    "readiness": {"ready": True, "refused_over_cap": False, "blocked_efforts": []},
}


class ApprovalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)

    def record(self, **overrides):
        base = {
            "schema_version": 1,
            "approval_reference": "cody-fixture-approval",
            "tenant_id": "tenant-trial",
            "endpoint": "http://fixture.invalid",
            "manifest_sha256": "a" * 64,
            "run_id": "run-1",
            "preflight_sha256": approval.preflight_digest(SUMMARY),
            "authorized_max_usd": 2.5,
            "expires_at": "2999-01-01T00:00:00+00:00",
        }
        base.update(overrides)
        return base

    def write(self, record, name="approval.json"):
        path = self.root / name
        path.write_text(json.dumps(record), encoding="utf-8")
        return path

    def test_valid_record_loads_and_binds(self):
        loaded = approval.load(self.write(self.record()), now=100.0)
        self.assertEqual(loaded["approval_reference"], "cody-fixture-approval")
        self.assertEqual(loaded["authorized_max_usd"], 2.5)
        approval.check_binding(loaded, endpoint="http://fixture.invalid", tenant_id="tenant-trial",
                               manifest_sha256="a" * 64, run_id="run-1")
        approval.check_preflight(loaded, SUMMARY)
        approval.check_ceiling(loaded, 2.5)

    def test_preflight_digest_is_canonical_and_stable(self):
        reordered = dict(reversed(list(SUMMARY.items())))
        self.assertEqual(approval.preflight_digest(SUMMARY), approval.preflight_digest(reordered))
        self.assertRegex(approval.preflight_digest(SUMMARY), r"^[0-9a-f]{64}$")

    def test_missing_malformed_and_non_object_records_raise(self):
        with self.assertRaisesRegex(approval.ApprovalError, "cannot read approval"):
            approval.load(self.root / "missing.json", now=100.0)
        path = self.root / "bad.json"
        path.write_text("{", encoding="utf-8")
        with self.assertRaisesRegex(approval.ApprovalError, "not valid JSON"):
            approval.load(path, now=100.0)
        path.write_text("[]", encoding="utf-8")
        with self.assertRaisesRegex(approval.ApprovalError, "JSON object"):
            approval.load(path, now=100.0)

    def test_schema_and_required_field_validation(self):
        cases = [
            ({"schema_version": 2}, "schema_version"),
            ({"approval_reference": ""}, "approval_reference"),
            ({"tenant_id": 5}, "tenant_id"),
            ({"endpoint": ""}, "endpoint"),
            ({"manifest_sha256": "xyz"}, "manifest_sha256"),
            ({"run_id": "bad run"}, "run_id"),
            ({"preflight_sha256": "xyz"}, "preflight_sha256"),
            ({"authorized_max_usd": -1}, "authorized_max_usd"),
            ({"authorized_max_usd": float("inf")}, "authorized_max_usd"),
            ({"authorized_max_usd": True}, "authorized_max_usd"),
            ({"expires_at": "not-a-time"}, "expires_at"),
            ({"expires_at": "2999-01-01T00:00:00"}, "offset"),
        ]
        for index, (overrides, message) in enumerate(cases):
            with self.subTest(overrides=overrides):
                path = self.write(self.record(**overrides), name=f"case-{index}.json")
                with self.assertRaisesRegex(approval.ApprovalError, message):
                    approval.load(path, now=100.0)

    def test_expired_records_are_refused_with_the_injected_clock(self):
        for index, expires in enumerate(("1970-01-01T00:00:01Z", 100.0, 99.5)):
            with self.subTest(expires=expires):
                path = self.write(self.record(expires_at=expires), name=f"expired-{index}.json")
                with self.assertRaisesRegex(approval.ApprovalError, "expired"):
                    approval.load(path, now=100.0)

    def test_identity_preflight_and_ceiling_mismatches_are_refused(self):
        loaded = approval.load(self.write(self.record()), now=100.0)
        binding = {"endpoint": "http://fixture.invalid", "tenant_id": "tenant-trial",
                   "manifest_sha256": "a" * 64, "run_id": "run-1"}
        mismatches = [
            ({"endpoint": "http://other.invalid"}, "endpoint"),
            ({"endpoint": "http://fixture.invalid/"}, "endpoint"),
            ({"tenant_id": "other-tenant"}, "tenant_id"),
            ({"manifest_sha256": "b" * 64}, "manifest_sha256"),
            ({"run_id": "run-2"}, "run_id"),
        ]
        for overrides, message in mismatches:
            with self.subTest(overrides=overrides):
                with self.assertRaisesRegex(approval.ApprovalError, message):
                    approval.check_binding(loaded, **{**binding, **overrides})
        with self.assertRaisesRegex(approval.ApprovalError, "preflight_sha256"):
            approval.check_preflight(loaded, {**SUMMARY, "projected_usd": 99.0})
        with self.assertRaisesRegex(approval.ApprovalError, "below required"):
            approval.check_ceiling(loaded, 3.0)


if __name__ == "__main__":
    unittest.main()
