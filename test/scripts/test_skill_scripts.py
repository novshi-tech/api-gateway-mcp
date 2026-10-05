"""Tests the skill scripts against a local fake gateway.

Run: python3 -m unittest discover -s test/scripts
"""
import csv
import base64
from email import policy
from email.parser import BytesParser
import http.server
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.parse
import zipfile
from xml.sax.saxutils import escape, quoteattr

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SKILLS = os.path.join(ROOT, "plugins", "api-gateway", "skills")
GW_REQUEST = os.path.join(SKILLS, "api-gateway", "scripts", "gw_request.py")
BOARD_ALL = os.path.join(SKILLS, "board", "scripts", "board_all.py")
GRAPH_ALL = os.path.join(SKILLS, "microsoft-graph", "scripts", "graph_all.py")
FREEE_ALL = os.path.join(SKILLS, "freee", "scripts", "freee_all.py")
BM_NEXT_GRAPHQL = os.path.join(SKILLS, "bm-next", "scripts", "bm_next_graphql.py")
BM_NEXT_ALL = os.path.join(SKILLS, "bm-next", "scripts", "bm_next_all.py")
BM_NEXT_TEMPLATE_CHECK = os.path.join(SKILLS, "bm-next", "scripts", "bm_next_template_check.py")
GMAIL_ALL = os.path.join(SKILLS, "gmail", "scripts", "gmail_all.py")
GMAIL_MIME = os.path.join(SKILLS, "gmail", "scripts", "gmail_mime.py")
DRIVE_ALL = os.path.join(SKILLS, "google-drive", "scripts", "drive_all.py")
CALENDAR_ALL = os.path.join(SKILLS, "google-calendar", "scripts", "calendar_all.py")

TOTAL_ITEMS = 250


GRAPH_PAGE = 100
BM_NEXT_PAGE = 100


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
        elif url.path in ("/api/gmail/gmail/v1/users/me/messages", "/api/drive/drive/v3/files", "/api/calendar/calendar/v3/calendars/primary/events", "/api/calendar/calendar/v3/users/me/calendarList", "/api/calendar/calendar/v3/calendars/primary/events/series1/instances"):
            if query.get("throttle") and not FakeGateway.throttled:
                FakeGateway.throttled = True
                self.send(429, b"{}", headers={"Retry-After": "0"})
                return
            key = "items" if "/api/calendar/" in url.path else ("messages" if "/api/gmail/" in url.path else "files")
            start = int(query.get("pageToken", 0))
            rows = [{"id": i, "name": f"file{i}", "threadId": f"thread{i}"} for i in range(start, min(start + 100, TOTAL_ITEMS))]
            if query.get("empty") and start == 100:
                rows = []
            body = {key: rows}
            if start + 100 < TOTAL_ITEMS:
                body["nextPageToken"] = str(start + 100)
            if query.get("loop"):
                body["nextPageToken"] = "100"
            if query.get("incomplete"):
                body["incompleteSearch"] = True
            # Model Google's partial-response field selection for the cursor.
            if "fields" in query and query["fields"] != "*" and "nextPageToken" not in query["fields"]:
                body.pop("nextPageToken", None)
            self.send(200, json.dumps(body).encode())
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
        if urllib.parse.urlsplit(self.path).path == "/api/bm-next/graphql":
            self.send(200, json.dumps(self.graphql(json.loads(body))).encode())
            return
        self.send(201, json.dumps({"ok": True}).encode())

    def graphql(self, request):
        query, variables = request["query"], request.get("variables") or {}
        if "boom" in query:
            # ビルメンNEXT answers GraphQL errors with HTTP 200.
            return {"errors": [{"message": "boom", "extensions": {"code": "AUTH_NOT_AUTHENTICATED"}}], "data": None}
        if "notpaged" in query:
            return {"data": {"myScopes": ["a"]}}
        if "works" in query:
            start = int(variables.get("from") or 0)
            end = min(start + BM_NEXT_PAGE, TOTAL_ITEMS)
            return {"data": {"works": {
                "results": [{"id": f"w{i}", "name": f"work {i}"} for i in range(start, end)],
                "continuationToken": str(end) if end < TOTAL_ITEMS else None,
            }}}
        return {"data": {"echo": {"variables": variables, "actAs": self.headers.get("X-Act-As-Organization")}}}


