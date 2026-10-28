#!/usr/bin/env python3
"""Copies the shared scripts in lib/plugin/ into every skill that needs them.

Usage: tools/sync-plugin-libs.py [--check]

Claude Code installs each plugin in its own tree and Cowork names skill
directories "<plugin>:<skill>", so a skill cannot reach another skill's files.
Each skill therefore carries copies next to its scripts:

- gwlib.py and gw_request.py: every skill (each calls the gateway)
- google_paging.py: skills whose scripts import it

Edit the files in lib/plugin/, then run this. --check only reports copies that
are missing or differ, and exits 1 if there are any (the tests run it).
"""
import filecmp
import glob
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "lib", "plugin")


def wanted():
    for skill in sorted(glob.glob(os.path.join(ROOT, "plugins", "*", "skills", "*"))):
        names = ["gwlib.py", "gw_request.py"]
        scripts = glob.glob(os.path.join(skill, "scripts", "*.py"))
        if any("google_paging" in open(p, encoding="utf-8").read() for p in scripts if not p.endswith("google_paging.py")):
            names.append("google_paging.py")
        for name in names:
            yield os.path.join(LIB, name), os.path.join(skill, "scripts", name)


def main():
    check = "--check" in sys.argv[1:]
    stale = []
    for source, target in wanted():
        if os.path.exists(target) and filecmp.cmp(source, target, shallow=False):
            continue
        stale.append(os.path.relpath(target, ROOT))
        if not check:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            shutil.copyfile(source, target)
    for path in stale:
        print(("out of date: " if check else "updated: ") + path)
    if check and stale:
        print("run tools/sync-plugin-libs.py", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
