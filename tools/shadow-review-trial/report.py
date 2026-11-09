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
from collections import Counter, defaultdict
from typing import Any

EFFORTS = ("high", "xhigh", "max")
STATUSES = ("ok", "ok_partial", "timeout", "api_error", "invalid_output", "unavailable",
            "refused_capture", "refused_disclosure", "refused_criteria", "skipped_budget", "skipped_duplicate")
HISTORICAL = ("matched", "partial", "unmatched")
NEW = ("matched", "partial", "disputed", "new-valid", "unadjudicated")
CATEGORIES = set(HISTORICAL) | set(NEW)
REVIEWER_MODEL = "claude-haiku-5-5"


def _canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


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


def validate_inputs(manifest: dict[str, Any], reviews: list[dict[str, Any]],
                    comparator_evidence: dict[str, Any], adjudications: dict[str, Any]) -> None:
    """Validate frozen identity and human decisions before calculating anything."""
    _mapping(manifest, "manifest")
    if manifest.get("schema_version") != 1:
        raise ValueError("unsupported manifest schema_version")
    digest = manifest.get("manifest_sha256")
    unhashed = dict(manifest)
    unhashed.pop("manifest_sha256", None)
    if not isinstance(digest, str) or _canonical_hash(unhashed) != digest:
        raise ValueError("manifest_sha256 does not match frozen manifest content")
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
        if case.get("stratum") not in ("phase", "pr", "unaccompanied"):
            raise ValueError(f"invalid stratum for case {case_id}")
    for index, raw in enumerate(_list(reviews, "reviews")):
        review = _mapping(raw, f"reviews[{index}]")
        if "attempts" in review and not isinstance(review["attempts"], list):
            raise ValueError(f"reviews[{index}].attempts must be an array")
        for a_index, attempt in enumerate(review.get("attempts", [])):
            attempt = _mapping(attempt, f"reviews[{index}].attempts[{a_index}]")
            for field in ("cost_usd", "latency_ms"):
                if field in attempt and (isinstance(attempt[field], bool) or not isinstance(attempt[field], (int, float))
                                         or not math.isfinite(attempt[field]) or attempt[field] < 0):
                    raise ValueError(f"invalid {field} in reviews[{index}].attempts[{a_index}]")
            for field in ("input_tokens", "output_tokens"):
                if field in attempt and (isinstance(attempt[field], bool) or not isinstance(attempt[field], int) or attempt[field] < 0):
                    raise ValueError(f"invalid {field} in reviews[{index}].attempts[{a_index}]")
    _mapping(comparator_evidence, "comparator_evidence")
    adjudications = _mapping(adjudications, "adjudications")
    if adjudications.get("version") != 1:
        raise ValueError("adjudications.version must be 1")
    rate = adjudications.get("low_sample_rate")
    if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not 0 <= rate <= 1:
        raise ValueError("adjudications.low_sample_rate must be between 0 and 1")
    rows = _list(adjudications.get("findings"), "adjudications.findings")
    seen: set[tuple[str, str, str, str]] = set()
    for raw in rows:
        row = _mapping(raw, "adjudication")
        case_id = _required_text(row.get("case_id"), "adjudication.case_id")
        finding_id = _required_text(row.get("finding_id"), "adjudication.finding_id")
        category = row.get("category")
        if category not in CATEGORIES:
            raise ValueError(f"invalid adjudication category for {case_id}/{finding_id}: {category}")
        source = row.get("source", "review")
        if source not in ("review", "curated", "pr_export"):
            raise ValueError(f"invalid adjudication source for {case_id}/{finding_id}")
        effort = row.get("effort", "")
        if source == "review" and effort not in EFFORTS:
            raise ValueError(f"review adjudication requires a valid effort: {case_id}/{finding_id}")
        if source != "review" and effort:
            raise ValueError(f"comparator adjudication must not specify effort: {case_id}/{finding_id}")
        if source == "review" and category not in NEW:
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


