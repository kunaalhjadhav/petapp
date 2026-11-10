#!/usr/bin/env python3
"""Records real resumable-upload responses (Phase 9e) for the customer app.

Needs: API running (SMS_PROVIDER=console, log at $API_LOG) with object storage, and ENABLE_REELS on (switched on here).
Starts a 20 MB video upload in parts, sends part 1, and records where it got to. The upload is left unfinished on
purpose; the worker's nightly clean-up removes it (and its parts) after a day.

Run:  python3 apps/customer-mobile/tool/record_upload_fixtures.py
"""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixture_api import admin_token, call, flag, login, put_bytes  # noqa: E402

MB = 1024 * 1024
admin = admin_token()
flag(admin, 'ENABLE_REELS')
t = login('9800000892', 'Ravi Uploads')

size = 20 * MB + 321
small = call('POST', '/media/uploads', {'kind': 'VIDEO', 'mimeType': 'video/mp4', 'sizeBytes': 3 * MB, 'resumable': True}, t, save='upload_single_create', expect=201)
assert small['upload']['method'] == 'PUT', small
big = call('POST', '/media/uploads', {'kind': 'VIDEO', 'mimeType': 'video/mp4', 'sizeBytes': size, 'resumable': True}, t, save='upload_multipart_create', expect=201)
mid = big['media']['id']
parts = call('POST', f'/media/{mid}/parts', {'partNumbers': [1, 2]}, t, save='upload_parts', expect=200)['parts']
p1 = parts[0]
put_bytes(p1['url'], {**p1['headers'], 'Content-Type': 'application/octet-stream'}, b'\0' * p1['length'])
call('GET', f'/media/{mid}/upload', None, t, save='upload_progress', expect=200)
call('POST', f'/media/{mid}/complete', None, t, save='upload_complete_missing', expect=400)
print('recorded resumable upload fixtures')
