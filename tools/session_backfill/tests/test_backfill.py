import json
import contextlib
import io
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backfill import (
    Session,
    discover,
    enqueue,
    is_flash_analysis,
    label_session,
    parse_queue_logs,
    read_session,
    score_gold,
    summarize,
    write_labels,
    main,
)


class BackfillTests(unittest.TestCase):
    def test_discovers_all_four_stores_from_explicit_roots(self):
        with tempfile.TemporaryDirectory() as td:
            roots = {name: Path(td) / name for name in ("claude", "codex", "opencode", "cursor")}
            paths = {
                "claude": roots["claude"] / "project" / "c1.jsonl",
                "codex": roots["codex"] / "2026" / "rollout-c2.jsonl",
                "opencode": roots["opencode"] / "session" / "project" / "o3.json",
                "cursor": roots["cursor"] / "project" / "agent-transcripts" / "c4" / "c4.jsonl",
            }
            for store, path in paths.items():
                path.parent.mkdir(parents=True, exist_ok=True)
                if store == "opencode":
                    path.write_text(json.dumps({"id": "o3", "directory": "/repo"}))
                    message = roots["opencode"] / "message" / "o3" / "m1.json"
                    part = roots["opencode"] / "part" / "m1" / "p1.json"
                    message.parent.mkdir(parents=True, exist_ok=True)
                    part.parent.mkdir(parents=True, exist_ok=True)
                    message.write_text(json.dumps({"id": "m1", "sessionID": "o3", "role": "user"}))
                    part.write_text(json.dumps({"messageID": "m1", "text": "docs/plans/22-demo"}))
                else:
                    path.write_text(json.dumps({"session_id": path.stem, "cwd": "/repo", "text": "docs/plans/22-demo"}) + "\n")
            sessions = list(discover(roots))
            self.assertEqual({s.store for s in sessions}, set(roots))
            self.assertEqual({s.session_id for s in sessions}, {"c1", "rollout-c2", "o3", "c4"})
            self.assertIn("docs/plans/22-demo", next(s.text for s in sessions if s.store == "opencode"))

    def test_codex_backfill_uses_transcript_thread_id_for_queued_fact(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            transcript_id = "019b7c53-ec1d-7a10-8b9d-53e1c4f0c421"
            rollout = root / "codex" / "2026" / "rollout-2026-11-07T10-30-00-filename-stem.jsonl"
            rollout.parent.mkdir(parents=True)
            rollout.write_text("\n".join([
                json.dumps({"type": "session_meta", "payload": {"id": transcript_id, "session_id": "different-session-id", "cwd": "/repo"}}),
                json.dumps({"type": "response_item", "payload": {"text": "docs/plans/22-session-work-tagging phase 5"}}),
            ]) + "\n")

            session = next(iter(discover({"codex": root / "codex"})))
            self.assertEqual(session.session_id, transcript_id)
            label = label_session(session, "owner/repo", {transcript_id: {"plan": "22-session-work-tagging", "phase": "5", "kind": "build"}})
            label.status = "complete"
            queue = root / "queue"
            self.assertEqual(enqueue([label], str(queue)), 1)
            envelope = json.loads(next(queue.glob("*.evt")).read_text().splitlines()[0])
            self.assertEqual(envelope["conversation_id"], transcript_id)

    def test_queue_log_matching_and_masked_gold_agreement(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            log = root / "logs" / "par-22-session-work-tagging-5-codex-1.log"
            log.parent.mkdir()
            log.write_text('session_id="s-1"\naction=build\n')
            truth = parse_queue_logs(root)
            self.assertEqual(truth["s-1"]["plan"], "22-session-work-tagging")
            self.assertEqual(truth["s-1"]["phase"], "5")
            self.assertEqual(truth["s-1"]["kind"], "build")
            session = Session("s-1", "codex", "fixture", "Please edit docs/plans/22-session-work-tagging/DESIGN.md during phase 5", "/repo", "feat/22-session-work-tagging")
            masked = label_session(session, "owner/repo")
            correct, total, agreement = score_gold([masked], truth)
            self.assertEqual((correct, total, agreement), (1, 1, 1.0))

    def test_cli_dry_run_reports_categories_without_enqueue(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            store = root / "claude"
            store.mkdir()
            (store / "s.jsonl").write_text(json.dumps({"session_id": "s", "cwd": "/repo", "text": "docs/plans/22-demo"}) + "\n")
            labels = root / "labels.jsonl"
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                result = main(["--root", f"claude={store}", "--repo", "owner/repo", "--labels", str(labels)])
            summary = json.loads(output.getvalue())
            self.assertEqual(result, 0)
            self.assertEqual(summary["stores"]["claude"]["partial"], 1)
            self.assertEqual(summary["stores"]["claude"]["complete"], 0)
            self.assertTrue(labels.exists())
            self.assertEqual(list((root / "queue").glob("*.evt")) if (root / "queue").exists() else [], [])

    def test_label_categories_and_evidence_scrub(self):
        complete = Session("a", "claude", "fixture", "docs/plans/22-demo phase 2 API_KEY=secret", "/repo", "")
        partial = Session("b", "cursor", "fixture", "docs/plans/22-demo", "/repo", "")
        empty = Session("c", "opencode", "fixture", "hello", "", "")
        labels = [
            label_session(complete, "owner/repo", {"a": {"plan": "22-demo", "phase": "2", "kind": "build"}}),
            label_session(partial, "owner/repo"),
            label_session(empty, "owner/repo"),
        ]
        self.assertNotIn("secret", labels[0].evidence)
        self.assertEqual([x.status for x in labels], ["complete", "partial", "unresolved"])
        self.assertEqual(summarize(labels)["claude"]["complete"], 1)

    def test_flash_exclusion(self):
        self.assertTrue(is_flash_analysis(Session("f", "opencode", "x", "Automated Flash analysis rating", "", "")))
        self.assertFalse(is_flash_analysis(Session("n", "opencode", "x", "ordinary build work", "", "")))

    def test_label_file_and_enqueue_are_repeatable_offline(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "labels.jsonl"
            queue = Path(td) / "queue"
            label = label_session(Session("session-1", "codex", "fixture", "docs/plans/22-demo", "/repo", ""), "owner/repo", {"session-1": {"plan": "22-demo", "phase": "2", "kind": "build"}})
            label.status = "complete"
            label.action["kind"] = "build"
            write_labels(path, [label])
            self.assertEqual(json.loads(path.read_text().splitlines()[0])["session_id"], "session-1")
            self.assertEqual(enqueue([label], str(queue)), 1)
            first = sorted(queue.glob("*.evt"))
            self.assertEqual(enqueue([label], str(queue)), 1)
            self.assertEqual(sorted(queue.glob("*.evt")), first)
            envelope, payload = first[0].read_text().splitlines()
            self.assertEqual(json.loads(envelope)["event"], "yakka.session_action")
            self.assertEqual(payload, "{}")


if __name__ == "__main__":
    unittest.main()
