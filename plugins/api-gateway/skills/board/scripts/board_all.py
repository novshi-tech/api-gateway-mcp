#!/usr/bin/env python3
"""Fetches every page of a Board list endpoint through the API gateway.

    export GW_TOKEN=... GW_BASE_URL=...     # from the issue_token tool
    board_all.py /v1/projects -q order_status_in[]=4 -o projects.json
    board_all.py /v1/clients --csv id,name,name_disp -o clients.csv

Uses per_page=100 and stays under Board's limit of 3 requests per second,
retrying on 429. Writes a JSON array (or CSV with --csv) to --out or stdout.
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
MIN_INTERVAL = 0.4


def fetch(url, token):
    for attempt in range(5):
        request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request) as response:
                return json.load(response), response.headers
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < 4:
                time.sleep(2 ** attempt)
                continue
            body = error.read().decode(errors="replace")
            raise SystemExit(f"HTTP {error.code} for {url}: {body}")
    raise SystemExit("gave up after repeated 429 responses")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("path", help="list endpoint, e.g. /v1/projects")
    parser.add_argument("-q", "--query", action="append", default=[], help="filter key=value")
    parser.add_argument("--max-pages", type=int, default=100)
    parser.add_argument("--csv", help="comma-separated fields to write as CSV instead of JSON")
    parser.add_argument("-o", "--out")
    args = parser.parse_args()

    token = os.environ.get("GW_TOKEN")
    base = os.environ.get("GW_BASE_URL", "").rstrip("/")
    if not token or not base:
        raise SystemExit("GW_TOKEN and GW_BASE_URL must be set (from the issue_token tool)")

    query = [tuple(q.split("=", 1)) for q in args.query]
    items, page, total = [], 1, None
    while page <= args.max_pages:
        started = time.monotonic()
        params = urllib.parse.urlencode(query + [("per_page", "100"), ("page", str(page))])
        data, headers = fetch(f"{base}/board{args.path}?{params}", token)
        items.extend(data)
        total = int(headers.get("X-Total-Count") or len(items))
        print(f"page {page}: {len(items)}/{total}", file=sys.stderr)
        if len(items) >= total or not data:
            break
        page += 1
        time.sleep(max(0.0, MIN_INTERVAL - (time.monotonic() - started)))

    out = open(args.out, "w", encoding="utf-8", newline="") if args.out else sys.stdout
    if args.csv:
        fields = args.csv.split(",")
        writer = csv.writer(out)
        writer.writerow(fields)
        for item in items:
            writer.writerow([item.get(f, "") for f in fields])
    else:
        json.dump(items, out, ensure_ascii=False, indent=2)
        out.write("\n")
    if args.out:
        out.close()
        print(f"wrote {len(items)} items to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
