#!/usr/bin/env python3
"""Generates the Board skill's endpoint reference from Board's OpenAPI spec.

Usage: tools/gen-board-reference.py > plugins/api-gateway/skills/board/references/endpoints.md
"""
import json
import re
import sys
import urllib.request

SPEC_URL = "https://developers.the-board.jp/doc/board_openapi.json"
METHODS = ("get", "post", "put", "patch", "delete")


def clean(text, limit=160):
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text or "")
    text = text.split("※例には")[0]
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def schema_type(schema):
    if "enum" in schema:
        return "enum(" + ", ".join(str(v) for v in schema["enum"]) + ")"
    kind = schema.get("type", "")
    if kind == "array":
        return f"array<{schema_type(schema.get('items', {}))}>"
    return kind if isinstance(kind, str) else "/".join(kind)


def merge_properties(schema, out, required):
    """Collects writable top-level properties across allOf/anyOf/oneOf branches."""
    for key in ("allOf", "anyOf", "oneOf"):
        for part in schema.get(key, []):
            merge_properties(part, out, required)
    required.update(schema.get("required", []))
    for name, prop in schema.get("properties", {}).items():
        if prop.get("readOnly") or name in out:
            continue
        out[name] = prop


def main():
    request = urllib.request.Request(SPEC_URL, headers={"User-Agent": "api-gateway-mcp-tools"})
    spec = json.load(urllib.request.urlopen(request))
    components = spec.get("components", {}).get("parameters", {})
    print(f"# Board API エンドポイント一覧(v{spec['info']['version']})")
    print()
    print(f"自動生成: `tools/gen-board-reference.py`(元: {SPEC_URL})。パスはすべて `/v1` の下。")
    print("レスポンスの項目はここに載せていない。実際に 1 件取得して確かめること。")
    for path, ops in spec["paths"].items():
        for method in METHODS:
            op = ops.get(method)
            if not op:
                continue
            print()
            print(f"## {method.upper()} /v1{path}")
            print()
            print(f"{clean(op.get('summary'))}。{clean(op.get('description'), 300)}".rstrip("。") + "。")
            params = []
            for p in op.get("parameters", []):
                if "$ref" in p:
                    p = components.get(p["$ref"].split("/")[-1], {})
                if p.get("in") in ("query", "path"):
                    params.append(p)
            if params:
                print()
                print("パラメータ:")
                for p in params:
                    print(f"- `{p['name']}` ({schema_type(p.get('schema', {}))}): {clean(p.get('description'))}")
            body = op.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema")
            if body:
                props, required = {}, set()
                merge_properties(body, props, required)
                if props:
                    print()
                    print("リクエストボディ(JSON):")
                    for name, prop in props.items():
                        mark = "(必須) " if name in required else ""
                        print(f"- `{name}` ({schema_type(prop)}): {mark}{clean(prop.get('description'))}")


if __name__ == "__main__":
    sys.exit(main())
