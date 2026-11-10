#!/usr/bin/env python3
"""Records real challenge, badge and judging responses into test/fixtures.
Same requirements as record_contest_fixtures.py (run that first)."""
import datetime as dt, json, os, pathlib, re, subprocess, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from record_contest_fixtures import call, login, unthrottle  # noqa: E402  (reuses its helpers; importing it records contest fixtures too)

iso = lambda h: (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=h)).isoformat()
stamp = str(int(time.time()))[-4:]
unthrottle()
admin = call('POST', '/admin/auth/login', {'email': os.environ.get('SEED_ADMIN_EMAIL', 'admin@petapp.local'), 'password': os.environ.get('SEED_ADMIN_PASSWORD', 'ChangeMe-Admin-2026')}, expect=200)['tokens']['accessToken']

# ── challenge: one check-in completes it and earns the badge ──
badge = call('POST', '/admin/badges', {'key': f'fixture-{stamp}', 'name': 'First Step', 'description': 'Completed a first challenge.'}, admin, expect=201)
ch = call('POST', '/admin/challenges', {
    'title': f'Fixture Walk Day {stamp}', 'description': 'Walk your dog today and tell us about it.', 'kind': 'FREE',
    'startsAt': iso(-1), 'endsAt': iso(48), 'requiredCheckIns': 1, 'proof': 'TEXT', 'pointsPerCheckIn': 10,
    'streakBonusEvery': 7, 'streakBonusPoints': 50, 'badgeId': badge['id'],
}, admin, expect=201)
call('POST', f"/admin/challenges/{ch['id']}/status", {'to': 'PUBLISHED'}, admin, expect=200)
u = login(f'9871{stamp}05'[:10], 'Chandni Walker')
call('POST', f"/challenges/{ch['id']}/join", {}, u, save='challenge_join', expect=201)
call('GET', '/challenges?when=active', None, u, save='challenges_active', expect=200)
call('GET', f"/challenges/{ch['id']}", None, u, save='challenge_detail_joined', expect=200)
call('POST', f"/challenges/{ch['id']}/check-in", {'text': 'Long walk by the lake.'}, u, save='challenge_checkin', expect=201)
call('GET', f"/challenges/{ch['id']}", None, u, save='challenge_detail_done', expect=200)
call('GET', f"/challenges/{ch['id']}/leaderboard", None, u, save='challenge_board', expect=200)
call('GET', '/users/me/badges', None, u, save='badges_mine', expect=200)

# ── judging: a judge scores an entry in a judged contest ──
judge = login(f'9872{stamp}06'[:10], 'Dr. Judge Fixture')
jid = call('GET', '/users/me', None, judge)['id']
call('PUT', f'/admin/users/{jid}/roles', {'roleKeys': ['CUSTOMER', 'JUDGE']}, admin, expect=200)
call('GET', '/users/me', None, judge, save='me_judge', expect=200)
c = call('POST', '/admin/contests', {
    'title': f'Fixture Judged Cup {stamp}', 'description': 'Judged by experts.', 'feePaise': 0, 'publicWeight': 50,
    'registrationOpensAt': iso(-1), 'registrationClosesAt': iso(1), 'submissionClosesAt': iso(2), 'votingClosesAt': iso(3),
    'tasks': [{'type': 'TEXT', 'title': 'Describe your pet’s best trick'}], 'prizes': [{'rank': 1, 'title': 'Winner', 'kind': 'VOUCHER'}],
    'criteria': [{'name': 'Skill', 'weight': 60}, {'name': 'Style', 'weight': 40}], 'judgeIds': [jid],
}, admin, expect=201)
for to in ['REVIEW', 'SCHEDULED', 'LIVE']: call('POST', f"/admin/contests/{c['id']}/transition", {'to': to}, admin, expect=200)
species = call('GET', '/species', expect=200)
dog = [s for s in species if s['key'] == 'dog'][0]['id']
pet = call('POST', '/pets', {'name': 'Juno', 'speciesId': dog}, u, expect=201)['id']
entry = call('POST', f"/contests/{c['id']}/register", {'petId': pet}, u, expect=201)['entryId']
task = call('GET', f"/contests/{c['id']}", None, u)['tasks'][0]['id']
call('POST', f'/contest-entries/{entry}/submissions', {'taskId': task, 'text': 'Balances a treat on her nose.'}, u, expect=201)
call('POST', f"/admin/contests/{c['id']}/transition", {'to': 'VOTING'}, admin, expect=200)
jc = call('GET', '/judge/contests', None, judge, save='judge_contests', expect=200)
mine = [x for x in jc if x['id'] == c['id']][0]
call('GET', f"/judge/contests/{c['id']}/entries", None, judge, save='judge_entries', expect=200)
call('PUT', f'/judge/contest-entries/{entry}/scores', {'scores': [{'criterionId': mine['criteria'][0]['id'], 'score': 9}, {'criterionId': mine['criteria'][1]['id'], 'score': 7.5}]}, judge, save='judge_scores', expect=200)
call('GET', f"/judge/contests/{c['id']}/entries", None, judge, save='judge_entries_scored', expect=200)
print('challenge and judging fixtures recorded')
