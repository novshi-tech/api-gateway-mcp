#!/usr/bin/env python3
"""Read a Google Docs document through the API gateway as text.

docs_text.py <document-id or URL>                 # Markdown-like text of every tab
docs_text.py <id> --paragraphs -o paragraphs.json # paragraphs with tab IDs and indexes
docs_text.py <id> --raw -o document.json          # the documents.get response as is

Fetches GET /v1/documents/{id}?includeTabsContent=true. Headings become "#",
list items "-", and tables "|" rows. --paragraphs lists every paragraph (table
cells included) with tabId, startIndex, endIndex, and namedStyleType: the
indexes batchUpdate requests use, in UTF-16 code units, valid for revisionId.
"""
import argparse
import json
import os
import re
import sys

SKILLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path += [os.path.join(SKILLS, d, "scripts") for d in sorted(os.listdir(SKILLS)) if d == "api-gateway" or d.endswith(":api-gateway")]
from gwlib import gateway_env, get_json, service_url

HEADINGS = {"TITLE": 1, "SUBTITLE": 2, **{f"HEADING_{n}": n for n in range(1, 7)}}


def document_id(value):
    match = re.search(r"/document/(?:u/\d+/)?d/([A-Za-z0-9_-]+)", value)
    return match.group(1) if match else value


def walk_tabs(tabs):
    for tab in tabs:
        yield tab
        yield from walk_tabs(tab.get("childTabs", []))


def paragraph_text(paragraph):
    parts = []
    for element in paragraph.get("elements", []):
        if "textRun" in element:
            parts.append(element["textRun"].get("content", ""))
        elif "person" in element:
            props = element["person"].get("personProperties", {})
            parts.append(props.get("name") or props.get("email", ""))
        elif "richLink" in element:
            props = element["richLink"].get("richLinkProperties", {})
            parts.append(props.get("title") or props.get("uri", ""))
        elif "dateElement" in element:
            parts.append(element["dateElement"].get("dateElementProperties", {}).get("displayText", ""))
    return "".join(parts)


def paragraphs(content, tab_id, cell=None):
    """Yields every paragraph in body content, descending into tables and tables of contents."""
    for element in content:
        if "paragraph" in element:
            paragraph = element["paragraph"]
            item = {
                "tabId": tab_id,
                "startIndex": element.get("startIndex", 0),
                "endIndex": element["endIndex"],
                "namedStyleType": paragraph.get("paragraphStyle", {}).get("namedStyleType", "NORMAL_TEXT"),
                "text": paragraph_text(paragraph),
            }
            if "bullet" in paragraph:
                item["bullet"] = {"listId": paragraph["bullet"].get("listId"), "nestingLevel": paragraph["bullet"].get("nestingLevel", 0)}
            if cell:
                item["table"] = cell
            yield item
        elif "table" in element:
            for r, row in enumerate(element["table"].get("tableRows", [])):
                for c, table_cell in enumerate(row.get("tableCells", [])):
                    yield from paragraphs(table_cell.get("content", []), tab_id, {"startIndex": element["startIndex"], "row": r, "column": c})
        elif "tableOfContents" in element:
            yield from paragraphs(element["tableOfContents"].get("content", []), tab_id, cell)


def markdown(content):
    lines = []
    for element in content:
        if "paragraph" in element:
            paragraph = element["paragraph"]
            text = paragraph_text(paragraph).rstrip("\n").replace("\v", "\n")
            style = paragraph.get("paragraphStyle", {}).get("namedStyleType", "")
            if "bullet" in paragraph:
                lines.append("  " * paragraph["bullet"].get("nestingLevel", 0) + "- " + text)
            elif style in HEADINGS and text:
                lines.append("#" * HEADINGS[style] + " " + text)
            else:
                lines.append(text)
        elif "table" in element:
            rows = element["table"].get("tableRows", [])
            for r, row in enumerate(rows):
                cells = [" ".join(markdown(cell.get("content", []))).replace("|", "\\|").replace("\n", " ") for cell in row.get("tableCells", [])]
                lines.append("| " + " | ".join(cells) + " |")
                if r == 0:
                    lines.append("|" + " --- |" * len(cells))
        elif "tableOfContents" in element:
            lines.extend(markdown(element["tableOfContents"].get("content", [])))
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("document", help="document ID or its docs.google.com URL")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--paragraphs", action="store_true", help="write paragraphs with indexes as JSON")
    mode.add_argument("--raw", action="store_true", help="write the documents.get response")
    parser.add_argument("-o", "--out")
    args = parser.parse_args()

    base, token = gateway_env()
    doc_id = document_id(args.document)
    doc, _ = get_json(service_url(base, "docs", f"/v1/documents/{doc_id}", [("includeTabsContent", "true")]), token)
    tabs = list(walk_tabs(doc.get("tabs", [])))

    if args.raw:
        output = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    elif args.paragraphs:
        items = []
        for tab in tabs:
            tab_id = tab.get("tabProperties", {}).get("tabId")
            items.extend(paragraphs(tab.get("documentTab", {}).get("body", {}).get("content", []), tab_id))
        output = json.dumps({"documentId": doc.get("documentId"), "title": doc.get("title"), "revisionId": doc.get("revisionId"), "paragraphs": items}, ensure_ascii=False, indent=2) + "\n"
    else:
        sections = [f"<!-- {doc.get('title', '')} documentId={doc.get('documentId')} revisionId={doc.get('revisionId')} -->"]
        for tab in tabs:
            props = tab.get("tabProperties", {})
            if len(tabs) > 1:
                sections.append(f"<!-- tab: {props.get('title', '')} tabId={props.get('tabId')} -->")
            sections.append("\n".join(markdown(tab.get("documentTab", {}).get("body", {}).get("content", []))).strip("\n"))
        output = "\n\n".join(sections) + "\n"

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(output)


if __name__ == "__main__":
    main()
