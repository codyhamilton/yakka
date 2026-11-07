"""Keep server owned protocol and wording out of the client shim."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


CLIENT = Path(__file__).resolve().parent
REPO = CLIENT.parents[2]
CORPUS = REPO / "packages/yakka/internal/serve/testdata/mcp-golden"
SOURCE = CLIENT / "yakka.py"


def shim_section(source: str) -> str:
    return source.split("# --- mcp ---", 1)[1].split("# --- login ---", 1)[0]


def forbidden_literals() -> dict[str, str]:
    values: dict[str, str] = {}
    for file in CORPUS.glob("*.json"):
        corpus = json.loads(file.read_text())
        for tool in corpus.get("tools", []):
            name = tool.get("name")
            description = tool.get("description")
            if name:
                values[f"tool:{name}"] = name
            if description:
                values[f"description:{name}"] = description
            schema = tool.get("inputSchema")
            if schema:
                values[f"schema:{name}"] = json.dumps(schema, sort_keys=True, separators=(",", ":"))
        if corpus.get("instructions"):
            values["instructions"] = corpus["instructions"]
        for call in corpus.get("calls", []):
            if call.get("text"):
                values[f"result:{call.get('name', '')}"] = call["text"]
    return values


def violations(section: str) -> list[str]:
    found = []
    for label, literal in forbidden_literals().items():
        if label.startswith("tool:"):
            if re.search(r"(?<![A-Za-z0-9_])" + re.escape(literal) + r"(?![A-Za-z0-9_])", section):
                found.append(label)
        elif literal in section:
            found.append(label)
    return found


class ShimGuardTests(unittest.TestCase):
    def test_shipped_shim_has_no_server_owned_surface(self) -> None:
        section = shim_section(SOURCE.read_text())
        self.assertEqual(violations(section), [])

    def test_guard_rejects_planted_tool_name_corpus_line_and_schema(self) -> None:
        section = shim_section(SOURCE.read_text())
        literals = forbidden_literals()
        for label in ("tool:artifact_feedback", "result:artifact_feedback", "schema:artifact_feedback"):
            with self.subTest(fixture=label):
                self.assertIn(label, violations(section + "\n# " + literals[label]))

    def test_legacy_test_module_has_no_tool_wording_contracts(self) -> None:
        source = (CLIENT / "test_mcp.py").read_text()
        self.assertIn("test_mcp_shim", source)
        self.assertNotIn("artifact_feedback", source)
        self.assertNotIn("search_artifacts", source)
        self.assertNotIn("list_checks", source)


if __name__ == "__main__":
    unittest.main()
