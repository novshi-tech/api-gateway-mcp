#!/usr/bin/env python3
"""Fetch Gmail messages, threads, drafts, or history through the gateway.

gmail_all.py /gmail/v1/users/me/messages -q 'q=has:attachment' -o messages.json
Lists contain IDs, not full message bodies. Uses nextPageToken, including
empty intermediate pages; writes a JSON array or CSV (--csv id,threadId).
"""

from google_paging import main

if __name__ == "__main__":
    main("gmail", ("messages", "threads", "drafts", "history"), __doc__)
