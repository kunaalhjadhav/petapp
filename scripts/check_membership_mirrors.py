#!/usr/bin/env python3
"""Python mirror of the customer app's Phase 9d Dart test (test/membership_test.dart), run against the same recorded
fixtures, with the pure helpers in lib/features/membership/membership_logic.dart (and notificationTarget, safeAppLink,
reachedEnd) re-implemented line for line. A stand-in where no Flutter SDK is available.
Usage: python3 scripts/check_membership_mirrors.py
"""
import json, pathlib, re, sys
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / 'apps' / 'customer-mobile'
fx = lambda n: json.load(open(APP / 'test' / 'fixtures' / f'{n}.json'))['data']
logic = (APP / 'lib' / 'features' / 'membership' / 'membership_logic.dart').read_text()
notes = (APP / 'lib' / 'features' / 'notifications' / 'notifications_screen.dart').read_text()
video = (APP / 'lib' / 'features' / 'posts' / 'video_view.dart').read_text()
models = (APP / 'lib' / 'api' / 'models.dart').read_text()
fails = []
def check(name, cond):
    if not cond: fails.append(name)

for name in ('planPrice', 'membershipHeadline', 'planAction'):
    check(f'membership_logic.dart defines {name}', re.search(r'\b' + name + r'\(', logic) is not None)
check('safeAppLink regex matches the API', r"RegExp(r'^/[a-z0-9][a-z0-9\-_/]{0,150}$')" in notes)
check('API link rule is the same', r"/^\/[a-z0-9][a-z0-9\-_/]{0,150}$/" in (ROOT / 'apps/backend/src/modules/reminders/reminders.rules.ts').read_text())
check('Membership route', "'Membership' => '/membership'" in notes)
check('reachedEnd in video_view', 'bool reachedEnd(' in video and 'Duration(milliseconds: 400)' in video)
check('promotions opt-in in the model', "static const optIn = {'promotions'};" in models)

def rupees(p):
    r, rem = divmod(p, 100)
    s = str(r)
    head, tail = (s[:-3], s[-3:]) if len(s) > 3 else ('', s)
    grouped = tail if not head else re.sub(r'\B(?=(\d{2})+(?!\d))', ',', head) + ',' + tail
    return f'₹{grouped}' + ('' if rem == 0 else f'.{rem:02d}')

def plan_price(p):
    if p['pricePaise'] == 0: return 'Free'
    period = {30: 'a month', 31: 'a month', 365: 'a year', 366: 'a year', 7: 'a week'}.get(p['periodDays'], f"for {p['periodDays']} days")
    return f"{rupees(p['pricePaise'])} {period}"

def plan_action(p, m, max_ahead=2):
    if p['pricePaise'] == 0: return None
    c = m['current']
    if c is None: return (f"Join {p['name']} · {rupees(p['pricePaise'])}", True)
    if c['plan']['id'] != p['id']: return ('Available after …', False)
    if len(m['upcoming']) >= max_ahead: return ('Renewed', False)
    return (f"Renew · {rupees(p['pricePaise'])}", True)

safe = lambda link: link is not None and re.fullmatch(r'/[a-z0-9][a-z0-9\-_/]{0,150}', link) is not None
reached = lambda pos_ms, dur_ms: dur_ms > 500 and pos_ms >= dur_ms - 400

plans = fx('membership_plans')
by = {p['key']: p for p in plans}
none, member = fx('membership_me_none'), fx('membership_me_member')
check('plan order', [p['key'] for p in plans] == ['FREE', 'PLUS', 'PREMIUM'])
check('prices', plan_price(by['FREE']) == 'Free' and plan_price(by['PLUS']) == '₹149 a month'
      and plan_price({'pricePaise': 149900, 'periodDays': 365}) == '₹1,499 a year' and plan_price({'pricePaise': 4900, 'periodDays': 14}) == '₹49 for 14 days')
check('premium lines', 'Book services up to 30 days earlier than everyone else' in by['PREMIUM']['lines'] and by['PREMIUM']['benefits']['priorityDays'] == 30)
check('none', none['enabled'] is True and none['current'] is None)
check('free has no button', plan_action(by['FREE'], none) is None)
check('join', plan_action(by['PLUS'], none) == ('Join Plus · ₹149', True))
check('member current', member['current']['plan']['key'] == 'PLUS' and len(member['upcoming']) == 1)
check('renewal starts when current ends', member['upcoming'][0]['startsAt'] == member['current']['endsAt'])
check('renew', plan_action(by['PLUS'], member) == ('Renew · ₹149', True) and plan_action(by['PLUS'], member, 1) == ('Renewed', False))
check('switch waits', plan_action(by['PREMIUM'], member)[1] is False)
check('badges', fx('me_member')['member']['plan'] == 'Plus' and fx('user_profile_member')['member']['plan'] == 'Plus' and fx('me').get('member') is None)
check('members flag', all(c.get('membersOnly') is False for c in fx('contests_with_members_flag')) and fx('challenge_detail_members_flag')['membersOnly'] is False)
old = fx('notification_prefs')
check('pref defaults', old.get('reminders', True) is not False and old.get('votes', True) is not False and old.get('promotions') is not True)
check('promotions chosen', fx('notification_prefs_9d')['promotions'] is True)
items = fx('notifications_9d')['items']
promo = next(n for n in items if n['type'] == 'PROMOTION')
check('promo link', promo['link'] == '/shop' and safe(promo['link']))
check('membership notification', any(n['type'] == 'MEMBERSHIP_UPDATE' and n['entityType'] == 'Membership' for n in items))
check('unsafe links', not safe('https://evil.example') and not safe('//evil.example') and safe('/contest/summer-smiles') and not safe('javascript:alert(1)'))
check('reached end', reached(14700, 15000) and not reached(10000, 15000) and not reached(0, 0))

if fails:
    print('FAILED:\n  ' + '\n  '.join(fails))
    sys.exit(1)
print('membership mirrors: OK')
