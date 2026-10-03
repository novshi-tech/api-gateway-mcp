#!/usr/bin/env python3
"""Checks a ビルメンNEXT Excel report template before it is uploaded.

    bm_next_template_check.py schedule schedule-template.xlsx --tag-key building
    bm_next_template_check.py meter meter-template.xlsx

Applies the server's upload checks (unknown tokens, the token row of a table,
keyed meter tokens, tokens in sheet names) and prints which engine the server
will use. Exits 1 when the server would reject the file. Warnings are things
the server accepts but that usually come out wrong. Uses only the standard
library, so it runs without openpyxl.

--tag-key lists the tag keys a schedule template may use in
{{schedule.tag[<key>]}}; without it, tag tokens are only reported.
"""
import argparse
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"

SCALARS = {
    "schedule": {"report.month", "report.createdAt", "report.scheduleCount", "filter.name"},
    "meter": {"report.month", "report.createdAt", "report.meterCount", "report.measureDate",
              "report.prevMeasureDate", "report.measureDateCompact", "facility.name"},
}
ROWS = {
    "schedule": {"schedule.title", "schedule.workName", "schedule.date", "schedule.day", "schedule.weekday",
                 "schedule.timeFrom", "schedule.timeTo", "schedule.timeFrames", "schedule.frequency",
                 "schedule.precautions"},
    "meter": {"meter.id", "meter.key", "meter.name", "meter.no", "meter.date", "meter.value", "meter.usage",
              "meter.prevDate", "meter.prevValue", "meter.prevUsage", "meter.median", "meter.usageYearAgo"},
}
# The legacy engine fills only these scalars, and writes dates as text.
LEGACY_METER_SCALARS = {"report.month", "report.createdAt", "report.meterCount", "facility.name"}
TAG = re.compile(r"^schedule\.tag\[(.+)\]$")
KEYED = re.compile(r"^meter\[([^\]]+)\]\.(.+)$")


def tokens(text):
    return re.findall(r"\{\{(.*?)\}\}", text)


class Workbook:
    """The parts of an .xlsx the checks need: sheets, their literal string cells and their tables."""

    def __init__(self, path):
        self.zip = zipfile.ZipFile(path)
        self.shared = [self.text(si) for si in self.xml("xl/sharedStrings.xml").iter(MAIN + "si")] \
            if "xl/sharedStrings.xml" in self.zip.namelist() else []
        rels = self.rels("xl/workbook.xml")
        self.sheets = [(s.get("name"), rels[s.get(REL + "id")])
                       for s in self.xml("xl/workbook.xml").iter(MAIN + "sheet")]

    def xml(self, part):
        return ET.fromstring(self.zip.read(part))

    def rels(self, part):
        """Maps relationship ids of a part to the zip paths they point at."""
        folder, name = posixpath.split(part)
        rels_part = posixpath.join(folder, "_rels", name + ".rels")
        if rels_part not in self.zip.namelist():
            return {}
        # Excel writes targets relative to the part, openpyxl absolute ("/xl/worksheets/sheet1.xml").
        return {r.get("Id"): posixpath.normpath(posixpath.join(folder, r.get("Target"))).lstrip("/")
                for r in self.xml(rels_part).iter(PKG_REL + "Relationship")}

    @staticmethod
    def text(element):
        """Joins the text runs of a string item, leaving out phonetic guides."""
        runs = [element.find(MAIN + "t")] + [r.find(MAIN + "t") for r in element.findall(MAIN + "r")]
        return "".join(t.text or "" for t in runs if t is not None)

    def cells(self, part):
        """Yields (row number, cell ref, text) for every literal string cell; formula cells are skipped."""
        for row in self.xml(part).iter(MAIN + "row"):
            for c in row.iter(MAIN + "c"):
                if c.find(MAIN + "f") is not None:
                    continue
                if c.get("t") == "s" and c.find(MAIN + "v") is not None:
                    text = self.shared[int(c.find(MAIN + "v").text)]
                elif c.get("t") == "inlineStr" and c.find(MAIN + "is") is not None:
                    text = self.text(c.find(MAIN + "is"))
                else:
                    continue
                yield int(row.get("r")), c.get("r"), text

    def tables(self, part):
        """Yields (table name, first data row, last data row) for the tables on a sheet."""
        rels = self.rels(part)
        for tp in self.xml(part).iter(MAIN + "tablePart"):
            table = self.xml(rels[tp.get(REL + "id")])
            rows = [int(re.sub(r"[^0-9]", "", ref)) for ref in table.get("ref").split(":")]
            first = rows[0] + int(table.get("headerRowCount", 1))
            yield table.get("displayName") or table.get("name"), first, rows[-1] - int(table.get("totalsRowCount", 0))


