#!/usr/bin/env python3
"""Python mirror of the customer app's Phase 9c Dart test (test/search_test.dart), run against the same recorded
fixtures, with the pure helpers in lib/features/home/search_logic.dart re-implemented line for line.
A stand-in where no Flutter SDK is available.
Usage: python3 scripts/check_search_mirrors.py
"""
import json, math, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / 'apps' / 'customer-mobile'
fx = lambda n: json.load(open(APP / 'test' / 'fixtures' / f'{n}.json'))['data']
src = (APP / 'lib' / 'features' / 'home' / 'search_logic.dart').read_text()
fails = []
def check(name, cond):
    if not cond: fails.append(name)

for name in ('hitRoute', 'hitTrailing', 'filtersOf', 'filterQuery', 'addRecent', 'petDistanceLabel', 'challengeProgress', 'coarsePoint', 'searchTypeLabel'):
    check(f'search_logic.dart defines {name}', re.search(r'\b' + name + r'\(', src) is not None)

# ── search_logic.dart ──
ORDER = ['pets', 'users', 'reels', 'products', 'services', 'partners', 'contests', 'challenges']
LABEL = {'pets': 'Pets', 'users': 'People', 'reels': 'Reels', 'products': 'Shop', 'services': 'Services', 'partners': 'Businesses', 'contests': 'Contests', 'challenges': 'Challenges'}
ROUTES = {'pet': '/pet/', 'user': '/user/', 'reel': '/post/', 'product': '/product/', 'service': '/service-partner/', 'contest': '/contest/', 'challenge': '/challenge/'}
def hit_route(kind, key):
    if not key: return None
    return ROUTES[kind] + key if kind in ROUTES else None

def rupees(p):
    r, rem = divmod(p, 100)
    s = str(r)
    head, tail = (s[:-3], s[-3:]) if len(s) > 3 else ('', s)
    grouped = tail if not head else re.sub(r'\B(?=(\d{2})+(?!\d))', ',', head) + ',' + tail
    return f'₹{grouped}' + ('' if rem == 0 else f'.{rem:02d}')

def fixed1(x):
    return f'{math.floor(abs(x) * 10 + 0.5) / 10:.1f}'

def trailing(t, meta):
    dist = meta.get('distance')
    join = lambda parts: ' · '.join(p for p in parts if p)
    num = lambda k: int(meta[k]) if isinstance(meta.get(k), (int, float)) and not isinstance(meta.get(k), bool) else None
    if t == 'PRODUCT':
        p = num('fromPaise'); return None if p is None else rupees(p)
    if t == 'SERVICE':
        p = num('pricePaise'); return join([None if p is None else rupees(p), dist])
    if t == 'PARTNER':
        n = num('ratingCount') or 0; avg = float(meta.get('ratingAvg') or 0)
        return join([f'★ {fixed1(avg)}' if n > 0 else None, dist])
    if t == 'CONTEST':
        n = num('entries') or 0; return f"{n} entr{'y' if n == 1 else 'ies'}"
    if t == 'CHALLENGE':
        return f"{num('participants') or 0} taking part"
    if t == 'PET':
        n = num('followers') or 0; return f"{n} follower{'' if n == 1 else 's'}" if n > 0 else None
    if t == 'REEL':
        n = num('likes') or 0; return f'♥ {n}' if n > 0 else None
    return None

FILTERS = {'pets': {'species'}, 'products': {'category', 'species', 'inStock'}, 'services': {'category', 'mode', 'near'}, 'partners': {'category', 'near'}, 'contests': {'category', 'when'}, 'challenges': {'when'}}
def filter_query(t, speciesId=None, categoryId=None, mode=None, when=None, inStock=False, lat=None, lng=None):
    f = FILTERS.get(t, set()); out = {}
    if 'species' in f and speciesId is not None: out['speciesId'] = speciesId
    if 'category' in f and categoryId is not None: out['categoryId'] = categoryId
    if 'mode' in f and mode is not None: out['mode'] = mode
    if 'when' in f and when is not None: out['when'] = when
    if 'inStock' in f and inStock: out['inStock'] = 'true'
    if 'near' in f and lat is not None and lng is not None: out.update({'lat': float(lat), 'lng': float(lng)})
    return out

def add_recent(recent, q, mx=8):
    t = q.strip()
    if len(t) < 2: return recent
    return ([t] + [r for r in recent if r.lower() != t.lower()])[:mx]

pet_distance = lambda km: '' if km is None else 'Within 1 km' if km <= 1 else f'{km} km away'
progress = lambda c, r, completed=False: 'Completed' if completed else f'{c} of {r} check-ins'
def dart_round(x):  # Dart's round(): half away from zero
    return int(math.floor(abs(x) + 0.5)) * (1 if x >= 0 else -1)
coarse = lambda lat, lng: (dart_round(lat * 100) / 100, dart_round(lng * 100) / 100)

check('type order in Dart matches', "const searchTypeOrder = ['pets', 'users', 'reels', 'products', 'services', 'partners', 'contests', 'challenges'];" in src)

