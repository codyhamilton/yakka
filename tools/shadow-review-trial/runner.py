"""Fixture-friendly driver for frozen historical review trials."""
from __future__ import annotations

import hashlib
import json
import math
import os
import pathlib
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

import approval

EFFORTS = ("high", "xhigh", "max")
RETRY_EXPOSURE = 2  # Phase 4 reserves one bounded retry per started review.
VALID_COMPLETION = {"ok", "ok_partial"}
RUN_ID = re.compile(r"[A-Za-z0-9_-]{1,32}")
TAG = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/=-]{0,95}")
MAX_TAGS = 16
EVIDENCE_PAGE_SIZE = 500
EVIDENCE_MAX_PAGES = 10000
EVIDENCE_MAX_ROWS = 1000000


class RunnerError(RuntimeError):
    pass


class ProjectionOverCap(RunnerError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _case_tag(case_id: str) -> str:
    return "case:" + _sha(case_id.encode("utf-8"))


def _canonical_tags(run_id: str, effort: str, manifest_hash: str, case_id: str) -> list[str]:
    if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
        raise RunnerError("run id must be 1-32 characters from [A-Za-z0-9_-]")
    return ["trial:" + run_id, "effort:" + effort, "manifest:" + manifest_hash, _case_tag(case_id)]


def _validate_tag(tag: Any) -> None:
    if not isinstance(tag, str) or not tag.isascii() or not TAG.fullmatch(tag):
        raise RunnerError(f"tag is not 1-96 ASCII bytes from the allowed set: {tag!r}")


def _merge_tags(canonical: list[str], supplied: Any) -> list[str]:
    if supplied is None:
        supplied = []
    if not isinstance(supplied, list) or not all(isinstance(tag, str) for tag in supplied):
        raise RunnerError("tags must be an array of strings")
    expected = {tag.split(":", 1)[0]: tag for tag in canonical}
    for tag in supplied:
        _validate_tag(tag)
        prefix = tag.partition(":")[0]
        if prefix in expected and tag != expected[prefix]:
            raise RunnerError(f"supplied {prefix} tag disagrees with the request: {tag!r}")
    merged = sorted(dict.fromkeys(list(supplied) + list(canonical)))
    if len(merged) > MAX_TAGS:
        raise RunnerError(f"more than {MAX_TAGS} tags")
    for tag in merged:
        _validate_tag(tag)
    return merged


def _certified_history(data: dict[str, Any]) -> None:
    history = data.get("history")
    if not isinstance(history, dict):
        raise RunnerError("manifest has no certified full-history evidence")
    if history.get("shallow") is not False or history.get("object_complete") is not True:
        raise RunnerError("manifest history is not certified complete")
    if not history.get("repository") or not history.get("tip_sha"):
        raise RunnerError("manifest history has no verified repository or tip")
    verified = history.get("verified_count")
    enumerated = history.get("enumerated_commits")
    if (not isinstance(verified, int) or isinstance(verified, bool) or verified < 0
            or not isinstance(enumerated, int) or isinstance(enumerated, bool) or enumerated != verified):
        raise RunnerError("manifest history commit counts are not certified")


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
    _certified_history(data)
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


def build_request(manifest: dict[str, Any], case: dict[str, Any], effort: str, dry_run: bool,
                  run_id: str, tags: Any = None) -> dict[str, Any]:
    if effort not in EFFORTS:
        raise RunnerError(f"unsupported effort: {effort}")
    if not case.get("eligible") or not isinstance(case.get("case_id"), str):
        raise RunnerError("case identity is missing or ineligible")
    cap = case.get("capture")
    required_capture = {"repo_id", "mode", "view", "base", "head", "diff", "diff_sha256", "complete"}
    if not isinstance(cap, dict) or not required_capture.issubset(cap):
        raise RunnerError(f"case {case['case_id']} has no complete frozen capture")
    range_head = cap.get("resolved_head", cap["head"])
    if cap["mode"] != "range" or cap["base"] != case.get("base_sha") or range_head != case.get("head_sha"):
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
    # `head` in a Phase 6 capture is checkout state; REST `head` identifies
    # the selected range tip. Preserve the frozen manifest and canonicalize
    # only the outbound request field.
    capture["head"] = case["head_sha"]
    request: dict[str, Any] = {
        "capture": capture,
        "kind": "adhoc",
        "criteria_text": [criteria["text"]],
        "allow_superseded": True,
        "build_models": build_models,
        "dry_run": dry_run,
        "effort": effort,
        "tags": _merge_tags(_canonical_tags(run_id, effort, manifest["manifest_sha256"], case["case_id"]), tags),
        "store": True,
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

    def whoami(self) -> dict[str, Any]:
        result = self._request("GET", "/v1/whoami")
        if not isinstance(result, dict) or not isinstance(result.get("tenant"), str):
            raise RunnerError("whoami returned no tenant identity")
        return result

    def verify_identity(self, expected_tenant: str) -> dict[str, Any]:
        identity = self.whoami()
        if identity.get("tenant") != expected_tenant or identity.get("scope") != "read_write":
            raise RunnerError(
                f"key identity {identity.get('tenant')!r}/{identity.get('scope')!r} is not the dedicated "
                f"tenant {expected_tenant!r} with read_write scope")
        return identity

    def post_review(self, request: dict[str, Any]) -> dict[str, Any]:
        result = self._request("POST", "/v1/reviews", request)
        if not isinstance(result, dict) or not isinstance(result.get("status"), str):
            raise RunnerError("review receipt has no status")
        return result

    @staticmethod
    def _review_page(result: Any) -> tuple[list[dict[str, Any]], str | None, bool]:
        """Validate one cursor page's protocol fields before any row is trusted."""
        if not isinstance(result, dict):
            raise RunnerError("review read page is not an object")
        rows = result.get("reviews")
        if not isinstance(rows, list):
            raise RunnerError("review read page has no reviews array")
        for row in rows:
            if not isinstance(row, dict):
                raise RunnerError("review read page has a malformed review row")
            # Stored rows keep the receipt id in review_id. keys.Canonical strips the
            # reserved top-level id, so a real server page may not have "id" at all.
            identity = row.get("id")
            if not isinstance(identity, str) or not identity:
                identity = row.get("review_id")
                if isinstance(identity, str) and identity:
                    row["id"] = identity
                else:
                    raise RunnerError("review read page row has no identity")
        cursor = result.get("next_cursor")
        if cursor is not None and not isinstance(cursor, str):
            raise RunnerError("review read page cursor is not a string or null")
        complete = result.get("complete")
        if not isinstance(complete, bool):
            raise RunnerError("review read page has no boolean complete field")
        if complete and cursor is not None:
            raise RunnerError("complete review page still carries a cursor")
        if not complete and cursor is None:
            raise RunnerError("nonterminal review page has no advancing cursor")
        return rows, cursor, complete

    def get_reviews(self, manifest_hash: str, run_id: str, tenant_id: str | None = None,
                    *, limit: int = EVIDENCE_PAGE_SIZE) -> dict[str, Any]:
        """Follow full-detail cursor pages to exhaustion and return saved-export evidence."""
        if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1 or limit > 500:
            raise RunnerError("review page size must be between 1 and 500")
        tags = sorted(["manifest:" + manifest_hash, "trial:" + run_id])
        rows: list[dict[str, Any]] = []
        pages: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        seen_cursors: set[str] = set()
        cursor: str | None = None
        while True:
            if len(pages) >= EVIDENCE_MAX_PAGES:
                raise RunnerError("review read exceeded the evidence page safety ceiling")
            query: list[tuple[str, str]] = [("tag", tag) for tag in tags]
            query += [("detail", "full"), ("limit", str(limit))]
            if cursor is not None:
                query.append(("cursor", cursor))
            result = self._request("GET", "/v1/reviews?" + urllib.parse.urlencode(query))
            page_rows, next_cursor, complete = self._review_page(result)
            for row in page_rows:
                identity = row["id"]
                if identity in seen_ids:
                    raise RunnerError(f"duplicate review identity across pages: {identity}")
                seen_ids.add(identity)
            rows.extend(page_rows)
            pages.append({"cursor_in": cursor, "cursor_out": next_cursor, "complete": complete,
                          "row_count": len(page_rows),
                          "row_ids_sha256": _sha(_canonical([row["id"] for row in page_rows]))})
            if len(rows) > EVIDENCE_MAX_ROWS:
                raise RunnerError("review read exceeded the evidence row safety ceiling")
            if complete:
                break
            if next_cursor is None or next_cursor == cursor or next_cursor in seen_cursors:
                raise RunnerError("review read cursor did not advance (cycle or missing cursor)")
            seen_cursors.add(next_cursor)
            cursor = next_cursor
        return {"schema_version": 1, "manifest_sha256": manifest_hash, "run_id": run_id,
                "tenant_id": tenant_id, "filters": {"tags": tags}, "detail": "full", "limit": limit,
                "pages": pages, "complete": True, "reviews": rows}


def _load_ledger(path: pathlib.Path, manifest_hash: str, run_id: str, tenant_id: str) -> dict[str, Any]:
    if not path.exists():
        return {"schema_version": 1, "manifest_hash": manifest_hash, "run_id": run_id,
                "tenant_id": tenant_id, "entries": {}}
    data = json.loads(path.read_text(encoding="utf-8"))
    if (data.get("schema_version") != 1 or data.get("manifest_hash") != manifest_hash
            or data.get("run_id") != run_id or data.get("tenant_id") != tenant_id
            or not isinstance(data.get("entries"), dict)):
        raise RunnerError("ledger is not bound to this manifest, run id and tenant")
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


def _row_has_identity(row: dict[str, Any], tags: frozenset[str]) -> bool:
    row_tags = row.get("tags")
    return isinstance(row_tags, list) and tags.issubset(set(row_tags))


def _record_matches(row: dict[str, Any], tags: frozenset[str], effort: str, reviewer_model: str) -> bool:
    return (_row_has_identity(row, tags) and row.get("effective_effort") == effort
            and row.get("returned_model") == reviewer_model and row.get("status") in VALID_COMPLETION)


def _completion(records: list[dict[str, Any]], tags: frozenset[str], effort: str,
                reviewer_model: str) -> dict[str, Any] | None:
    return next((r for r in records if _record_matches(r, tags, effort, reviewer_model)), None)


def _duplicate_body(receipt: dict[str, Any]) -> dict[str, Any] | None:
    original_id = receipt.get("original_review_id") or receipt.get("reason")
    if not isinstance(original_id, str) or not original_id:
        return None
    return {"id": original_id, "status": receipt.get("original_status"), "result": receipt.get("result"),
            "coverage": receipt.get("coverage"), "finding_counts": receipt.get("finding_counts"),
            "returned_model": receipt.get("model"), "effective_effort": receipt.get("effort"),
            "tags": receipt.get("tags"), "attempts": receipt.get("attempts")}


def _receipt_cost(receipt: Any) -> float:
    """Sum recorded attempt charges, never inventing a price for a missing cost."""
    if not isinstance(receipt, dict):
        return 0.0
    total = 0.0
    attempts = receipt.get("attempts")
    if isinstance(attempts, list) and attempts:
        for attempt in attempts:
            if not isinstance(attempt, dict):
                continue
            value = attempt.get("cost_usd")
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                total += float(value)
    else:
        value = receipt.get("cost_usd")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            total += float(value)
    return total


def _prior_spend(ledger: dict[str, Any]) -> float:
    """Charges already recorded by real run attempts, excluding dry-run estimates."""
    total = 0.0
    for entry in ledger.get("entries", {}).values():
        if not isinstance(entry, dict):
            continue
        for attempt in entry.get("attempts", []):
            if isinstance(attempt, dict) and attempt.get("kind") == "run":
                total += _receipt_cost(attempt.get("receipt"))
    return total


def _unknown_reservations(ledger: dict[str, Any], retry_by_arm: dict[tuple[Any, Any], float]) -> float:
    """Conservatively reserve the retry-inclusive estimate for unfinished claims."""
    total = 0.0
    for entry in ledger.get("entries", {}).values():
        if not isinstance(entry, dict):
            continue
        if entry.get("state") in {"started", "started_unknown"}:
            total += retry_by_arm.get((entry.get("case_id"), entry.get("effort")), 0.0)
    return total


def run(manifest_path: pathlib.Path, ledger_path: pathlib.Path, runner: TrialRunner,
        cap_usd: float, reviewer_model: str, *, run_id: str, tenant_id: str,
        execute: bool = False, config_id: str = "default",
        approval_path: pathlib.Path | None = None,
        clock: Callable[[], float] | None = None) -> dict[str, Any]:
    """Preflight all arms; optionally run valid, under-cap, approved requests."""
    if cap_usd < 0 or not reviewer_model:
        raise RunnerError("a non-negative cap and reviewer model id are required")
    if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
        raise RunnerError("run id must be 1-32 characters from [A-Za-z0-9_-]")
    if not isinstance(tenant_id, str) or not tenant_id:
        raise RunnerError("an expected dedicated tenant id is required")
    manifest = _manifest(pathlib.Path(manifest_path))
    cases = _case_map(manifest)
    manifest_hash = manifest["manifest_sha256"]
    now = (clock or time.time)()
    record = None
    if execute:
        if approval_path is None:
            raise approval.ApprovalError("--execute requires an explicit approval record")
        record = approval.load(approval_path, now=now)
        # Identity/expiry mismatches abort before any request, including resume.
        approval.check_binding(record, endpoint=runner.base_url, tenant_id=tenant_id,
                               manifest_sha256=manifest_hash, run_id=run_id)
    runner.verify_identity(tenant_id)  # refuse a mismatched key before any review POST
    ledger_path = pathlib.Path(ledger_path)
    ledger = _load_ledger(ledger_path, manifest_hash, run_id, tenant_id)
    cfg = _sha(_canonical({"reviewer_model": reviewer_model, "cap_usd": cap_usd, "config_id": config_id}))
    estimate_rows = []
    projection = 0.0
    for case_id in manifest["run_order"]:
        case = cases[case_id]
        for effort in EFFORTS:
            req = build_request(manifest, case, effort, True, run_id)
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
    blocked_efforts = sorted({row["effort"] for row in estimate_rows
                              if row["status"] in {"unavailable", "skipped_budget"}})
    retry_by_arm = {(row["case_id"], row["effort"]): row["retry_inclusive_usd"] for row in estimate_rows}
    summary = {"manifest_hash": manifest_hash, "run_id": run_id, "tenant_id": tenant_id,
               "estimates": estimate_rows, "retry_exposure_per_review": RETRY_EXPOSURE,
               "projected_usd": projection, "cap_usd": cap_usd, "refused_over_cap": projection > cap_usd,
               "readiness": {"ready": projection <= cap_usd and not blocked_efforts,
                             "refused_over_cap": projection > cap_usd,
                             "blocked_efforts": blocked_efforts}}
    if projection > cap_usd:
        return summary
    if not execute:
        return summary

    approval.check_preflight(record, summary)
    required = _prior_spend(ledger) + _unknown_reservations(ledger, retry_by_arm) + projection
    summary["approval_required_usd"] = required
    summary["authorized_max_usd"] = record["authorized_max_usd"]
    approval.check_ceiling(record, required)

    # Reconcile existing server records first; duplicate receipts carry their own canonical body.
    records = runner.get_reviews(manifest_hash, run_id, tenant_id)["reviews"]
    for case_id in manifest["run_order"]:
        for effort in EFFORTS:
            req = build_request(manifest, cases[case_id], effort, False, run_id)
            tags = frozenset(req["tags"])
            key = _entry_key(case_id, effort, req)
            entry = ledger["entries"][key]
            matched = _completion(records, tags, effort, reviewer_model)
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
                canonical = _duplicate_body(receipt)
                entry["canonical_review_id"] = canonical.get("id") if canonical else None
                resolved = canonical is not None and _record_matches(canonical, tags, effort, reviewer_model)
                entry["duplicate_resolved"] = resolved
                entry["state"] = "complete" if resolved else "duplicate_unresolved"
            else:
                entry["state"] = "awaiting_record" if receipt["status"] in VALID_COMPLETION else "finished_incomplete"
                records = runner.get_reviews(manifest_hash, run_id, tenant_id)["reviews"]
            _save_ledger(ledger_path, ledger)

    # Final reconciliation is authoritative; status receipts alone never fill an arm.
    evidence = runner.get_reviews(manifest_hash, run_id, tenant_id)
    records = evidence["reviews"]
    arm = {}
    completed = {}
    for effort in EFFORTS:
        ids = [cid for cid in manifest["run_order"]
               if _completion(records, frozenset(_canonical_tags(run_id, effort, manifest_hash, cid)),
                              effort, reviewer_model)]
        completed[effort] = set(ids)
        target = int(manifest.get("target_per_effort", 50))
        arm[effort] = {"eligible": len(cases), "completed": len(ids), "shortfall": max(0, target - len(ids))}
        for cid in manifest["run_order"]:
            req = build_request(manifest, cases[cid], effort, False, run_id)
            tags = frozenset(req["tags"])
            entry = ledger["entries"][_entry_key(cid, effort, req)]
            matched = _completion(records, tags, effort, reviewer_model)
            if matched:
                entry["state"] = "complete"
                entry["canonical_review_id"] = matched.get("id")
            elif entry.get("state") in {"awaiting_record", "complete", "complete_mismatch"}:
                identity_records = [r for r in records if _row_has_identity(r, tags)
                                    and r.get("effective_effort") == effort]
                entry["state"] = "model_mismatch" if any(r.get("returned_model") != reviewer_model for r in identity_records) else "record_missing"
    paired = set.intersection(*completed.values()) if completed else set()
    _save_ledger(ledger_path, ledger)
    summary.update({"arms": arm, "paired_completed": len(paired), "paired_case_ids": sorted(paired),
                    "records_seen": len(records), "ledger": str(ledger_path)})
    return summary
