"""Deterministic, metric-only Markdown rendering of an alignment report.

``render`` is pure: it formats the numbers a report already carries and never
recomputes a metric, reads a file or emits a timestamp, path, diff line,
outcome excerpt, finding title or case list.
"""
from __future__ import annotations

from typing import Any


def _fmt(value: Any, places: int = 4) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return f"{value:.{places}f}"
    return str(value)


def _counts(mapping: Any) -> str:
    if not isinstance(mapping, dict) or not mapping:
        return "none"
    return ", ".join(f"{key} {_fmt(mapping[key])}" for key in sorted(mapping))


def _recall(label: str, row: Any, total_key: str) -> str:
    row = row if isinstance(row, dict) else {}
    null = row.get("null") if isinstance(row.get("null"), dict) else {}
    return (f"- {label}: {_fmt(row.get('matched'))}/{_fmt(row.get(total_key))} = "
            f"{_fmt(row.get('recall'))}; null {_fmt(null.get('matched'))}/"
            f"{_fmt(null.get(total_key))} = {_fmt(null.get('recall'))}")


def _population(lines: list[str], population: Any) -> None:
    population = population if isinstance(population, dict) else {}
    lines.extend(["## Population", ""])
    lines.append(f"- eligible {_fmt(population.get('eligible'))} / frozen {_fmt(population.get('frozen'))} "
                 f"/ target {_fmt(population.get('target'))} / floor {_fmt(population.get('floor'))}")
    lines.append(f"- censored {_fmt(population.get('censored'))}; shortfall against floor "
                 f"{_fmt(population.get('shortfall_against_floor'))}")
    exclusions = population.get("exclusions") if isinstance(population.get("exclusions"), dict) else {}
    for scope in sorted(exclusions):
        lines.append(f"- exclusions ({scope}): {_counts(exclusions[scope])}")
    by_tier = population.get("by_tier") if isinstance(population.get("by_tier"), dict) else {}
    if by_tier:
        lines.append("- by tier:")
        for tier in sorted(by_tier):
            row = by_tier[tier] if isinstance(by_tier[tier], dict) else {}
            lines.append(f"  - {tier}: eligible {_fmt(row.get('eligible'))}, frozen {_fmt(row.get('frozen'))}")
    by_effort = population.get("by_effort") if isinstance(population.get("by_effort"), dict) else {}
    if by_effort:
        lines.append("- by effort:")
        for effort in sorted(by_effort):
            row = by_effort[effort] if isinstance(by_effort[effort], dict) else {}
            lines.append(f"  - {effort}: eligible {_fmt(row.get('eligible'))}, attempted "
                         f"{_fmt(row.get('attempted'))}, completed {_fmt(row.get('completed'))}, failed "
                         f"{_fmt(row.get('failed'))}, censored {_fmt(row.get('censored'))}, shortfall "
                         f"{_fmt(row.get('shortfall_against_floor'))}")
            tiers = row.get("by_tier") if isinstance(row.get("by_tier"), dict) else {}
            if tiers:
                parts = []
                for tier in sorted(tiers):
                    tier_row = tiers[tier] if isinstance(tiers[tier], dict) else {}
                    parts.append(f"{tier} attempted {_fmt(tier_row.get('attempted'))} completed "
                                 f"{_fmt(tier_row.get('completed'))}")
                lines.append("    - by tier: " + "; ".join(parts))
            if isinstance(row.get("exclusions"), dict) and row["exclusions"]:
                lines.append("    - exclusions: " + _counts(row["exclusions"]))


