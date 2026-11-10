#!/usr/bin/env python3
"""Python mirror of the customer app's Phase 7c Dart test (test/assistant_test.dart), run against the same recorded
fixtures. A stand-in where no Flutter SDK is available: if an expectation here fails, the Dart test would too.
Usage: python3 scripts/check_assistant_mirrors.py
"""
import json, pathlib, sys

APP = pathlib.Path(__file__).resolve().parents[1] / 'apps' / 'customer-mobile'
fx = lambda n: json.load(open(APP / 'test' / 'fixtures' / f'{n}.json'))['data']
fails = []
def check(name, cond):
    if not cond: fails.append(name)

KNOWN = {'SERVICE', 'PRODUCT', 'CONTEST', 'CHALLENGE', 'BOOKING', 'LINK', 'CARE'}
cards = lambda m: [c for c in m['cards'] if c['type'] in KNOWN]
i = fx('assistant_info')
check('info', i['name'] == 'PetApp Assistant' and 'not a vet' in i['healthNotice'] and i['suggestions'])
s = fx('assistant_services')
check('roles', s['question']['role'] == 'USER' and s['answer']['role'] == 'ASSISTANT')
check('service cards', cards(s['answer']) and all(c['type'] == 'SERVICE' for c in cards(s['answer'])))
check('product cards', all(c['type'] == 'PRODUCT' for c in cards(fx('assistant_products')['answer'])))
check('challenge cards', all(c['type'] == 'CHALLENGE' for c in cards(fx('assistant_challenges')['answer'])))
link = cards(fx('assistant_link')['answer'])
check('link', len(link) == 1 and link[0]['item']['route'] == '/pets/new' and link[0]['item']['steps'])
bk = [c for c in cards(fx('assistant_bookings')['answer']) if c['type'] == 'BOOKING']
check('booking', bk and bk[0]['item']['petName'] == 'Momo' and bk[0]['item']['startsAt'])
care = fx('assistant_care')['answer']
check('care', care['safety'] == 'GENERAL_INFO' and 'not a diagnosis' in care['notice'] and [c['type'] for c in cards(care)] == ['CARE'])
u = fx('assistant_urgent')['answer']
check('urgent', u['safety'] == 'URGENT' and 'emergency' in u['notice'] and 'vet' in u['text'])
check('dose', fx('assistant_dose')['answer']['text'].startswith('I can’t suggest medicine doses'))
check('no notice', s['answer']['notice'] is None)
check('rating', fx('assistant_rate')['rating'] == 'UP')
check('conversations', fx('assistant_conversations')[0]['title'] == 'Find a groomer near me')
conv = fx('assistant_conversation')
check('conversation', conv['messages'][0]['role'] == 'USER' and len(conv['messages']) == 18)
check('unknown card', [c for c in [{'type': 'HOLOGRAM'}] if c['type'] in KNOWN] == [])
if fails:
    print('MIRROR FAILURES:', ', '.join(fails)); sys.exit(1)
print('OK: assistant test expectations hold against the recorded fixtures')
