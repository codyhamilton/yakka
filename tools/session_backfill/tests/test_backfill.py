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
    label_session,
    read_session,
    write_labels,
    main,
    yakka,
)


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")


def claude_session(root, name, prompt=None, skills=(), commands=(), texts=()):
    rows = []
    if prompt is not None:
        rows.append({"type": "user", "message": {"role": "user", "content": prompt}})
    for skill, args in skills:
        rows.append({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "tool_use", "name": "Skill", "input": {"skill": skill, "args": args}}
        ]}})
    for command, args in commands:
        content = f"<command-name>{command}</command-name>"
        if args:
            content += f"<command-args>{args}</command-args>"
        rows.append({"type": "user", "message": {"role": "user", "content": content}})
    for text in texts:
        rows.append({"type": "assistant", "message": {"role": "assistant", "content": [
            {"type": "text", "text": text}
        ]}})
    write_jsonl(root / name, rows)


def cursor_session(root, project, sid, prompt):
    write_jsonl(root / project / "agent-transcripts" / sid / f"{sid}.jsonl",
                [{"role": "user", "message": {"content": [{"type": "text", "text": prompt}]}}])


def codex_session(root, name, prompt, sid="cx"):
    rows = []
    if sid is not None:
        rows.append({"type": "session_meta", "payload": {"id": sid, "cwd": "/repo"}})
    if prompt is not None:
        rows.append({"type": "event_msg", "payload": {"type": "user_message", "message": prompt}})
    write_jsonl(root / name, rows)


def opencode_session(root, sid, prompt):
    mid = f"{sid}-m"
    write_jsonl(root / "session" / "proj" / f"{sid}.json", [{"id": sid}])
    write_jsonl(root / "message" / sid / f"{mid}.json",
                [{"id": mid, "sessionID": sid, "role": "user"}])
    write_jsonl(root / "part" / mid / "p.json",
                [{"messageID": mid, "type": "text", "text": prompt}])


