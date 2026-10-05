#!/usr/bin/env python3
"""Fetch Gmail messages, threads, drafts, or history through the gateway.

gmail_all.py /gmail/v1/users/me/messages -q 'q=has:attachment' -o messages.json
Lists contain IDs, not full message bodies. Uses nextPageToken, including
empty intermediate pages; writes a JSON array or CSV (--csv id,threadId).
"""
import os
import sys

SKILLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path += [os.path.join(SKILLS, d, "scripts") for d in sorted(os.listdir(SKILLS)) if d == "api-gateway" or d.endswith(":api-gateway")]
from google_paging import main

if __name__ == "__main__":
    main("gmail", ("messages", "threads", "drafts", "history"), __doc__)
