"""Read-only, metric-only check over a shadow review trial evidence folder."""
import fnmatch
import json
import pathlib

NAME_PATTERNS = ("manifest*.json", "*manifest*.json", "*export*.json", "run-export*.json")
SHAPE_SIGNATURES = (
    frozenset({"manifest_sha256", "cases"}),
    frozenset({"reviews", "pages"}),
    frozenset({"manifest_hash", "entries"}),
)


def _name_matches(name):
    lowered = name.lower()
    return any(fnmatch.fnmatchcase(lowered, pattern) for pattern in NAME_PATTERNS)


def _shape_matches(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if not isinstance(data, dict):
        return False
    keys = data.keys()
    return any(signature <= keys for signature in SHAPE_SIGNATURES)


def check_folder(folder):
    """Return a metric-only verdict for every file under ``folder``."""
    folder = pathlib.Path(folder)
    files_checked = 0
    offenders = []
    for path in sorted(folder.rglob("*")):
        if not path.is_file():
            continue
        files_checked += 1
        if _name_matches(path.name) or (path.suffix.lower() == ".json" and _shape_matches(path)):
            offenders.append(path.relative_to(folder).as_posix())
    offenders.sort()
    return {
        "pass": not offenders,
        "folder": str(folder),
        "files_checked": files_checked,
        "offenders": offenders,
    }


def require_metric_only(folder):
    """Raise ``ValueError`` when the folder still holds local trial data."""
    result = check_folder(folder)
    if not result["pass"]:
        raise ValueError("evidence folder contains local trial data: " + ", ".join(result["offenders"]))
    return result
