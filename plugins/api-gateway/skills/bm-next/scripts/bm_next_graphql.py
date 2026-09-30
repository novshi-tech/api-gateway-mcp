#!/usr/bin/env python3
"""Runs one GraphQL query or mutation against ビルメンNEXT through the API gateway.

    export GW_TOKEN=... GW_BASE_URL=...     # from the issue_token tool
    bm_next_graphql.py '{ myOrganization { id name } }'
    bm_next_graphql.py @query.graphql --vars '{"year": 2026, "month": 9}'
    bm_next_graphql.py @query.graphql --vars @vars.json --act-as ORGANIZATION_ID -o out.json

The query is the first argument, or @file to read it from a file. --vars takes
a JSON object, or @file. --act-as sends X-Act-As-Organization, which only API
keys issued by a System organization may use.

Prints the response's "data" as JSON to stdout, or to --out. ビルメンNEXT
answers GraphQL errors (including authentication failures) with HTTP 200, so
this exits non-zero and prints the "errors" to stderr whenever the response
has any.
"""
import argparse
import json
import os
import sys

# Cowork installs skills as "<plugin>:<skill>", so the directory is not always plain "api-gateway".
SKILLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path += [os.path.join(SKILLS, d, "scripts") for d in sorted(os.listdir(SKILLS)) if d == "api-gateway" or d.endswith(":api-gateway")]
import gwlib  # noqa: E402

SERVICE = "bm-next"
PATH = "/graphql"


def load_arg(value):
    """Returns the text of an argument, reading it from a file when it starts with @."""
    if value.startswith("@"):
        with open(value[1:], encoding="utf-8") as f:
            return f.read()
    return value


def run(base, token, query, variables=None, act_as=None):
    """Sends the query and returns (data, errors). Raises SystemExit on HTTP errors."""
    body = {"query": query}
    if variables:
        body["variables"] = variables
    headers = {"X-Act-As-Organization": act_as} if act_as else None
    response, _ = gwlib.request_json(gwlib.service_url(base, SERVICE, PATH), token, body=body, headers=headers)
    return response.get("data"), response.get("errors") or []


def fail_on_errors(errors):
    if errors:
        print(json.dumps(errors, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(1)


def add_query_options(parser):
    parser.add_argument("query", help="GraphQL document, or @file")
    parser.add_argument("--vars", help="variables as a JSON object, or @file")
    parser.add_argument("--act-as", metavar="ORGANIZATION_ID", help="send X-Act-As-Organization (System organization keys only)")


def parse_vars(text):
    if not text:
        return None
    variables = json.loads(load_arg(text))
    if not isinstance(variables, dict):
        raise SystemExit("--vars must be a JSON object")
    return variables


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_query_options(parser)
    parser.add_argument("-o", "--out")
    args = parser.parse_args()
    base, token = gwlib.gateway_env()

    data, errors = run(base, token, load_arg(args.query), parse_vars(args.vars), args.act_as)
    if data is not None:
        text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(text)
            print(f"wrote {args.out}", file=sys.stderr)
        else:
            sys.stdout.write(text)
    fail_on_errors(errors)


if __name__ == "__main__":
    main()
