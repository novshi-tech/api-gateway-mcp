#!/usr/bin/env python3
"""Fetches every page of a ビルメンNEXT list query through the API gateway.

    export GW_TOKEN=... GW_BASE_URL=...     # from the issue_token tool
    bm_next_all.py 'query($from: String) { works(from: $from) { results { id name } continuationToken } }' -o works.json
    bm_next_all.py @members.graphql --csv id,name -o members.csv

The query must have exactly one top-level field that returns
{ results, continuationToken }, and must declare a `$from: String` variable
and pass it to that field's `from` argument. The script feeds each page's
continuationToken back as `from` until it comes back empty. Other arguments
(name, limit, ...) are written into the query or passed with --vars.

Writes the collected `results` as a JSON array (or CSV with --csv) to --out
or stdout. Exits non-zero, after writing what it got, if any response has
GraphQL errors.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "api-gateway", "scripts"))
import bm_next_graphql  # noqa: E402
import gwlib  # noqa: E402

MAX_PAGES = 1000


def page_of(data):
    if not isinstance(data, dict) or len(data) != 1:
        raise SystemExit(f"the query must have exactly one top-level field; got {sorted(data or {})}")
    field, page = next(iter(data.items()))
    if not isinstance(page, dict) or not isinstance(page.get("results"), list) or "continuationToken" not in page:
        raise SystemExit(f"{field} does not return {{ results, continuationToken }}; select both")
    return page


def main():
    parser = gwlib.list_parser(__doc__, "GraphQL document, or @file", max_pages=MAX_PAGES)
    parser.add_argument("--vars", help="other variables as a JSON object, or @file")
    parser.add_argument("--act-as", metavar="ORGANIZATION_ID", help="send X-Act-As-Organization (System organization keys only)")
    args = parser.parse_args()
    base, token = gwlib.gateway_env()
    query = bm_next_graphql.load_arg(args.path)
    variables = bm_next_graphql.parse_vars(args.vars) or {}

    items, errors, seen = [], [], set()
    for page_number in range(1, args.max_pages + 1):
        data, errors = bm_next_graphql.run(base, token, query, variables, args.act_as)
        if errors:
            break
        page = page_of(data)
        items.extend(page["results"])
        print(f"page {page_number}: {len(items)} items", file=sys.stderr)
        token_next = page["continuationToken"]
        if not token_next or token_next in seen:
            break
        seen.add(token_next)
        variables["from"] = token_next

    gwlib.write_items(items, args.out, args.csv)
    bm_next_graphql.fail_on_errors(errors)


if __name__ == "__main__":
    main()