def check(kind, path, tag_keys=None):
    """Returns (engine, errors, warnings) for a template file."""
    book = Workbook(path)
    scalars, rows, prefix = SCALARS[kind], ROWS[kind], kind + "."
    errors, warnings = [], []
    cells = [(name, part, row, ref, text) for name, part in book.sheets for row, ref, text in book.cells(part)
             if "{{" in text]

    def is_row(token):
        tag = TAG.match(token)
        if kind == "schedule" and tag:
            if tag_keys is not None and tag.group(1) not in tag_keys:
                return False
            return True
        return token in rows

    keyed = kind == "meter" and any("{{meter[" in text for *_, text in cells)
    token_rows = {}  # (sheet part, table, row) -> where its first row token is
    for name, part in book.sheets:
        for table, first, last in book.tables(part):
            for _, cpart, row, ref, text in cells:
                if cpart == part and first <= row <= last and "{{" + prefix in text:
                    token_rows.setdefault((part, table, row), (name, ref))
    token_rows = list(token_rows.values())
    engine = "fixed-cell" if keyed else "table" if token_rows else "legacy"

    named = [name for name, _ in book.sheets if "{{" in name]
    if named and engine == "legacy":
        errors.append(f"{named[0]}!A1: シート名のトークンはテーブル方式と固定セル方式でだけ使えます。")
    for name in named:
        for token in tokens(name):
            if token not in scalars:
                errors.append(f"{name}!A1: シート名に使えるのはスカラートークンだけです: {{{{{token}}}}}")
    if len(named) > 1:
        errors.append(f"{named[1]}!A1: トークンを含むシート名はブックに 1 つまでです。")

    for name, _, _, ref, text in cells:
        where = f"{name}!{ref}"
        found = tokens(text)
        for token in found:
            if keyed and token.startswith("meter["):
                match = KEYED.match(token)
                if not match or "meter." + match.group(2) not in rows:
                    errors.append(f"{where}: 不正なキー付きトークン: {{{{{token}}}}}")
                elif text != "{{" + token + "}}":
                    errors.append(f"{where}: キー付きトークンはセルに単独で書いてください: {{{{{token}}}}}")
            elif keyed and token.startswith("meter."):
                errors.append(f"{where}: 固定セル方式に繰り返しの {{{{meter.*}}}} は混ぜられません: {{{{{token}}}}}")
            elif token not in scalars and not is_row(token):
                errors.append(f"{where}: 未知のトークン: {{{{{token}}}}}")
            elif kind == "schedule" and TAG.match(token) and tag_keys is None:
                warnings.append(f"{where}: タグキー {TAG.match(token).group(1)!r} の存在はサーバーが確かめます(--tag-key で確認できます)。")
        if not keyed and any(t.startswith(prefix) for t in found) and text.strip() != "{{" + found[0] + "}}":
            warnings.append(f"{where}: 行トークンのセルには値だけが入り、ほかの文字や 2 つ目以降のトークンは消えます: {text!r}")
        if engine == "legacy" and kind == "meter":
            for token in found:
                if token in scalars and token not in LEGACY_METER_SCALARS:
                    warnings.append(f"{where}: 旧方式では {{{{{token}}}}} は置き換わりません。テーブル方式にしてください。")
                if token in ("meter.key", "meter.date", "meter.prevDate"):
                    warnings.append(f"{where}: 旧方式では {{{{{token}}}}} が正しく入りません(日付は文字列、key は不可)。")

    if engine == "table" and len(token_rows) > 1:
        name, ref = token_rows[1]
        errors.append(f"{name}!{ref}: 行トークンを含むデータ行がテーブル内に複数あります。トークン行は 1 行にしてください。")
    if engine == "legacy":
        if not any(is_row(t) for *_, text in cells for t in tokens(text)):
            errors.append(f"{book.sheets[0][0]}!A1: {{{{{kind}.*}}}} のトークン行がありません。1 行に行トークンを並べてください。")
        if any(True for _, part in book.sheets for _ in book.tables(part)):
            warnings.append("テーブルがありますが、行トークンがテーブルのデータ行にありません。旧方式として扱われ、読み込めずに拒否されることがあります。")
    return engine, errors, warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("kind", choices=["schedule", "meter"], help="schedule (作業予定) or meter (検針表)")
    parser.add_argument("file", help="template .xlsx")
    parser.add_argument("--tag-key", action="append", help="a tag key that {{schedule.tag[...]}} may use (repeatable)")
    args = parser.parse_args()
    try:
        engine, errors, warnings = check(args.kind, args.file, set(args.tag_key) if args.tag_key else None)
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as e:
        raise SystemExit(f"not a readable .xlsx: {e}")
    print(f"engine: {engine}")
    for w in warnings:
        print(f"warning: {w}")
    for e in errors:
        print(f"error: {e}", file=sys.stderr)
    if errors:
        raise SystemExit(1)
    print("ok")


if __name__ == "__main__":
    main()
