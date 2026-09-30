#!/usr/bin/env python3
"""Fetches every page of a Board list endpoint through the API gateway.

    export GW_TOKEN=... GW_BASE_URL=...     # from the issue_token tool
    board_all.py /v1/projects -q order_status_in[]=4 -o projects.json
    board_all.py /v1/clients --csv id,name,name_disp -o clients.csv

Uses per_page=100 and stays under Board's limit of 3 requests per second,
retrying on 429. Writes a JSON array (or CSV with --csv) to --out or stdout.
"""
import os
import sys
import time

# Cowork installs skills as "<plugin>:<skill>", so the directory is not always plain "api-gateway".
SKILLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path += [os.path.join(SKILLS, d, "scripts") for d in sorted(os.listdir(SKILLS)) if d == "api-gateway" or d.endswith(":api-gateway")]
import gwlib  # noqa: E402

MIN_INTERVAL = 0.4


def main():
    args = gwlib.list_parser(__doc__, "list endpoint, e.g. /v1/projects").parse_args()
    base, token = gwlib.gateway_env()

    items, page = [], 1
    while page <= args.max_pages:
        started = time.monotonic()
        url = gwlib.service_url(base, "board", args.path, args.query + [("per_page", "100"), ("page", str(page))])
        data, headers = gwlib.get_json(url, token)
        items.extend(data)
        total = int(headers.get("X-Total-Count") or len(items))
        print(f"page {page}: {len(items)}/{total}", file=sys.stderr)
        if len(items) >= total or not data:
            break
        page += 1
        gwlib.pace(started, MIN_INTERVAL)

    gwlib.write_items(items, args.out, args.csv)


if __name__ == "__main__":
    main()
