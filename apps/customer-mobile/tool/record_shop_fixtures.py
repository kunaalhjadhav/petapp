#!/usr/bin/env python3
"""Records real marketplace responses for the customer app (shop, cart, checkout, orders).

Needs the API and worker running, storage, PAYMENT_PROVIDER=fake, SMS_PROVIDER=console (log at $API_LOG)
and the seeded super admin. Turns on ENABLE_MARKETPLACE.
"""
import datetime as dt, os, pathlib, sys, time, urllib.request
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixture_api import call, login, unthrottle  # noqa: E402

FIX = pathlib.Path(__file__).resolve().parents[2] / 'backend' / 'test' / 'fixtures'
iso = lambda h: (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=h)).isoformat()
stamp = str(int(time.time()))[-4:]

def upload(token, kind, mime, body):
    up = call('POST', '/media/uploads', {'kind': kind, 'mimeType': mime, 'sizeBytes': len(body)}, token, expect=201)
    req = urllib.request.Request(up['upload']['url'], data=body, method='PUT')
    for k, v in up['upload']['headers'].items(): req.add_header(k, v)
    urllib.request.urlopen(req).read()
    mid = up['media']['id']
    call('POST', f'/media/{mid}/complete', None, token, expect=200)
    for _ in range(80):
        if call('GET', f'/media/{mid}', None, token)['status'] == 'READY': return mid
        time.sleep(0.25)
    raise SystemExit('media never became READY: is the worker running?')

unthrottle()
admin = call('POST', '/admin/auth/login', {'email': os.environ.get('SEED_ADMIN_EMAIL', 'admin@petapp.local'), 'password': os.environ.get('SEED_ADMIN_PASSWORD', 'ChangeMe-Admin-2026')}, expect=200)['tokens']['accessToken']
call('PATCH', '/admin/flags/ENABLE_MARKETPLACE', {'enabled': True}, admin, expect=200)
import subprocess; subprocess.run('redis-cli del platform:flags >/dev/null', shell=True)
cat = call('POST', '/admin/product-categories', {'key': f'dog-food-{stamp}', 'name': f'Dog food {stamp}', 'commissionBps': 1000}, admin, expect=201)

# ── a vendor with a live product ──
vendor = login(f'9861{stamp}21'[:10], 'Shop Owner')
call('POST', '/vendor/profile', {'businessName': f'Happy Tails {stamp}', 'phone': f'9861{stamp}21'[:10], 'addressLine': '1 Market Road', 'city': 'Pune', 'state': 'Maharashtra', 'pincode': '411001'}, vendor, expect=201)
doc = upload(vendor, 'DOCUMENT', 'application/pdf', b'%PDF-1.4\n% ID\n%%EOF')
call('POST', '/vendor/documents', {'kind': 'ID_PROOF', 'mediaId': doc}, vendor, expect=201)
vid = call('POST', '/vendor/submit', None, vendor, expect=200)['id']
docs = call('GET', f'/admin/vendors/{vid}', None, admin)['documents']
call('POST', f'/admin/vendors/{vid}/review', {'decision': 'APPROVE', 'documents': [{'id': d['id'], 'status': 'ACCEPTED'} for d in docs]}, admin, expect=200)
img = upload(vendor, 'IMAGE', 'image/jpeg', (FIX / 'photo-gps.jpg').read_bytes())
p = call('POST', '/vendor/products', {
    'categoryId': cat['id'], 'title': f'Royal Kibble {stamp}', 'brand': 'Royal', 'description': 'Complete food for adult dogs.', 'imageIds': [img],
    'variants': [{'sku': 'RK-3', 'title': '3 kg', 'mrpPaise': 189900, 'pricePaise': 169900, 'gstRateBps': 1800, 'stock': 4},
                 {'sku': 'RK-7', 'title': '7 kg', 'mrpPaise': 389900, 'pricePaise': 349900, 'gstRateBps': 1800, 'stock': 20}],
}, vendor, expect=201)
call('PATCH', f"/vendor/products/{p['id']}", {'status': 'ACTIVE'}, vendor, expect=200)
v3 = [v for v in p['variants'] if v['sku'] == 'RK-3'][0]['id']
v7 = [v for v in p['variants'] if v['sku'] == 'RK-7'][0]['id']
code = f'FIX{stamp}'
call('POST', '/admin/coupons', {'code': code, 'kind': 'PERCENT', 'value': 1000, 'maxDiscountPaise': 30000, 'startsAt': iso(-1), 'endsAt': iso(48)}, admin, expect=201)

# ── a customer shops ──
c = login(f'9862{stamp}22'[:10], 'Asha Shopper')
call('GET', '/product-categories', None, c, save='shop_categories', expect=200)
call('GET', f'/products?q=Royal%20Kibble%20{stamp}', None, c, save='shop_products', expect=200)
call('GET', f"/products/{p['id']}", None, c, save='shop_product', expect=200)
call('PUT', '/cart/items', {'variantId': v3, 'qty': 2}, c, expect=200)
call('PUT', '/cart/items', {'variantId': v7, 'qty': 1}, c, save='shop_cart', expect=200)
call('POST', '/checkout/preview', {'couponCode': 'NOPE'}, c, save='shop_preview_bad_coupon', expect=200)
call('POST', '/checkout/preview', {'couponCode': code}, c, save='shop_preview', expect=200)
addr = call('POST', '/users/me/addresses', {'label': 'Home', 'line1': '4 Lake View', 'locality': 'Koregaon Park', 'city': 'Pune', 'state': 'Maharashtra', 'pincode': '411001', 'isDefault': True}, c, expect=201)
call('GET', '/users/me/addresses', None, c, save='shop_addresses', expect=200)
placed = call('POST', '/orders', {'addressId': addr['id'], 'couponCode': code}, c, save='shop_placed', expect=201)
call('POST', f"/payments/{placed['payment']['paymentId']}/simulate", None, c, expect=200)
oid = placed['order']['id']
sid = placed['order']['parcels'][0]['id']
call('POST', f'/vendor/orders/{sid}/pack', None, vendor, expect=200)
call('POST', f'/vendor/orders/{sid}/ship', {'courier': 'Delhivery', 'trackingNumber': 'DL123456789IN'}, vendor, expect=200)
call('GET', f'/orders/{oid}', None, c, save='shop_order_shipped', expect=200)
call('POST', f'/vendor/orders/{sid}/deliver', None, vendor, expect=200)
call('POST', f'/sub-orders/{sid}/return', {'reason': 'Our dog won’t eat it'}, c, save='shop_order_return', expect=200)

# ── a second order, cancelled before packing (refund recorded) ──
call('PUT', '/cart/items', {'variantId': v7, 'qty': 1}, c, expect=200)
second = call('POST', '/orders', {'addressId': addr['id']}, c, expect=201)
call('POST', f"/payments/{second['payment']['paymentId']}/simulate", None, c, expect=200)
call('POST', f"/sub-orders/{second['order']['parcels'][0]['id']}/cancel", {'reason': 'Ordered twice by mistake'}, c, save='shop_order_cancelled', expect=200)
call('GET', '/orders', None, c, save='shop_orders', expect=200)

# ── out of stock in the cart ──
call('PUT', '/cart/items', {'variantId': v3, 'qty': 2}, c, expect=200)
call('PUT', f'/vendor/variants/{v3}/stock', {'stock': 1}, vendor, expect=200)
call('GET', '/cart', None, c, save='shop_cart_problem', expect=200)
call('DELETE', '/cart', None, c, expect=200)
print('shop fixtures recorded')
