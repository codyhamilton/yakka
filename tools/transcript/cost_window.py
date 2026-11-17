#!/usr/bin/env python3
"""Attribute usage-CSV tokens to a session by time window."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone


def _to_int(s: str) -> int:
    try:
        return int(s)
    except (TypeError, ValueError):
        return 0


def load_window(args) -> tuple[str, str, set[str], str]:
    session_models: set[str] = set()
    session_id = ""
    if args.start and args.end:
        return args.start, args.end, session_models, session_id

    raw = sys.stdin.read()
    if not raw.strip():
        sys.exit(
            "No window: pipe extract.py output, or pass --start and --end.\n"
            "  e.g. extract.py SESSION_ID PROJECT | cost_window.py --csv FILE"
        )
    data = json.loads(raw)
    session = data.get("session", {})
    session_id = session.get("id", "")
    start_iso = session.get("start_time_iso")
    end_iso = session.get("end_time_iso")
    if not (start_iso and end_iso):
        sys.exit("Extracted session has no start/end time; pass --start/--end.")

    pad = timedelta(minutes=args.pad_minutes)
    start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00")) - pad
    end_dt = datetime.fromisoformat(end_iso.replace("Z", "+00:00")) + pad
    start = start_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    end = end_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M")

    for t in data.get("agent_spawns", []):
        m = t.get("model") or ""
        if m:
            session_models.add(m)
    return start, end, session_models, session_id


_COMPONENTS = ("fresh_in", "cache_write", "cache_read", "output")
_RATE_KEY = {
    "fresh_in": "input",
    "cache_write": "cache_write",
    "cache_read": "cache_read",
    "output": "output",
}


def _cost(tokens: dict, rates: dict) -> dict:
    rows = tokens.get("usage_rows")
    if rows and rates.get("tiers"):
        total = dict.fromkeys(_COMPONENTS, 0.0)
        for row in rows:
            row_split = _cost(row, rates)
            for key in _COMPONENTS:
                total[key] += row_split[key]
        return total
    input_size = sum(tokens.get(k, 0) for k in ("fresh_in", "cache_write", "cache_read"))
    applicable = rates
    for tier in rates.get("tiers", []):
        minimum = tier.get("min_input_tokens", 0)
        maximum = tier.get("max_input_tokens")
        if input_size >= minimum and (maximum is None or input_size <= maximum):
            applicable = tier
            break
    return {k: tokens[k] * applicable[_RATE_KEY[k]] / 1_000_000 for k in _COMPONENTS}


def _row_matches_filters(
    row: dict,
    *,
    models: set[str] | None,
    exclude_models: re.Pattern[str] | None,
    kinds: set[str] | None,
) -> bool:
    model = row.get("Model", "") or ""
    kind = row.get("Kind", "") or ""
    if models and model not in models:
        return False
    if exclude_models and exclude_models.search(model):
        return False
    if kinds and kind not in kinds:
        return False
    return True


def compute(
    csv_path: str,
    start: str,
    end: str,
    session_models: set[str],
    pricing: dict | None = None,
    substitute: tuple[str, str] | None = None,
    *,
    models: set[str] | None = None,
    exclude_models: re.Pattern[str] | None = None,
    kinds: set[str] | None = None,
) -> dict:
    if not os.path.exists(csv_path):
        sys.exit(f"CSV not found: {csv_path}")
    by_model: dict[str, dict] = defaultdict(
        lambda: {
            "total": 0,
            "output": 0,
            "cache_read": 0,
            "cache_write": 0,
            "fresh_in": 0,
            "events": 0,
            "usage_rows": [],
        }
    )
    in_window = 0
    skipped_filter = 0
    events: list[dict] = []
    cost_labels: dict[str, int] = defaultdict(int)
    with open(csv_path, newline="") as fh:
        for r in csv.DictReader(fh):
            date = r.get("Date", "")
            if not (start <= date <= end + "￿"):
                continue
            if not _row_matches_filters(
                r, models=models, exclude_models=exclude_models, kinds=kinds
            ):
                skipped_filter += 1
                continue
            in_window += 1
            events.append(
                {
                    "date": date,
                    "model": r.get("Model", ""),
                    "kind": r.get("Kind", ""),
                    "fresh_in": _to_int(r.get("Input (w/o Cache Write)", "")),
                    "cache_write": _to_int(r.get("Input (w/ Cache Write)", "")),
                    "cache_read": _to_int(r.get("Cache Read", "")),
                    "output": _to_int(r.get("Output Tokens", "")),
                    "total": _to_int(r.get("Total Tokens", "")),
                }
            )
            m = r.get("Model", "unknown") or "unknown"
            b = by_model[m]
            b["total"] += _to_int(r.get("Total Tokens", ""))
            b["output"] += _to_int(r.get("Output Tokens", ""))
            b["cache_read"] += _to_int(r.get("Cache Read", ""))
            b["cache_write"] += _to_int(r.get("Input (w/ Cache Write)", ""))
            b["fresh_in"] += _to_int(r.get("Input (w/o Cache Write)", ""))
            b["events"] += 1
            b["usage_rows"].append({
                "fresh_in": _to_int(r.get("Input (w/o Cache Write)", "")),
                "cache_write": _to_int(r.get("Input (w/ Cache Write)", "")),
                "cache_read": _to_int(r.get("Cache Read", "")),
                "output": _to_int(r.get("Output Tokens", "")),
            })
            cost_labels[r.get("Cost", "") or "(blank)"] += 1

    cost = None
    if pricing:
        priced, unpriced = {}, []
        for m, b in by_model.items():
            rates = pricing.get(m)
            if not rates:
                unpriced.append(m)
                continue
            split = _cost(b, rates)
            priced[m] = {
                "split": split,
                "total": sum(split.values()),
                "cache_read_share": round(100 * split["cache_read"] / sum(split.values()), 1)
                if sum(split.values())
                else 0.0,
                "output_share": round(100 * split["output"] / sum(split.values()), 1)
                if sum(split.values())
                else 0.0,
            }
        grand = sum(p["total"] for p in priced.values())
        cost = {
            "by_model": dict(sorted(priced.items(), key=lambda kv: -kv[1]["total"])),
            "grand_total": grand,
            "unpriced_models": sorted(unpriced),
        }
        if substitute:
            src, dst = substitute
            if src in by_model and dst in pricing:
                cur = priced.get(src, {}).get("total", 0.0)
                new_split = _cost(by_model[src], pricing[dst])
                new_total = sum(new_split.values())
                cost["substitution"] = {
                    "from": src,
                    "to": dst,
                    "current_cost": cur,
                    "new_cost": new_total,
                    "saving": cur - new_total,
                    "saving_pct": round(100 * (cur - new_total) / cur, 1) if cur else 0.0,
                    "new_grand_total": grand - cur + new_total,
                }

    total_tokens = sum(b["total"] for b in by_model.values())
    foreign = sorted(m for m in by_model if session_models and m not in session_models)
    foreign_tokens = sum(by_model[m]["total"] for m in foreign)
    return {
        "window_start": start,
        "window_end": end,
        "in_window_events": in_window,
        "skipped_filter": skipped_filter,
        "events": events,
        "total_tokens": total_tokens,
        "session_models": sorted(session_models),
        "by_model": {
            m: by_model[m] for m in sorted(by_model, key=lambda k: -by_model[k]["total"])
        },
        "foreign_models": foreign,
        "foreign_tokens": foreign_tokens,
        "foreign_pct": round(100 * foreign_tokens / total_tokens, 1) if total_tokens else 0.0,
        "attribution_confidence_pct": round(100 - (100 * foreign_tokens / total_tokens), 1)
        if total_tokens
        else None,
        "cost_labels": dict(cost_labels),
        "cost": cost,
    }


def print_text(c: dict) -> None:
    print("=" * 64)
    print("COST WINDOW (timestamp-correlated — no session join key exists)")
    print("=" * 64)
    print(f"  Window        : {c['window_start']}  ->  {c['window_end']}")
    print(f"  Events        : {c['in_window_events']}")
    if c.get("skipped_filter"):
        print(f"  Skipped       : {c['skipped_filter']} (model/kind filter)")
    print(f"  Total tokens  : {c['total_tokens']:,}")
    if c.get("events"):
        print()
        print("EVENTS (one row per API call — a session spans many)")
        print("-" * 64)
        for ev in c["events"]:
            mode = "miss" if ev["cache_read"] == 0 else "hit "
            print(
                f"  {ev['date'][11:19]} {ev['model']:<22} {mode}"
                f"  fresh={ev['fresh_in']:>7,} read={ev['cache_read']:>9,}"
                f" out={ev['output']:>5,}"
            )
    print()
    print("TOKENS BY MODEL")
    print("-" * 64)
    sess = set(c["session_models"])
    for m, b in c["by_model"].items():
        flag = "" if (not sess or m in sess) else "  << FOREIGN"
        print(f"  {m:<34} {b['total']:>14,} tok  {b['events']:>3} ev{flag}")
    print()
    print("ATTRIBUTION CONFIDENCE")
    print("-" * 64)
    if not sess:
        print("  No session model list (used --start/--end without a piped session).")
    elif c["foreign_models"]:
        print(
            f"  Foreign models : {', '.join(c['foreign_models'])} "
            f"({c['foreign_pct']}% of window tokens)"
        )
        print(f"  Confidence     : ~{c['attribution_confidence_pct']}%")
    else:
        print("  Every in-window model was used by the session — window is clean (~100%).")
    print()
    print("COST COLUMN (Cursor subscription accounting, not dollars)")
    print("-" * 64)
    for label, n in sorted(c["cost_labels"].items(), key=lambda x: -x[1]):
        print(f"  {label:<12} {n:>4} events")

    cost = c.get("cost")
    if cost:
        print()
        print("DOLLAR COST (computed from pricing.json)")
        print("-" * 64)
        for m, p in cost["by_model"].items():
            print(f"  {m:<28} ${p['total']:>8.2f}")
        print("-" * 64)
        print(f"  {'GRAND TOTAL':<28} ${cost['grand_total']:>8.2f}")


def load_pricing(path: str | None) -> dict | None:
    if path is None:
        default = os.path.join(os.path.dirname(__file__), "pricing.json")
        path = default if os.path.exists(default) else None
    if not path:
        return None
    if not os.path.exists(path):
        sys.exit(f"Pricing file not found: {path}")
    with open(path) as f:
        data = json.load(f)
    return {k: v for k, v in data.items() if not k.startswith("_")}


def main() -> None:
    p = argparse.ArgumentParser(
        description="Attribute usage-CSV tokens to a session by time window."
    )
    p.add_argument("--csv", required=True, help="usage export CSV path")
    p.add_argument("--start", help="window start ISO prefix (with --end, skips stdin)")
    p.add_argument("--end", help="window end ISO prefix")
    p.add_argument(
        "--pad-minutes", type=int, default=1, help="widen session window each side (default 1)"
    )
    p.add_argument("--pricing", default=None, help="pricing JSON path")
    p.add_argument("--no-pricing", action="store_true", help="skip dollar cost")
    p.add_argument("--substitute", metavar="FROM:TO", help="what-if model substitution")
    p.add_argument(
        "--model",
        action="append",
        metavar="NAME",
        help="include only this model (repeatable)",
    )
    p.add_argument(
        "--exclude-model",
        metavar="REGEX",
        default=r"grok-bot|automation",
        help="exclude models matching regex (default: grok-bot|automation)",
    )
    p.add_argument(
        "--no-exclude-model",
        action="store_true",
        help="do not exclude any models by regex",
    )
    p.add_argument(
        "--kind",
        action="append",
        metavar="NAME",
        help="include only this Kind column value (repeatable)",
    )
    p.add_argument("--format", choices=["text", "json"], default="text")
    args = p.parse_args()

    start, end, session_models, _ = load_window(args)
    pricing = None if args.no_pricing else load_pricing(args.pricing)
    sub = None
    if args.substitute:
        if ":" not in args.substitute:
            sys.exit("--substitute must be FROM:TO")
        sub = tuple(args.substitute.split(":", 1))
    exclude = None
    if not args.no_exclude_model and args.exclude_model:
        exclude = re.compile(args.exclude_model)
    result = compute(
        args.csv,
        start,
        end,
        session_models,
        pricing=pricing,
        substitute=sub,
        models=set(args.model) if args.model else None,
        exclude_models=exclude,
        kinds=set(args.kind) if args.kind else None,
    )

    if args.format == "json":
        print(json.dumps(result, indent=2))
    else:
        print_text(result)


if __name__ == "__main__":
    main()
