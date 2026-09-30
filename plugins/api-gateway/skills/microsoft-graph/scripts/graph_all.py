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
import os
import sys
import urllib.parse

# Cowork installs skills as "<plugin>:<skill>", so the directory is not always plain "api-gateway".
SKILLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path += [os.path.join(SKILLS, d, "scripts") for d in sorted(os.listdir(SKILLS)) if d == "api-gateway" or d.endswith(":api-gateway")]
import gwlib  # noqa: E402

GRAPH_HOST = "graph.microsoft.com"


def gateway_url(base, next_link):
    """Maps an @odata.nextLink onto the gateway. Refuses other hosts so the
    token is never sent anywhere but the gateway."""
    parts = urllib.parse.urlsplit(next_link)
    if parts.netloc.lower() != GRAPH_HOST:
        raise SystemExit(f"unexpected nextLink host: {next_link}")
    path = urllib.parse.quote(parts.path, safe=gwlib.URL_SAFE)
    query = urllib.parse.quote(parts.query, safe=gwlib.URL_SAFE + "?")
    return f"{base}/graph{path}" + (f"?{query}" if query else "")


def main():
    args = gwlib.list_parser(__doc__, "Graph path including the version, e.g. /v1.0/me/messages", max_pages=50).parse_args()
    base, token = gwlib.gateway_env()

    url = gwlib.service_url(base, "graph", args.path, args.query)
    items, page = [], 0
    while url and page < args.max_pages:
        page += 1
        data, _ = gwlib.get_json(url, token)
        items.extend(data.get("value", []))
        print(f"page {page}: {len(items)} items", file=sys.stderr)
        next_link = data.get("@odata.nextLink")
        url = gateway_url(base, next_link) if next_link else None
    if url:
        print(f"stopped at --max-pages {args.max_pages}; more items remain", file=sys.stderr)

    gwlib.write_items(items, args.out, args.csv)


if __name__ == "__main__":
    main()