def build_report(manifest: dict[str, Any], reviews: list[dict[str, Any]],
                 comparator_evidence: dict[str, Any], adjudications: dict[str, Any],
                 cost_cap_usd: float | None = None) -> dict[str, Any]:
    """Build a JSON-serializable report. No input is mutated and no I/O occurs."""
    validate_inputs(manifest, reviews, comparator_evidence, adjudications)
    if cost_cap_usd is not None and (isinstance(cost_cap_usd, bool) or not isinstance(cost_cap_usd, (int, float))
                                     or not math.isfinite(cost_cap_usd) or cost_cap_usd < 0):
        raise ValueError("cost_cap_usd must be a finite non-negative number or null")
    cases = {case["case_id"]: case for case in manifest["cases"]}
    target = manifest.get("target_per_effort", 50)
    if not isinstance(target, int) or target < 1:
        raise ValueError("manifest.target_per_effort must be a positive integer")
    manifest_hash = manifest["manifest_sha256"]
    comps = _normalize_comparators(manifest, comparator_evidence)
    adj = _adjudication_index(adjudications)
    valid_adjudication_ids = {(c["source"], c["case_id"], "", c["finding_id"]) for c in comps}
    for identity in adj:
        if identity[0] != "review" and identity not in valid_adjudication_ids:
            raise ValueError(f"adjudication does not match an input finding: {identity[1]}/{identity[3]}")
    attempts_by_arm: dict[str, list[dict[str, Any]]] = {e: [] for e in EFFORTS}
    valid_by_arm: dict[str, dict[str, dict[str, Any]]] = {e: {} for e in EFFORTS}
    status_counts = Counter()
    exclusions = Counter()
    completed_records = []
    for index, record in enumerate(reviews):
        if not isinstance(record, dict):
            raise ValueError(f"review record {index} must be an object")
        status = record.get("status", "unknown")
        status_counts[status] += 1
        case_id = record.get("case_id", "")
        effort = record.get("effective_effort", "")
        trial = effort in EFFORTS
        if trial:
            attempts_by_arm[effort].extend(_attempts(record))
        reason = None
        if "attempts" not in record or not isinstance(record.get("attempts"), list): reason = "missing_attempt_data"
        elif status in ("ok", "ok_partial") and (not record.get("attempts") or not isinstance(record.get("payload"), dict)
                                                     or not isinstance(record["payload"].get("findings"), list)):
            reason = "missing_completion_data"
        elif record.get("profile") != "historical_trial": reason = "wrong_profile"
        elif record.get("manifest_hash") != manifest_hash: reason = "wrong_manifest"
        elif case_id not in cases: reason = "wrong_case"
        elif effort not in EFFORTS: reason = "wrong_effort"
        elif status not in ("ok", "ok_partial"): reason = "non_completed_status"
        elif record.get("configured_model") != REVIEWER_MODEL: reason = "wrong_configured_model"
        elif not record.get("returned_model"): reason = "missing_returned_model"
        elif record.get("returned_model") != REVIEWER_MODEL or record.get("model_mismatch") is True: reason = "mismatched_model"
        elif case_id in valid_by_arm[effort]: reason = "duplicate_completed_case_effort"
        if reason:
            exclusions[reason] += 1
            continue
        valid_by_arm[effort][case_id] = record
        completed_records.append((case_id, effort, record))

    valid_review_finding_ids = {("review", case_id, effort, f.get("id"))
                                for case_id, effort, r in completed_records
                                for f in r["payload"]["findings"] if isinstance(f, dict)}
    for identity in adj:
        if identity[0] == "review" and identity not in valid_review_finding_ids:
            raise ValueError(f"adjudication does not match a completed review finding: {identity[1]}/{identity[3]}")

    arm_reports = {}
    for effort in EFFORTS:
        arm_attempts = attempts_by_arm[effort]
        cost = sum(float(a["cost_usd"]) for a in arm_attempts if "cost_usd" in a)
        input_tokens = sum(a["input_tokens"] for a in arm_attempts if "input_tokens" in a)
        output_tokens = sum(a["output_tokens"] for a in arm_attempts if "output_tokens" in a)
        missing_input = sum("input_tokens" not in a for a in arm_attempts)
        missing_output = sum("output_tokens" not in a for a in arm_attempts)
        missing_cost = sum("cost_usd" not in a for a in arm_attempts)
        latencies = sorted(int(a["latency_ms"]) for a in arm_attempts if "latency_ms" in a and a["latency_ms"] >= 0)
        available = set(valid_by_arm[effort])
        per_case = {}
        for case_id in sorted(available):
            record = valid_by_arm[effort][case_id]
            case_attempts = _attempts(record)
            missing_case_usage = {field: sum(field not in a for a in case_attempts)
                                  for field in ("cost_usd", "input_tokens", "output_tokens", "latency_ms")}
            per_case[case_id] = {"status": record["status"], "coverage": record.get("coverage", {}).get("state", "unknown"),
                                 "cost_usd": None if missing_case_usage["cost_usd"] else round(sum(float(a["cost_usd"]) for a in case_attempts), 12),
                                 "input_tokens": None if missing_case_usage["input_tokens"] else sum(a["input_tokens"] for a in case_attempts),
                                 "output_tokens": None if missing_case_usage["output_tokens"] else sum(a["output_tokens"] for a in case_attempts),
                                 "missing_usage_fields": missing_case_usage,
                                 "latency_ms": _distribution(sorted(int(a["latency_ms"]) for a in case_attempts if "latency_ms" in a))}
        arm_reports[effort] = {"eligible": len(cases), "eligible_shortfall": max(0, target - len(cases)),
                               "completed": len(available), "completion_shortfall": max(0, target - len(available)),
                               "partial_records": sum(valid_by_arm[effort][case_id].get("status") == "ok_partial" for case_id in available),
                               "shortfall": max(0, target - len(available)),
                               "target": target, "attempted_records": sum(1 for r in reviews if isinstance(r, dict) and r.get("effective_effort") == effort),
                               "completed_case_ids": sorted(available), "per_case": per_case,
                               "partial_coverage_case_ids": sorted(case_id for case_id in available
                                                                    if valid_by_arm[effort][case_id].get("status") == "ok_partial"
                                                                    or valid_by_arm[effort][case_id].get("coverage", {}).get("state") == "partial"),
                               "cost_usd": None if missing_cost else round(cost, 12),
                               "input_tokens": None if missing_input else input_tokens,
                               "output_tokens": None if missing_output else output_tokens,
                               "missing_usage_fields": {"cost_usd": missing_cost, "input_tokens": missing_input, "output_tokens": missing_output},
                               "latency_ms": _distribution(latencies)}
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
    attempt_status_counts = Counter(a.get("status", "unknown") for r in reviews if isinstance(r, dict)
                                    for a in _attempts(r) if isinstance(a, dict))
    all_attempts = [a for r in reviews if isinstance(r, dict) for a in _attempts(r) if isinstance(a, dict)]
    all_cost = sum(float(a["cost_usd"]) for a in all_attempts if "cost_usd" in a)
    all_input_tokens = sum(a["input_tokens"] for a in all_attempts if "input_tokens" in a)
    all_output_tokens = sum(a["output_tokens"] for a in all_attempts if "output_tokens" in a)
    all_latencies = [int(a["latency_ms"]) for a in all_attempts if "latency_ms" in a and a["latency_ms"] >= 0]
    missing_attempt_records = sum(not isinstance(r, dict) or "attempts" not in r for r in reviews)
    missing_cost_fields = sum("cost_usd" not in a for r in reviews if isinstance(r, dict) for a in _attempts(r) if isinstance(a, dict))
    missing_input_fields = sum("input_tokens" not in a for r in reviews if isinstance(r, dict) for a in _attempts(r) if isinstance(a, dict))
    missing_output_fields = sum("output_tokens" not in a for r in reviews if isinstance(r, dict) for a in _attempts(r) if isinstance(a, dict))
    missing_latency_fields = sum("latency_ms" not in a for r in reviews if isinstance(r, dict) for a in _attempts(r) if isinstance(a, dict))
    statuses = {status: status_counts.get(status, 0) for status in STATUSES}
    statuses.update({k: v for k, v in sorted(status_counts.items()) if k not in statuses})
    return {"schema_version": 1, "manifest_sha256": manifest_hash,
            "denominators": {"attempted_records": len(reviews), "eligible_cases": len(cases),
                             "completed_valid_records": len(completed_records), "historical_findings": len(historical_rows),
                             "new_findings": len(finding_rows), "adjudicated_findings": adjudicated_count,
                             "required_adjudications": required_count,
                             "unadjudicated_required": required_count - sum(r["category"] != "unadjudicated" and r["required_adjudication"] for r in finding_rows)},
            "records_by_status": statuses, "attempts_by_status": dict(sorted(attempt_status_counts.items())),
            "record_limit_may_truncate": len(reviews) >= 500,
            "excluded_records": dict(sorted(exclusions.items())),
            "arms": arm_reports, "paired_intersection": {"completed_cases": len(intersection), "case_ids": sorted(intersection)},
            "outcomes": {"by_build_model": dict(sorted(model_strata.items())), "by_reviewer_model": dict(sorted(reviewer_strata.items())),
                         "by_effective_effort": dict(sorted(effort_strata.items())), **arm_outcomes},
            "historical_findings": {"by_category": {k: category_counts.get(k, 0) for k in (*HISTORICAL, "unadjudicated")}, "items": historical_rows},
            "new_findings": {"by_category": {k: new_counts.get(k, 0) for k in NEW}, "items": finding_rows,
                             "low_sample_rate": adjudications["low_sample_rate"], "sampling_seed": manifest.get("seed", 0)},
            "usage": {"cost_usd": None if missing_cost_fields or missing_attempt_records else round(all_cost, 12),
                      "input_tokens": None if missing_input_fields else all_input_tokens,
                      "output_tokens": None if missing_output_fields else all_output_tokens,
                      "latency_ms": _distribution(sorted(all_latencies)),
                      "missing_data": {"attempt_records": missing_attempt_records, "cost_fields": missing_cost_fields,
                                       "input_token_fields": missing_input_fields, "output_token_fields": missing_output_fields,
                                       "latency_fields": missing_latency_fields}, "cap_usd": cost_cap_usd,
                      "cap_comparison": "unknown" if cost_cap_usd is None or missing_cost_fields or missing_attempt_records
                      else ("within" if all_cost <= cost_cap_usd else "exceeded")}}


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
