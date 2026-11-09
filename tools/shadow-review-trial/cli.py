#!/usr/bin/env python3
"""Offline historical manifest command. No network or provider calls."""
import argparse
import json
import pathlib

from manifest import ManifestFrozenError, create_manifest


def main(argv=None):
    parser = argparse.ArgumentParser(prog="shadow-review-trial")
    commands = parser.add_subparsers(dest="command", required=True)
    manifest = commands.add_parser("manifest", help="freeze historical cases and comparator evidence")
    manifest.add_argument("--repo", type=pathlib.Path, default=pathlib.Path.cwd())
    manifest.add_argument("--output", type=pathlib.Path, required=True)
    manifest.add_argument("--seed", type=int, default=1)
    manifest.add_argument("--target", type=int, default=50)
    manifest.add_argument("--comparators", type=pathlib.Path)
    manifest.add_argument("--pr-export", type=pathlib.Path)
    args = parser.parse_args(argv)
    try:
        frozen = create_manifest(args.repo, args.output, args.seed, args.target, args.comparators, args.pr_export)
    except (ManifestFrozenError, ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps({"manifest": str(args.output.resolve()), "manifest_sha256": frozen["manifest_sha256"],
                      "candidates": len(frozen["candidates"]), "eligible": len(frozen["cases"]),
                      "shortages": frozen["shortages"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
