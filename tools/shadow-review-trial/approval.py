"""Local Cody paid-spend authorization for the shadow review trial runner.

The record is an auditable operator acknowledgement, not a server-authenticated
chat quotation. This module only reads and validates it; it never creates one.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import math
import pathlib
import re
from typing import Any

SCHEMA_VERSION = 1
RUN_ID = re.compile(r"[A-Za-z0-9_-]{1,32}")
SHA256_HEX = re.compile(r"[0-9a-f]{64}")


class ApprovalError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def preflight_digest(summary: dict[str, Any]) -> str:
    """Return the sha256 of the canonical dry-run summary the operator approved."""
    return hashlib.sha256(_canonical(summary)).hexdigest()


def _text(record: dict[str, Any], key: str) -> str:
    value = record.get(key)
    if not isinstance(value, str) or not value:
        raise ApprovalError(f"approval {key} must be a non-empty string")
    return value


def _expires_epoch(value: Any) -> float:
    if isinstance(value, bool):
        raise ApprovalError("approval expires_at must be an ISO 8601 UTC timestamp or epoch seconds")
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ApprovalError("approval expires_at must be finite")
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.datetime.fromisoformat(text)
        except ValueError as exc:
            raise ApprovalError("approval expires_at must be an ISO 8601 UTC timestamp") from exc
        if parsed.tzinfo is None:
            raise ApprovalError("approval expires_at must include a UTC offset")
        return parsed.timestamp()
    raise ApprovalError("approval expires_at must be an ISO 8601 UTC timestamp or epoch seconds")


def load(path: pathlib.Path, *, now: float) -> dict[str, Any]:
    """Read and validate an approval record. Missing, malformed or expired input raises."""
    path = pathlib.Path(path)
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ApprovalError(f"cannot read approval record: {path}") from exc
    try:
        record = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApprovalError(f"approval record is not valid JSON: {path}") from exc
    if not isinstance(record, dict):
        raise ApprovalError("approval record must be a JSON object")
    if record.get("schema_version") != SCHEMA_VERSION:
        raise ApprovalError(f"approval schema_version must be {SCHEMA_VERSION}")
    _text(record, "approval_reference")
    _text(record, "tenant_id")
    _text(record, "endpoint")
    if not SHA256_HEX.fullmatch(_text(record, "manifest_sha256")):
        raise ApprovalError("approval manifest_sha256 must be a lowercase sha256 hex digest")
    if not RUN_ID.fullmatch(_text(record, "run_id")):
        raise ApprovalError("approval run_id must be 1-32 characters from [A-Za-z0-9_-]")
    if not SHA256_HEX.fullmatch(_text(record, "preflight_sha256")):
        raise ApprovalError("approval preflight_sha256 must be a lowercase sha256 hex digest")
    amount = record.get("authorized_max_usd")
    if (isinstance(amount, bool) or not isinstance(amount, (int, float))
            or not math.isfinite(amount) or amount < 0):
        raise ApprovalError("approval authorized_max_usd must be a finite non-negative number")
    if isinstance(now, bool) or not isinstance(now, (int, float)) or not math.isfinite(now):
        raise ApprovalError("an injected clock value is required to validate approval expiry")
    expires = _expires_epoch(record.get("expires_at"))
    if float(now) >= expires:
        raise ApprovalError("approval record has expired")
    validated = dict(record)
    validated["_expires_epoch"] = expires
    return validated


def check_binding(record: dict[str, Any], *, endpoint: str, tenant_id: str,
                  manifest_sha256: str, run_id: str) -> None:
    """The record must name this exact endpoint, tenant, frozen manifest and run."""
    if record["endpoint"] != endpoint:
        raise ApprovalError("approval endpoint does not match the runner endpoint")
    if record["tenant_id"] != tenant_id:
        raise ApprovalError("approval tenant_id does not match the dedicated tenant")
    if record["manifest_sha256"] != manifest_sha256:
        raise ApprovalError("approval manifest_sha256 does not match the frozen manifest")
    if record["run_id"] != run_id:
        raise ApprovalError("approval run_id does not match the trial run")


def check_preflight(record: dict[str, Any], summary: dict[str, Any]) -> None:
    if record["preflight_sha256"] != preflight_digest(summary):
        raise ApprovalError("approval preflight_sha256 does not match the dry-run summary")


def check_ceiling(record: dict[str, Any], required_usd: float) -> None:
    if isinstance(required_usd, bool) or not isinstance(required_usd, (int, float)) \
            or not math.isfinite(required_usd) or required_usd < 0:
        raise ApprovalError("approval required exposure must be a finite non-negative number")
    if required_usd > record["authorized_max_usd"]:
        raise ApprovalError(
            f"approval ceiling {record['authorized_max_usd']} is below required exposure {required_usd}")