def _comparisons(lines: list[str], comparisons: Any, cost_latency: Any) -> None:
    comparisons = comparisons if isinstance(comparisons, dict) else {}
    lines.extend(["## Comparisons (a)–(g)", ""])

    lines.extend(["### (a) Finding recall", ""])
    recall = comparisons.get("finding_recall") if isinstance(comparisons.get("finding_recall"), dict) else {}
    for effort in sorted(recall.get("by_effort") or {}):
        lines.append(_recall(effort, recall["by_effort"][effort], "recorded"))
    for tier in sorted(recall.get("by_tier") or {}):
        lines.append(_recall(f"tier {tier}", recall["by_tier"][tier], "recorded"))

    fixes = comparisons.get("fix_recall") if isinstance(comparisons.get("fix_recall"), dict) else {}
    lines.extend(["", "### (b) Fix recall", ""])
    lines.append(f"- uncensored cases {_fmt(fixes.get('uncensored_cases'))}; censored excluded "
                 f"{_fmt(fixes.get('censored_excluded'))}")
    for effort in sorted(fixes.get("by_effort") or {}):
        lines.append(_recall(effort, fixes["by_effort"][effort], "hunks"))
    for tier in sorted(fixes.get("by_tier") or {}):
        lines.append(_recall(f"tier {tier}", fixes["by_tier"][tier], "hunks"))

    lines.extend(["", "### (c) Corroboration", ""])
    corroboration = comparisons.get("corroboration") if isinstance(comparisons.get("corroboration"), dict) else {}
    for effort in sorted(corroboration.get("by_effort") or {}):
        row = corroboration["by_effort"][effort] if isinstance(corroboration["by_effort"][effort], dict) else {}
        lines.append(f"- {effort}: findings {_fmt(row.get('findings'))}, corroborated "
                     f"{_fmt(row.get('corroborated'))}, valid {_fmt(row.get('valid'))}, invalid "
                     f"{_fmt(row.get('invalid'))}, unknown {_fmt(row.get('unknown'))}, unadjudicated "
                     f"{_fmt(row.get('unadjudicated'))}, rate {_fmt(row.get('rate'))}")

    lines.extend(["", "### (d) Verdict agreement", ""])
    verdicts = comparisons.get("verdict_agreement") if isinstance(comparisons.get("verdict_agreement"), dict) else {}
    for effort in sorted(verdicts.get("by_effort") or {}):
        row = verdicts["by_effort"][effort] if isinstance(verdicts["by_effort"][effort], dict) else {}
        matrix = row.get("matrix") if isinstance(row.get("matrix"), dict) else {}
        pass_row = matrix.get("pass") if isinstance(matrix.get("pass"), dict) else {}
        fail_row = matrix.get("fail") if isinstance(matrix.get("fail"), dict) else {}
        lines.append(f"- {effort}: cases {_fmt(row.get('cases'))}, agreement {_fmt(row.get('agreement'))}; "
                     f"pass->pass {_fmt(pass_row.get('pass'))}, pass->fail {_fmt(pass_row.get('fail'))}, "
                     f"fail->pass {_fmt(fail_row.get('pass'))}, fail->fail {_fmt(fail_row.get('fail'))}")

    lines.extend(["", "### (e) Severity agreement", ""])
    severity = comparisons.get("severity_agreement") if isinstance(comparisons.get("severity_agreement"), dict) else {}
    for effort in sorted(severity.get("by_effort") or {}):
        row = severity["by_effort"][effort] if isinstance(severity["by_effort"][effort], dict) else {}
        lines.append(f"- {effort}: pairs {_fmt(row.get('pairs'))}, agree {_fmt(row.get('agree'))}, "
                     f"rate {_fmt(row.get('rate'))}")

    lines.extend(["", "### (f) Paired effort deltas", ""])
    deltas = comparisons.get("paired_deltas") if isinstance(comparisons.get("paired_deltas"), dict) else {}
    for metric in sorted(deltas):
        for pair in sorted(deltas[metric] or {}):
            row = deltas[metric][pair] if isinstance(deltas[metric][pair], dict) else {}
            lines.append(f"- {metric} {pair}: delta {_fmt(row.get('delta'))} "
                         f"[{_fmt(row.get('low'))}, {_fmt(row.get('high'))}], n {_fmt(row.get('n'))}")

    lines.extend(["", "### (g) Cost and latency", ""])
    cost = cost_latency if isinstance(cost_latency, dict) else {}
    lines.append(f"- cost basis {_fmt(cost.get('cost_basis'))}")
    by_effort = cost.get("by_effort") if isinstance(cost.get("by_effort"), dict) else {}
    for effort in sorted(by_effort):
        row = by_effort[effort] if isinstance(by_effort[effort], dict) else {}
        latency = row.get("latency_ms") if isinstance(row.get("latency_ms"), dict) else {}
        lines.append(f"- {effort}: reviews {_fmt(row.get('reviews'))}, cost_usd "
                     f"{_fmt(row.get('cost_usd'), 6)}, known_cost_usd {_fmt(row.get('known_cost_usd'), 6)}, "
                     f"unknown_cost_entries {_fmt(row.get('unknown_cost_entries'))}, latency_ms count "
                     f"{_fmt(latency.get('count'))} min {_fmt(latency.get('min'))} p50 {_fmt(latency.get('p50'))} "
                     f"p90 {_fmt(latency.get('p90'))} max {_fmt(latency.get('max'))}")


