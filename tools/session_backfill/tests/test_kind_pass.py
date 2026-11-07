import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import kind_pass  # noqa: E402
import typesafe_kind as tk  # noqa: E402

FAKE_AWS = "AKIAIOSFODNN7EXAMPLE"
FAKE_GH = "ghp_" + "A" * 36


def _write_session(root: Path, name: str, text: str) -> None:
    path = root / "claude" / "proj" / f"{name}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"text": text}) + "\n", encoding="utf-8")


def _write_truth(logs: Path, n: int, session_id: str, kind: str) -> None:
    logs.mkdir(parents=True, exist_ok=True)
    (logs / f"par-22-session-work-tagging-6-claude-{n}.log").write_text(
        f"session_id={session_id}\nkind={kind}\n", encoding="utf-8")


def _answer(choice, confidence):
    return {"answers": {tk.QUESTION_ID: {"choice": choice, "confidence": confidence}}}


class FakeTransport:
    """Answers by marker in the prompt. Records every request it receives."""

    def __init__(self, rules):
        self.rules = rules
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        prompt = request["state"]["prompt"]
        for marker, outcome in self.rules:
            if marker in prompt:
                if isinstance(outcome, BaseException):
                    raise outcome
                return outcome
        return {"answers": {}}


class PromptAndRequestTests(unittest.TestCase):
    def test_secret_across_cut_is_removed_before_truncation(self):
        text = "x" * 980 + " password=hunter2hunter2hunter2hunter2 tail"
        prefix = tk.prompt_prefix(text)
        self.assertLessEqual(len(prefix), tk.PROMPT_PREFIX_CHARS)
        self.assertNotIn("hunter2", prefix)

    def test_assignment_and_token_shapes_are_removed(self):
        prefix = tk.prompt_prefix(f"api_key=abc123 token {FAKE_GH} and {FAKE_AWS} ok")
        self.assertNotIn("abc123", prefix)
        self.assertNotIn("A" * 36, prefix)
        self.assertNotIn(FAKE_AWS, prefix)
        self.assertIn("ok", prefix)

    def test_only_first_nonempty_line_is_used(self):
        self.assertEqual(tk.prompt_prefix("\n\n  first line\nsecond"), "first line")

    def test_request_state_has_only_prompt_and_schema_is_valid(self):
        request = tk.build_kind_request("hello")
        self.assertEqual(request["state"], {"prompt": "hello"})
        self.assertEqual(set(request), {"model", "state", "questions"})
        self.assertEqual(request["model"], tk.jev_client.JEV_MODEL)
        tk.jev_client.validate_systemone_request(request)

    def test_criteria_map_has_exactly_eleven_labels(self):
        criteria = tk.build_kind_request("x")["questions"][tk.QUESTION_ID]["criteria"]
        self.assertIsInstance(criteria, dict)
        self.assertEqual(
            set(criteria),
            {"design", "refine", "build", "review", "fix", "close-out", "sync",
             "escalation", "triage", "research", "unclear"},
        )
        self.assertEqual(len(criteria), 11)


class AnswerTests(unittest.TestCase):
    def test_parse_outcomes(self):
        cases = [
            (_answer("build", 0.9), ("build", 0.9, "")),
            (_answer("unclear", 0.7), ("unclear", 0.7, "model_unclear")),
            (_answer("bogus", 0.9), ("unclear", 0.0, "invalid_answer")),
            (_answer("build", 1.5), ("unclear", 0.0, "invalid_answer")),
            (_answer("build", -0.1), ("unclear", 0.0, "invalid_answer")),
            (_answer("build", "high"), ("unclear", 0.0, "invalid_answer")),
            (_answer("build", True), ("unclear", 0.0, "invalid_answer")),
            (_answer("build", float("nan")), ("unclear", 0.0, "invalid_answer")),
            ({"answers": {}}, ("unclear", 0.0, "invalid_answer")),
            ({}, ("unclear", 0.0, "invalid_answer")),
            ("not a dict", ("unclear", 0.0, "invalid_answer")),
        ]
        for response, expected in cases:
            with self.subTest(response=response):
                self.assertEqual(tk.parse_answer(response), expected)

    def test_transport_error_and_systemexit_are_isolated(self):
        for error in (RuntimeError("boom"), SystemExit("HTTP 500")):
            with self.subTest(error=type(error).__name__):
                result = tk.classify_prompt("p", FakeTransport([("p", error)]))
                self.assertEqual((result.kind, result.reason), (tk.UNCLEAR, "transport_error"))

    def test_empty_prompt_makes_no_call(self):
        transport = FakeTransport([])
        result = tk.classify_prompt("", transport)
        self.assertEqual(result.reason, "empty_prompt")
        self.assertEqual(transport.requests, [])


