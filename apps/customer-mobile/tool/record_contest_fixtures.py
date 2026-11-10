#!/usr/bin/env python3
"""Records real contest responses into test/fixtures (run after record_fixtures.py).

Needs the API running with SMS_PROVIDER=console (log at $API_LOG, default /tmp/api.log), PAYMENT_PROVIDER=fake,
and the seeded super admin ($SEED_ADMIN_EMAIL / $SEED_ADMIN_PASSWORD). Turns on ENABLE_CONTESTS and ENABLE_PUBLIC_VOTING.
"""
import datetime as dt, json, os, pathlib, re, subprocess, time, urllib.error, urllib.request

APP = pathlib.Path(__file__).resolve().parents[1]
OUT = APP / 'test' / 'fixtures'
API = os.environ.get('API_URL', 'http://localhost:4000') + '/api/v1'
LOG = os.environ.get('API_LOG', '/tmp/api.log')

def call(method, path, body=None, token=None, save=None, expect=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req) as r: status, raw = r.status, r.read()
    except urllib.error.HTTPError as e: status, raw = e.code, e.read()
    j = json.loads(raw)
    if expect and status != expect: raise SystemExit(f'{method} {path} -> {status} {raw[:400]}')
    if save: (OUT / f'{save}.json').write_text(json.dumps(j, indent=2, ensure_ascii=False))
    return j['data'] if isinstance(j, dict) and 'data' in j else j

def unthrottle():
    subprocess.run("redis-cli --scan --pattern 'throttle:*' | xargs -r redis-cli del >/dev/null", shell=True)

def login(phone, name):
    unthrottle()
    call('POST', '/auth/otp/request', {'phone': phone}, expect=200)
    for _ in range(40):
        m = re.findall(r'DEV SMS → \+91\*+' + phone[-4:] + r'\] (\d{6})', open(LOG).read())
        if m: break
        time.sleep(0.25)
    d = call('POST', '/auth/otp/verify', {'phone': phone, 'code': m[-1]}, expect=200)
    t = d['tokens']['accessToken']
    call('PATCH', '/users/me', {'name': name}, t, expect=200)
    return t

def flag(admin, key):
    call('PATCH', f'/admin/flags/{key}', {'enabled': True}, admin, expect=200)

iso = lambda h: (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=h)).isoformat()
stamp = str(int(time.time()))[-4:]
unthrottle()
admin = call('POST', '/admin/auth/login', {'email': os.environ.get('SEED_ADMIN_EMAIL', 'admin@petapp.local'), 'password': os.environ.get('SEED_ADMIN_PASSWORD', 'ChangeMe-Admin-2026')}, expect=200)['tokens']['accessToken']
for k in ['ENABLE_CONTESTS', 'ENABLE_PUBLIC_VOTING']: flag(admin, k)
subprocess.run('redis-cli del platform:flags >/dev/null', shell=True)

cat = call('POST', '/admin/contest-categories', {'key': f'fixture-{stamp}', 'name': 'Best Trick', 'group': 'TALENT'}, admin, expect=201)
contest = call('POST', '/admin/contests', {
    'title': f'Fixture Talent Cup {stamp}', 'description': 'Show us your best trick.', 'categoryId': cat['id'], 'feePaise': 9900,
    'minParticipants': 2, 'maxParticipants': 50, 'publicWeight': 100, 'votesPerUserPerDay': 1,
    'registrationOpensAt': iso(-1), 'registrationClosesAt': iso(1), 'submissionClosesAt': iso(2), 'votingClosesAt': iso(3),
    'finance': {'prizePoolPct': 60, 'platformFeePct': 20, 'gatewayPct': 2, 'gstOnPlatformFeePct': 18, 'promotionPct': 5, 'refundReservePct': 5, 'judgeFeesPaise': 0},
    'tasks': [{'type': 'TEXT', 'title': 'Describe the trick in one line'}],
    'prizes': [{'rank': 1, 'title': 'Winner', 'kind': 'CASH', 'amountPaise': 50000}, {'title': 'Crowd favourite', 'kind': 'VOUCHER'}],
}, admin, expect=201)
cid = contest['id']
for to in ['REVIEW', 'SCHEDULED']: call('POST', f'/admin/contests/{cid}/transition', {'to': to}, admin, expect=200)
call('POST', f'/admin/contests/{cid}/legal-approval', {'note': 'Fixture: counsel ref LGL-FIX-001'}, admin, expect=200)
call('POST', f'/admin/contests/{cid}/transition', {'to': 'LIVE'}, admin, expect=200)

species = call('GET', '/species', expect=200)
dog = [s for s in species if s['key'] == 'dog'][0]['id']
entrants = []
for i, (phone, name, pet) in enumerate([(f'9877{stamp}01'[:10], 'Asha Entrant', 'Tara'), (f'9878{stamp}02'[:10], 'Ravi Entrant', 'Bolt')]):
    t = login(phone, name)
    pid = call('POST', '/pets', {'name': pet, 'speciesId': dog}, t, expect=201)['id']
    if i == 0:
        call('GET', '/contests?when=live', None, t, save='contests_live', expect=200)
        call('GET', f'/contests/{cid}', None, t, save='contest_detail_open', expect=200)
    reg = call('POST', f'/contests/{cid}/register', {'petId': pid}, t, save='contest_register' if i == 0 else None, expect=201)
    if i == 0: call('GET', f'/contests/{cid}', None, t, save='contest_detail_pending', expect=200)
    call('POST', f"/payments/{reg['payment']['paymentId']}/simulate", None, t, save='payment_simulate' if i == 0 else None, expect=200)
    task = call('GET', f'/contests/{cid}', None, t, expect=200)['tasks'][0]['id']
    call('POST', f"/contest-entries/{reg['entryId']}/submissions", {'taskId': task, 'text': 'Rolls over, then high-fives.'}, t, save='contest_submission' if i == 0 else None, expect=201)
    if i == 0: call('GET', f'/contests/{cid}', None, t, save='contest_detail_entered', expect=200)
    entrants.append(reg['entryId'])
call('POST', f'/admin/contests/{cid}/transition', {'to': 'VOTING'}, admin, expect=200)
voter = login(f'9879{stamp}03'[:10], 'Vik Voter')
call('POST', f'/contest-entries/{entrants[0]}/vote', None, voter, save='contest_vote', expect=200)
call('GET', f'/contests/{cid}/leaderboard', None, voter, save='contest_leaderboard', expect=200)
print('contest fixtures recorded for', cid)
