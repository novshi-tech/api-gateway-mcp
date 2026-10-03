#!/usr/bin/env python3
"""Fetch Drive files, drives, permissions, revisions, or changes through the gateway.

drive_all.py /drive/v3/files -q 'q=trashed=false' -q 'fields=files(id,name)' -o files.json
Uses nextPageToken, including empty pages. Retains nextPageToken in partial
responses; writes a JSON array or CSV (--csv id,name,mimeType).
"""
import os
import sys

SKILLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path += [os.path.join(SKILLS, d, "scripts") for d in sorted(os.listdir(SKILLS)) if d == "api-gateway" or d.endswith(":api-gateway")]
from google_paging import main

if __name__ == "__main__":
    main("drive", ("files", "drives", "permissions", "revisions", "changes"), __doc__)
