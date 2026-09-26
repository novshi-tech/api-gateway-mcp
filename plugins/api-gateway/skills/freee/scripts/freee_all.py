#!/usr/bin/env python3
"""Fetches every page of a freee list endpoint through the API gateway.

    export GW_TOKEN=... GW_BASE_URL=...     # from the issue_token tool
    freee_all.py /api/1/deals -q company_id=123 -q start_issue_date=2026-09-01 -o deals.json
    freee_all.py /api/1/partners -q company_id=123 --csv id,name,code -o partners.csv

Pages with offset/limit (limit 100 by default), one request per second,
retrying on 429 (honoring Retry-After). The list is the response's only
array-valued key (e.g. "deals"); pass --key when there is more than one.
Stops at an empty or short page, or at meta.total_count / total_count.
Writes a JSON array (or CSV with --csv) to --out or stdout.
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
MIN_INTERVAL = 1.0


def fetch(url, token):
    for attempt in range(5):
        request = urllib.request.Request(
            url, headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT, "Accept": "application/json"}
        )
        try:
            with urllib.request.urlopen(request) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 429 and attempt < 4:
                retry_after = error.headers.get("Retry-After", "")
                time.sleep(int(retry_after) if retry_after.isdigit() else 2 ** (attempt + 1))
                continue
            body = error.read().decode(errors="replace")
            raise SystemExit(f"HTTP {error.code} for {url}: {body}")
    raise SystemExit("gave up after repeated 429 responses")


def list_key(data, key):
    if key:
        if not isinstance(data.get(key), list):
            raise SystemExit(f"response has no list under {key!r}: keys {sorted(data)}")
        return key
    keys = [k for k, v in data.items() if isinstance(v, list)]
    if len(keys) != 1:
        raise SystemExit(f"cannot tell which key holds the list ({keys}); pass --key")
    return keys[0]


def total_count(data):
    meta = data.get("meta")
    value = meta.get("total_count") if isinstance(meta, dict) else data.get("total_count")
    return value if isinstance(value, int) else None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("path", help="list endpoint, e.g. /api/1/deals")
    parser.add_argument("-q", "--query", action="append", default=[], help="query parameter key=value")
    parser.add_argument("--key", help="response key that holds the list, e.g. deals")
    parser.add_argument("--limit", type=int, default=100, help="page size (the upper bound differs by endpoint)")
    parser.add_argument("--max-pages", type=int, default=100)
    parser.add_argument("--csv", help="comma-separated fields to write as CSV instead of JSON")
    parser.add_argument("-o", "--out")
    args = parser.parse_args()

    token = os.environ.get("GW_TOKEN")
    base = os.environ.get("GW_BASE_URL", "").rstrip("/")
    if not token or not base:
        raise SystemExit("GW_TOKEN and GW_BASE_URL must be set (from the issue_token tool)")

    query = [tuple(q.split("=", 1)) for q in args.query]
    items, key, page = [], args.key, 0
    while page < args.max_pages:
        started = time.monotonic()
        params = urllib.parse.urlencode(
            query + [("offset", str(len(items))), ("limit", str(args.limit))], quote_via=urllib.parse.quote
        )
        data = fetch(f"{base}/freee{args.path}?{params}", token)
        key = list_key(data, key)
        batch = data[key]
        items.extend(batch)
        page += 1
        total = total_count(data)
        print(f"page {page}: {len(items)}" + (f"/{total}" if total is not None else ""), file=sys.stderr)
        if len(batch) < args.limit or (total is not None and len(items) >= total):
            break
        time.sleep(max(0.0, MIN_INTERVAL - (time.monotonic() - started)))
    else:
        print(f"stopped at --max-pages {args.max_pages}; more items may remain", file=sys.stderr)

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
