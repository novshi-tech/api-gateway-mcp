#!/usr/bin/env python3
"""Packages a plugin under plugins/ as a zip for uploading to Claude.

Usage: tools/build-plugin-zip.py [plugin-name ...]   (default: every plugin)
Writes dist/<plugin-name>-<version>.zip for each.

       tools/build-plugin-zip.py --assets
Writes every plugin to dist/assets/plugins/, with index.json describing them, for the
gateway to offer on its web UI (the Worker's static assets; tools/wrangler.mjs runs this
before each deploy).
"""
import json
import os
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGINS = os.path.join(ROOT, "plugins")


def main():
    args = sys.argv[1:]
    if args == ["--assets"]:
        assets()
        return
    for name in args or sorted(os.listdir(PLUGINS)):
        print(build(name, os.path.join(ROOT, "dist")))


def manifest(name):
    with open(os.path.join(PLUGINS, name, ".claude-plugin", "plugin.json"), encoding="utf-8") as f:
        return json.load(f)


def build(name, out_dir):
    version = manifest(name)["version"]
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{name}-{version}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(os.path.join(PLUGINS, name)):
            dirs[:] = sorted(d for d in dirs if d != "__pycache__")
            for file in sorted(files):
                path = os.path.join(root, file)
                # A fixed time, so the same sources make the same zip.
                info = zipfile.ZipInfo(os.path.relpath(path, PLUGINS), date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (os.stat(path).st_mode & 0o777) << 16
                with open(path, "rb") as f:
                    z.writestr(info, f.read())
    return out


# Each plugin as the marketplace lists it (.claude-plugin/marketplace.json), in its order.
def assets():
    out_dir = os.path.join(ROOT, "dist", "assets", "plugins")
    shutil.rmtree(out_dir, ignore_errors=True)
    with open(os.path.join(ROOT, ".claude-plugin", "marketplace.json"), encoding="utf-8") as f:
        market = json.load(f)
    listed = {p["name"]: p for p in market["plugins"]}
    names = [p["name"] for p in market["plugins"] if os.path.isdir(os.path.join(PLUGINS, p["name"]))]
    names += sorted(n for n in os.listdir(PLUGINS) if n not in listed)
    index = []
    for name in names:
        plugin = manifest(name)
        entry = listed.get(name, {})
        source = entry.get("source")
        index.append(
            {
                "name": name,
                "version": plugin["version"],
                "description": entry.get("description") or plugin.get("description", ""),
                "dependencies": entry.get("dependencies", []),
                "file": os.path.basename(build(name, out_dir)),
                "marketplace": source.get("url") if isinstance(source, dict) else None,
            }
        )
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"plugins": index, "marketplace": market["name"]}, f, ensure_ascii=False, indent=2)
    print(out_dir)


if __name__ == "__main__":
    main()
