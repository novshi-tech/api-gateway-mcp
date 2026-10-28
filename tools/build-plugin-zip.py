#!/usr/bin/env python3
"""Packages a plugin under plugins/ as a zip for uploading to Claude.

Usage: tools/build-plugin-zip.py [plugin-name ...]   (default: every plugin)
Writes dist/<plugin-name>-<version>.zip for each.
"""
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    plugins = os.path.join(ROOT, "plugins")
    for name in sys.argv[1:] or sorted(os.listdir(plugins)):
        build(plugins, name)


def build(plugins, name):
    manifest = os.path.join(plugins, name, ".claude-plugin", "plugin.json")
    with open(manifest, encoding="utf-8") as f:
        version = json.load(f)["version"]
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    out = os.path.join(ROOT, "dist", f"{name}-{version}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(os.path.join(plugins, name)):
            dirs[:] = sorted(d for d in dirs if d != "__pycache__")
            for file in sorted(files):
                path = os.path.join(root, file)
                z.write(path, os.path.relpath(path, plugins))
    print(out)


if __name__ == "__main__":
    main()
