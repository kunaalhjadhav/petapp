#!/usr/bin/env python3
"""Records real privacy and legal responses for the customer app.

Needs the API and worker running with SMS_PROVIDER=console (log at $API_LOG), object storage, and the seeded super admin.
DEVELOPMENT DATABASE ONLY: if the Terms of Service or Privacy Policy aren't published yet, it publishes the template
with its {{placeholders}} replaced by [brackets], so there is something to accept.

Run:  python3 apps/customer-mobile/tool/record_privacy_fixtures.py
"""
import pathlib, re, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixture_api import admin_token, call, login, unthrottle, LOG  # noqa: E402

stamp = str(int(time.time()))[-4:]
admin = admin_token()
for row in call('GET', '/admin/legal', None, admin):
    if row['slug'] in ('terms-of-service', 'privacy-policy') and not row['current']:
        d = call('GET', f"/admin/legal/{row['draft']['id']}", None, admin)
        body = re.sub(r'\{\{([^}]+)\}\}', lambda m: m.group(1) if m.group(1)[0].isdigit() else f'[{m.group(1).strip()}]', d['body'])
        call('PATCH', f"/admin/legal/{d['id']}", {'body': body}, admin, expect=200)
        call('POST', f"/admin/legal/{d['id']}/publish", {}, admin, expect=200)

call('GET', '/legal', None, None, save='legal_list', expect=200)
call('GET', '/legal/privacy-policy', None, None, save='legal_doc', expect=200)

phone = f'9874{stamp}44'[:10]
me = login(phone, 'Privacy Person')
status = call('GET', '/me/consents', None, me, save='consents_pending', expect=200)
for d in status['documents']:
    if d['pending']: call('POST', '/me/consents', {'slug': d['slug'], 'version': d['version']}, me, expect=200)
call('PUT', '/me/marketing', {'granted': True}, me, save='consents_accepted', expect=200)

call('POST', '/me/data-exports', None, me, save='data_exports_requested', expect=201)
for _ in range(240):  # a failed build is retried after 30 s
    x = call('GET', '/me/data-exports', None, me)
    if x['items'][0]['status'] != 'PENDING': break
    time.sleep(0.25)
if x['items'][0]['status'] != 'READY': raise SystemExit(f"export {x['items'][0]['status']}: is object storage up and the worker running?")
call('GET', '/me/data-exports', None, me, save='data_exports', expect=200)
call('GET', f"/me/data-exports/{x['items'][0]['id']}/link", None, me, save='data_export_link', expect=200)

call('DELETE', '/users/me', None, me, save='account_deletion', expect=200)
# Signing in again during the grace period keeps the account (after the 30-second wait between codes).
time.sleep(31)
unthrottle()
call('POST', '/auth/otp/request', {'phone': phone}, expect=200)
for _ in range(40):
    codes = re.findall(r'DEV SMS → \+91\*+' + phone[-4:] + r'\] (\d{6})', open(LOG).read())
    if codes: break
    time.sleep(0.25)
call('POST', '/auth/otp/verify', {'phone': phone, 'code': codes[-1]}, save='auth_restored', expect=200)
print('recorded privacy fixtures')
