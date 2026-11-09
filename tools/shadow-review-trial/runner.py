"""Fixture-friendly driver for frozen historical review trials."""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

EFFORTS = ("high", "xhigh", "max")
RETRY_EXPOSURE = 2  # Phase 4 reserves one bounded retry per started review.
VALID_COMPLETION = {"ok", "ok_partial"}


class RunnerError(RuntimeError):
    pass


class ProjectionOverCap(RunnerError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _manifest(path: pathlib.Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    claimed = data.get("manifest_sha256")
    body = {k: v for k, v in data.items() if k != "manifest_sha256"}
    if not isinstance(claimed, str) or _sha(_canonical(body)) != claimed:
        raise RunnerError("manifest hash mismatch")
    if not isinstance(data.get("cases"), list) or not isinstance(data.get("run_order"), list):
        raise RunnerError("manifest has no frozen cases or run order")
    if data.get("settings", {}).get("efforts") != list(EFFORTS):
        raise RunnerError("manifest effort set must be high, xhigh, max")
    return data


def _case_map(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result = {}
    for case in manifest["cases"]:
        cid = case.get("case_id")
        if not isinstance(cid, str) or not cid or cid in result or not case.get("eligible"):
            raise RunnerError("manifest case identity or eligibility is invalid")
        result[cid] = case
    if len(manifest["run_order"]) != len(set(manifest["run_order"])) or set(manifest["run_order"]) != set(result):
        raise RunnerError("manifest run order does not match the frozen case set")
    return result


def build_request(manifest: dict[str, Any], case: dict[str, Any], effort: str, dry_run: bool) -> dict[str, Any]:
    if effort not in EFFORTS:
        raise RunnerError(f"unsupported effort: {effort}")
    if not case.get("eligible") or not isinstance(case.get("case_id"), str):
        raise RunnerError("case identity is missing or ineligible")
    cap = case.get("capture")
    required_capture = {"repo_id", "mode", "view", "base", "head", "diff", "diff_sha256", "complete"}
    if not isinstance(cap, dict) or not required_capture.issubset(cap):
        raise RunnerError(f"case {case['case_id']} has no complete frozen capture")
    if cap["mode"] != "range" or cap["base"] != case.get("base_sha") or cap["head"] != case.get("head_sha"):
        raise RunnerError(f"case {case['case_id']} capture differs from its frozen range")
    criteria = case.get("criteria")
    if (not isinstance(criteria, dict) or criteria.get("source") not in {"head_blob", "explicit_text", "pinned"}
            or not isinstance(criteria.get("text"), str) or not criteria["text"]
            or not criteria.get("content_hash")):
        raise RunnerError(f"case {case['case_id']} has no frozen criteria text and hash")
    model_evidence = case.get("build_models", {})
    models = model_evidence.get("models", []) if isinstance(model_evidence, dict) else []
    if models:
        build_models = [{"id": model} for model in models if isinstance(model, str) and model]
        if len(build_models) != len(models):
            raise RunnerError(f"case {case['case_id']} has invalid build-model evidence")
    elif isinstance(model_evidence, dict) and model_evidence.get("source") == "unknown":
        # The API requires a non-empty field; this sentinel preserves the manifest's explicit unknown.
        build_models = [{"id": "unknown"}]
    else:
        raise RunnerError(f"case {case['case_id']} has no build-model evidence")
    # Keep only the REST Capture fields. Values are copied byte-for-byte from the frozen manifest.
    capture_fields = required_capture | {"merge_base", "merge_base_sha", "files", "manifest"}
    capture = {k: v for k, v in cap.items() if k in capture_fields}
    request: dict[str, Any] = {
        "capture": capture,
        "kind": "adhoc",
        "criteria_text": [criteria["text"]],
        "allow_superseded": True,
        "build_models": build_models,
        "dry_run": dry_run,
        "trial": {"manifest_hash": manifest["manifest_sha256"], "case_id": case["case_id"], "effort": effort},
    }
    return request


class HTTPTransport:
    """stdlib transport; tests can inject an object with request(method,url,headers,body,timeout)."""

    def request(self, method: str, url: str, headers: dict[str, str], body: bytes | None,
                timeout: float) -> tuple[int, bytes]:
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()


class TrialRunner:
    def __init__(self, base_url: str, auth_provider: Callable[[], str], transport: Any | None = None,
                 timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.auth_provider = auth_provider
        self.transport = transport or HTTPTransport()
        self.timeout = timeout

    def _request(self, method: str, path: str, body: Any | None = None) -> Any:
        token = self.auth_provider()
        if not isinstance(token, str) or not token:
            raise RunnerError("auth provider did not supply a fixture or operator token")
        headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
        payload = None
        if body is not None:
            payload = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        status, raw = self.transport.request(method, self.base_url + path, headers, payload, self.timeout)
        if status < 200 or status >= 300:
            raise RunnerError(f"REST {method} {path} returned HTTP {status}")
        try:
            return json.loads(raw)
        except (TypeError, json.JSONDecodeError) as exc:
            raise RunnerError(f"REST {method} {path} returned invalid JSON") from exc

    def post_review(self, request: dict[str, Any]) -> dict[str, Any]:
        result = self._request("POST", "/v1/reviews", request)
        if not isinstance(result, dict) or not isinstance(result.get("status"), str):
            raise RunnerError("review receipt has no status")
        return result

    def get_reviews(self, manifest_hash: str) -> list[dict[str, Any]]:
        query = urllib.parse.urlencode({"profile": "historical_trial", "manifest_hash": manifest_hash, "limit": 500})
        result = self._request("GET", "/v1/reviews?" + query)
        rows = result.get("reviews") if isinstance(result, dict) else None
        if not isinstance(rows, list):
            raise RunnerError("review read has no reviews array")
        return [r for r in rows if isinstance(r, dict)]


def _load_ledger(path: pathlib.Path, manifest_hash: str) -> dict[str, Any]:
    if not path.exists():
        return {"schema_version": 1, "manifest_hash": manifest_hash, "entries": {}}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema_version") != 1 or data.get("manifest_hash") != manifest_hash or not isinstance(data.get("entries"), dict):
        raise RunnerError("ledger is not bound to this manifest")
    return data


def _save_ledger(path: pathlib.Path, ledger: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(ledger, handle, sort_keys=True, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def _entry_key(case_id: str, effort: str, request: dict[str, Any]) -> str:
    return _sha(_canonical({"case_id": case_id, "effort": effort, "request": request}))


def _record_matches(row: dict[str, Any], manifest_hash: str, case_id: str, effort: str,
                    reviewer_model: str) -> bool:
    return (row.get("manifest_hash") == manifest_hash and row.get("case_id") == case_id
            and row.get("effective_effort") == effort and row.get("returned_model") == reviewer_model
            and row.get("status") in VALID_COMPLETION)


def _completion(records: list[dict[str, Any]], manifest_hash: str, case_id: str, effort: str,
                reviewer_model: str) -> dict[str, Any] | None:
    return next((r for r in records if _record_matches(r, manifest_hash, case_id, effort, reviewer_model)), None)


def run(manifest_path: pathlib.Path, ledger_path: pathlib.Path, runner: TrialRunner,
        cap_usd: float, reviewer_model: str, *, execute: bool = False,
        config_id: str = "default") -> dict[str, Any]:
    """Preflight all arms; optionally run valid, under-cap requests and persist each transition."""
    if cap_usd < 0 or not reviewer_model:
        raise RunnerError("a non-negative cap and reviewer model id are required")
    manifest = _manifest(pathlib.Path(manifest_path))
    cases = _case_map(manifest)
    ledger_path = pathlib.Path(ledger_path)
    ledger = _load_ledger(ledger_path, manifest["manifest_sha256"])
    cfg = _sha(_canonical({"reviewer_model": reviewer_model, "cap_usd": cap_usd, "config_id": config_id}))
    estimate_rows = []
    projection = 0.0
    for case_id in manifest["run_order"]:
        case = cases[case_id]
        for effort in EFFORTS:
            req = build_request(manifest, case, effort, True)
            key = _entry_key(case_id, effort, {**req, "dry_run": False})
            entry = ledger["entries"].setdefault(key, {"case_id": case_id, "effort": effort,
                "request_identity": key, "attempts": [], "state": "new"})
            entry["preflight_config"] = cfg
            # Changed budget/config invalidates only zero-call outcomes; started work is immutable.
            if entry.get("preflight_status") is None or entry.get("preflight_config_seen") != cfg:
                receipt = runner.post_review(req)
                entry.setdefault("attempts", []).append({"kind": "dry_run", "at": time.time(), "receipt": receipt})
                entry["preflight_status"] = receipt["status"]
                entry["preflight_receipt"] = receipt
                entry["preflight_config_seen"] = cfg
                if receipt["status"] in {"unavailable", "skipped_budget"}:
                    entry["state"] = "preflight_blocked"
            estimate = float(entry.get("preflight_receipt", {}).get("estimated_usd", 0) or 0)
            retry_total = estimate * RETRY_EXPOSURE
            projection += retry_total
            estimate_rows.append({"case_id": case_id, "effort": effort, "estimated_usd": estimate,
                                  "retry_inclusive_usd": retry_total, "status": entry.get("preflight_status")})
    _save_ledger(ledger_path, ledger)
    summary = {"manifest_hash": manifest["manifest_sha256"], "estimates": estimate_rows,
               "retry_exposure_per_review": RETRY_EXPOSURE, "projected_usd": projection,
               "cap_usd": cap_usd, "refused_over_cap": projection > cap_usd}
    if projection > cap_usd:
        return summary
    if not execute:
        return summary

    # Reconcile existing server records first, including canonical references for duplicate receipts.
    records = runner.get_reviews(manifest["manifest_sha256"])
    for case_id in manifest["run_order"]:
        for effort in EFFORTS:
            req = build_request(manifest, cases[case_id], effort, False)
            key = _entry_key(case_id, effort, req)
            entry = ledger["entries"][key]
            matched = _completion(records, manifest["manifest_sha256"], case_id, effort, reviewer_model)
            if matched:
                entry["state"] = "complete"
                entry["canonical_review_id"] = matched.get("id")
                continue
            if entry.get("state") in {"started", "started_unknown", "complete"}:
                entry["state"] = "started_unknown" if entry.get("state") != "complete" else "complete_mismatch"
                continue
            if entry.get("preflight_status") in {"unavailable", "skipped_budget"}:
                # These statuses are zero-provider-call outcomes; configuration changes can resume them.
                if entry.get("preflight_config_seen") == cfg:
                    continue
            entry["state"] = "started"
            entry["started_at"] = time.time()
            _save_ledger(ledger_path, ledger)  # claim before network I/O: interruption must not replay it.
            try:
                receipt = runner.post_review(req)
            except Exception as exc:
                entry.setdefault("attempts", []).append({"kind": "run", "at": time.time(),
                    "transport_error": type(exc).__name__})
                entry["state"] = "started_unknown"
                _save_ledger(ledger_path, ledger)
                continue
            entry.setdefault("attempts", []).append({"kind": "run", "at": time.time(), "receipt": receipt})
            entry["last_status"] = receipt["status"]
            if receipt["status"] in {"unavailable", "skipped_budget"}:
                entry["state"] = "preflight_blocked"
                entry["preflight_config_seen"] = cfg
            elif receipt["status"] == "skipped_duplicate":
                entry["duplicate_receipt"] = receipt
                canonical_id = receipt.get("reason")
                canonical = next((r for r in records if r.get("id") == canonical_id), None)
                if canonical is None:
                    records = runner.get_reviews(manifest["manifest_sha256"])
                    canonical = next((r for r in records if r.get("id") == canonical_id), None)
                entry["canonical_review_id"] = canonical_id
                entry["duplicate_resolved"] = bool(canonical)
                entry["state"] = "complete" if canonical and _record_matches(canonical, manifest["manifest_sha256"], case_id, effort, reviewer_model) else "duplicate_unresolved"
            else:
                entry["state"] = "awaiting_record" if receipt["status"] in VALID_COMPLETION else "finished_incomplete"
            _save_ledger(ledger_path, ledger)
            records = runner.get_reviews(manifest["manifest_sha256"])

    # Final reconciliation is authoritative; status receipts alone never fill an arm.
    records = runner.get_reviews(manifest["manifest_sha256"])
    arm = {}
    completed = {}
    for effort in EFFORTS:
        ids = [cid for cid in manifest["run_order"] if _completion(records, manifest["manifest_sha256"], cid, effort, reviewer_model)]
        completed[effort] = set(ids)
        target = int(manifest.get("target_per_effort", 50))
        arm[effort] = {"eligible": len(cases), "completed": len(ids), "shortfall": max(0, target - len(ids))}
        for cid in manifest["run_order"]:
            req = build_request(manifest, cases[cid], effort, False)
            entry = ledger["entries"][_entry_key(cid, effort, req)]
            matched = _completion(records, manifest["manifest_sha256"], cid, effort, reviewer_model)
            if matched:
                entry["state"] = "complete"
                entry["canonical_review_id"] = matched.get("id")
            elif entry.get("state") in {"awaiting_record", "complete", "complete_mismatch"}:
                identity_records = [r for r in records if r.get("manifest_hash") == manifest["manifest_sha256"]
                                    and r.get("case_id") == cid and r.get("effective_effort") == effort]
                entry["state"] = "model_mismatch" if any(r.get("returned_model") != reviewer_model for r in identity_records) else "record_missing"
    paired = set.intersection(*completed.values()) if completed else set()
    _save_ledger(ledger_path, ledger)
    summary.update({"arms": arm, "paired_completed": len(paired), "paired_case_ids": sorted(paired),
                    "records_seen": len(records), "ledger": str(ledger_path)})
    return summary