def _validation(lines: list[str], validation: Any) -> None:
    validation = validation if isinstance(validation, dict) else {}
    lines.extend(["## Validation controls", ""])
    matching = validation.get("matching") if isinstance(validation.get("matching"), dict) else {}
    line = (f"- matching: matches {_fmt(matching.get('matches'))}; structural "
            f"{_fmt((matching.get('method_counts') or {}).get('structural'))}; adjudicated "
            f"{_fmt((matching.get('method_counts') or {}).get('adjudicated'))}; uncertain band "
            f"{_fmt(matching.get('uncertain_band'))}")
    lines.append(line)
    adjudication = validation.get("adjudication") if isinstance(validation.get("adjudication"), dict) else {}
    lines.append(f"- adjudication: double_labelled {_fmt(adjudication.get('double_labelled'))}, kappa "
                 f"{_fmt(adjudication.get('kappa'))}, labeler {_fmt(adjudication.get('labeler_model'))}, "
                 f"second labeler {_fmt(adjudication.get('second_labeler_model'))}")
    null = validation.get("shuffled_null") if isinstance(validation.get("shuffled_null"), dict) else {}
    lines.append(f"- shuffled null: seed {_fmt(null.get('seed'))}, method {_fmt(null.get('method'))}")
    leak = validation.get("leak_check") if isinstance(validation.get("leak_check"), dict) else {}
    errors = leak.get("request_errors") if isinstance(leak.get("request_errors"), list) else []
    lines.append(f"- leak check: pass {_fmt(leak.get('pass'))}, scope {_fmt(leak.get('scope'))}, requests "
                 f"checked {_fmt(leak.get('requests_checked'))}, own plan document hits "
                 f"{_fmt(leak.get('own_plan_document_hits'))}, outcome text hits "
                 f"{_fmt(leak.get('outcome_text_hits'))}, foreign plan document captures "
                 f"{_fmt(leak.get('foreign_plan_document_captures'))}, request errors {_fmt(len(errors))}")


def _reproducibility(lines: list[str], reproducibility: Any) -> None:
    reproducibility = reproducibility if isinstance(reproducibility, dict) else {}
    lines.extend(["## Reproducibility", ""])
    for key in ("manifest_sha256", "seed", "ledger_sha256", "export_sha256", "report_sha256"):
        lines.append(f"- {key}: {_fmt(reproducibility.get(key))}")


def _reconciliation(lines: list[str], reconciliation: Any) -> None:
    reconciliation = reconciliation if isinstance(reconciliation, dict) else {}
    lines.extend(["## Reconciliation", ""])
    for key in ("canonical_records", "completed_records", "completed_without_canonical_id",
                "completed_without_cost", "unknown_cost_entries", "missing_from_export", "cost_basis"):
        lines.append(f"- {key}: {_fmt(reconciliation.get(key))}")


def render(report: dict) -> str:
    """Render a ``report.build_report`` result as deterministic Markdown."""
    report = report if isinstance(report, dict) else {}
    lines = ["# Shadow review trial report", ""]
    _population(lines, report.get("population"))
    lines.append("")
    _comparisons(lines, report.get("comparisons"), report.get("cost_latency"))
    lines.append("")
    _validation(lines, report.get("validation"))
    lines.append("")
    _reproducibility(lines, report.get("reproducibility"))
    lines.append("")
    _reconciliation(lines, report.get("reconciliation"))
    return "\n".join(lines) + "\n"
