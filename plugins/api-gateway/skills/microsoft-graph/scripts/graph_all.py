#!/usr/bin/env python3
"""Fetches every page of a Microsoft Graph list through the API gateway.

    export GW_TOKEN=... GW_BASE_URL=...     # from the issue_token tool
    graph_all.py /v1.0/me/messages -q '$select=id,subject,receivedDateTime' -q '$top=100' -o mail.json
    graph_all.py /v1.0/me/drive/root/children --csv id,name,size,file.mimeType -o files.csv

Follows @odata.nextLink, which is an absolute graph.microsoft.com URL, by
sending its path and query to the gateway instead. Retries on 429 and 503,
honoring Retry-After. Writes the collected "value" items as a JSON array (or
CSV with --csv; dotted fields reach into nested objects) to --out or stdout.
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "api-gateway-client/1"
GRAPH_HOST = "graph.microsoft.com"
# Characters left as they are when percent-encoding a path or query ("%"
# included, so encoded input is not encoded twice).
URL_SAFE = "/%:@!$&'()*+,;=-._~"


def fetch(url, token):
    for attempt in range(5):
        request = urllib.request.Request(
            url, headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT, "Accept": "application/json"}
        )
        try:
            with urllib.request.urlopen(request) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code in (429, 503) and attempt < 4:
                retry_after = error.headers.get("Retry-After", "")
                time.sleep(int(retry_after) if retry_after.isdigit() else 2 ** attempt)
                continue
            body = error.read().decode(errors="replace")
            raise SystemExit(f"HTTP {error.code} for {url}: {body}")
    raise SystemExit("gave up after repeated throttling")


def gateway_url(base, next_link):
    """Maps an @odata.nextLink onto the gateway. Refuses other hosts so the
    token is never sent anywhere but the gateway."""
    parts = urllib.parse.urlsplit(next_link)
    if parts.netloc.lower() != GRAPH_HOST:
        raise SystemExit(f"unexpected nextLink host: {next_link}")
    path = urllib.parse.quote(parts.path, safe=URL_SAFE)
    query = urllib.parse.quote(parts.query, safe=URL_SAFE + "?")
    return f"{base}/graph{path}" + (f"?{query}" if query else "")


def pick(item, field):
    value = item
    for key in field.split("."):
        value = value.get(key) if isinstance(value, dict) else None
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return "" if value is None else value


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("path", help="Graph path including the version, e.g. /v1.0/me/messages")
    parser.add_argument("-q", "--query", action="append", default=[], help="query parameter key=value")
    parser.add_argument("--max-pages", type=int, default=50)
    parser.add_argument("--csv", help="comma-separated fields to write as CSV instead of JSON")
    parser.add_argument("-o", "--out")
    args = parser.parse_args()

    token = os.environ.get("GW_TOKEN")
    base = os.environ.get("GW_BASE_URL", "").rstrip("/")
    if not token or not base:
        raise SystemExit("GW_TOKEN and GW_BASE_URL must be set (from the issue_token tool)")

    path = args.path if args.path.startswith("/") else "/" + args.path
    path = urllib.parse.quote(path, safe=URL_SAFE)
    query = [tuple(q.split("=", 1)) for q in args.query]
    url = f"{base}/graph{path}"
    if query:
        url += "?" + urllib.parse.urlencode(query, quote_via=urllib.parse.quote, safe="$")

    items, page = [], 0
    while url and page < args.max_pages:
        page += 1
        data = fetch(url, token)
        items.extend(data.get("value", []))
        print(f"page {page}: {len(items)} items", file=sys.stderr)
        next_link = data.get("@odata.nextLink")
        url = gateway_url(base, next_link) if next_link else None
    if url:
        print(f"stopped at --max-pages {args.max_pages}; more items remain", file=sys.stderr)

    out = open(args.out, "w", encoding="utf-8", newline="") if args.out else sys.stdout
    if args.csv:
        fields = args.csv.split(",")
        writer = csv.writer(out)
        writer.writerow(fields)
        for item in items:
            writer.writerow([pick(item, f) for f in fields])
    else:
        json.dump(items, out, ensure_ascii=False, indent=2)
        out.write("\n")
    if args.out:
        out.close()
        print(f"wrote {len(items)} items to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
