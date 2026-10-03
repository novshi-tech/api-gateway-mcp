#!/usr/bin/env python3
"""Fetch Google Calendar list pages through the API gateway.

calendar_all.py /calendar/v3/users/me/calendarList -o calendars.json
calendar_all.py /calendar/v3/calendars/primary/events -q singleEvents=true
    -q orderBy=startTime -q timeMin=... -q timeMax=... -o events.json
Uses the items array and nextPageToken. Supports calendarList, events, and
instances; writes JSON or CSV (--csv id,summary,start.dateTime,start.date).
Does not save nextSyncToken; use full responses for incremental sync.
"""
import os
import sys

SKILLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path += [os.path.join(SKILLS, d, "scripts") for d in sorted(os.listdir(SKILLS)) if d == "api-gateway" or d.endswith(":api-gateway")]
from google_paging import main

if __name__ == "__main__":
    main("calendar", ("items",), __doc__, default_key="items")