class ThresholdAndAccuracyTests(unittest.TestCase):
    def test_lowest_qualifying_confidence_excludes_unclear(self):
        pairs = [
            ("build", tk.KindResult("fix", 0.6, "", "")),
            ("build", tk.KindResult("build", 0.8, "", "")),
            ("fix", tk.KindResult("fix", 0.8, "", "")),
            ("fix", tk.KindResult("fix", 0.9, "", "")),
            ("build", tk.KindResult(tk.UNCLEAR, 0.99, "model_unclear", "")),
        ]
        self.assertEqual(kind_pass.compute_threshold(pairs), (0.8, "ok"))

    def test_no_qualifying_confidence_gives_none(self):
        pairs = [("build", tk.KindResult("fix", 0.5, "", "")), ("build", tk.KindResult("fix", 0.9, "", ""))]
        self.assertEqual(kind_pass.compute_threshold(pairs), (None, "accuracy_bar_not_met"))

    def test_empty_or_unclear_only_gold_gives_none(self):
        self.assertEqual(kind_pass.compute_threshold([]), (None, "no_gold_answers"))
        only_unclear = [("build", tk.KindResult(tk.UNCLEAR, 0.9, "invalid_answer", ""))]
        self.assertEqual(kind_pass.compute_threshold(only_unclear), (None, "no_gold_answers"))

    def test_confusion_rows_sum_to_gold_count(self):
        pairs = [
            ("build", tk.KindResult("build", 0.9, "", "")),
            ("build", tk.KindResult("fix", 0.9, "", "")),
            ("build", tk.KindResult(tk.UNCLEAR, 0.0, "invalid_answer", "")),
            ("fix", tk.KindResult("fix", 0.9, "", "")),
        ]
        report = kind_pass.accuracy(pairs)
        self.assertEqual(report["labelled"], 4)
        self.assertEqual(report["correct"], 2)
        self.assertEqual(report["per_kind"]["build"], {"labelled": 3, "correct": 1, "accuracy": 0.3333})
        for kind, row in report["confusion"].items():
            self.assertEqual(sum(row.values()), report["per_kind"][kind]["labelled"])
        self.assertEqual(report["confusion"]["build"]["unclear"], 1)


class RoutingTests(unittest.TestCase):
    def _target(self, sid):
        label = kind_pass.Label(sid, "claude", "partial", {"subject_type": "plan", "subject_id": "o/r:plan/22-x"}, source_file="f")
        return kind_pass.Target(label, "prefix")

    def test_routing_outcomes(self):
        results = [
            (self._target("hi"), tk.KindResult("fix", 0.95, "", "hi")),
            (self._target("lo"), tk.KindResult("fix", 0.4, "", "lo")),
            (self._target("unc"), tk.KindResult(tk.UNCLEAR, 0.99, "model_unclear", "unc")),
            (self._target("bad"), tk.KindResult(tk.UNCLEAR, 0.0, "invalid_answer", "bad")),
            (self._target("err"), tk.KindResult(tk.UNCLEAR, 0.0, "transport_error", "err")),
        ]
        completed, review = kind_pass.route(results, 0.9)
        self.assertEqual([label.session_id for label in completed], ["hi"])
        self.assertEqual(completed[0].status, "complete")
        self.assertEqual(completed[0].action["kind"], "fix")
        self.assertEqual({row["session_id"]: row["reason"] for row in review},
                         {"lo": "below_threshold", "unc": "model_unclear",
                          "bad": "invalid_answer", "err": "transport_error"})

    def test_no_threshold_completes_nothing(self):
        results = [(self._target("hi"), tk.KindResult("fix", 0.99, "", "hi"))]
        completed, review = kind_pass.route(results, None)
        self.assertEqual(completed, [])
        self.assertEqual(review[0]["reason"], "no_threshold")