SPREADSHEET = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships"


def write_xlsx(path, sheets):
    """Writes the parts of an .xlsx that bm_next_template_check.py reads.

    sheets is [(name, {"A1": "text", ...}, ["A1:C2", ...table refs])]. Cells are
    inline strings; targets are relative, the way Excel writes them.
    """
    with zipfile.ZipFile(path, "w") as z:
        entries, links, table_no = [], [], 0
        for i, (name, cells, tables) in enumerate(sheets, 1):
            entries.append(f'<sheet name={quoteattr(name)} sheetId="{i}" r:id="rId{i}"/>')
            links.append(f'<Relationship Id="rId{i}" Target="worksheets/sheet{i}.xml" Type="ws"/>')
            rows = {}
            for ref, text in cells.items():
                rows.setdefault(int(ref.lstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZ")), []).append(
                    f'<c r="{ref}" t="inlineStr"><is><t>{escape(text)}</t></is></c>')
            sheet_rels, parts = [], []
            for j, ref in enumerate(tables, 1):
                table_no += 1
                sheet_rels.append(f'<Relationship Id="rId{j}" Target="../tables/table{table_no}.xml" Type="table"/>')
                parts.append(f'<tablePart r:id="rId{j}"/>')
                z.writestr(f"xl/tables/table{table_no}.xml",
                           f'<table xmlns="{SPREADSHEET}" id="{table_no}" name="T{table_no}" displayName="T{table_no}" ref="{ref}"/>')
            body = "".join(f'<row r="{r}">{"".join(c)}</row>' for r, c in sorted(rows.items()))
            z.writestr(f"xl/worksheets/sheet{i}.xml",
                       f'<worksheet xmlns="{SPREADSHEET}" xmlns:r="{RELATIONSHIPS}"><sheetData>{body}</sheetData>'
                       f'{"<tableParts>" + "".join(parts) + "</tableParts>" if parts else ""}</worksheet>')
            if sheet_rels:
                z.writestr(f"xl/worksheets/_rels/sheet{i}.xml.rels",
                           f'<Relationships xmlns="{PACKAGE}">{"".join(sheet_rels)}</Relationships>')
        z.writestr("xl/workbook.xml",
                   f'<workbook xmlns="{SPREADSHEET}" xmlns:r="{RELATIONSHIPS}"><sheets>{"".join(entries)}</sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", f'<Relationships xmlns="{PACKAGE}">{"".join(links)}</Relationships>')


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

    def test_bm_next_graphql_sends_query_variables_and_org_header(self):
        out = self.run_script(BM_NEXT_GRAPHQL, "{ echo }", "--vars", '{"year": 2026}', "--act-as", "org-1")
        self.assertEqual(json.loads(out.stdout), {"echo": {"variables": {"year": 2026}, "actAs": "org-1"}})
        req = FakeGateway.requests[0]
        self.assertEqual(req["method"], "POST")
        self.assertEqual(req["path"], "/api/bm-next/graphql")
        self.assertEqual(req["headers"]["Authorization"], "Bearer tok")
        self.assertEqual(req["headers"]["Content-Type"], "application/json")
        self.assertIn("api-gateway-client", req["headers"]["User-Agent"])
        self.assertEqual(json.loads(req["body"])["query"], "{ echo }")

    def test_bm_next_graphql_reads_query_and_vars_from_files(self):
        for name, text in (("q.graphql", "{ echo }"), ("v.json", '{"month": 9}')):
            with open(os.path.join(self.tmp.name, name), "w", encoding="utf-8") as f:
                f.write(text)
        out = self.run_script(BM_NEXT_GRAPHQL, "@q.graphql", "--vars", "@v.json")
        self.assertEqual(json.loads(out.stdout)["echo"]["variables"], {"month": 9})
        self.assertIsNone(json.loads(out.stdout)["echo"]["actAs"])

    def test_bm_next_graphql_exits_non_zero_on_graphql_errors_despite_http_200(self):
        result = self.run_script(BM_NEXT_GRAPHQL, "{ boom }", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("AUTH_NOT_AUTHENTICATED", result.stderr.decode())

    def test_bm_next_all_follows_continuation_token_as_from(self):
        self.run_script(BM_NEXT_ALL, "query($from: String) { works(from: $from) { results { id } continuationToken } }", "-o", "works.json")
        with open(os.path.join(self.tmp.name, "works.json"), encoding="utf-8") as f:
            items = json.load(f)
        self.assertEqual([i["id"] for i in items], [f"w{i}" for i in range(TOTAL_ITEMS)])
        sent = [json.loads(r["body"]).get("variables", {}).get("from") for r in FakeGateway.requests]
        self.assertEqual(sent, [None, "100", "200"])

    def test_bm_next_all_keeps_other_variables_and_csv(self):
        out = self.run_script(BM_NEXT_ALL, "{ works }", "--vars", '{"name": "x"}', "--csv", "id,name")
        rows = list(csv.reader(io.StringIO(out.stdout.decode())))
        self.assertEqual(rows[:2], [["id", "name"], ["w0", "work 0"]])
        self.assertEqual(len(rows), TOTAL_ITEMS + 1)
        self.assertTrue(all(json.loads(r["body"])["variables"]["name"] == "x" for r in FakeGateway.requests))

    def test_bm_next_all_rejects_a_query_that_is_not_a_page(self):
        result = self.run_script(BM_NEXT_ALL, "{ notpaged }", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("continuationToken", result.stderr.decode())

    def test_bm_next_all_exits_non_zero_on_graphql_errors(self):
        result = self.run_script(BM_NEXT_ALL, "{ boom }", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("AUTH_NOT_AUTHENTICATED", result.stderr.decode())

    def check_template(self, kind, sheets, *args):
        write_xlsx(os.path.join(self.tmp.name, "t.xlsx"), sheets)
        result = self.run_script(BM_NEXT_TEMPLATE_CHECK, kind, "t.xlsx", *args, check=False)
        return result.returncode, result.stdout.decode(), result.stderr.decode()

    def test_template_check_accepts_a_table_template_with_one_token_row(self):
        code, out, _ = self.check_template("schedule", [("予定", {
            "A1": "{{filter.name}} 作業予定", "A3": "日付", "B3": "作業",
            "A4": "{{schedule.date}}", "B4": "{{schedule.workName}}"}, ["A3:B4"])])
        self.assertEqual(code, 0)
        self.assertIn("engine: table", out)

    def test_template_check_rejects_unknown_tokens_with_their_cell(self):
        code, _, err = self.check_template("schedule", [("予定", {
            "A1": "日付", "A2": "{{schedule.date}}", "A5": "{{report.foo}}"}, ["A1:A2"])])
        self.assertEqual(code, 1)
        self.assertIn("予定!A5: 未知のトークン: {{report.foo}}", err)

    def test_template_check_rejects_two_token_rows_in_a_table(self):
        code, _, err = self.check_template("meter", [("検針値", {
            "A1": "名前", "B1": "値", "A2": "{{meter.name}}", "B2": "{{meter.value}}",
            "A3": "{{meter.name}}", "B3": "{{meter.value}}"}, ["A1:B3"])])
        self.assertEqual(code, 1)
        self.assertIn("検針値!A3", err)

    def test_template_check_checks_tag_keys_when_given(self):
        sheets = [("予定", {"A1": "棟", "A2": "{{schedule.tag[building]}}"}, ["A1:A2"])]
        self.assertEqual(self.check_template("schedule", sheets, "--tag-key", "building")[0], 0)
        code, _, err = self.check_template("schedule", sheets, "--tag-key", "floor")
        self.assertEqual(code, 1)
        self.assertIn("{{schedule.tag[building]}}", err)

    def test_template_check_legacy_template_needs_a_token_row(self):
        code, _, err = self.check_template("meter", [("検針表", {"A1": "{{facility.name}}"}, [])])
        self.assertEqual(code, 1)
        self.assertIn("トークン行がありません", err)
        code, out, _ = self.check_template("meter", [("検針表", {"A1": "{{facility.name}}", "A2": "{{meter.name}}"}, [])])
        self.assertEqual(code, 0)
        self.assertIn("engine: legacy", out)

    def test_template_check_fixed_cell_tokens_must_be_alone_and_not_mixed(self):
        ok = [("検針表", {"A1": "{{report.measureDate}}", "B2": "{{meter[k-1].value}}"}, [])]
        code, out, _ = self.check_template("meter", ok)
        self.assertEqual((code, "engine: fixed-cell" in out), (0, True))
        code, _, err = self.check_template("meter", [("検針表", {
            "B2": "{{meter[k-1].value}} kWh", "B3": "{{meter.name}}", "B4": "{{meter[k-2].foo}}"}, [])])
        self.assertEqual(code, 1)
        self.assertIn("検針表!B2: キー付きトークンはセルに単独で", err)
        self.assertIn("検針表!B3: 固定セル方式に繰り返し", err)
        self.assertIn("検針表!B4: 不正なキー付きトークン", err)

    def test_template_check_sheet_name_tokens(self):
        table = {"A1": "名前", "A2": "{{meter.name}}"}
        self.assertEqual(self.check_template("meter", [("{{report.measureDateCompact}}", table, ["A1:A2"])])[0], 0)
        code, _, err = self.check_template("meter", [("{{meter.name}}", table, ["A1:A2"])])
        self.assertEqual(code, 1)
        self.assertIn("シート名に使えるのはスカラートークンだけ", err)
        code, _, err = self.check_template("meter", [("{{facility.name}}", table, [])])
        self.assertEqual(code, 1)
        self.assertIn("テーブル方式と固定セル方式でだけ", err)

    def test_template_check_warns_about_text_around_row_tokens(self):
        code, out, _ = self.check_template("schedule", [("予定", {"A1": "作業", "A2": "{{schedule.workName}} 様"}, ["A1:A2"])])
        self.assertEqual(code, 0)
        self.assertIn("warning: 予定!A2", out)

    def test_google_lists_keep_query_and_gateway_auth_across_pages(self):
        for script, path, key in ((GMAIL_ALL, "/gmail/v1/users/me/messages", "messages"), (DRIVE_ALL, "/drive/v3/files", "files"), (CALENDAR_ALL, "/calendar/v3/calendars/primary/events", "items")):
            with self.subTest(script=script):
                FakeGateway.requests = []
                out = self.run_script(script, path, "-q", "q=請求書", "-q", f"fields={key}(id)")
                self.assertEqual([row["id"] for row in json.loads(out.stdout)], list(range(TOTAL_ITEMS)))
                queries = [dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(r["path"]).query)) for r in FakeGateway.requests]
                self.assertEqual([q.get("pageToken") for q in queries], [None, "100", "200"])
                self.assertTrue(all(q["q"] == "請求書" and "nextPageToken" in q["fields"] for q in queries))
                self.assertTrue(all(r["headers"]["Authorization"] == "Bearer tok" for r in FakeGateway.requests))
                self.assertTrue(all(r["headers"]["User-Agent"].startswith("api-gateway-client") for r in FakeGateway.requests))

    def test_google_lists_continue_after_empty_page(self):
        for script, path in ((DRIVE_ALL, "/drive/v3/files"), (CALENDAR_ALL, "/calendar/v3/calendars/primary/events")):
            with self.subTest(script=script):
                FakeGateway.requests = []
                out = self.run_script(script, path, "-q", "empty=1")
                self.assertEqual([r["id"] for r in json.loads(out.stdout)], list(range(100)) + list(range(200, 250)))
                self.assertEqual(len(FakeGateway.requests), 3)

    def test_calendar_lists_and_instances_use_items_array(self):
        for path in ("/calendar/v3/users/me/calendarList", "/calendar/v3/calendars/primary/events/series1/instances"):
            with self.subTest(path=path):
                out = self.run_script(CALENDAR_ALL, path, "--csv", "id", "--max-pages", "1")
                rows = list(csv.reader(io.StringIO(out.stdout.decode())))
                self.assertEqual(rows[:2], [["id"], ["0"]])
                self.assertEqual(len(rows), 101)
                self.assertIn("more items remain", out.stderr.decode())

    def test_calendar_preserves_period_and_timezone_on_every_page(self):
        params = {"timeMin": "2026-10-01T00:00:00+09:00", "timeMax": "2026-10-08T00:00:00+09:00", "timeZone": "Asia/Tokyo", "singleEvents": "true", "orderBy": "startTime"}
        args = [arg for key, value in params.items() for arg in ("-q", f"{key}={value}")]
        out = self.run_script(CALENDAR_ALL, "/calendar/v3/calendars/primary/events", *args)
        self.assertEqual(len(json.loads(out.stdout)), TOTAL_ITEMS)
        self.assertEqual(len(FakeGateway.requests), 3)
        for req in FakeGateway.requests:
            query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(req["path"]).query))
            self.assertEqual({key: query[key] for key in params}, params)

    def test_google_list_csv_and_partial_result_warnings(self):
        out = self.run_script(DRIVE_ALL, "/drive/v3/files", "--max-pages", "1", "--csv", "id,name", "-q", "incomplete=1")
        rows = list(csv.reader(io.StringIO(out.stdout.decode())))
        self.assertEqual(rows[:2], [["id", "name"], ["0", "file0"]])
        self.assertIn("incompleteSearch=true", out.stderr.decode())
        self.assertIn("more items remain", out.stderr.decode())

    def test_google_list_retries_and_stops_cursor_loop(self):
        self.run_script(GMAIL_ALL, "/gmail/v1/users/me/messages", "-q", "throttle=1", "--max-pages", "1")
        self.assertEqual(len(FakeGateway.requests), 2)
        FakeGateway.requests = []
        result = self.run_script(DRIVE_ALL, "/drive/v3/files", "-q", "loop=1", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("repeated nextPageToken", result.stderr.decode())
        self.assertEqual(len(FakeGateway.requests), 2)

    def test_google_list_rejects_invalid_page_limit_before_requests(self):
        result = self.run_script(GMAIL_ALL, "/gmail/v1/users/me/messages", "--max-pages", "0", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(FakeGateway.requests, [])

    def test_gmail_mime_builds_unicode_reply_draft_with_attachment_locally(self):
        body_path = os.path.join(self.tmp.name, "body.txt")
        attachment = os.path.join(self.tmp.name, "請求書.pdf")
        with open(body_path, "w", encoding="utf-8") as f:
            f.write("請求書をお送りします。")
        with open(attachment, "wb") as f:
            f.write(bytes(range(256)))
        out = self.run_script(GMAIL_MIME, "build", "--from", "sender@example.com", "--to", "user@example.com", "--to", "other@example.com", "--subject", "Re: 請求書", "--body", "@" + body_path, "--attach", attachment, "--thread-id", "thread1", "--in-reply-to", "<original@example.com>", "--draft")
        data = json.loads(out.stdout)["message"]
        self.assertEqual(data["threadId"], "thread1")
        message = BytesParser(policy=policy.default).parsebytes(base64.urlsafe_b64decode(data["raw"]))
        self.assertEqual(str(message["Subject"]), "Re: 請求書")
        self.assertEqual(str(message["References"]), "<original@example.com>")
        self.assertIn("other@example.com", str(message["To"]))
        self.assertEqual(message.get_body(preferencelist=("plain",)).get_content().strip(), "請求書をお送りします。")
        part = next(message.iter_attachments())
        self.assertEqual(part.get_filename(), "請求書.pdf")
        self.assertEqual(part.get_payload(decode=True), bytes(range(256)))
        self.assertEqual(FakeGateway.requests, [])

    def test_gmail_decode_restores_unpadded_binary_attachment(self):
        payload = bytes(range(256))
        path = os.path.join(self.tmp.name, "attachment.json")
        with open(path, "w") as f:
            json.dump({"data": base64.urlsafe_b64encode(payload).decode().rstrip("=")}, f)
        self.run_script(GMAIL_MIME, "decode", path, "-o", "attachment.pdf")
        with open(os.path.join(self.tmp.name, "attachment.pdf"), "rb") as f:
            self.assertEqual(f.read(), payload)

    def test_gmail_reply_requires_thread_and_rfc_message_id(self):
        result = self.run_script(GMAIL_MIME, "build", "--from", "a@example.com", "--to", "b@example.com", "--subject", "Reply", "--body", "body", "--thread-id", "thread", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--in-reply-to", result.stderr.decode())

    def test_scripts_find_gwlib_when_skill_dirs_are_prefixed_with_the_plugin_name(self):
        # Cowork installs a plugin's skills as "<plugin>:<skill>", e.g. "api-gateway:api-gateway".
        skills = os.path.join(self.tmp.name, "skills")
        for name in os.listdir(SKILLS):
            shutil.copytree(os.path.join(SKILLS, name), os.path.join(skills, f"api-gateway:{name}"), ignore=shutil.ignore_patterns("__pycache__"))
        scripts = [
            ("board", "board_all.py", ["/v1/projects", "--max-pages", "1"]),
            ("freee", "freee_all.py", ["/api/1/deals", "-q", "company_id=1", "--max-pages", "1"]),
            ("microsoft-graph", "graph_all.py", ["/v1.0/me/messages", "--max-pages", "1"]),
            ("bm-next", "bm_next_graphql.py", ["{ echo }"]),
            ("bm-next", "bm_next_all.py", ["{ works }", "--max-pages", "1"]),
            ("gmail", "gmail_all.py", ["/gmail/v1/users/me/messages", "--max-pages", "1"]),
            ("google-drive", "drive_all.py", ["/drive/v3/files", "--max-pages", "1"]),
            ("google-calendar", "calendar_all.py", ["/calendar/v3/users/me/calendarList", "--max-pages", "1"]),
        ]
        for skill, script, args in scripts:
            with self.subTest(script=script):
                self.run_script(os.path.join(skills, f"api-gateway:{skill}", "scripts", script), *args)


class SkillDocsTest(unittest.TestCase):
    def skill_docs(self):
        for root, _, files in os.walk(SKILLS):
            for name in files:
                if name.endswith(".md"):
                    yield os.path.join(root, name)

    def test_every_skill_has_a_name_and_description(self):
        for skill in os.listdir(SKILLS):
            with self.subTest(skill=skill), open(os.path.join(SKILLS, skill, "SKILL.md"), encoding="utf-8") as f:
                head = f.read().split("---")[1]
                self.assertIn(f"\nname: {skill}\n", head)
                self.assertRegex(head, r"\ndescription: \S")

    def test_relative_links_point_at_files(self):
        for path in self.skill_docs():
            with open(path, encoding="utf-8") as f:
                text = f.read()
            for target in re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", text):
                if "://" not in target:
                    with self.subTest(doc=os.path.relpath(path, SKILLS), link=target):
                        self.assertTrue(os.path.exists(os.path.join(os.path.dirname(path), target)))

    def test_report_template_tokens_match_the_checker(self):
        sys.path.insert(0, os.path.dirname(BM_NEXT_TEMPLATE_CHECK))
        try:
            import bm_next_template_check as checker
        finally:
            sys.path.pop(0)
        with open(os.path.join(SKILLS, "bm-next", "references", "report-templates.md"), encoding="utf-8") as f:
            sections = re.split(r"^## ", f.read(), flags=re.M)
        for kind, heading in (("schedule", "作業予定のテンプレート"), ("meter", "検針表のテンプレート")):
            section = next(s for s in sections if s.startswith(heading))
            documented = set(re.findall(r"^\| `\{\{([^}]+)\}\}`", section, flags=re.M))
            expected = checker.SCALARS[kind] | checker.ROWS[kind] | ({"schedule.tag[<key>]"} if kind == "schedule" else set())
            with self.subTest(kind=kind):
                self.assertEqual(documented, expected)


if __name__ == "__main__":
    unittest.main()