# ── test/search_test.dart ──
for n in ['search_pets', 'search_users', 'search_reels', 'search_products', 'search_services', 'search_partners', 'search_contests', 'search_challenges']:
    lst = fx(n)
    check(f'{n} not empty', len(lst) > 0)
    for h in lst:
        check(f'{n} {h["type"]} opens', hit_route(h['link']['kind'], h['link']['key']) is not None)
check('routes', hit_route('pet', 'bruno.ana') == '/pet/bruno.ana' and hit_route('reel', 'r1') == '/post/r1' and hit_route('service', 'pia') == '/service-partner/pia' and hit_route('nope', 'x') is None and hit_route('pet', '') is None)

a = fx('search_all')
check('all query', a['query'] == 'walk' and a['groups'][0]['type'] == 'challenges' and a['groups'][0]['items'][0]['type'] == 'CHALLENGE')
f = fx('search_filters')
check('filters types', f['types'] == ORDER)
check('filters species', len(f['pets']['species']) > 0)
check('filters modes', [m['id'] for m in f['services']['modes']] == ['AT_CENTER', 'AT_HOME'])
check('filters challenge when', [w['id'] for w in f['challenges']['when']] == ['active', 'upcoming', 'past'])

s = fx('search_services')[0]
check('service trailing', trailing(s['type'], s['meta']) == '₹849 · 100 m')
p = fx('search_partners')[0]
check('partner trailing', trailing(p['type'], p['meta']) == '★ 5.0 · 100 m')
check('product trailing', trailing('PRODUCT', {'fromPaise': 29900}) == '₹299')
check('contest trailing', trailing('CONTEST', {'entries': 1}) == '1 entry')
check('challenge trailing', trailing('CHALLENGE', {'participants': 0}) == '0 taking part')
check('pet trailing', trailing('PET', {'followers': 0}) is None)
check('reel trailing', trailing('REEL', {'likes': 3}) == '♥ 3')
check('user trailing', trailing('USER', {}) is None)
check('label', LABEL['partners'] == 'Businesses' and "'partners': 'Businesses'" in src)

check('filters pets', filter_query('pets', speciesId='s', categoryId='c') == {'speciesId': 's'})
check('filters services', filter_query('services', categoryId='c', mode='AT_HOME', lat=1, lng=2) == {'categoryId': 'c', 'mode': 'AT_HOME', 'lat': 1.0, 'lng': 2.0})
check('filters products', filter_query('products', inStock=True, when='past') == {'inStock': 'true'})
check('filters contests', filter_query('contests', when='voting') == {'when': 'voting'})
check('filters users', filter_query('users', speciesId='s') == {})
check('recent', add_recent(['Luna', 'groom'], 'luna') == ['luna', 'groom'] and add_recent([], 'a') == [] and len(add_recent([f'q{i}' for i in range(8)], 'new')) == 8)

near = fx('discover_nearby')
check('nearby', len(near) > 0 and all(isinstance(x.get('distanceKm'), int) and x['distanceKm'] >= 1 for x in near))
check('nearby no coordinates', not any('latitude' in x or 'location' in x for x in near))
check('distance labels', pet_distance(1) == 'Within 1 km' and pet_distance(3) == '3 km away')
check('owner discoverable', fx('pet_view_owner_discoverable')['discoverable'] is True)
check('coarse point', coarse(19.07612, 72.87765) == (19.08, 72.88))

ce = fx('discover_contest_entries')
check('contest entry', len(ce) == 1 and ce[0]['pet']['name'] == 'Bagel' and ce[0]['contest']['id'])
ch = fx('discover_challenge_entries')
check('challenge entry', len(ch) == 1 and ch[0]['challenge']['requiredCheckIns'] == 5 and progress(ch[0]['checkIns'], 5) == '0 of 5 check-ins' and progress(5, 5, True) == 'Completed')
check('reels', len(fx('discover_reels')['items']) > 0)

pin = fx('location_pincode')
check('pincode', pin['city']['name'] == 'Mumbai' and pin['state']['name'] == 'Maharashtra' and pin['locality']['name'] == 'Bandra West')
check('cities', 'pune' in [c['slug'] for c in fx('location_cities')])
check('coverage', fx('location_coverage')['covered'] is True)
out = fx('location_coverage_outside')
check('coverage outside', out['covered'] is False and out['nearest']['name'] == 'Mumbai')

okc = fx('shop_preview_delivery')
check('delivery ok', okc['delivery']['deliverable'] is True and okc['delivery']['line'] == 'Delivery in 1–2 days' and okc['shippingPaise'] == 0)
no = fx('shop_preview_undeliverable')
check('delivery no', no['canCheckout'] is False and no['delivery']['problem'] == 'Paused for the monsoon.')
check('preview without address', fx('shop_preview').get('delivery') is None)

if fails:
    print('FAILED:\n  ' + '\n  '.join(fails))
    sys.exit(1)
print('search mirrors: OK')
