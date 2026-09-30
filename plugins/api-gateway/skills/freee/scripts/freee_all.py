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
import os
import sys
import time

# Cowork installs skills as "<plugin>:<skill>", so the directory is not always plain "api-gateway".
SKILLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path += [os.path.join(SKILLS, d, "scripts") for d in sorted(os.listdir(SKILLS)) if d == "api-gateway" or d.endswith(":api-gateway")]
import gwlib  # noqa: E402

MIN_INTERVAL = 1.0


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
    parser = gwlib.list_parser(__doc__, "list endpoint, e.g. /api/1/deals")
    parser.add_argument("--key", help="response key that holds the list, e.g. deals")
    parser.add_argument("--limit", type=int, default=100, help="page size (the upper bound differs by endpoint)")
    args = parser.parse_args()
    base, token = gwlib.gateway_env()

    items, key, page = [], args.key, 0
    while page < args.max_pages:
        started = time.monotonic()
        url = gwlib.service_url(base, "freee", args.path, args.query + [("offset", str(len(items))), ("limit", str(args.limit))])
        data, _ = gwlib.get_json(url, token)
        key = list_key(data, key)
        batch = data[key]
        items.extend(batch)
        page += 1
        total = total_count(data)
        print(f"page {page}: {len(items)}" + (f"/{total}" if total is not None else ""), file=sys.stderr)
        if len(batch) < args.limit or (total is not None and len(items) >= total):
            break
        gwlib.pace(started, MIN_INTERVAL)
    else:
        print(f"stopped at --max-pages {args.max_pages}; more items may remain", file=sys.stderr)

    gwlib.write_items(items, args.out, args.csv)


if __name__ == "__main__":
    main()
