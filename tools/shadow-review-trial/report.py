"""Deterministic, offline alignment calculations for the frozen shadow trial.

Input mappings follow manifest.py and GET /v1/reviews?detail=full records.
Adjudications are version 1 JSON: {"version": 1, "low_sample_rate": 0.2,
"findings": [{"case_id": ..., "effort": ..., "finding_id": ...,
"category": ..., "context_tags": [], "evidence_refs": []}]}. Historical
comparator adjudications use the comparator finding id and its stratum/source;
review findings use the review record id plus finding id. Missing required
decisions are retained as unadjudicated.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from typing import Any

import leak_check
import matching

EFFORTS = ("high", "xhigh", "max")
RUN_ID = re.compile(r"[A-Za-z0-9_-]{1,32}")
STATUSES = ("ok", "ok_partial", "timeout", "api_error", "invalid_output", "unavailable",
            "refused_capture", "refused_disclosure", "refused_criteria", "skipped_budget",
            "skipped_busy", "skipped_duplicate")
HISTORICAL = ("matched", "partial", "unmatched")
NEW = ("matched", "partial", "disputed", "new-valid", "unadjudicated")
CORROBORATION = ("valid", "invalid", "unknown")
REVIEW_CATEGORIES = tuple(NEW) + CORROBORATION
CATEGORIES = set(HISTORICAL) | set(NEW) | set(CORROBORATION)
TIER_ORDER = ("phase", "unit", "pr", "unaccompanied")
CORROBORATING_BANDS = ("matched", "partial")
REVIEWER_MODEL = "claude-haiku-5-5"
UNKNOWN_STATES = ("started", "started_unknown")
NO_PROVIDER_CALL_STATUSES = ("unavailable", "skipped_busy", "skipped_budget")
USAGE_FIELDS = ("cost_usd", "cost_known", "input_tokens", "output_tokens", "latency_ms")


def _canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def _case_tag(case_id: str) -> str:
    return "case:" + hashlib.sha256(case_id.encode("utf-8")).hexdigest()


def _mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    return value


def _required_text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _validate_manifest(manifest: dict[str, Any]) -> None:
    _mapping(manifest, "manifest")
    if manifest.get("schema_version") != 1:
        raise ValueError("unsupported manifest schema_version")
    digest = manifest.get("manifest_sha256")
    unhashed = dict(manifest)
    unhashed.pop("manifest_sha256", None)
    if not isinstance(digest, str) or _canonical_hash(unhashed) != digest:
        raise ValueError("manifest_sha256 does not match frozen manifest content")
    history = manifest.get("history")
    if not isinstance(history, dict):
        raise ValueError("manifest has no certified full-history evidence")
    if history.get("shallow") is not False or history.get("object_complete") is not True:
        raise ValueError("manifest history is not certified complete")
    if not history.get("repository") or not history.get("tip_sha"):
        raise ValueError("manifest history has no verified repository or tip")
    verified = history.get("verified_count")
    enumerated = history.get("enumerated_commits")
    if isinstance(verified, bool) or isinstance(enumerated, bool) or not isinstance(verified, int) \
            or not isinstance(enumerated, int) or verified != enumerated:
        raise ValueError("manifest history commit counts are not certified")
    cases = _list(manifest.get("cases"), "manifest.cases")
    case_ids: set[str] = set()
    for raw in cases:
        case = _mapping(raw, "manifest case")
        case_id = _required_text(case.get("case_id"), "case.case_id")
        if case_id in case_ids:
            raise ValueError(f"duplicate manifest case_id: {case_id}")
        case_ids.add(case_id)
        if case.get("eligible") is not True:
            raise ValueError(f"manifest.cases contains ineligible case: {case_id}")
        tier = case.get("tier")
        if tier is not None and tier not in ("phase", "unit", "pr"):
            raise ValueError(f"invalid tier for case {case_id}")
        if case.get("stratum") not in ("phase", "unit", "pr", "unaccompanied"):
            raise ValueError(f"invalid stratum for case {case_id}")
        if tier is not None and case["stratum"] != tier:
            raise ValueError(f"case {case_id} tier and stratum disagree")


def _validate_export(export: dict[str, Any], manifest: dict[str, Any]) -> None:
    """Refuse anything that is not a complete, certified 3-03 saved export."""
    _mapping(export, "review export")
    if export.get("schema_version") != 1:
        raise ValueError("review export is not a certified saved export (missing schema_version 1)")
    manifest_hash = manifest["manifest_sha256"]
    if export.get("manifest_sha256") != manifest_hash:
        raise ValueError("review export manifest_sha256 does not match the frozen manifest")
    run_id = export.get("run_id")
    if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
        raise ValueError("review export run_id is missing or invalid")
    tenant_id = export.get("tenant_id")
    if not isinstance(tenant_id, str) or not tenant_id:
        raise ValueError("review export tenant_id is missing")
    if export.get("detail") != "full":
        raise ValueError("review export detail must be full")
    filters = _mapping(export.get("filters"), "review export filters")
    tags = _list(filters.get("tags"), "review export filters.tags")
    if not all(isinstance(tag, str) and tag for tag in tags):
        raise ValueError("review export filters.tags must be non-empty strings")
    if not {"manifest:" + manifest_hash, "trial:" + run_id}.issubset(set(tags)):
        raise ValueError("review export filters do not carry the frozen trial tags")
    limit = export.get("limit")
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1 or limit > 500:
        raise ValueError("review export limit must be a page size between 1 and 500")
    if export.get("error") or export.get("truncated"):
        raise ValueError("review export reports an error or truncation")
    if export.get("complete") is not True:
        raise ValueError("review export is not complete")
    pages = _list(export.get("pages"), "review export pages")
    if not pages:
        raise ValueError("review export has no page evidence")
    rows = _list(export.get("reviews"), "review export reviews")
    seen_ids: set[str] = set()
    seen_cursors: set[str] = set()
    offset = 0
    previous_cursor = None
    for index, raw in enumerate(pages):
        page = _mapping(raw, f"review export pages[{index}]")
        cursor_in, cursor_out = page.get("cursor_in"), page.get("cursor_out")
        complete, row_count, digest = page.get("complete"), page.get("row_count"), page.get("row_ids_sha256")
        if cursor_in is not None and not isinstance(cursor_in, str):
            raise ValueError("review export page cursor_in is not a string or null")
        if cursor_out is not None and not isinstance(cursor_out, str):
            raise ValueError("review export page cursor_out is not a string or null")
        if not isinstance(complete, bool):
            raise ValueError("review export page is missing completion metadata")
        if isinstance(row_count, bool) or not isinstance(row_count, int) or row_count < 0:
            raise ValueError("review export page row_count is invalid")
        if not isinstance(digest, str) or not digest:
            raise ValueError("review export page row-id digest is missing")
        if page.get("error") or page.get("truncated") or page.get("status") in ("error", "truncated"):
            raise ValueError("review export contains an error or truncated page")
        if index == 0:
            if cursor_in is not None:
                raise ValueError("review export first page has a cursor_in")
        elif cursor_in != previous_cursor:
            raise ValueError("review export page cursors are not continuous")
        if complete:
            if index != len(pages) - 1:
                raise ValueError("review export has a page after the terminal page")
            if cursor_out is not None:
                raise ValueError("terminal review export page still carries a cursor")
        else:
            if index == len(pages) - 1:
                raise ValueError("last review export page is not terminal")
            if not isinstance(cursor_out, str) or not cursor_out:
                raise ValueError("nonterminal review export page has no advancing cursor")
            if cursor_out == cursor_in or cursor_out in seen_cursors:
                raise ValueError("review export cursor does not progress (cycle)")
            seen_cursors.add(cursor_out)
        slice_rows = rows[offset:offset + row_count]
        if len(slice_rows) != row_count:
            raise ValueError("review export page row_count does not match the reviews array")
        ids: list[str] = []
        for row in slice_rows:
            _mapping(row, "review export row")
            identity = row.get("id")
            if not isinstance(identity, str) or not identity:
                raise ValueError("review export has a malformed or unidentified row")
            if identity in seen_ids:
                raise ValueError(f"duplicate review identity in export: {identity}")
            seen_ids.add(identity)
            ids.append(identity)
        if _canonical_hash(ids) != digest:
            raise ValueError("review export page row-id digest does not match its rows")
        offset += row_count
        previous_cursor = cursor_out
    if offset != len(rows):
        raise ValueError("review export page counts do not cover all reviews")
    if pages[-1].get("complete") is not True:
        raise ValueError("review export terminal page is not complete")
    for index, raw in enumerate(rows):
        review = _mapping(raw, f"reviews[{index}]")
        if "attempts" in review and not isinstance(review["attempts"], list):
            raise ValueError(f"reviews[{index}].attempts must be an array")
        for a_index, attempt in enumerate(review.get("attempts", [])):
            attempt = _mapping(attempt, f"reviews[{index}].attempts[{a_index}]")
            _validate_cost(attempt, f"reviews[{index}].attempts[{a_index}]")
            for field in ("latency_ms",):
                if field in attempt and (isinstance(attempt[field], bool) or not isinstance(attempt[field], (int, float))
                                         or not math.isfinite(attempt[field]) or attempt[field] < 0):
                    raise ValueError(f"invalid {field} in reviews[{index}].attempts[{a_index}]")
            for field in ("input_tokens", "output_tokens"):
                if field in attempt and (isinstance(attempt[field], bool) or not isinstance(attempt[field], int) or attempt[field] < 0):
                    raise ValueError(f"invalid {field} in reviews[{index}].attempts[{a_index}]")


def _finite_amount(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError(f"{label} must be a finite non-negative number")
    return float(value)


def _token_count(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


def _validate_cost(scope: dict[str, Any], label: str) -> None:
    """A null cost must say it is unknown; a present amount must be real spend."""
    if "cost_known" in scope and not isinstance(scope["cost_known"], bool):
        raise ValueError(f"{label}.cost_known must be a bool")
    if "cost_usd" in scope:
        if scope["cost_usd"] is None:
            if scope.get("cost_known") is not False:
                raise ValueError(f"{label}.cost_usd may be null only with cost_known false")
        else:
            _finite_amount(scope["cost_usd"], f"{label}.cost_usd")


def _validate_receipt(receipt: Any, label: str) -> None:
    """Reject malformed or impossible usage before it can reach cost totals."""
    receipt = _mapping(receipt, label)
    raw_attempts = receipt.get("attempts")
    if raw_attempts is not None:
        for index, raw in enumerate(_list(raw_attempts, label + ".attempts")):
            attempt = _mapping(raw, f"{label}.attempts[{index}]")
            _validate_cost(attempt, f"{label}.attempts[{index}]")
            if "latency_ms" in attempt:
                _finite_amount(attempt["latency_ms"], f"{label}.attempts[{index}].latency_ms")
            for field in ("input_tokens", "output_tokens"):
                if field in attempt:
                    _token_count(attempt[field], f"{label}.attempts[{index}].{field}")
    _validate_cost(receipt, label)
    if "latency_ms" in receipt:
        _finite_amount(receipt["latency_ms"], f"{label}.latency_ms")
    for field in ("input_tokens", "output_tokens"):
        if field in receipt:
            _token_count(receipt[field], f"{label}.{field}")


def _validate_ledger(ledger: dict[str, Any], manifest: dict[str, Any], export: dict[str, Any]) -> None:
    _mapping(ledger, "run ledger")
    if ledger.get("schema_version") != 1:
        raise ValueError("unsupported run ledger schema_version")
    if ledger.get("manifest_hash") != manifest["manifest_sha256"]:
        raise ValueError("run ledger manifest_hash does not match the frozen manifest")
    if ledger.get("run_id") != export["run_id"]:
        raise ValueError("run ledger run_id does not match the review export")
    if ledger.get("tenant_id") != export["tenant_id"]:
        raise ValueError("run ledger tenant_id does not match the review export")
    entries = _mapping(ledger.get("entries"), "run ledger entries")
    case_ids = {case["case_id"] for case in manifest["cases"]}
    canonical_ids: set[str] = set()
    for key, raw in entries.items():
        entry = _mapping(raw, f"run ledger entry {key}")
        case_id = _required_text(entry.get("case_id"), "run ledger entry case_id")
        if case_id not in case_ids:
            raise ValueError(f"run ledger entry {key} references a case outside the frozen manifest")
        if entry.get("effort") not in EFFORTS:
            raise ValueError(f"run ledger entry {key} has an invalid effort")
        attempts = entry.get("attempts", [])
        if not isinstance(attempts, list):
            raise ValueError(f"run ledger entry {key} attempts must be an array")
        for index, raw_attempt in enumerate(attempts):
            attempt = _mapping(raw_attempt, f"run ledger entry {key} attempt {index}")
            if "receipt" in attempt:
                _validate_receipt(attempt["receipt"], f"run ledger entry {key} attempt {index} receipt")
        if "duplicate_receipt" in entry:
            _validate_receipt(entry["duplicate_receipt"], f"run ledger entry {key} duplicate_receipt")
        if "preflight_receipt" in entry:
            _validate_receipt(entry["preflight_receipt"], f"run ledger entry {key} preflight_receipt")
        identity = entry.get("canonical_review_id")
        if identity is None:
            continue
        if not isinstance(identity, str) or not identity:
            raise ValueError(f"run ledger entry {key} has an invalid canonical review id")
        if identity in canonical_ids:
            raise ValueError("run ledger references a canonical review id more than once")
        canonical_ids.add(identity)


def _is_no_provider_call(status: Any) -> bool:
    return status in NO_PROVIDER_CALL_STATUSES or (isinstance(status, str) and status.startswith("refused_"))


def _carries_usage(scope: dict[str, Any]) -> bool:
    return any(field in scope for field in USAGE_FIELDS)


def _receipt_usage(receipt: dict[str, Any]) -> dict[str, Any]:
    """Sum one run receipt's real usage; a null cost stays unknown, never estimated."""
    raw_attempts = receipt.get("attempts")
    items = [a for a in raw_attempts if isinstance(a, dict)] if isinstance(raw_attempts, list) and raw_attempts else []
    usage: dict[str, Any] = {"cost_usd": None, "input_tokens": None, "output_tokens": None, "latencies": [],
                             "unknown_cost": 0,
                             "missing": {"cost_usd": 0, "input_tokens": 0, "output_tokens": 0, "latency_ms": 0}}
    scopes = items or [receipt]
    if _is_no_provider_call(receipt.get("status")) and not _carries_usage(receipt) \
            and not any(_carries_usage(scope) for scope in scopes):
        usage.update({"cost_usd": 0.0, "input_tokens": 0, "output_tokens": 0})
        return usage
    for field in ("input_tokens", "output_tokens"):
        values = [scope[field] for scope in scopes if field in scope]
        if values:
            usage[field] = sum(values)
            usage["missing"][field] = len(scopes) - len(values)
        elif field in receipt:
            usage[field] = receipt[field]
        else:
            usage["missing"][field] = max(1, len(scopes))
    known, unknown = 0.0, 0
    cost_scopes = [scope for scope in scopes if "cost_usd" in scope or "cost_known" in scope]
    for scope in cost_scopes:
        if "cost_usd" in scope:
            if scope["cost_usd"] is None:
                unknown += 1
            else:
                known += float(scope["cost_usd"])
        elif scope.get("cost_known") is False:
            unknown += 1
    if cost_scopes:
        usage["cost_usd"] = known
        usage["unknown_cost"] = unknown
        usage["missing"]["cost_usd"] = len(scopes) - len(cost_scopes)
    elif "cost_usd" in receipt or "cost_known" in receipt:
        if receipt.get("cost_usd") is None:
            usage["unknown_cost"] = 1
        else:
            usage["cost_usd"] = float(receipt.get("cost_usd", 0.0))
    else:
        usage["missing"]["cost_usd"] = max(1, len(scopes))
    usage["latencies"] = [int(scope["latency_ms"]) for scope in scopes if "latency_ms" in scope]
    usage["missing"]["latency_ms"] = len(scopes) - len(usage["latencies"])
    return usage