class PassTests(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.base = Path(self._td.name)
        self.roots = {"claude": self.base / "claude"}
        self.logs = self.base / "logs"
        self.queue = self.base / "queue"
        self.review = self.base / "review.jsonl"
        for i in range(10):
            _write_session(self.base, f"g{i}", f"GOLD build task {i} docs/plans/22-session-work-tagging/DESIGN.md")
            _write_truth(self.logs, i, f"g{i}", "build")
        for name, text in {
            "t_hi": "TARGET-HI fix the thing docs/plans/22-session-work-tagging/DESIGN.md",
            "t_lo": "TARGET-LO fix maybe docs/plans/22-session-work-tagging/DESIGN.md",
            "t_unc": "TARGET-UNCLEAR docs/plans/22-session-work-tagging/DESIGN.md",
            "t_bad": "TARGET-BAD docs/plans/22-session-work-tagging/DESIGN.md",
            "t_err": "TARGET-ERR docs/plans/22-session-work-tagging/DESIGN.md",
        }.items():
            _write_session(self.base, name, text)
        self.rules = [
            ("GOLD", _answer("build", 0.9)),
            ("TARGET-HI", _answer("fix", 0.95)),
            ("TARGET-LO", _answer("fix", 0.4)),
            ("TARGET-UNCLEAR", _answer("unclear", 0.99)),
            ("TARGET-BAD", {"answers": {tk.QUESTION_ID: {"choice": "bogus", "confidence": 0.9}}}),
            ("TARGET-ERR", RuntimeError("fake network down")),
        ]

    def tearDown(self):
        self._td.cleanup()

    def test_dry_run_makes_no_call_and_writes_nothing(self):
        with mock.patch.object(tk.jev_client, "post_systemone", side_effect=AssertionError("network call")) as post:
            report = kind_pass.run_pass(self.roots, repo="o/r", queue_logs=self.logs)
        post.assert_not_called()
        self.assertEqual(report["mode"], "dry_run")
        self.assertEqual((report["targets"], report["gold"]), (5, 10))
        self.assertIsNone(report["threshold"])
        self.assertIsNone(report["completed"])
        self.assertEqual(report["enqueued"], 0)
        self.assertFalse(self.review.exists())
        self.assertFalse(self.queue.exists())

    def test_live_routes_threshold_and_isolates_errors(self):
        transport = FakeTransport(self.rules)
        report = kind_pass.run_pass(self.roots, repo="o/r", queue_logs=self.logs,
                                    transport=transport, review_path=self.review)
        self.assertEqual(report["threshold"], 0.9)
        self.assertEqual(report["accuracy"]["accuracy"], 1.0)
        self.assertEqual(report["accuracy"]["confusion"]["build"]["build"], 10)
        self.assertEqual(report["completed"], 1)
        self.assertEqual(report["review"], {"below_threshold": 1, "model_unclear": 1,
                                            "invalid_answer": 1, "transport_error": 1})
        rows = [json.loads(line) for line in self.review.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(rows), 4)
        for row in rows:
            self.assertEqual(set(row), {"session_id", "store", "action", "predicted_kind",
                                        "confidence", "reason", "prompt_prefix"})
        # Every request carried only the prompt, from the fake transport.
        for request in transport.requests:
            self.assertEqual(set(request["state"]), {"prompt"})

    def test_enqueue_writes_typesafe_fact_once_and_is_idempotent(self):
        transport = FakeTransport(self.rules)
        kwargs = dict(repo="o/r", queue_logs=self.logs, transport=transport,
                      enqueue_facts=True, queue_dir=str(self.queue), review_path=self.review)
        first = kind_pass.run_pass(self.roots, **kwargs)
        files = sorted(p.name for p in self.queue.glob("*.evt"))
        self.assertEqual(first["enqueued"], 1)
        self.assertEqual(len(files), 1)
        body = (self.queue / files[0]).read_text(encoding="utf-8")
        self.assertIn("typesafe", body)
        self.assertNotIn("deterministic", body)
        second = kind_pass.run_pass(self.roots, **kwargs)
        self.assertEqual(second["enqueued"], 1)
        self.assertEqual(sorted(p.name for p in self.queue.glob("*.evt")), files)

    def test_no_gold_means_no_threshold_and_no_enqueue(self):
        empty_logs = self.base / "no-logs"
        empty_logs.mkdir()
        transport = FakeTransport(self.rules)
        report = kind_pass.run_pass(self.roots, repo="o/r", queue_logs=empty_logs,
                                    transport=transport, enqueue_facts=True,
                                    queue_dir=str(self.queue), review_path=self.review)
        self.assertIsNone(report["threshold"])
        self.assertEqual(report["threshold_reason"], "no_gold_answers")
        self.assertEqual(report["enqueued"], 0)
        self.assertFalse(self.queue.exists())

    def test_enqueue_without_transport_is_refused(self):
        with self.assertRaises(ValueError):
            kind_pass.run_pass(self.roots, queue_logs=self.logs, enqueue_facts=True)


class CliTests(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.base = Path(self._td.name)
        _write_session(self.base, "t_hi", "TARGET-HI fix docs/plans/22-session-work-tagging/DESIGN.md")
        self.root_arg = f"claude={self.base / 'claude'}"

    def tearDown(self):
        self._td.cleanup()

    def test_dry_run_prints_report_and_never_calls_network(self):
        out = io.StringIO()
        with mock.patch.object(tk.jev_client, "post_systemone", side_effect=AssertionError("network call")) as post:
            with contextlib.redirect_stdout(out):
                code = kind_pass.main(["--root", self.root_arg, "--repo", "o/r"])
        post.assert_not_called()
        self.assertEqual(code, 0)
        report = json.loads(out.getvalue())
        self.assertEqual(report["mode"], "dry_run")
        self.assertEqual(report["targets"], 1)
        self.assertIsNone(report["threshold"])

    def test_enqueue_without_live_is_refused(self):
        with mock.patch.object(tk.jev_client, "post_systemone", side_effect=AssertionError("network call")) as post:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as cm:
                kind_pass.main(["--root", self.root_arg, "--enqueue"])
        post.assert_not_called()
        self.assertEqual(cm.exception.code, 2)

    def test_live_without_confirm_is_refused(self):
        with mock.patch.object(tk.jev_client, "post_systemone", side_effect=AssertionError("network call")) as post:
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as cm:
                kind_pass.main(["--root", self.root_arg, "--live"])
        post.assert_not_called()
        self.assertEqual(cm.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
