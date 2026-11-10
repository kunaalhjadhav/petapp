#!/usr/bin/env python3
"""Records real membership, reminder-preference, promotion and members-only responses (Phase 9d) for the customer app.

Needs: API + worker running (SMS_PROVIDER=console, log at $API_LOG), the seeded super admin and membership plans,
and demo contests and challenges. `psql` access to the dev database (DATABASE_URL) is used to find demo things, and to clear the recording
account's earlier memberships so a second run records the same story.
What this script switches on for the recording (ENABLE_MEMBERSHIPS) is switched back off at the end, and the test
promotion is the only one it sends.

Run:  python3 apps/customer-mobile/tool/record_membership_fixtures.py
"""
import os, pathlib, subprocess, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixture_api import admin_token, call, flag, login  # noqa: E402

DB = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/petapp')

def sql(q):
    return [r.split('|') for r in subprocess.run(['psql', DB, '-tAc', q], capture_output=True, text=True, check=True).stdout.split('\n') if r]

admin = admin_token()
for f in ('ENABLE_CONTESTS', 'ENABLE_MEMBERSHIPS'): flag(admin, f)
mira = login('9800000881', 'Mira Joshi')
neel = login('9800000882', 'Neel Joshi')
mira_id = call('GET', '/users/me', None, mira, expect=200)['id']
sql(f"""DELETE FROM "Membership" WHERE "userId" = '{mira_id}'""")
sql(f"""DELETE FROM "Notification" WHERE "userId" = '{mira_id}'""")

# ── plans, buying one, and what the person sees ──
plans = call('GET', '/memberships/plans', None, None, save='membership_plans', expect=200)
plus = next(p for p in plans if p['key'] == 'PLUS')
call('GET', '/memberships/me', None, mira, save='membership_me_none', expect=200)
buy = call('POST', '/memberships/purchase', {'planId': plus['id']}, mira, save='membership_purchase', expect=201)
call('POST', f"/payments/{buy['payment']['paymentId']}/simulate", None, mira, expect=200)
renew = call('POST', '/memberships/purchase', {'planId': plus['id']}, mira, expect=201)
call('POST', f"/payments/{renew['payment']['paymentId']}/simulate", None, mira, expect=200)
call('GET', '/memberships/me', None, mira, save='membership_me_member', expect=200)
call('GET', '/users/me', None, mira, save='me_member', expect=200)
call('GET', f'/users/{mira_id}', None, neel, save='user_profile_member', expect=200)

# ── members-only marks on contests and challenges ──
call('GET', '/contests?when=live', None, mira, save='contests_with_members_flag', expect=200)
challenge = sql("""SELECT id FROM "Challenge" WHERE status = 'PUBLISHED' LIMIT 1""")[0][0]
call('GET', f'/challenges/{challenge}', None, mira, save='challenge_detail_members_flag', expect=200)

# ── reminders, votes and promotions preferences; a promotion with a link ──
call('PUT', '/notifications/preferences', {'promotions': True}, mira, save='notification_prefs_9d', expect=200)
title = f'Weekend treats {int(time.time())}'
promo = call('POST', '/admin/promotions', {'title': title, 'body': 'Free delivery on treats this weekend.', 'link': '/shop', 'audience': 'ALL'}, admin, expect=201)
for _ in range(120):
    items = call('GET', '/notifications?limit=50', None, mira, expect=200)['items']
    titles = {n['title'] for n in items}
    if title in titles and 'Welcome to Plus' in titles and 'Membership renewed' in titles: break
    time.sleep(1)
else:
    raise SystemExit('the worker did not deliver the promotion and membership notifications within 2 minutes')
call('GET', '/notifications?limit=50', None, mira, save='notifications_9d', expect=200)
call('PUT', '/notifications/preferences', {'promotions': False}, mira, expect=200)

call('PATCH', '/admin/flags/ENABLE_MEMBERSHIPS', {'enabled': False}, admin, expect=200)
subprocess.run('redis-cli del platform:flags >/dev/null', shell=True)
print('recorded membership, preference and promotion fixtures')