def _empty_spend() -> dict[str, Any]:
    return {"cost_usd": 0.0, "input_tokens": 0, "output_tokens": 0, "latencies": [],
            "missing": {"cost_usd": 0, "input_tokens": 0, "output_tokens": 0, "latency_ms": 0},
            "unknown_entries": 0, "unknown_cost_entries": 0}


def _add_usage(target: dict[str, Any], usage: dict[str, Any]) -> None:
    for field in ("cost_usd", "input_tokens", "output_tokens"):
        if usage[field] is not None:
            target[field] += usage[field]
    target["latencies"].extend(usage["latencies"])
    for field, count in usage["missing"].items():
        target["missing"][field] += count
    target["unknown_cost_entries"] += usage.get("unknown_cost", 0)


def _ledger_spend(ledger: dict[str, Any], case_ids: set[str]) -> dict[str, Any]:
    """Actual spend from real run receipts only, plus explicitly-unknown started claims."""
    total, per_effort = _empty_spend(), {effort: _empty_spend() for effort in EFFORTS}
    unknown: list[str] = []
    has_receipts = False
    for key in sorted(ledger["entries"]):
        entry = ledger["entries"][key]
        if entry["case_id"] not in case_ids or entry["effort"] not in EFFORTS:
            continue
        effort = entry["effort"]
        receipts = [attempt["receipt"] for attempt in entry.get("attempts", [])
                    if isinstance(attempt, dict) and attempt.get("kind") == "run"
                    and isinstance(attempt.get("receipt"), dict)]
        duplicate = entry.get("duplicate_receipt")
        if isinstance(duplicate, dict) and not any(_canonical_hash(r) == _canonical_hash(duplicate) for r in receipts):
            receipts.append(duplicate)
        if receipts:
            has_receipts = True
        for receipt in receipts:
            usage = _receipt_usage(receipt)
            _add_usage(total, usage)
            _add_usage(per_effort[effort], usage)
        if entry.get("state") in UNKNOWN_STATES and not receipts:
            unknown.append(key)
            per_effort[effort]["unknown_entries"] += 1
    return {"has_receipts": has_receipts, "total": total, "by_effort": per_effort,
            "unknown_entries": unknown}


