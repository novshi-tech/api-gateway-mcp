#!/usr/bin/env python3
"""Prepare Gmail JSON locally or decode a saved attachment/raw response.

build --from sender@example.com --to user@example.com --subject '件名'
      --body @body.txt --attach invoice.pdf --draft -o draft.json
decode attachment.json -o invoice.pdf

This script never sends mail or calls an API. build emits {raw: ...}, or
{message: {raw: ...}} with --draft. decode accepts {data: ...} or {raw: ...}.
"""
import argparse
import base64
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import formatdate, make_msgid
import json
import mimetypes
from pathlib import Path
import sys


def text_arg(value):
    return Path(value[1:]).read_text(encoding="utf-8") if value.startswith("@") else value


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build", help="prepare a send/draft JSON body locally")
    build.add_argument("--from", dest="sender", required=True)
    build.add_argument("--to", action="append", required=True)
    build.add_argument("--cc", action="append", default=[])
    build.add_argument("--bcc", action="append", default=[])
    build.add_argument("--subject", required=True)
    build.add_argument("--body", required=True, help="plain text or @UTF-8-file")
    build.add_argument("--html", help="optional HTML alternative or @UTF-8-file")
    build.add_argument("--attach", action="append", default=[])
    build.add_argument("--thread-id")
    build.add_argument("--in-reply-to", help="original RFC Message-ID, not Gmail's message id")
    build.add_argument("--references", help="RFC Message-IDs including the original Message-ID")
    build.add_argument("--draft", action="store_true")
    build.add_argument("-o", "--out")
    decode = commands.add_parser("decode", help="decode saved attachment JSON or raw message JSON")
    decode.add_argument("input")
    decode.add_argument("-o", "--out", required=True)
    args = parser.parse_args()
    if args.command == "decode":
        data = json.loads(Path(args.input).read_text(encoding="utf-8"))
        encoded = data.get("data", data.get("raw"))
        if not isinstance(encoded, str):
            parser.error("input must contain a base64url data or raw string")
        try:
            payload = base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True)
        except ValueError as error:
            parser.error(f"invalid base64url: {error}")
        Path(args.out).write_bytes(payload)
        print(f"wrote {len(payload)} bytes to {args.out}", file=sys.stderr)
        return
    if bool(args.thread_id) != bool(args.in_reply_to) or (args.references and not args.in_reply_to):
        parser.error("replies require both --thread-id and --in-reply-to")
    message = EmailMessage(policy=SMTP)
    message["From"] = args.sender
    message["To"] = ", ".join(args.to)
    for header, values in (("Cc", args.cc), ("Bcc", args.bcc)):
        if values:
            message[header] = ", ".join(values)
    message["Subject"] = args.subject
    message["Date"] = formatdate(localtime=False, usegmt=True)
    message["Message-ID"] = make_msgid()
    if args.in_reply_to:
        message["In-Reply-To"] = args.in_reply_to
        message["References"] = args.references or args.in_reply_to
    message.set_content(text_arg(args.body))
    if args.html:
        message.add_alternative(text_arg(args.html), subtype="html")
    for filename in args.attach:
        path = Path(filename)
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        maintype, subtype = mime.split("/", 1)
        message.add_attachment(path.read_bytes(), maintype=maintype, subtype=subtype, filename=path.name)
    body = {"raw": base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")}
    if args.thread_id:
        body["threadId"] = args.thread_id
    if args.draft:
        body = {"message": body}
    output = json.dumps(body, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        Path(args.out).write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)


if __name__ == "__main__":
    main()
