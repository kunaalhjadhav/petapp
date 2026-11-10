#!/usr/bin/env python3
"""Records real home screen and recommendation responses for the customer app.

Needs the API and worker running, storage, SMS_PROVIDER=console (log at $API_LOG), the seeded super admin,
and at least one approved service partner and live product (the earlier recorders create them).
Turns on ENABLE_REELS, ENABLE_CONTESTS, ENABLE_SERVICES and ENABLE_MARKETPLACE.

Run:  python3 apps/customer-mobile/tool/record_home_fixtures.py
"""
import datetime as dt, pathlib, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixture_api import admin_token, call, flag, login, put_bytes  # noqa: E402

FIX = pathlib.Path(__file__).resolve().parents[2] / 'backend' / 'test' / 'fixtures'
stamp = str(int(time.time()))[-4:]
iso = lambda h: (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=h)).isoformat()

def upload(token, kind, mime, body):
    up = call('POST', '/media/uploads', {'kind': kind, 'mimeType': mime, 'sizeBytes': len(body)}, token, expect=201)
    put_bytes(up['upload']['url'], up['upload']['headers'], body)
    mid = up['media']['id']
    call('POST', f'/media/{mid}/complete', None, token, expect=200)
    for _ in range(240):
        if call('GET', f'/media/{mid}', None, token)['status'] == 'READY': return mid
        time.sleep(0.25)
    raise SystemExit('media never became READY: is the worker running?')

admin = admin_token()
for f in ['ENABLE_REELS', 'ENABLE_CONTESTS', 'ENABLE_SERVICES', 'ENABLE_MARKETPLACE']: flag(admin, f)
partners = call('GET', '/admin/partners?status=APPROVED&limit=1', None, admin)
if not partners: raise SystemExit('No approved service partner: run record_services_fixtures.py first.')
near = call('GET', f"/admin/partners/{partners[0]['id']}", None, admin)

# An offer on the home screen.
code = f'HOME{stamp}'
coupon = call('POST', '/admin/coupons', {'code': code, 'description': '10% off your first order', 'kind': 'PERCENT', 'value': 1000, 'maxDiscountPaise': 20000, 'startsAt': iso(-1), 'endsAt': iso(72)}, admin, expect=201)
offers = [s for s in call('GET', '/admin/home-sections', None, admin) if s['kind'] == 'PARTNER_OFFERS']
if not offers: raise SystemExit('No Partner offers section: apply the 20261014090000_home_reco migration.')
call('POST', f"/admin/home-sections/{offers[0]['id']}/pins", {'ref': code}, admin, expect=201)

# A creator posts a reel; a customer with a puppy follows them and likes it.
creator = login(f'9871{stamp}31'[:10], 'Reel Maker')
reel_media = upload(creator, 'VIDEO', 'video/mp4', (FIX / 'reel-3s.mp4').read_bytes())
reel = call('POST', '/posts', {'type': 'REEL', 'mediaIds': [reel_media], 'caption': 'Zoomies #zoomies'}, creator, expect=201)
for _ in range(240):
    if call('GET', f"/posts/{reel['id']}", None, creator)['status'] == 'PUBLISHED': break
    time.sleep(0.25)
me = login(f'9872{stamp}32'[:10], 'Home Viewer')
dog = [s for s in call('GET', '/species', None, me) if s['key'] == 'dog'][0]
born = (dt.date.today() - dt.timedelta(days=120)).isoformat()
call('POST', '/pets', {'name': 'Pip', 'speciesId': dog['id'], 'gender': 'FEMALE', 'dateOfBirth': born}, me, expect=201)
creator_id = call('GET', '/users/me', None, creator)['id']
call('POST', f'/users/{creator_id}/follow', None, me, expect=200)
call('POST', f"/posts/{reel['id']}/like", None, me, expect=200)
products = call('GET', '/products?limit=3', None, me)
for p in products: call('GET', f"/products/{p['id']}", None, me, expect=200)

q = f"lat={near['lat']}&lng={near['lng']}"
call('GET', f'/home?{q}', None, me, save='home_personal', expect=200)
call('GET', f"/home?{q}&city={near['city']}", None, None, save='home_anon', expect=200)
call('GET', '/recommendations/products?limit=6', None, me, save='reco_products', expect=200)
call('GET', '/recommendations/reels', None, me, save='reco_reels', expect=200)
call('GET', '/me/recommendations', None, me, save='reco_settings', expect=200)
call('PUT', '/me/recommendations', {'personalised': False}, me, save='reco_settings_off', expect=200)
call('DELETE', '/me/recommendations/history', None, me, save='reco_settings_cleared', expect=200)
call('GET', '/pets?search=Pip&limit=5', None, me, save='pets_search', expect=200)
print('recorded home fixtures')