def validate_inputs(manifest: dict[str, Any], export: dict[str, Any], ledger: dict[str, Any],
                    comparator_evidence: dict[str, Any], adjudications: dict[str, Any]) -> None:
    """Validate frozen identity, export provenance and human decisions before calculating."""
    _validate_manifest(manifest)
    _validate_export(export, manifest)
    _validate_ledger(ledger, manifest, export)
    _mapping(comparator_evidence, "comparator_evidence")
    adjudications = _mapping(adjudications, "adjudications")
    if adjudications.get("version") != 1:
        raise ValueError("adjudications.version must be 1")
    rate = adjudications.get("low_sample_rate")
    if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not 0 <= rate <= 1:
        raise ValueError("adjudications.low_sample_rate must be between 0 and 1")
    for field in ("labeler_model", "second_labeler_model"):
        value = adjudications.get(field)
        if value is not None and (not isinstance(value, str) or not value):
            raise ValueError(f"adjudications.{field} must be a non-empty string or null")
    rows = _list(adjudications.get("findings"), "adjudications.findings")
    seen: set[tuple[str, str, str, str]] = set()
    for raw in rows:
        row = _mapping(raw, "adjudication")
        case_id = _required_text(row.get("case_id"), "adjudication.case_id")
        finding_id = _required_text(row.get("finding_id"), "adjudication.finding_id")
        category = row.get("category")
        if category not in CATEGORIES:
            raise ValueError(f"invalid adjudication category for {case_id}/{finding_id}: {category}")
        second_label = row.get("second_label")
        if second_label is not None and second_label not in CATEGORIES:
            raise ValueError(f"invalid adjudication second_label category for {case_id}/{finding_id}: {second_label}")
        source = row.get("source", "review")
        if source not in ("review", "curated", "pr_export"):
            raise ValueError(f"invalid adjudication source for {case_id}/{finding_id}")
        effort = row.get("effort", "")
        if source == "review" and effort not in EFFORTS:
            raise ValueError(f"review adjudication requires a valid effort: {case_id}/{finding_id}")
        if source != "review" and effort:
            raise ValueError(f"comparator adjudication must not specify effort: {case_id}/{finding_id}")
        if source == "review" and category not in REVIEW_CATEGORIES:
            raise ValueError(f"review finding adjudication requires a new-finding category: {case_id}/{finding_id}")
        if source == "curated" and category not in HISTORICAL:
            raise ValueError(f"historical adjudication requires matched/partial/unmatched: {case_id}/{finding_id}")
        if source == "pr_export" and category not in HISTORICAL:
            raise ValueError(f"historical adjudication requires matched/partial/unmatched: {case_id}/{finding_id}")
        tags = row.get("context_tags", [])
        refs = row.get("evidence_refs", [])
        if not isinstance(tags, list) or not all(isinstance(x, str) and x for x in tags):
            raise ValueError(f"context_tags must be an array of strings: {case_id}/{finding_id}")
        if not isinstance(refs, list) or not all(isinstance(x, str) and x for x in refs):
            raise ValueError(f"evidence_refs must be an array of strings: {case_id}/{finding_id}")
        identity = (source, case_id, effort, finding_id)
        if identity in seen:
            raise ValueError(f"duplicate adjudication identity: {case_id}/{finding_id}")
        seen.add(identity)


def _normalize_comparators(manifest: dict[str, Any], evidence: dict[str, Any]) -> list[dict[str, Any]]:
    """Keep curated and PR export records distinct, preserving phase/PR links."""
    embedded = manifest.get("comparators", {})
    if not isinstance(embedded, dict):
        raise ValueError("manifest.comparators must be an object")
    curated = evidence.get("curated", embedded.get("curated") or [])
    exported = evidence.get("pr_export_by_head", embedded.get("pr_export_by_head") or {})
    if "curated" in evidence and _canonical_hash(curated) != _canonical_hash(embedded.get("curated") or []):
        raise ValueError("curated comparator evidence does not match the frozen manifest")
    if "pr_export_by_head" in evidence and _canonical_hash(exported) != _canonical_hash(embedded.get("pr_export_by_head") or {}):
        raise ValueError("PR export evidence does not match the frozen manifest")
    for field in ("curated_sha256", "pr_export_sha256"):
        if field in evidence and evidence[field] != embedded.get(field):
            raise ValueError(f"{field} does not match the frozen manifest")
    rows: list[dict[str, Any]] = []
    case_index = {c["case_id"]: c for c in manifest["cases"]}
    for raw in _list(curated, "comparators.curated"):
        item = _mapping(raw, "curated comparator")
        if item.get("stratum") not in ("phase", "pr"):
            raise ValueError("curated comparator stratum must be phase or pr")
        case_id = _required_text(item.get("head_sha"), "comparator.head_sha")
        if case_id not in case_index or case_index[case_id]["stratum"] != item["stratum"]:
            raise ValueError(f"curated comparator does not match a manifest phase/PR case: {case_id}")
        rows.append({"source": "curated", "case_id": case_id,
                     "finding_id": _required_text(item.get("id"), "comparator.id"), "stratum": item["stratum"],
                     "text": item.get("text", ""), "evidence_refs": [c.get("path", "") for c in item.get("citations", []) if isinstance(c, dict)]})
    _mapping(exported, "comparators.pr_export_by_head")
    for case_id, reviews in sorted(exported.items()):
        if case_id not in case_index or case_index[case_id]["stratum"] != "pr":
            raise ValueError(f"PR export does not match a manifest PR case: {case_id}")
        for index, raw in enumerate(_list(reviews, f"PR export for {case_id}")):
            review = _mapping(raw, "PR export review")
            findings = review.get("findings")
            if isinstance(findings, list):
                for f_index, finding in enumerate(findings):
                    f = _mapping(finding, "PR export finding")
                    rows.append({"source": "pr_export", "case_id": case_id,
                                 "finding_id": str(f.get("id") or f"review-{index}-finding-{f_index}"),
                                 "stratum": "pr", "text": f.get("text", f.get("title", "")),
                                 "evidence_refs": f.get("evidence_refs", [])})
            else:
                body = review.get("body")
                if isinstance(body, str) and body.strip():
                    rows.append({"source": "pr_export", "case_id": case_id,
                                 "finding_id": str(review.get("id") or f"review-{index}"),
                                 "stratum": "pr", "text": body, "evidence_refs": review.get("evidence_refs", [])})
    identities = [(r["source"], r["case_id"], r["finding_id"]) for r in rows]
    if len(identities) != len(set(identities)):
        raise ValueError("duplicate comparator finding identity")
    return rows


def _adjudication_index(adjudications: dict[str, Any]) -> dict[tuple[str, str, str, str], dict[str, Any]]:
    return {(row.get("source", "review"), row["case_id"], row.get("effort", ""), row["finding_id"]): row
            for row in adjudications["findings"]}


def _low_sample(identity: str, seed: int, rate: float) -> bool:
    bucket = int(hashlib.sha256(f"{seed}:{identity}".encode()).hexdigest()[:16], 16) / 0xFFFFFFFFFFFFFFFF
    return bucket < rate


