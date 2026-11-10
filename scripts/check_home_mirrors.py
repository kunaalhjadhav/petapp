#!/usr/bin/env python3
"""Python mirror of the customer app's Phase 7b Dart test (test/home_test.dart), run against the same recorded
fixtures. A stand-in where no Flutter SDK is available: if an expectation here fails, the Dart test would too.
Usage: python3 scripts/check_home_mirrors.py
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / 'apps' / 'customer-mobile'
fails = []
fx = lambda n: json.load(open(APP / 'test' / 'fixtures' / f'{n}.json'))['data']
def check(name, cond):
    if not cond: fails.append(name)

KINDS = {'FEATURED_REELS', 'TRENDING_PETS', 'ACTIVE_CONTESTS', 'CHALLENGES', 'NEARBY_SERVICES', 'RECOMMENDED_PRODUCTS', 'PARTNER_OFFERS', 'UPCOMING_EVENTS'}
def sections(feed):  # HomeFeed.fromJson: unknown kinds have no items; empty sections are dropped
    return [s for s in feed['sections'] if s['kind'] in KINDS and s['items']]

def rupees(paise):
    r, p = divmod(paise, 100)
    s = str(r)
    head, tail = (s[:-3], s[-3:]) if len(s) > 3 else ('', s)
    grouped = tail if not head else re.sub(r'\B(?=(\d{2})+(?!\d))', ',', head) + ',' + tail
    return f'₹{grouped}' + ('' if p == 0 else f'.{p:02d}')

def offer_text(o):
    v = o['value']
    pct = str(v // 100) if v % 100 == 0 else f'{v / 100:.1f}'
    off = f'{pct}% off' if o['kind'] == 'PERCENT' else f'{rupees(v)} off'
    cap = f" (up to {rupees(o['maxDiscountPaise'])})" if o['kind'] == 'PERCENT' and o.get('maxDiscountPaise') is not None else ''
    mn = f" on orders over {rupees(o['minOrderPaise'])}" if o.get('minOrderPaise', 0) > 0 else ''
    return off + cap + mn

def hashtag_for(q):
    t = re.sub(r'^#', '', q.strip()).lower()
    return t if re.fullmatch(r'[\w]{2,50}', t) else None

h = fx('home_personal')
secs = sections(h)
check('personalised', h['personalised'] is True and secs and all(s['items'] for s in secs))
reels = [s for s in secs if s['kind'] == 'FEATURED_REELS'][0]
check('reel reason', reels['items'][0]['reason'] == 'From someone you follow')
offer = [s for s in secs if s['kind'] == 'PARTNER_OFFERS'][0]['items'][0]
check('offer code', offer['code'].startswith('HOME'))
check('offer text', offer_text(offer) == '10% off (up to ₹200)')
up = [s for s in secs if s['kind'] == 'UPCOMING_EVENTS'][0]['items']
check('upcoming', all(u['at'] and u['label'] and u['kind'] in ('BOOKING', 'CONTEST', 'CHALLENGE') for u in up))
check('anon', fx('home_anon')['personalised'] is False)
check('unknown kinds', sections({'sections': [{'kind': 'SOMETHING_NEW', 'items': [{'id': 'x'}]}, {'kind': 'TRENDING_PETS', 'items': []}]}) == [])
picks = fx('reco_products')
check('picks', picks and picks[0]['reason'] and picks[0].get('pinned', False) is False)
check('reels page', [p['type'] for p in fx('reco_reels')['items']] == ['REEL'])
on, off = fx('reco_settings'), fx('reco_settings_off')
check('settings on', on['personalised'] and len(on['basedOn']) == 4 and on['viewsKept'] > 0)
check('settings off', off['personalised'] is False and off['basedOn'] == [] and off['viewsKept'] == 0)
o = lambda kind, value, cap=None, mn=0: {'kind': kind, 'value': value, 'maxDiscountPaise': cap, 'minOrderPaise': mn}
check('percent', offer_text(o('PERCENT', 1250)) == '12.5% off')
check('flat', offer_text(o('FLAT', 10000, mn=50000)) == '₹100 off on orders over ₹500')
check('hashtags', hashtag_for('#Zoomies') == 'zoomies' and hashtag_for('beach') == 'beach' and hashtag_for('golden retriever') is None and hashtag_for('#') is None)

if fails:
    print('MIRROR FAILURES:', ', '.join(fails))
    sys.exit(1)
print('OK: home test expectations hold against the recorded fixtures')
