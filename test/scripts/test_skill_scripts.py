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
GRAPH_ALL = os.path.join(SKILLS, "microsoft-graph", "scripts", "graph_all.py")
FREEE_ALL = os.path.join(SKILLS, "freee", "scripts", "freee_all.py")

TOTAL_ITEMS = 250


GRAPH_PAGE = 100


class FakeGateway(http.server.BaseHTTPRequestHandler):
    requests = []
    throttled = False

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
        elif url.path == "/api/graph/v1.0/me/messages":
            if query.get("throttle") and not FakeGateway.throttled:
                FakeGateway.throttled = True
                self.send(429, b"{}", headers={"Retry-After": "0"})
                return
            start = int(query.get("$skiptoken", 0))
            body = {"value": [{"id": i, "from": {"address": f"u{i}@example.com"}} for i in range(start, min(start + GRAPH_PAGE, TOTAL_ITEMS))]}
            if start + GRAPH_PAGE < TOTAL_ITEMS:
                body["@odata.nextLink"] = (
                    f"https://graph.microsoft.com/v1.0/me/messages?%24select=id,from&%24skiptoken={start + GRAPH_PAGE}"
                )
            self.send(200, json.dumps(body).encode())
        elif url.path == "/api/graph/v1.0/me/elsewhere":
            self.send(200, json.dumps({"value": [], "@odata.nextLink": "https://evil.example.com/v1.0/x"}).encode())
        elif url.path == "/api/freee/api/1/deals":
            offset, limit = int(query.get("offset", 0)), int(query.get("limit", 20))
            deals = [{"id": i, "amount": i * 10} for i in range(offset, min(offset + limit, TOTAL_ITEMS))]
            self.send(200, json.dumps({"deals": deals, "meta": {"total_count": TOTAL_ITEMS}}).encode())
        elif url.path == "/api/freee/api/1/ambiguous":
            self.send(200, json.dumps({"a": [], "b": []}).encode())
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
        FakeGateway.throttled = False
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

    def test_path_and_query_are_percent_encoded(self):
        self.run_script(
            GW_REQUEST, "GET", "graph", "/v1.0/me/drive/root:/請求書 2026:/children", "-q", "$filter=isRead eq false",
            check=False,
        )
        path = FakeGateway.requests[0]["path"]
        self.assertTrue(path.startswith("/api/graph/v1.0/me/drive/root:/%E8%AB%8B%E6%B1%82%E6%9B%B8%202026:/children?"))
        self.assertTrue(path.endswith("?$filter=isRead%20eq%20false"))

    def test_already_encoded_path_is_not_encoded_twice(self):
        self.run_script(GW_REQUEST, "GET", "graph", "/v1.0/me/drive/root:/a%20b:/children", check=False)
        self.assertEqual(FakeGateway.requests[0]["path"], "/api/graph/v1.0/me/drive/root:/a%20b:/children")

    def test_graph_all_follows_next_link_through_gateway(self):
        self.run_script(GRAPH_ALL, "/v1.0/me/messages", "-q", "$select=id,from", "-o", "all.json")
        with open(os.path.join(self.tmp.name, "all.json"), encoding="utf-8") as f:
            items = json.load(f)
        self.assertEqual([i["id"] for i in items], list(range(TOTAL_ITEMS)))
        self.assertEqual(len(FakeGateway.requests), 3)
        for req in FakeGateway.requests:
            self.assertTrue(req["path"].startswith("/api/graph/v1.0/me/messages?"))
            self.assertEqual(req["headers"]["Authorization"], "Bearer tok")
            self.assertTrue(req["headers"]["User-Agent"].startswith("api-gateway-client"))
        self.assertIn("skiptoken=100", FakeGateway.requests[1]["path"])

    def test_graph_all_csv_with_nested_field(self):
        out = self.run_script(GRAPH_ALL, "/v1.0/me/messages", "--csv", "id,from.address")
        rows = list(csv.reader(io.StringIO(out.stdout.decode())))
        self.assertEqual(rows[:2], [["id", "from.address"], ["0", "u0@example.com"]])
        self.assertEqual(len(rows), TOTAL_ITEMS + 1)

    def test_graph_all_retries_after_429(self):
        self.run_script(GRAPH_ALL, "/v1.0/me/messages", "-q", "throttle=1", "--max-pages", "1", "-o", "one.json")
        self.assertEqual(len(FakeGateway.requests), 2)

    def test_graph_all_refuses_next_link_to_other_host(self):
        result = self.run_script(GRAPH_ALL, "/v1.0/me/elsewhere", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unexpected nextLink host", result.stderr.decode())
        self.assertEqual(len(FakeGateway.requests), 1)

    def test_freee_all_pages_with_offset_and_limit(self):
        self.run_script(FREEE_ALL, "/api/1/deals", "-q", "company_id=123", "-o", "deals.json")
        with open(os.path.join(self.tmp.name, "deals.json"), encoding="utf-8") as f:
            items = json.load(f)
        self.assertEqual([i["id"] for i in items], list(range(TOTAL_ITEMS)))
        offsets = [dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(r["path"]).query)) for r in FakeGateway.requests]
        self.assertEqual([o["offset"] for o in offsets], ["0", "100", "200"])
        self.assertTrue(all(o["company_id"] == "123" and o["limit"] == "100" for o in offsets))
        self.assertEqual(FakeGateway.requests[0]["headers"]["Authorization"], "Bearer tok")

    def test_freee_all_csv(self):
        out = self.run_script(FREEE_ALL, "/api/1/deals", "-q", "company_id=1", "--limit", "250", "--csv", "id,amount")
        rows = list(csv.reader(io.StringIO(out.stdout.decode())))
        self.assertEqual(rows[:2], [["id", "amount"], ["0", "0"]])
        self.assertEqual(len(rows), TOTAL_ITEMS + 1)
        self.assertEqual(len(FakeGateway.requests), 1)

    def test_freee_all_needs_key_when_ambiguous(self):
        result = self.run_script(FREEE_ALL, "/api/1/ambiguous", "-q", "company_id=1", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--key", result.stderr.decode())


if __name__ == "__main__":
    unittest.main()
