#!/usr/bin/env python3
"""Generates the ビルメンNEXT skill's schema reference from the server's published GraphQL schema.

Usage: tools/gen-bm-next-reference.py [schema.graphql | URL] > plugins/api-gateway/skills/bm-next/references/schema.md

Defaults to the public schema at SCHEMA_URL. Directives are dropped except the
required scope, which is shown on each query and mutation. Sign-in fields
(@allowAnonymous) are left out, since an API key never uses them.
"""
import re
import sys
import urllib.request

SCHEMA_URL = "https://api.bm-next.ai/graphql/schema.graphql"
KINDS = ("type", "input", "interface", "enum")
POLICIES = {"RequiresOrganization": "組織に所属していること", "RequiresSystemAdmin": "System 組織の管理者のみ"}
HEADER = re.compile(r"^(type|input|interface|enum) (\w+)")
FIELD = re.compile(r"^  (\w+)(\(.*?\))?: (.+)$")


def load(source):
    if re.match(r"https?://", source):
        request = urllib.request.Request(source, headers={"User-Agent": "api-gateway-mcp-tools"})
        return urllib.request.urlopen(request).read().decode("utf-8")
    with open(source, encoding="utf-8") as f:
        return f.read()


def directives(text):
    """Splits 'Type! @authorize(policy: "x") @cost(weight: "10")' into (Type!, [(name, argument)])."""
    found = re.findall(r'@(\w+)(?:\(([^)]*)\))?', text)
    return re.split(r"\s@", " " + text, maxsplit=1)[0].strip(), found


def requirement(found):
    """Describes the scope, feature flag or role an operation needs."""
    needs = []
    for name, argument in found:
        if name != "authorize":
            continue
        policy = re.search(r'policy: "([^"]+)"', argument or "")
        policy = policy.group(1) if policy else None
        if policy is None:
            needs.append("要認証")
        elif policy.startswith("scope:"):
            needs.append("スコープ `" + policy[len("scope:"):] + "`")
        elif policy.startswith("feature:"):
            needs.append("機能フラグ `" + policy[len("feature:"):] + "`")
        else:
            needs.append(POLICIES.get(policy, policy))
    return "、".join(dict.fromkeys(needs))


def parse(schema):
    """Returns (blocks, unions). Each block is (kind, name, [(description, line)])."""
    blocks, unions, current, description = [], [], None, None
    for line in schema.splitlines():
        if '"""' in line:
            raise SystemExit("multi-line descriptions are not supported")
        header = HEADER.match(line)
        if header and line.rstrip().endswith("{"):
            current = (header.group(1), header.group(2), [])
            blocks.append(current)
            description = None
        elif line.startswith("}"):
            current = None
        elif current is not None:
            if line.startswith('  "'):
                description = line.strip().strip('"')
            elif line.strip():
                current[2].append((description, line))
                description = None
        elif line.startswith("union "):
            unions.append(line.split("@")[0].strip())
    return blocks, unions


def render_field(line):
    match = FIELD.match(line)
    if not match:
        return line.strip().split(" @")[0], []
    name, args, rest = match.groups()
    type_, found = directives(rest)
    return f"{name}{args or ''}: {type_}", found


def main():
    blocks, unions = parse(load(sys.argv[1] if len(sys.argv) > 1 else SCHEMA_URL))
    out = [
        "# ビルメンNEXT GraphQL リファレンス",
        "",
        f"自動生成: `tools/gen-bm-next-reference.py`(元: {SCHEMA_URL})。",
        "見出しは `## query <名前>`、`## mutation <名前>`、`## type <名前>`、`## input <名前>`、`## enum <名前>` の形。"
        "`grep -n '^## query works' references/schema.md` のように検索して、その節だけ読む。",
        "一覧の結果は `{ results, continuationToken }` の形。次のページは `continuationToken` を `from` に渡す。",
    ]
    anonymous = 0
    for root in ("Query", "Mutation"):
        for kind, name, fields in blocks:
            if name != root:
                continue
            for description, line in fields:
                text, found = render_field(line)
                if any(d == "allowAnonymous" for d, _ in found):
                    anonymous += 1
                    continue
                out += ["", f"## {root.lower()} {FIELD.match(line).group(1)}", "", "```graphql", text, "```"]
                needs = requirement(found)
                notes = "。".join(filter(None, [description, f"必要な権限: {needs}" if needs else ""]))
                if notes:
                    out += ["", notes]
    for kind, name, fields in blocks:
        if name in ("Query", "Mutation"):
            continue
        out += ["", f"## {kind} {name}", "", "```graphql"]
        for description, line in fields:
            text = render_field(line)[0] if kind != "enum" else line.strip().split(" @")[0]
            out.append(f"{text}  # {description}" if description else text)
        out.append("```")
    if unions:
        out += ["", "## union", "", "```graphql", *unions, "```"]
    print("\n".join(out))
    print(f"skipped {anonymous} anonymous fields", file=sys.stderr)


if __name__ == "__main__":
    main()
