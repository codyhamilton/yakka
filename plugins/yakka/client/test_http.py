import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

import yakka


class _Recorder(BaseHTTPRequestHandler):
    seen: list = []

    def do_GET(self) -> None:
        self.seen.append(self.headers.get("User-Agent"))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args) -> None:
        pass


class TestUserAgent(unittest.TestCase):
    def setUp(self) -> None:
        _Recorder.seen = []
        self.srv = HTTPServer(("127.0.0.1", 0), _Recorder)
        Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.server_close)
        self.addCleanup(self.srv.shutdown)
        self.url = "http://127.0.0.1:%d/" % self.srv.server_port

    def test_both_openers_send_yakka_agent(self) -> None:
        import urllib.request

        for opener in (yakka._urlopen, yakka._urlopen_noredir):
            with opener(urllib.request.Request(self.url, method="GET")) as resp:
                self.assertEqual(resp.status, 200)
        want = "yakka-client/" + yakka._plugin_version_text()
        self.assertEqual(_Recorder.seen, [want, want])
        self.assertNotIn("Python-urllib", want)


if __name__ == "__main__":
    unittest.main()
