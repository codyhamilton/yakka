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
    yakka,
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
                elif store == "codex":
                    path.write_text(json.dumps({"type": "session_meta", "payload": {"id": "c2", "cwd": "/repo"}}) + "\n")
                else:
                    path.write_text(json.dumps({"session_id": path.stem, "cwd": "/repo", "text": "docs/plans/22-demo"}) + "\n")
            sessions = list(discover(roots))
            self.assertEqual({s.store for s in sessions}, set(roots))
            self.assertEqual({s.session_id for s in sessions}, {"c1", "c2", "o3", "c4"})
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
            self.assertEqual(label.status, "complete")
            queue = root / "queue"
            self.assertEqual(enqueue([label], str(queue)), 1)
            envelope = json.loads(next(queue.glob("*.evt")).read_text().splitlines()[0])
            self.assertEqual(envelope["conversation_id"], transcript_id)
            event = next(queue.glob("*.evt"))
            built = yakka.Build(None, [yakka.File(Name=event.name, Data=event.read_bytes())])[0]
            self.assertEqual(built.Reasons, [])
            self.assertEqual(len(built.Facts), 1)
            fact = json.loads(built.Facts[0])
            self.assertEqual(fact["type"], "session_action")
            self.assertEqual(fact["conversation_id"], transcript_id)

    def test_codex_metadata_ids_override_filename_and_other_record_ids(self):
        transcript_id = "019b7c53-ec1d-7a10-8b9d-53e1c4f0c421"
        payloads = [
            {"id": transcript_id},
            {"meta": {"id": transcript_id}},
            {"id": transcript_id, "meta": {"cwd": "/repo"}},
            {"id": transcript_id, "meta": {"id": "unrelated-nested-id"}},
        ]
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "rollout-unrelated-filename.jsonl"
            for payload in payloads:
                with self.subTest(payload=payload):
                    path.write_text("\n".join(json.dumps(row) for row in [
                        {"type": "response_item", "id": "message-id", "payload": {"id": "tool-id"}},
                        {"type": "session_meta", "payload": None},
                        {"type": "session_meta", "payload": payload},
                    ]) + "\n")
                    session = read_session(path, "codex", "caller-filename-stem")
                    self.assertEqual(session.session_id, transcript_id)

    def test_codex_missing_or_invalid_identity_stays_inspectable_without_enqueue(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            store = root / "codex"
            store.mkdir()
            path = store / "rollout-unresolved.jsonl"
            logs = root / "logs"
            logs.mkdir()
            # Even log truth matching the filename must not turn it into a
            # conversation ID when no usable transcript identity was found.
            (logs / "par-22-demo-5-codex-1.log").write_text('session_id="rollout-unresolved"\naction=build\n')
            for payload in (None, {}, {"id": ""}, {"id": 123}, {"id": "bad/id"}, {"meta": {"id": ""}}):
                with self.subTest(payload=payload):
                    rows = [{"type": "response_item", "payload": {"id": "message-id", "text": "docs/plans/22-demo phase 5"}}]
                    if payload is not None:
                        rows.insert(0, {"type": "session_meta", "payload": payload})
                    path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")
                    labels = root / "labels.jsonl"
                    queue = root / "queue"
                    output = io.StringIO()
                    with contextlib.redirect_stdout(output):
                        result = main(["--root", f"codex={store}", "--repo", "owner/repo",
                                       "--queue-logs", str(logs), "--labels", str(labels),
                                       "--enqueue", "--queue-dir", str(queue)])
                    self.assertEqual(result, 0)
                    summary = json.loads(output.getvalue())
                    self.assertEqual(summary["sessions"], 1)
                    self.assertEqual(summary["stores"]["codex"]["unresolved"], 1)
                    self.assertEqual(summary["emitted"], 0)
                    label = json.loads(labels.read_text())
                    self.assertEqual(label["session_id"], "")
                    self.assertEqual(label["source_file"], str(path))
                    self.assertIn("session_meta", label["evidence"])
                    self.assertEqual(list(queue.glob("*.evt")), [])

    def test_codex_unparseable_rollout_is_unresolved(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "rollout-unreadable-metadata.jsonl"
            for raw in ("", "not json\n", '{"type":"session_meta","payload":'):
                with self.subTest(raw=raw):
                    path.write_text(raw)
                    sessions = list(discover({"codex": Path(td)}))
                    self.assertEqual(len(sessions), 1)
                    label = label_session(sessions[0], "owner/repo")
                    self.assertEqual(label.status, "unresolved")
                    self.assertEqual(label.session_id, "")
                    self.assertEqual(label.source_file, str(path))
                    # A later pass accidentally marking it complete must still
                    # never enqueue an action without a recovered identity.
                    label.status = "complete"
                    self.assertEqual(enqueue([label], str(Path(td) / "queue")), 0)

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

    def test_unreadable_transcripts_are_labelled_unresolved_not_dropped(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            claude = root / "claude" / "project"
            claude.mkdir(parents=True)
            (claude / "empty.jsonl").write_bytes(b"")
            (claude / "garbage.jsonl").write_text("not json\n")
            cursor = root / "cursor" / "project" / "agent-transcripts" / "c9"
            cursor.mkdir(parents=True)
            (cursor / "c9.jsonl").write_text("{broken\n")
            opencode = root / "opencode" / "session" / "project"
            opencode.mkdir(parents=True)
            (opencode / "o9.json").write_text("{not json")
            roots = {"claude": root / "claude", "cursor": root / "cursor", "opencode": root / "opencode"}
            sessions = list(discover(roots))
            self.assertEqual(sorted(s.session_id for s in sessions), ["c9", "empty", "garbage", "o9"])
            self.assertTrue(all(s.unreadable for s in sessions))
            for session in sessions:
                label = label_session(session, "owner/repo")
                self.assertEqual(label.status, "unresolved")
                self.assertEqual(label.session_id, session.session_id)
                self.assertEqual(label.source_file, session.path)
            self.assertFalse((root / "queue").exists())
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                main(["--root", f"claude={root / 'claude'}", "--root", f"cursor={root / 'cursor'}",
                      "--root", f"opencode={root / 'opencode'}", "--labels", str(root / "labels.jsonl")])
            summary = json.loads(output.getvalue())
            self.assertEqual(summary["sessions"], 4)
            self.assertEqual(summary["unreadable"], 4)
            self.assertEqual(summary["coverage"]["incomplete"], 4)
            self.assertEqual(summary["stores"]["claude"]["unresolved"], 2)
            self.assertEqual(len((root / "labels.jsonl").read_text().splitlines()), 4)

    def test_duplicate_conversation_ids_are_reported_and_enqueued_once(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for project in ("empty-window", "garcia"):
                d = root / "cursor" / project / "agent-transcripts" / "dup-1"
                d.mkdir(parents=True)
                (d / "dup-1.jsonl").write_text(json.dumps({"text": "docs/plans/22-demo phase 2"}) + "\n")
            sessions = list(discover({"cursor": root / "cursor"}))
            self.assertEqual([s.session_id for s in sessions], ["dup-1", "dup-1"])
            truth = {"dup-1": {"plan": "22-demo", "phase": "2", "kind": "build", "queue_log": "x.log"}}
            labels = [label_session(s, "owner/repo", truth) for s in sessions]
            self.assertEqual([x.status for x in labels], ["complete", "complete"])
            queue = root / "queue"
            self.assertEqual(enqueue(labels, str(queue)), 1)
            self.assertEqual(len(list(queue.glob("*.evt"))), 1)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                main(["--root", f"cursor={root / 'cursor'}", "--labels", str(root / "labels.jsonl")])
            summary = json.loads(output.getvalue())
            self.assertEqual(summary["duplicate_conversation_ids"], 1)
            self.assertEqual(summary["sessions"], 2)


if __name__ == "__main__":
    unittest.main()
