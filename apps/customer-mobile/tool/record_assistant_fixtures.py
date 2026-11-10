#!/usr/bin/env python3
"""Records real PetApp Assistant responses for the customer app.

Needs the API running with SMS_PROVIDER=console (log at $API_LOG), the seeded super admin, and at least one approved
service partner (record_services_fixtures.py creates one). Turns on ENABLE_AI_ASSISTANT and the marketplace switches.
Works with either assistant (built-in answers or Claude); the fixtures say which answered.

Run:  python3 apps/customer-mobile/tool/record_assistant_fixtures.py
"""
import datetime as dt, pathlib, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixture_api import admin_token, call, flag, login  # noqa: E402

stamp = str(int(time.time()))[-4:]
admin = admin_token()
for f in ['ENABLE_AI_ASSISTANT', 'ENABLE_CONTESTS', 'ENABLE_SERVICES', 'ENABLE_MARKETPLACE']: flag(admin, f)
partners = call('GET', '/admin/partners?status=APPROVED&limit=1', None, admin)
if not partners: raise SystemExit('No approved service partner: run record_services_fixtures.py first.')
near = call('GET', f"/admin/partners/{partners[0]['id']}", None, admin)
here = {'lat': near['lat'], 'lng': near['lng']}

me = login(f'9873{stamp}33'[:10], 'Assistant Asker')
dog = [s for s in call('GET', '/species', None, me) if s['key'] == 'dog'][0]
pet = call('POST', '/pets', {'name': 'Momo', 'speciesId': dog['id'], 'gender': 'MALE', 'dateOfBirth': (dt.date.today() - dt.timedelta(days=200)).isoformat()}, me, expect=201)

# A booking (left unpaid) so "my bookings" has something to show.
svc = [x for x in call('GET', f"/service-partners/{near['id']}", None, me)['services'] if 'AT_CENTER' in x['modes'] and (not x['speciesIds'] or dog['id'] in x['speciesIds'])][0]
for d in range(1, 8):
    slots = call('GET', f"/partner-services/{svc['id']}/slots?date={(dt.date.today() + dt.timedelta(days=d)).isoformat()}", None, me)['slots']
    if slots: break
call('POST', '/bookings', {'serviceId': svc['id'], 'petId': pet['id'], 'startsAt': slots[-1]['startsAt'], 'mode': 'AT_CENTER'}, me, expect=201)

call('GET', '/assistant', None, me, save='assistant_info', expect=200)
first = call('POST', '/assistant/messages', {'text': 'Find a groomer near me', **here}, me, save='assistant_services', expect=200)
conv = first['conversation']['id']
def ask(text, save, **extra):
    return call('POST', '/assistant/messages', {'text': text, 'conversationId': conv, **extra}, me, save=save, expect=200)
ask('buy dog food', 'assistant_products')
ask('Which contests can my pet enter?', 'assistant_contests')
ask('any challenges running?', 'assistant_challenges')
ask('How do I add my pet?', 'assistant_link')
ask('my dog has fleas', 'assistant_care')
ask('Help, my dog ate chocolate!', 'assistant_urgent', **here)
ask('How much paracetamol can I give my dog?', 'assistant_dose')
ask('cancel my booking', 'assistant_bookings')
call('POST', f"/assistant/messages/{first['answer']['id']}/rating", {'rating': 'UP'}, me, save='assistant_rate', expect=200)
call('GET', '/assistant/conversations', None, me, save='assistant_conversations', expect=200)
call('GET', f'/assistant/conversations/{conv}', None, me, save='assistant_conversation', expect=200)
print('recorded assistant fixtures')
