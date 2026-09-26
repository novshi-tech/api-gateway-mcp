"""Tests the skill scripts against a local fake gateway.

Run: python3 -m unittest discover -s test/scripts
"""
import csv
import http.server
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SKILLS = os.path.join(ROOT, "plugins", "api-gateway", "skills")
GW_REQUEST = os.path.join(SKILLS, "api-gateway", "scripts", "gw_request.py")
BOARD_ALL = os.path.join(SKILLS, "board", "scripts", "board_all.py")

TOTAL_ITEMS = 250


class FakeGateway(http.server.BaseHTTPRequestHandler):
    requests = []

    def log_message(self, *args):
        pass

    def record(self, body=b""):
        FakeGateway.requests.append(
            {"method": self.command, "path": self.path, "headers": dict(self.headers), "body": body}
        )

    def send(self, status, body, content_type="application/json", headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.record()
        url = urllib.parse.urlsplit(self.path)
        query = dict(urllib.parse.parse_qsl(url.query))
        if url.path == "/api/board/v1/projects":
            page, per_page = int(query.get("page", 1)), int(query.get("per_page", 10))
            start = (page - 1) * per_page
            items = [{"id": i, "name": f"p{i}"} for i in range(start, min(start + per_page, TOTAL_ITEMS))]
            self.send(200, json.dumps(items).encode(), headers={"X-Total-Count": str(TOTAL_ITEMS)})
        elif url.path == "/api/graph/redirect":
            port = self.server.server_address[1]
            self.send(302, b"", headers={"Location": f"http://127.0.0.1:{port}/download/file.pdf"})
        elif url.path == "/download/file.pdf":
            self.send(200, bytes(range(256)), content_type="application/pdf")
        elif url.path == "/api/board/v1/forbidden":
            self.send(403, json.dumps({"message": "許可されていません。"}).encode())
        else:
            self.send(404, b"{}")

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.record(body)
        self.send(201, json.dumps({"ok": True}).encode())


class SkillScriptsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeGateway)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        port = cls.server.server_address[1]
        cls.env = {**os.environ, "GW_TOKEN": "tok", "GW_BASE_URL": f"http://127.0.0.1:{port}/api/"}

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        FakeGateway.requests = []
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, *args, check=True):
        result = subprocess.run([sys.executable, *args], env=self.env, capture_output=True, cwd=self.tmp.name)
        if check and result.returncode != 0:
            self.fail(result.stderr.decode())
        return result

    def test_get_sends_token_user_agent_and_query(self):
        out = self.run_script(GW_REQUEST, "GET", "board", "/v1/projects", "-q", "per_page=2", "-q", "name_cont=保守")
        self.assertEqual(len(json.loads(out.stdout)), 2)
        req = FakeGateway.requests[0]
        self.assertEqual(req["headers"]["Authorization"], "Bearer tok")
        self.assertTrue(req["headers"]["User-Agent"].startswith("api-gateway-client"))
        self.assertIn("name_cont=%E4%BF%9D%E5%AE%88", req["path"])
        self.assertIn("X-Total-Count: 250", out.stderr.decode())

    def test_json_body(self):
        self.run_script(GW_REQUEST, "POST", "board", "/v1/clients", "--json", '{"name": "株式会社テスト"}')
        req = FakeGateway.requests[0]
        self.assertEqual(req["headers"]["Content-Type"], "application/json")
        self.assertEqual(json.loads(req["body"]), {"name": "株式会社テスト"})

    def test_multipart_upload(self):
        path = os.path.join(self.tmp.name, "invoice.pdf")
        with open(path, "wb") as f:
            f.write(bytes(range(256)))
        self.run_script(GW_REQUEST, "POST", "freee", "/api/1/receipts", "-f", "company_id=1", "--file", f"receipt={path}")
        req = FakeGateway.requests[0]
        self.assertTrue(req["headers"]["Content-Type"].startswith("multipart/form-data; boundary="))
        self.assertIn(b'name="company_id"\r\n\r\n1\r\n', req["body"])
        self.assertIn(b'filename="invoice.pdf"\r\nContent-Type: application/pdf\r\n\r\n' + bytes(range(256)), req["body"])

    def test_download_follows_redirect_without_token_on_other_host(self):
        self.env_other_host = dict(self.env)
        # Same server under another host name, so the redirect crosses hosts.
        self.env["GW_BASE_URL"] = self.env["GW_BASE_URL"].replace("127.0.0.1", "localhost")
        try:
            self.run_script(GW_REQUEST, "GET", "graph", "/redirect", "-o", "out.pdf")
        finally:
            self.env = self.env_other_host
        with open(os.path.join(self.tmp.name, "out.pdf"), "rb") as f:
            self.assertEqual(f.read(), bytes(range(256)))
        first, second = FakeGateway.requests
        self.assertEqual(first["headers"]["Authorization"], "Bearer tok")
        self.assertNotIn("Authorization", second["headers"])

    def test_http_error_exits_non_zero(self):
        result = self.run_script(GW_REQUEST, "GET", "board", "/v1/forbidden", check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("HTTP 403", result.stderr.decode())

    def test_requires_token(self):
        env = {k: v for k, v in self.env.items() if k != "GW_TOKEN"}
        result = subprocess.run([sys.executable, GW_REQUEST, "GET", "board", "/v1"], env=env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)

    def test_board_all_fetches_every_page(self):
        self.run_script(BOARD_ALL, "/v1/projects", "-q", "order_status_in[]=4", "-o", "all.json")
        with open(os.path.join(self.tmp.name, "all.json"), encoding="utf-8") as f:
            items = json.load(f)
        self.assertEqual([i["id"] for i in items], list(range(TOTAL_ITEMS)))
        self.assertEqual(len(FakeGateway.requests), 3)
        self.assertTrue(all("order_status_in%5B%5D=4" in r["path"] for r in FakeGateway.requests))

    def test_board_all_csv(self):
        out = self.run_script(BOARD_ALL, "/v1/projects", "--csv", "id,name")
        rows = list(csv.reader(io.StringIO(out.stdout.decode())))
        self.assertEqual(rows[0], ["id", "name"])
        self.assertEqual(rows[1], ["0", "p0"])
        self.assertEqual(len(rows), TOTAL_ITEMS + 1)


if __name__ == "__main__":
    unittest.main()