def _attempts(record: dict[str, Any]) -> list[dict[str, Any]]:
    attempts = record.get("attempts", [])
    return attempts if isinstance(attempts, list) else []


def _models(record: dict[str, Any]) -> list[str]:
    raw = record.get("build_models")
    if not isinstance(raw, list):
        return ["unknown"]
    models = sorted({x.get("id") for x in raw if isinstance(x, dict) and isinstance(x.get("id"), str) and x["id"]})
    return models or ["unknown"]


def _case_tier(case: dict[str, Any]) -> str:
    """The case's tier, falling back to a legacy stratum, never invented."""
    tier = case.get("tier")
    if tier in ("phase", "unit", "pr"):
        return tier
    stratum = case.get("stratum")
    if stratum in ("phase", "unit", "pr"):
        return stratum
    return "unaccompanied"


def _record_effort(record: dict[str, Any]) -> str | None:
    tags = record.get("tags")
    if isinstance(tags, list):
        for effort in EFFORTS:
            if "effort:" + effort in tags:
                return effort
    return None


def _integer_line(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def _payload_findings(record: dict[str, Any]) -> list[dict[str, Any]]:
    payload = record.get("payload")
    findings = payload.get("findings") if isinstance(payload, dict) else None
    return [finding for finding in findings if isinstance(finding, dict)] if isinstance(findings, list) else []


def _review_geometry(finding: dict[str, Any]) -> dict[str, Any] | None:
    """A review finding needs a path and an integer line range to be matchable."""
    path = finding.get("path")
    start, end = _integer_line(finding.get("line_start")), _integer_line(finding.get("line_end"))
    if not isinstance(path, str) or start is None or end is None:
        return None
    return {"path": path, "line_start": start, "line_end": end,
            "title": finding.get("title", ""), "evidence": finding.get("evidence", ""),
            "severity": finding.get("severity")}


def _recorded_targets(case: dict[str, Any]) -> list[dict[str, Any]]:
    """Reported review findings with a path and an integer line range."""
    targets: list[dict[str, Any]] = []
    for index, outcome in enumerate(case.get("outcomes") or []):
        if not isinstance(outcome, dict) or outcome.get("kind") != "review_finding":
            continue
        path = outcome.get("path")
        start, end = _integer_line(outcome.get("line_start")), _integer_line(outcome.get("line_end"))
        if not isinstance(path, str) or start is None or end is None:
            continue
        targets.append({"key": ("recorded", index), "path": path, "line_start": start, "line_end": end,
                        "excerpt": outcome.get("excerpt", ""), "severity": outcome.get("severity")})
    return targets


def _fix_targets(case: dict[str, Any]) -> list[dict[str, Any]]:
    """Later-fix hunks mapped onto the matcher's line keys; the fix subject is the target text."""
    targets: list[dict[str, Any]] = []
    for fix_index, fix in enumerate(case.get("later_fixes") or []):
        if not isinstance(fix, dict):
            continue
        subject = fix.get("subject", "") if isinstance(fix.get("subject"), str) else ""
        for hunk_index, hunk in enumerate(fix.get("hunks") or []):
            if not isinstance(hunk, dict):
                continue
            path = hunk.get("path")
            start = _integer_line(hunk.get("start", hunk.get("line_start")))
            end = _integer_line(hunk.get("end", hunk.get("line_end")))
            if not isinstance(path, str) or start is None or end is None:
                continue
            targets.append({"key": ("fix", fix_index, hunk_index), "path": path,
                            "line_start": start, "line_end": end, "excerpt": subject})
    return targets


def _best_candidate(review: dict[str, Any], targets: list[dict[str, Any]], band: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """Deterministic best target in one band: highest similarity, then lowest path/line."""
    best = None
    for target in targets:
        result = matching.classify(review, target)
        if result["band"] != band:
            continue
        key = (-result["text_similarity"], target["path"], target["line_start"], target["line_end"])
        if best is None or key < best[0]:
            best = (key, target, result)
    return None if best is None else (best[1], best[2])


def _match_review(review: dict[str, Any], targets: list[dict[str, Any]],
                  decision: dict[str, Any] | None) -> tuple[dict[str, Any], str] | None:
    """Structural first; an uncertain band becomes a match only under a matching adjudication label."""
    structural = _best_candidate(review, targets, "structural")
    if structural is not None:
        return structural[0], matching.tag_method("structural", False)
    if decision is not None and decision.get("category") in CORROBORATING_BANDS:
        uncertain = _best_candidate(review, targets, "uncertain")
        if uncertain is not None:
            return uncertain[0], matching.tag_method("uncertain", True)
    return None


def _has_uncertain(review: dict[str, Any], targets: list[dict[str, Any]]) -> bool:
    return _best_candidate(review, targets, "uncertain") is not None


def _recorded_verdict(case: dict[str, Any]) -> str:
    """pass/fail/unknown from the case's recorded review_verdict outcomes."""
    verdicts = []
    for outcome in case.get("outcomes") or []:
        if not isinstance(outcome, dict) or outcome.get("kind") != "review_verdict":
            continue
        excerpt = outcome.get("excerpt")
        text = matching.normalise_text(excerpt if isinstance(excerpt, str) else "")
        if "pass" in text:
            verdicts.append("pass")
        elif any(term in text for term in ("fail", "blocked", "request changes", "changes requested")):
            verdicts.append("fail")
    if "fail" in verdicts:
        return "fail"
    if "pass" in verdicts:
        return "pass"
    return "unknown"


def _review_verdict(findings: list[dict[str, Any]]) -> str:
    return "fail" if any(finding.get("severity") in ("blocker", "high") for finding in findings) else "pass"


def _rate(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def _analyse_record(record: dict[str, Any], case: dict[str, Any], effort: str, case_id: str,
                    adjudications: dict[tuple[str, str, str, str], dict[str, Any]]) -> dict[str, Any]:
    """One completed record's matches, counts and severity pairs (no I/O, no mutation)."""
    reviews = _payload_findings(record)
    recorded, fixes = _recorded_targets(case), _fix_targets(case)
    matched_recorded: set[tuple[Any, ...]] = set()
    matched_fixes: set[tuple[Any, ...]] = set()
    matched_ids: set[Any] = set()
    methods: list[str] = []
    uncertain_findings = 0
    severity_pairs: list[tuple[str, str]] = []
    for finding in reviews:
        decision = adjudications.get(("review", case_id, effort, finding.get("id", "")))
        geometry = _review_geometry(finding)
        if geometry is None:
            continue
        recorded_match = _match_review(geometry, recorded, decision)
        if recorded_match is not None:
            target, method = recorded_match
            matched_recorded.add(target["key"])
            matched_ids.add(finding.get("id"))
            methods.append(method)
            review_severity, recorded_severity = geometry["severity"], target["severity"]
            if review_severity is not None and recorded_severity is not None:
                severity_pairs.append((str(review_severity).lower(), str(recorded_severity).lower()))
        fix_match = _match_review(geometry, fixes, decision)
        if fix_match is not None:
            target, method = fix_match
            matched_fixes.add(target["key"])
            matched_ids.add(finding.get("id"))
            methods.append(method)
        if _has_uncertain(geometry, recorded + fixes):
            uncertain_findings += 1
    return {"reviews": reviews, "recorded": recorded, "fixes": fixes,
            "matched_recorded": matched_recorded, "matched_fixes": matched_fixes,
            "matched_finding_ids": matched_ids, "methods": methods,
            "uncertain_findings": uncertain_findings, "severity_pairs": severity_pairs}


def _analyse_against(reviews: list[dict[str, Any]], recorded: list[dict[str, Any]], fixes: list[dict[str, Any]],
                     case_id: str, effort: str,
                     adjudications: dict[tuple[str, str, str, str], dict[str, Any]]
                     ) -> tuple[int, int, int, int]:
    """Count matched targets for the shuffled null: recorded matched/total, fix matched/total."""
    matched_recorded: set[tuple[Any, ...]] = set()
    matched_fixes: set[tuple[Any, ...]] = set()
    for finding in reviews:
        geometry = _review_geometry(finding)
        if geometry is None:
            continue
        decision = adjudications.get(("review", case_id, effort, finding.get("id", "")))
        recorded_match = _match_review(geometry, recorded, decision)
        if recorded_match is not None:
            matched_recorded.add(recorded_match[0]["key"])
        fix_match = _match_review(geometry, fixes, decision)
        if fix_match is not None:
            matched_fixes.add(fix_match[0]["key"])
    return len(matched_recorded), len(recorded), len(matched_fixes), len(fixes)


def _empty_finding_recall() -> dict[str, Any]:
    return {"matched": 0, "recorded": 0, "null_matched": 0, "null_recorded": 0}


def _empty_fix_recall() -> dict[str, Any]:
    return {"matched": 0, "hunks": 0, "null_matched": 0, "null_hunks": 0}


def _finding_recall_row(row: dict[str, Any]) -> dict[str, Any]:
    return {"matched": row["matched"], "recorded": row["recorded"],
            "recall": _rate(row["matched"], row["recorded"]),
            "null": {"matched": row["null_matched"], "recorded": row["null_recorded"],
                     "recall": _rate(row["null_matched"], row["null_recorded"])}}


def _fix_recall_row(row: dict[str, Any]) -> dict[str, Any]:
    return {"matched": row["matched"], "hunks": row["hunks"],
            "recall": _rate(row["matched"], row["hunks"]),
            "null": {"matched": row["null_matched"], "hunks": row["null_hunks"],
                     "recall": _rate(row["null_matched"], row["null_hunks"])}}


def _comparisons_and_validation(manifest: dict[str, Any], cases: dict[str, dict[str, Any]],
                                completed_records: list[tuple[str, str, dict[str, Any]]],
                                adjudications: dict[str, Any],
                                adj: dict[tuple[str, str, str, str], dict[str, Any]],
                                run_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build comparisons (a)-(e) and the matching/adjudication/leak validation controls."""
    seed = int(manifest.get("seed", 0))
    shuffled = matching.shuffled_case_map(sorted(cases), seed)
    tier_names = [tier for tier in TIER_ORDER if any(_case_tier(case) == tier for case in cases.values())]
    findings_by_effort = {effort: _empty_finding_recall() for effort in EFFORTS}
    findings_by_tier = {tier: _empty_finding_recall() for tier in tier_names}
    fixes_by_effort = {effort: _empty_fix_recall() for effort in EFFORTS}
    fixes_by_tier = {tier: _empty_fix_recall() for tier in tier_names}
    corroboration = {effort: Counter() for effort in EFFORTS}
    verdicts = {effort: {"pass": Counter(), "fail": Counter()} for effort in EFFORTS}
    severity = {effort: {"pairs": 0, "agree": 0} for effort in EFFORTS}
    methods: Counter = Counter()
    matches = 0
    uncertain_band = 0
    uncensored_cases: set[str] = set()
    censored_cases: set[str] = set()

    for case_id, effort, record in completed_records:
        case = cases[case_id]
        tier = _case_tier(case)
        analysis = _analyse_record(record, case, effort, case_id, adj)
        for group in (findings_by_effort[effort], findings_by_tier[tier]):
            group["recorded"] += len(analysis["recorded"])
            group["matched"] += len(analysis["matched_recorded"])
        censored = case.get("censored") is True
        (censored_cases if censored else uncensored_cases).add(case_id)
        if not censored:
            for group in (fixes_by_effort[effort], fixes_by_tier[tier]):
                group["hunks"] += len(analysis["fixes"])
                group["matched"] += len(analysis["matched_fixes"])
        other_id = shuffled.get(case_id)
        if other_id is not None:
            other = cases[other_id]
            null_recorded_match, null_recorded, null_fix_match, null_fixes = _analyse_against(
                analysis["reviews"], _recorded_targets(other), _fix_targets(other), other_id, effort, adj)
            for group in (findings_by_effort[effort], findings_by_tier[tier]):
                group["null_matched"] += null_recorded_match
                group["null_recorded"] += null_recorded
            if not censored and not other.get("censored") is True:
                for group in (fixes_by_effort[effort], fixes_by_tier[tier]):
                    group["null_matched"] += null_fix_match
                    group["null_hunks"] += null_fixes
        corroboration[effort]["findings"] += len(analysis["reviews"])
        for finding in analysis["reviews"]:
            decision = adj.get(("review", case_id, effort, finding.get("id", "")))
            if finding.get("id") in analysis["matched_finding_ids"]:
                corroboration[effort]["corroborated"] += 1
            else:
                category = decision.get("category") if decision else None
                corroboration[effort][category if category in CORROBORATION else "unadjudicated"] += 1
        recorded_verdict = _recorded_verdict(case)
        if recorded_verdict != "unknown":
            verdicts[effort][_review_verdict(analysis["reviews"])][recorded_verdict] += 1
        for review_severity, recorded_severity in analysis["severity_pairs"]:
            severity[effort]["pairs"] += 1
            severity[effort]["agree"] += review_severity == recorded_severity
        matches += len(analysis["methods"])
        methods.update(analysis["methods"])
        uncertain_band += analysis["uncertain_findings"]

    corroboration_rows = {}
    for effort in EFFORTS:
        counts = corroboration[effort]
        corroboration_rows[effort] = {
            "findings": counts["findings"], "corroborated": counts["corroborated"],
            "valid": counts["valid"], "invalid": counts["invalid"],
            "unknown": counts["unknown"], "unadjudicated": counts["unadjudicated"],
            "rate": _rate(counts["corroborated"] + counts["valid"], counts["findings"])}
    verdict_rows = {}
    for effort in EFFORTS:
        matrix = {"pass": {"pass": verdicts[effort]["pass"]["pass"], "fail": verdicts[effort]["pass"]["fail"]},
                  "fail": {"pass": verdicts[effort]["fail"]["pass"], "fail": verdicts[effort]["fail"]["fail"]}}
        cases_count = sum(sum(row.values()) for row in matrix.values())
        agree = matrix["pass"]["pass"] + matrix["fail"]["fail"]
        verdict_rows[effort] = {"cases": cases_count, "matrix": matrix,
                                "agreement": _rate(agree, cases_count)}
    severity_rows = {effort: {"pairs": severity[effort]["pairs"], "agree": severity[effort]["agree"],
                              "rate": _rate(severity[effort]["agree"], severity[effort]["pairs"])}
                     for effort in EFFORTS}
    comparisons = {
        "finding_recall": {"by_effort": {effort: _finding_recall_row(findings_by_effort[effort]) for effort in EFFORTS},
                           "by_tier": {tier: _finding_recall_row(findings_by_tier[tier]) for tier in tier_names}},
        "fix_recall": {"uncensored_cases": len(uncensored_cases), "censored_excluded": len(censored_cases),
                       "by_effort": {effort: _fix_recall_row(fixes_by_effort[effort]) for effort in EFFORTS},
                       "by_tier": {tier: _fix_recall_row(fixes_by_tier[tier]) for tier in tier_names}},
        "corroboration": {"by_effort": corroboration_rows},
        "verdict_agreement": {"by_effort": verdict_rows},
        "severity_agreement": {"by_effort": severity_rows},
    }
    label_pairs = [(row["category"], row["second_label"]) for row in adjudications["findings"]
                   if row.get("second_label") is not None]
    validation = {
        "matching": {"matches": matches,
                     "method_counts": {"structural": methods.get("structural", 0),
                                       "adjudicated": methods.get("adjudicated", 0)},
                     "uncertain_band": uncertain_band},
        "adjudication": {"double_labelled": len(label_pairs),
                         "kappa": matching.cohen_kappa(label_pairs) if label_pairs else None,
                         "labeler_model": adjudications.get("labeler_model"),
                         "second_labeler_model": adjudications.get("second_labeler_model")},
        "shuffled_null": {"seed": seed, "method": "shuffled_case_map"},
        "leak_check": leak_check.check_requests(manifest, run_id),
    }
    return comparisons, validation




def build_report(manifest: dict[str, Any], export: dict[str, Any], ledger: dict[str, Any],
                 comparator_evidence: dict[str, Any], adjudications: dict[str, Any]) -> dict[str, Any]:
    """Build a JSON-serializable report. No input is mutated and no I/O occurs."""
    validate_inputs(manifest, export, ledger, comparator_evidence, adjudications)
    cases = {case["case_id"]: case for case in manifest["cases"]}
    spend = _ledger_spend(ledger, set(cases))
    target = manifest.get("target", manifest.get("target_per_effort", 50))
    if isinstance(target, bool) or not isinstance(target, int) or target < 1:
        raise ValueError("manifest target must be a positive integer")
    floor = manifest.get("floor", target)
    if isinstance(floor, bool) or not isinstance(floor, int) or floor < 1:
        raise ValueError("manifest floor must be a positive integer")
    manifest_hash = manifest["manifest_sha256"]
    run_id = export["run_id"]
    tenant_id = export["tenant_id"]
    rows = export["reviews"]
    rows_by_id = {row["id"]: row for row in rows}
    manifest_tag, run_tag = "manifest:" + manifest_hash, "trial:" + run_id
    comps = _normalize_comparators(manifest, comparator_evidence)
    adj = _adjudication_index(adjudications)
    valid_adjudication_ids = {(c["source"], c["case_id"], "", c["finding_id"]) for c in comps}
    for identity in adj:
        if identity[0] != "review" and identity not in valid_adjudication_ids:
            raise ValueError(f"adjudication does not match an input finding: {identity[1]}/{identity[3]}")

    canonical_refs: list[tuple[str, str, str]] = []
    for key in sorted(ledger["entries"]):
        entry = ledger["entries"][key]
        identity = entry.get("canonical_review_id")
        if identity is not None:
            canonical_refs.append((entry["case_id"], entry["effort"], identity))
    canonical_refs.sort()
    canonical_ids = {identity for _, _, identity in canonical_refs}
    for case_id, effort, identity in canonical_refs:
        record = rows_by_id.get(identity)
        if record is None:
            raise ValueError(f"canonical review id from the run ledger is missing from the export: {identity}")
        if not isinstance(record.get("tags"), list):
            raise ValueError(f"canonical review {identity} has no trial tags")
        expected = {manifest_tag, run_tag, "effort:" + effort, _case_tag(case_id)}
        if not expected.issubset(set(record["tags"])):
            raise ValueError(f"canonical review {identity} does not belong to this run and tenant")
        if record.get("tenant_id") not in (None, tenant_id):
            raise ValueError(f"canonical review {identity} belongs to another tenant")
        if record.get("effective_effort") not in (None, effort) or record.get("case_id") not in (None, case_id):
            raise ValueError(f"canonical review {identity} identity disagrees with the run ledger")

    status_counts = Counter()
    exclusions = Counter()
    exclusions_by_effort: dict[str, Counter] = {effort: Counter() for effort in EFFORTS}
    unattributed_exclusions: Counter = Counter()
    for record in rows:
        status_counts[record.get("status", "unknown")] += 1

    def attribute_exclusion(reason: str, record: dict[str, Any]) -> None:
        effort = _record_effort(record)
        if effort is None:
            unattributed_exclusions[reason] += 1
        else:
            exclusions_by_effort[effort][reason] += 1

    for record in rows:
        identity = record["id"]
        if identity in canonical_ids:
            continue
        if record.get("tenant_id") not in (None, tenant_id):
            exclusions["unrelated_tenant"] += 1
            attribute_exclusion("unrelated_tenant", record)
            continue
        record_tags = set(record["tags"]) if isinstance(record.get("tags"), list) else set()
        if run_tag not in record_tags or manifest_tag not in record_tags:
            exclusions["unrelated_run"] += 1
            attribute_exclusion("unrelated_run", record)
            continue
        if record.get("duplicate_of") or record.get("original_review_id") or any(
                {_case_tag(case_id), "effort:" + effort}.issubset(record_tags)
                for case_id, effort, _ in canonical_refs):
            exclusions["duplicate_receipt"] += 1
            attribute_exclusion("duplicate_receipt", record)
            continue
        exclusions["non_canonical_record"] += 1
        attribute_exclusion("non_canonical_record", record)

    attempts_by_arm: dict[str, list[dict[str, Any]]] = {e: [] for e in EFFORTS}
    valid_by_arm: dict[str, dict[str, dict[str, Any]]] = {e: {} for e in EFFORTS}
    completed_records = []
    for case_id, effort, identity in canonical_refs:
        record = rows_by_id[identity]
        status = record.get("status", "unknown")
        reason = None
        if not isinstance(record.get("attempts"), list): reason = "missing_attempt_data"
        elif status in ("ok", "ok_partial") and (not record.get("attempts") or not isinstance(record.get("payload"), dict)
                                                     or not isinstance(record["payload"].get("findings"), list)):
            reason = "missing_completion_data"
        elif case_id not in cases: reason = "wrong_case"
        elif status not in ("ok", "ok_partial"): reason = "non_completed_status"
        elif record.get("configured_model") != REVIEWER_MODEL: reason = "wrong_configured_model"
        elif not record.get("returned_model"): reason = "missing_returned_model"
        elif record.get("returned_model") != REVIEWER_MODEL or record.get("model_mismatch") is True: reason = "mismatched_model"
        elif case_id in valid_by_arm[effort]: reason = "duplicate_completed_case_effort"
        if reason:
            exclusions[reason] += 1
            exclusions_by_effort[effort][reason] += 1
            continue
        normalized = {**record, "case_id": case_id, "effective_effort": effort}
        valid_by_arm[effort][case_id] = normalized
        attempts_by_arm[effort].extend(_attempts(normalized))
        completed_records.append((case_id, effort, normalized))

    valid_review_finding_ids = {("review", case_id, effort, f.get("id"))
                                for case_id, effort, r in completed_records
                                for f in r["payload"]["findings"] if isinstance(f, dict)}
    for identity in adj:
        if identity[0] == "review" and identity not in valid_review_finding_ids:
            raise ValueError(f"adjudication does not match a completed review finding: {identity[1]}/{identity[3]}")

    case_by_tag = {_case_tag(case_id): case_id for case_id in cases}
    attempted_by_arm = Counter()
    attempted_tier_by_arm: dict[str, Counter] = {effort: Counter() for effort in EFFORTS}
    attempted_cases_by_arm: dict[str, set[str]] = {effort: set() for effort in EFFORTS}
    for record in rows:
        record_tags = set(record["tags"]) if isinstance(record.get("tags"), list) else set()
        if manifest_tag in record_tags and run_tag in record_tags:
            for effort in EFFORTS:
                if "effort:" + effort in record_tags:
                    attempted_by_arm[effort] += 1
                    case_id = next((case_by_tag[tag] for tag in record_tags if tag in case_by_tag), None)
                    if case_id is not None:
                        attempted_tier_by_arm[effort][_case_tier(cases[case_id])] += 1
                        attempted_cases_by_arm[effort].add(case_id)
                    break

    arm_reports = {}
    for effort in EFFORTS:
        arm_attempts = attempts_by_arm[effort]
        cost = sum(float(a["cost_usd"]) for a in arm_attempts
                   if isinstance(a.get("cost_usd"), (int, float)) and not isinstance(a.get("cost_usd"), bool))
        input_tokens = sum(a["input_tokens"] for a in arm_attempts if "input_tokens" in a)
        output_tokens = sum(a["output_tokens"] for a in arm_attempts if "output_tokens" in a)
        missing_input = sum("input_tokens" not in a for a in arm_attempts)
        missing_output = sum("output_tokens" not in a for a in arm_attempts)
        missing_cost = sum("cost_usd" not in a and "cost_known" not in a for a in arm_attempts)
        latencies = sorted(int(a["latency_ms"]) for a in arm_attempts if "latency_ms" in a and a["latency_ms"] >= 0)
        available = set(valid_by_arm[effort])
        per_case = {}
        for case_id in sorted(available):
            record = valid_by_arm[effort][case_id]
            case_attempts = _attempts(record)
            missing_case_cost = sum("cost_usd" not in a and "cost_known" not in a for a in case_attempts)
            unknown_case_cost = sum("cost_usd" in a and a["cost_usd"] is None
                                    or "cost_usd" not in a and a.get("cost_known") is False
                                    for a in case_attempts)
            known_case_cost = sum(float(a["cost_usd"]) for a in case_attempts
                                  if isinstance(a.get("cost_usd"), (int, float)) and not isinstance(a.get("cost_usd"), bool))
            missing_case_usage = {"cost_usd": missing_case_cost,
                                  "input_tokens": sum("input_tokens" not in a for a in case_attempts),
                                  "output_tokens": sum("output_tokens" not in a for a in case_attempts),
                                  "latency_ms": sum("latency_ms" not in a for a in case_attempts)}
            per_case[case_id] = {"status": record["status"], "coverage": record.get("coverage", {}).get("state", "unknown"),
                                 "cost_usd": None if missing_case_cost or unknown_case_cost else round(known_case_cost, 12),
                                 "known_cost_usd": round(known_case_cost, 12),
                                 "unknown_cost_attempts": unknown_case_cost,
                                 "input_tokens": None if missing_case_usage["input_tokens"] else sum(a["input_tokens"] for a in case_attempts),
                                 "output_tokens": None if missing_case_usage["output_tokens"] else sum(a["output_tokens"] for a in case_attempts),
                                 "missing_usage_fields": missing_case_usage,
                                 "latency_ms": _distribution(sorted(int(a["latency_ms"]) for a in case_attempts if "latency_ms" in a))}
        arm_spend = spend["by_effort"][effort]
        if spend["has_receipts"]:
            cost = arm_spend["cost_usd"]
            input_tokens = arm_spend["input_tokens"]
            output_tokens = arm_spend["output_tokens"]
            missing_cost = arm_spend["missing"]["cost_usd"]
            missing_input = arm_spend["missing"]["input_tokens"]
            missing_output = arm_spend["missing"]["output_tokens"]
            latencies = sorted(arm_spend["latencies"])
            spend_unknown = arm_spend["unknown_entries"] + arm_spend["unknown_cost_entries"]
        else:
            spend_unknown = sum(("cost_usd" in a and a["cost_usd"] is None)
                                or ("cost_usd" not in a and a.get("cost_known") is False) for a in arm_attempts)
        arm_reports[effort] = {"eligible": len(cases), "eligible_shortfall": max(0, target - len(cases)),
                               "completed": len(available), "completion_shortfall": max(0, target - len(available)),
                               "partial_records": sum(valid_by_arm[effort][case_id].get("status") == "ok_partial" for case_id in available),
                               "shortfall": max(0, target - len(available)),
                               "floor": floor, "shortfall_against_floor": max(0, floor - len(available)),
                               "target": target, "attempted_records": attempted_by_arm[effort],
                               "completed_case_ids": sorted(available), "per_case": per_case,
                               "partial_coverage_case_ids": sorted(case_id for case_id in available
                                                                    if valid_by_arm[effort][case_id].get("status") == "ok_partial"
                                                                    or valid_by_arm[effort][case_id].get("coverage", {}).get("state") == "partial"),
                               "cost_usd": None if missing_cost or spend_unknown else round(cost, 12),
                               "known_cost_usd": round(cost, 12),
                               "unknown_cost_entries": spend_unknown,
                               "input_tokens": None if missing_input else input_tokens,
                               "output_tokens": None if missing_output else output_tokens,
                               "missing_usage_fields": {"cost_usd": missing_cost, "input_tokens": missing_input, "output_tokens": missing_output},
                               "latency_ms": _distribution(latencies)}

    tier_counts = Counter(_case_tier(case) for case in cases.values())
    tier_names = ["phase", "unit", "pr"]
    if tier_counts["unaccompanied"]:
        tier_names.append("unaccompanied")
    manifest_tiers = manifest.get("tiers")
    by_tier: dict[str, Any] = {}
    for tier in tier_names:
        row = manifest_tiers.get(tier) if isinstance(manifest_tiers, dict) else None
        if isinstance(row, dict) and isinstance(row.get("eligible"), int) and not isinstance(row.get("eligible"), bool) \
                and isinstance(row.get("frozen"), int) and not isinstance(row.get("frozen"), bool):
            by_tier[tier] = {"eligible": row["eligible"], "frozen": row["frozen"]}
        else:
            by_tier[tier] = {"eligible": tier_counts[tier], "frozen": tier_counts[tier]}
    raw_censored = manifest.get("censored")
    censored = raw_censored if isinstance(raw_censored, int) and not isinstance(raw_censored, bool) \
        else sum(1 for case in cases.values() if case.get("censored") is True)
    censored_case_ids = {case_id for case_id, case in cases.items() if case.get("censored") is True}
    completed_tier_by_arm: dict[str, Counter] = {effort: Counter() for effort in EFFORTS}
    for effort in EFFORTS:
        for case_id in valid_by_arm[effort]:
            completed_tier_by_arm[effort][_case_tier(cases[case_id])] += 1
    population_by_effort: dict[str, Any] = {}
    for effort in EFFORTS:
        arm_completed = len(valid_by_arm[effort])
        population_by_effort[effort] = {
            "eligible": len(cases), "attempted": attempted_by_arm[effort], "completed": arm_completed,
            "failed": max(0, attempted_by_arm[effort] - arm_completed),
            "censored": len(attempted_cases_by_arm[effort] & censored_case_ids),
            "shortfall_against_floor": max(0, floor - arm_completed),
            "by_tier": {tier: {"attempted": attempted_tier_by_arm[effort][tier],
                               "completed": completed_tier_by_arm[effort][tier]} for tier in tier_names},
            "exclusions": dict(sorted(exclusions_by_effort[effort].items()))}
    if unattributed_exclusions:
        population_by_effort["unattributed"] = {
            "eligible": 0, "attempted": 0, "completed": 0,
            "failed": sum(unattributed_exclusions.values()), "censored": 0,
            "shortfall_against_floor": 0, "by_tier": {},
            "exclusions": dict(sorted(unattributed_exclusions.items()))}
    manifest_exclusions = manifest.get("exclusions")
    population = {"eligible": len(cases), "frozen": len(cases),
                  "target": target, "floor": floor, "censored": censored,
                  "shortfall_against_floor": max(0, floor - len(cases)),
                  "exclusions": {"manifest": dict(sorted(manifest_exclusions.items())) if isinstance(manifest_exclusions, dict) else {},
                                 "run": dict(sorted(exclusions.items()))},
                  "by_tier": by_tier, "by_effort": population_by_effort}
    intersection = set.intersection(*(set(valid_by_arm[e]) for e in EFFORTS)) if EFFORTS else set()
    paired = {e: _outcome_summary([valid_by_arm[e][case_id] for case_id in sorted(intersection)], adj) for e in EFFORTS}
    available = {e: _outcome_summary(list(valid_by_arm[e].values()), adj) for e in EFFORTS}
    arm_outcomes = {"common_completed_cases": {"case_count": len(intersection), "case_ids": sorted(intersection), "by_effort": paired},
                    "available_cases": {e: {"case_count": arm_reports[e]["completed"], **available[e]} for e in EFFORTS}}

    finding_rows: list[dict[str, Any]] = []
    for case_id, effort, record in completed_records:
        payload = record.get("payload")
        findings = payload.get("findings", []) if isinstance(payload, dict) else []
        seen_finding_ids: set[str] = set()
        for finding in findings if isinstance(findings, list) else []:
            if not isinstance(finding, dict): continue
            fid = _required_text(finding.get("id"), "payload finding.id")
            if fid in seen_finding_ids:
                raise ValueError(f"duplicate finding id in review record {record.get('id')}: {fid}")
            seen_finding_ids.add(fid)
            key = ("review", case_id, effort, fid)
            decision = adj.get(key)
            severity = finding.get("severity", "unknown")
            if severity not in ("blocker", "high", "medium", "low"):
                raise ValueError(f"invalid finding severity: {case_id}/{effort}/{fid}")
            identity = f"{case_id}:{effort}:{record.get('id', '')}:{fid}"
            required = severity in ("blocker", "high", "medium") or _low_sample(identity, int(manifest.get("seed", 0)), float(adjudications["low_sample_rate"]))
            selected_low = severity == "low" and _low_sample(identity, int(manifest.get("seed", 0)), float(adjudications["low_sample_rate"]))
            category = decision.get("category") if decision else "unadjudicated"
            if severity == "low" and decision and not selected_low:
                raise ValueError(f"low finding is outside the seeded adjudication sample: {case_id}/{effort}/{fid}")
            finding_rows.append({"case_id": case_id, "stratum": cases[case_id]["stratum"], "effort": effort,
                                 "record_id": record.get("id"), "finding_id": fid, "severity": severity,
                                 "required_adjudication": required, "selected_low_sample": selected_low, "category": category,
                                 "context_tags": sorted(set(decision.get("context_tags", []))) if decision else [],
                                 "evidence_refs": list(decision.get("evidence_refs", [])) if decision else []})
    historical_rows = []
    for comp in comps:
        decision = adj.get((comp["source"], comp["case_id"], "", comp["finding_id"]))
        historical_rows.append({**comp, "category": decision["category"] if decision else "unadjudicated",
                                "context_tags": sorted(set(decision.get("context_tags", []))) if decision else [],
                                "adjudicated": decision is not None,
                                "evidence_refs": sorted(set(comp["evidence_refs"] + (decision.get("evidence_refs", []) if decision else [])))})
    category_counts = Counter(row["category"] for row in historical_rows)
    new_counts = Counter(row["category"] for row in finding_rows)
    adjudicated_count = sum(row["category"] != "unadjudicated" for row in finding_rows)
    required_count = sum(row["required_adjudication"] for row in finding_rows)
    model_strata: dict[str, Any] = {}
    reviewer_strata: dict[str, Any] = {}
    effort_strata: dict[str, Any] = {}
    for case_id, effort, record in completed_records:
        summaries = _outcome_summary([record], adj)
        for model in _models(record):
            model_strata.setdefault(model, _empty_summary())
            _merge_summary(model_strata[model], summaries)
        returned = record["returned_model"]
        reviewer_strata.setdefault(returned, _empty_summary()); _merge_summary(reviewer_strata[returned], summaries)
        effort_strata.setdefault(effort, _empty_summary()); _merge_summary(effort_strata[effort], summaries)
    for d in (model_strata, reviewer_strata, effort_strata):
        for summary in d.values(): _finish_summary(summary)
    all_attempts = [a for effort in EFFORTS for a in attempts_by_arm[effort] if isinstance(a, dict)]
    attempt_status_counts = Counter(a.get("status", "unknown") for a in all_attempts)
    all_cost = sum(float(a["cost_usd"]) for a in all_attempts
                   if isinstance(a.get("cost_usd"), (int, float)) and not isinstance(a.get("cost_usd"), bool))
    all_input_tokens = sum(a["input_tokens"] for a in all_attempts if "input_tokens" in a)
    all_output_tokens = sum(a["output_tokens"] for a in all_attempts if "output_tokens" in a)
    all_latencies = [int(a["latency_ms"]) for a in all_attempts if "latency_ms" in a and a["latency_ms"] >= 0]
    missing_attempt_records = sum(not isinstance(rows_by_id[identity].get("attempts"), list)
                                  for _, _, identity in canonical_refs)
    unknown_cost_fields = sum(("cost_usd" in a and a["cost_usd"] is None)
                              or ("cost_usd" not in a and a.get("cost_known") is False) for a in all_attempts)
    missing_cost_fields = sum("cost_usd" not in a and "cost_known" not in a for a in all_attempts)
    missing_input_fields = sum("input_tokens" not in a for a in all_attempts)
    missing_output_fields = sum("output_tokens" not in a for a in all_attempts)
    missing_latency_fields = sum("latency_ms" not in a for a in all_attempts)
    if spend["has_receipts"]:
        receipt_total = spend["total"]
        known_cost = round(receipt_total["cost_usd"], 12)
        unknown_cost_entries = receipt_total["unknown_cost_entries"] + len(spend["unknown_entries"])
        cost_unknown = bool(receipt_total["missing"]["cost_usd"] or unknown_cost_entries)
        usage_cost = None if cost_unknown else known_cost
        usage_input = None if receipt_total["missing"]["input_tokens"] else receipt_total["input_tokens"]
        usage_output = None if receipt_total["missing"]["output_tokens"] else receipt_total["output_tokens"]
        usage_latency = _distribution(sorted(receipt_total["latencies"]))
        missing_data = {"attempt_records": len(spend["unknown_entries"]),
                        "cost_fields": receipt_total["missing"]["cost_usd"],
                        "input_token_fields": receipt_total["missing"]["input_tokens"],
                        "output_token_fields": receipt_total["missing"]["output_tokens"],
                        "latency_fields": receipt_total["missing"]["latency_ms"]}
        cost_basis = "ledger_run_receipts"
    else:
        known_cost = round(all_cost, 12)
        unknown_cost_entries = unknown_cost_fields + len(spend["unknown_entries"])
        cost_unknown = bool(missing_cost_fields or missing_attempt_records or unknown_cost_entries)
        usage_cost = None if cost_unknown else known_cost
        usage_input = None if missing_input_fields else all_input_tokens
        usage_output = None if missing_output_fields else all_output_tokens
        usage_latency = _distribution(sorted(all_latencies))
        missing_data = {"attempt_records": missing_attempt_records, "cost_fields": missing_cost_fields,
                        "input_token_fields": missing_input_fields, "output_token_fields": missing_output_fields,
                        "latency_fields": missing_latency_fields}
        cost_basis = "canonical_record_attempts"
    comparisons, validation = _comparisons_and_validation(
        manifest, cases, completed_records, adjudications, adj, run_id)
    statuses = {status: status_counts.get(status, 0) for status in STATUSES}
    statuses.update({k: v for k, v in sorted(status_counts.items()) if k not in statuses})
    pages = [{key: page[key] for key in ("cursor_in", "cursor_out", "complete", "row_count", "row_ids_sha256")}
             for page in export["pages"]]
    return {"schema_version": 1, "manifest_sha256": manifest_hash,
            "denominators": {"attempted_records": len(rows), "eligible_cases": len(cases),
                             "canonical_records": len(canonical_refs),
                             "completed_valid_records": len(completed_records), "historical_findings": len(historical_rows),
                             "new_findings": len(finding_rows), "adjudicated_findings": adjudicated_count,
                             "required_adjudications": required_count,
                             "unadjudicated_required": required_count - sum(r["category"] != "unadjudicated" and r["required_adjudication"] for r in finding_rows)},
            "records_by_status": statuses, "attempts_by_status": dict(sorted(attempt_status_counts.items())),
            "provenance": {"schema_version": export["schema_version"], "manifest_sha256": export["manifest_sha256"],
                           "run_id": run_id, "tenant_id": tenant_id, "detail": export["detail"],
                           "filters": export["filters"], "limit": export["limit"],
                           "complete": True, "page_count": len(pages),
                           "row_count": len(rows), "canonical_records": len(canonical_refs),
                           "completed_records": len(completed_records),
                           "terminal": {"complete": pages[-1]["complete"], "cursor_out": pages[-1]["cursor_out"]},
                           "pages": pages},
            "excluded_records": dict(sorted(exclusions.items())),
            "population": population,
            "arms": arm_reports, "paired_intersection": {"completed_cases": len(intersection), "case_ids": sorted(intersection)},
            "outcomes": {"by_build_model": dict(sorted(model_strata.items())), "by_reviewer_model": dict(sorted(reviewer_strata.items())),
                         "by_effective_effort": dict(sorted(effort_strata.items())), **arm_outcomes},
            "comparisons": comparisons, "validation": validation,
            "historical_findings": {"by_category": {k: category_counts.get(k, 0) for k in (*HISTORICAL, "unadjudicated")}, "items": historical_rows},
            "new_findings": {"by_category": {k: new_counts.get(k, 0) for k in NEW}, "items": finding_rows,
                             "low_sample_rate": adjudications["low_sample_rate"], "sampling_seed": manifest.get("seed", 0)},
            "usage": {"cost_usd": usage_cost, "known_cost_usd": known_cost,
                      "cost_basis": cost_basis, "input_tokens": usage_input,
                      "output_tokens": usage_output, "latency_ms": usage_latency,
                      "missing_data": missing_data,
                      "unknown_cost_entries": unknown_cost_entries}}


def _distribution(values: list[int]) -> dict[str, int | float | None]:
    if not values:
        return {"count": 0, "min": None, "p50": None, "p90": None, "max": None}
    def percentile(p: float) -> int:
        return values[max(0, math.ceil(p * len(values)) - 1)]
    return {"count": len(values), "min": values[0], "p50": percentile(.5), "p90": percentile(.9), "max": values[-1]}


def _empty_summary() -> dict[str, Any]:
    return {"records": 0, "cases": set(), "findings": 0, "partial_records": 0, "categories": Counter()}


def _outcome_summary(records: list[dict[str, Any]], adjudications: dict[tuple[str, str, str, str], dict[str, Any]] | None = None) -> dict[str, Any]:
    findings = 0
    categories = Counter()
    for record in records:
        payload = record.get("payload")
        if isinstance(payload, dict) and isinstance(payload.get("findings"), list):
            for finding in payload["findings"]:
                if not isinstance(finding, dict): continue
                findings += 1
                decision = (adjudications or {}).get(("review", record.get("case_id", ""), record.get("effective_effort", ""), finding.get("id", "")))
                categories[decision["category"] if decision else "unadjudicated"] += 1
    return {"records": len(records), "case_ids": sorted({r.get("case_id", "") for r in records}),
            "findings": findings, "finding_categories": {k: categories.get(k, 0) for k in NEW},
            "partial_records": sum(r.get("status") == "ok_partial" for r in records)}


def _merge_summary(target: dict[str, Any], source: dict[str, Any]) -> None:
    target["records"] += source["records"]; target["cases"].update(source["case_ids"])
    target["findings"] += source["findings"]; target["partial_records"] += source["partial_records"]


def _finish_summary(summary: dict[str, Any]) -> None:
    summary["cases"] = sorted(summary["cases"])
    summary["case_count"] = len(summary["cases"])