def first_label(root, store):
    return next(iter([label_session(s, "owner/repo") for s in discover({store: root})]))


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
                    part.write_text(json.dumps({"messageID": "m1", "type": "text", "text": "docs/plans/22-demo"}))
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
                json.dumps({"type": "event_msg", "payload": {"type": "user_message", "message": "docs/plans/22-session-work-tagging/briefs/5-04-signal-rule-rebuild.md"}}),
            ]) + "\n")

            session = next(iter(discover({"codex": root / "codex"})))
            self.assertEqual(session.session_id, transcript_id)
            label = label_session(session, "owner/repo")
            self.assertEqual(label.status, "labelled")
            self.assertEqual(label.action["kind"], "build")
            self.assertEqual(label.action["phase"], "5")
            self.assertEqual(label.confidence, 1.0)
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
            for payload in (None, {}, {"id": ""}, {"id": 123}, {"id": "bad/id"}, {"meta": {"id": ""}}):
                with self.subTest(payload=payload):
                    rows = [{"type": "event_msg", "payload": {"type": "user_message", "message": "docs/plans/22-demo/briefs/5-01-demo.md"}}]
                    if payload is not None:
                        rows.insert(0, {"type": "session_meta", "payload": payload})
                    path.write_text("\n".join(json.dumps(row) for row in rows) + "\n")
                    labels = root / "labels.jsonl"
                    queue = root / "queue"
                    output = io.StringIO()
                    with contextlib.redirect_stdout(output):
                        result = main(["--root", f"codex={store}", "--repo", "owner/repo",
                                       "--labels", str(labels),
                                       "--enqueue", "--queue-dir", str(queue)])
                    self.assertEqual(result, 0)
                    summary = json.loads(output.getvalue())
                    self.assertEqual(summary["total"]["sessions"], 1)
                    self.assertEqual(summary["stores"]["codex"]["unreadable"], 1)
                    self.assertEqual(summary["emitted"], 0)
                    label = json.loads(labels.read_text())
                    self.assertEqual(label["session_id"], "")
                    self.assertEqual(label["source_file"], str(path))
                    self.assertIn("session_meta", label["evidence"])
                    self.assertEqual(list(queue.glob("*.evt")), [])

    def test_codex_unparseable_rollout_is_unreadable(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "rollout-unreadable-metadata.jsonl"
            for raw in ("", "not json\n", '{"type":"session_meta","payload":'):
                with self.subTest(raw=raw):
                    path.write_text(raw)
                    sessions = list(discover({"codex": Path(td)}))
                    self.assertEqual(len(sessions), 1)
                    label = label_session(sessions[0], "owner/repo")
                    self.assertEqual(label.status, "unreadable")
                    self.assertEqual(label.session_id, "")
                    self.assertEqual(label.source_file, str(path))
                    # A later pass marking it labelled must still never enqueue
                    # an action without a recovered identity.
                    label.status = "labelled"
                    self.assertEqual(enqueue([label], str(Path(td) / "queue")), 0)

    def test_claude_skill_table_classifies_each_family(self):
        cases = [
            ("design", "docs/plans/22-demo phase 2", "design", "planning"),
            ("workflow:plan", "docs/plans/22-demo phase 2", "design", "planning"),
            ("plan", "docs/plans/22-demo phase 2", "design", "planning"),
            ("planning", "docs/plans/22-demo phase 2", "design", "planning"),
            ("refine", "docs/plans/22-demo phase 2", "refine", "refining"),
            ("execute", "docs/plans/22-demo phase 2", "build", "executing"),
            ("plan-execution", "docs/plans/22-demo phase 2", "build", "executing"),
        ]
        for skill, args, kind, signal_class in cases:
            with self.subTest(skill=skill), tempfile.TemporaryDirectory() as td:
                root = Path(td) / "claude"
                claude_session(root, "s.jsonl", skills=[(skill, args)])
                label = first_label(root, "claude")
                self.assertEqual(label.status, "labelled")
                self.assertEqual(label.action["kind"], kind)
                self.assertEqual(label.signal_class, signal_class)
                self.assertEqual(label.confidence, 1.0)

    def test_claude_command_name_slash_command_is_a_signal(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "claude"
            claude_session(root, "s.jsonl", commands=[("/yakka:execute", "docs/plans/22-demo phase 3")])
            label = first_label(root, "claude")
            self.assertEqual(label.status, "labelled")
            self.assertEqual(label.action["kind"], "build")
            self.assertEqual(label.action["phase"], "3")
            self.assertEqual(label.confidence, 1.0)

    def test_cursor_skill_block_classifies_and_ignores_non_workflow(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "cursor"
            cursor_session(root, "proj", "cu", "<manually_attached_skills>\nSkill name yakka:execute\n</manually_attached_skills>\ndocs/plans/22-demo phase 2")
            label = first_label(root, "cursor")
            self.assertEqual(label.status, "labelled")
            self.assertEqual(label.action["kind"], "build")
            self.assertEqual(label.signal_class, "executing")
            self.assertEqual(label.confidence, 0.65)
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "cursor"
            cursor_session(root, "proj", "cu", "<manually_attached_skills>\nSkill name other-skill\n</manually_attached_skills>\nhello")
            label = first_label(root, "cursor")
            self.assertEqual(label.status, "no_signal")

    def test_brief_path_labels_each_store(self):
        brief = "docs/plans/22-demo/briefs/5-01-demo.md"
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            claude_session(root / "claude", "s.jsonl", prompt=brief)
            codex_session(root / "codex", "rollout-s.jsonl", brief)
            cursor_session(root / "cursor", "proj", "cu", brief)
            opencode_session(root / "opencode", "op", brief)
            for store in ("claude", "codex", "cursor", "opencode"):
                with self.subTest(store=store):
                    label = first_label(root / store, store)
                    self.assertEqual(label.status, "labelled")
                    self.assertEqual(label.action["kind"], "build")
                    self.assertEqual(label.signal_class, "brief")
                    self.assertEqual(label.action["phase"], "5")
                    self.assertEqual(label.action["subject_type"], "plan")
                    self.assertEqual(label.confidence, 1.0)

    def test_repeated_skill_is_one_signal(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "claude"
            claude_session(root, "s.jsonl", skills=[("design", "docs/plans/22-demo phase 2"),
                                                    ("design", "docs/plans/22-demo phase 2")])
            label = first_label(root, "claude")
            self.assertEqual(label.status, "labelled")
            self.assertEqual(label.signal_class, "planning")

    def test_two_workflow_skills_are_multi_signal(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "claude"
            claude_session(root, "s.jsonl", skills=[("design", "docs/plans/22-demo phase 2"),
                                                    ("execute", "docs/plans/22-demo phase 2")])
            label = first_label(root, "claude")
            self.assertEqual(label.status, "multi_signal")
            self.assertEqual(label.action, {})

    def test_skill_plus_brief_path_is_multi_signal(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "claude"
            claude_session(root, "s.jsonl",
                           prompt="docs/plans/22-demo/briefs/5-01-demo.md",
                           skills=[("execute", "docs/plans/22-demo phase 2")])
            label = first_label(root, "claude")
            self.assertEqual(label.status, "multi_signal")

    def test_close_out_and_post_build_alone_are_no_signal(self):
        for skill in ("close-out", "post-build", "comprehensive-review", "iterate"):
            with self.subTest(skill=skill), tempfile.TemporaryDirectory() as td:
                root = Path(td) / "claude"
                claude_session(root, "s.jsonl", skills=[(skill, "docs/plans/22-demo phase 2")])
                label = first_label(root, "claude")
                self.assertEqual(label.status, "no_signal")

    def test_no_signal_is_unlabelled(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "claude"
            claude_session(root, "s.jsonl", prompt="hello there")
            label = first_label(root, "claude")
            self.assertEqual(label.status, "no_signal")
            self.assertEqual(enqueue([label], str(Path(td) / "queue")), 0)

    def test_single_signal_without_subject_is_no_subject_and_not_enqueued(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "claude"
            claude_session(root, "s.jsonl", skills=[("execute", "")])
            label = first_label(root, "claude")
            self.assertEqual(label.status, "no_subject")
            self.assertEqual(label.action, {})
            self.assertEqual(enqueue([label], str(Path(td) / "queue")), 0)

    def test_confidence_tiers(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "claude"
            claude_session(root, "args.jsonl", skills=[("execute", "docs/plans/22-demo phase 2")])
            label = first_label(root, "claude")
            self.assertEqual((label.status, label.confidence), ("labelled", 1.0))
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "claude"
            claude_session(root, "fallback.jsonl", skills=[("execute", "")],
                           texts=["docs/plans/22-demo phase 2"])
            label = first_label(root, "claude")
            self.assertEqual((label.status, label.confidence), ("labelled", 0.65))
            self.assertIn("subject:fallback", label.evidence)

    def test_claude_subagents_are_not_discovered_and_are_counted(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "claude"
            claude_session(root, "parent/s.jsonl", prompt="hello")
            claude_session(root, "parent/subagents/child.jsonl",
                           skills=[("execute", "docs/plans/22-demo phase 2")])
            sessions = list(discover({"claude": root}))
            self.assertEqual([s.session_id for s in sessions], ["s"])
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                main(["--root", f"claude={root}", "--labels", str(Path(td) / "labels.jsonl")])
            summary = json.loads(output.getvalue())
            self.assertEqual(summary["stores"]["claude"]["sessions"], 1)
            self.assertEqual(summary["stores"]["claude"]["skipped_subagent"], 1)
            self.assertEqual(summary["stores"]["claude"]["transcripts_discovered"], 2)

    def test_cursor_subagents_are_skipped_and_counted(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "cursor"
            cursor_session(root, "proj", "cu", "hello")
            sub = root / "proj" / "agent-transcripts" / "cu" / "subagents" / "child.jsonl"
            write_jsonl(sub, [{"role": "user", "message": {"content": [{"type": "text", "text": "hello"}]}}])
            sessions = list(discover({"cursor": root}))
            self.assertEqual([s.session_id for s in sessions], ["cu"])
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                main(["--root", f"cursor={root}", "--labels", str(Path(td) / "labels.jsonl")])
            summary = json.loads(output.getvalue())
            self.assertEqual(summary["stores"]["cursor"]["skipped_child"], 1)
            self.assertEqual(summary["stores"]["cursor"]["transcripts_discovered"], 2)

    def test_duplicate_conversation_ids_are_one_row_one_enqueue(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            brief = "docs/plans/22-demo/briefs/5-01-demo.md"
            for project in ("empty-window", "garcia"):
                cursor_session(root / "cursor", project, "dup-1", brief)
            sessions = list(discover({"cursor": root / "cursor"}))
            self.assertEqual([s.session_id for s in sessions], ["dup-1"])
            labels = [label_session(s, "owner/repo") for s in sessions]
            queue = root / "queue"
            self.assertEqual(enqueue(labels, str(queue)), 1)
            self.assertEqual(len(list(queue.glob("*.evt"))), 1)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                main(["--root", f"cursor={root / 'cursor'}", "--labels", str(root / "labels.jsonl")])
            summary = json.loads(output.getvalue())
            self.assertEqual(summary["stores"]["cursor"]["duplicate_ids"], 1)
            self.assertEqual(summary["stores"]["cursor"]["duplicate_transcripts"], 1)
            self.assertEqual(summary["stores"]["cursor"]["sessions"], 1)
            self.assertEqual(len((root / "labels.jsonl").read_text().splitlines()), 1)

    def test_report_reconciles_with_discovery(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            brief = "docs/plans/22-demo/briefs/5-01-demo.md"
            claude_session(root / "claude", "a/labelled.jsonl", prompt=brief)
            claude_session(root / "claude", "a/nosignal.jsonl", prompt="hello")
            claude_session(root / "claude", "a/subagents/child.jsonl", prompt=brief)
            claude_session(root / "claude", "dup/s1.jsonl", prompt=brief)
            claude_session(root / "claude", "dup2/s1.jsonl", prompt=brief)
            codex_session(root / "codex", "rollout-labelled.jsonl", brief, sid="cx")
            codex_session(root / "codex", "rollout-missing.jsonl", brief, sid=None)
            write_jsonl(root / "codex" / "rollout-unreadable.jsonl", [])
            cursor_session(root / "cursor", "proj", "cu",
                           "<manually_attached_skills>\nSkill name yakka:execute\n</manually_attached_skills>\ndocs/plans/22-demo phase 2")
            write_jsonl(root / "cursor" / "proj" / "agent-transcripts" / "cu" / "subagents" / "child.jsonl",
                        [{"role": "user", "message": {"content": [{"type": "text", "text": "hello"}]}}])
            opencode_session(root / "opencode", "op", brief)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                result = main(["--root", f"claude={root / 'claude'}", "--root", f"codex={root / 'codex'}",
                               "--root", f"cursor={root / 'cursor'}", "--root", f"opencode={root / 'opencode'}",
                               "--repo", "owner/repo", "--labels", str(root / "labels.jsonl")])
            self.assertEqual(result, 0)
            summary = json.loads(output.getvalue())
            for name, row in {**summary["stores"], "total": summary["total"]}.items():
                with self.subTest(row=name):
                    self.assertEqual(row["sessions"],
                                     row["labelled"] + row["multi_signal"] + row["no_signal"]
                                     + row["no_subject"] + row["unreadable"])
                    self.assertEqual(row["labelled"], sum(row["labelled_by_signal"].values()))
                    self.assertEqual(row["transcripts_discovered"],
                                     row["sessions"] + row["skipped_subagent"] + row["skipped_child"]
                                     + row["duplicate_transcripts"])
            total = summary["total"]
            self.assertEqual(total["sessions"], 8)
            self.assertEqual(total["labelled"], 5)
            self.assertEqual(total["labelled_by_signal"], {"planning": 0, "refining": 0, "executing": 1, "brief": 4})
            self.assertEqual(total["no_signal"], 1)
            self.assertEqual(total["unreadable"], 2)
            self.assertEqual(total["skipped_subagent"], 1)
            self.assertEqual(total["skipped_child"], 1)
            self.assertEqual(total["duplicate_ids"], 1)
            self.assertEqual(total["duplicate_transcripts"], 1)
            self.assertEqual(total["transcripts_discovered"], 11)

    def test_cli_dry_run_has_count_report_and_no_enqueue(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            store = root / "claude"
            claude_session(store, "s.jsonl", prompt="docs/plans/22-demo/briefs/5-01-demo.md")
            labels = root / "labels.jsonl"
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                result = main(["--root", f"claude={store}", "--repo", "owner/repo", "--labels", str(labels)])
            summary = json.loads(output.getvalue())
            self.assertEqual(result, 0)
            self.assertEqual(summary["stores"]["claude"]["labelled"], 1)
            self.assertEqual(summary["stores"]["claude"]["labelled_by_signal"]["brief"], 1)
            self.assertNotIn("emitted", summary)
            self.assertTrue(labels.exists())
            self.assertFalse((root / "queue").exists())

    def test_evidence_scrub(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "claude"
            claude_session(root, "s.jsonl", skills=[("execute", "API_KEY=secret docs/plans/22-demo phase 2")])
            label = first_label(root, "claude")
            self.assertNotIn("secret", label.evidence)
            self.assertLessEqual(len(label.evidence), 300)

    def test_label_file_and_enqueue_are_repeatable_offline(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "labels.jsonl"
            queue = Path(td) / "queue"
            root = Path(td) / "claude"
            claude_session(root, "session-1.jsonl", prompt="docs/plans/22-demo/briefs/5-01-demo.md")
            label = first_label(root, "claude")
            self.assertEqual(label.status, "labelled")
            write_labels(path, [label])
            self.assertEqual(json.loads(path.read_text().splitlines()[0])["session_id"], "session-1")
            self.assertEqual(enqueue([label], str(queue)), 1)
            first = sorted(queue.glob("*.evt"))
            self.assertEqual(enqueue([label], str(queue)), 1)
            self.assertEqual(sorted(queue.glob("*.evt")), first)
            envelope, payload = first[0].read_text().splitlines()
            self.assertEqual(json.loads(envelope)["event"], "yakka.session_action")
            self.assertEqual(payload, "{}")

    def test_unreadable_transcripts_are_labelled_unreadable_not_dropped(self):
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
                self.assertEqual(label.status, "unreadable")
                self.assertEqual(label.session_id, session.session_id)
                self.assertEqual(label.source_file, session.path)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                main(["--root", f"claude={root / 'claude'}", "--root", f"cursor={root / 'cursor'}",
                      "--root", f"opencode={root / 'opencode'}", "--labels", str(root / "labels.jsonl")])
            summary = json.loads(output.getvalue())
            self.assertEqual(summary["total"]["sessions"], 4)
            self.assertEqual(summary["total"]["unreadable"], 4)
            self.assertEqual(len((root / "labels.jsonl").read_text().splitlines()), 4)


if __name__ == "__main__":
    unittest.main()
