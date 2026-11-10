#!/usr/bin/env python3
"""Records real API responses for the seller app's tests and contract check, by running a seller's full journey.

Needs the API and worker running (SMS_PROVIDER=console logging to $API_LOG, default /tmp/api.log; PAYMENT_PROVIDER=fake),
object storage, and the seeded super admin ($SEED_ADMIN_EMAIL / $SEED_ADMIN_PASSWORD). Turns on ENABLE_MARKETPLACE.
"""
import datetime as dt, json, os, pathlib, re, subprocess, time, urllib.error, urllib.request

APP = pathlib.Path(__file__).resolve().parents[1]
OUT = APP / 'test' / 'fixtures'
PHOTO = APP.parents[0] / 'backend' / 'test' / 'fixtures' / 'photo-gps.jpg'
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
    if expect and status != expect: raise SystemExit(f'{method} {path} -> {status} {raw[:500]}')
    if save: (OUT / f'{save}.json').write_text(json.dumps(j, indent=2, ensure_ascii=False))
    return j.get('data') if isinstance(j, dict) else j

def unthrottle():
    subprocess.run("redis-cli --scan --pattern 'throttle:*' | xargs -r redis-cli del >/dev/null", shell=True)

def login(phone, name):
    unthrottle()
    call('POST', '/auth/otp/request', {'phone': phone}, expect=200)
    for _ in range(40):
        m = re.findall(r'DEV SMS → \+91\*+' + phone[-4:] + r'\] (\d{6})', open(LOG).read())
        if m: break
        time.sleep(0.25)
    t = call('POST', '/auth/otp/verify', {'phone': phone, 'code': m[-1]}, expect=200)['tokens']['accessToken']
    call('PATCH', '/users/me', {'name': name}, t, expect=200)
    return t

def upload(token, kind, mime, body):
    up = call('POST', '/media/uploads', {'kind': kind, 'mimeType': mime, 'sizeBytes': len(body)}, token, expect=201)
    req = urllib.request.Request(up['upload']['url'], data=body, method='PUT')
    for k, v in up['upload']['headers'].items(): req.add_header(k, v)
    urllib.request.urlopen(req).read()
    mid = up['media']['id']
    call('POST', f'/media/{mid}/complete', None, token, expect=200)
    for _ in range(80):
        if call('GET', f'/media/{mid}', None, token)['status'] == 'READY': return mid, up
        time.sleep(0.25)
    raise SystemExit('media never became READY: is the worker running?')

iso = lambda h: (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=h)).isoformat()
stamp = str(int(time.time()))[-4:]
unthrottle()
admin = call('POST', '/admin/auth/login', {'email': os.environ.get('SEED_ADMIN_EMAIL', 'admin@petapp.local'), 'password': os.environ.get('SEED_ADMIN_PASSWORD', 'ChangeMe-Admin-2026')}, expect=200)['tokens']['accessToken']
call('PATCH', '/admin/flags/ENABLE_MARKETPLACE', {'enabled': True}, admin, expect=200)
subprocess.run('redis-cli del platform:flags >/dev/null', shell=True)
cat = call('POST', '/admin/product-categories', {'key': f'treats-{stamp}', 'name': f'Treats {stamp}', 'commissionBps': 1200}, admin, expect=201)

# ── onboarding ──
phone = f'9863{stamp}31'[:10]
seller = login(phone, 'Meera Seller')
call('GET', '/vendor/profile', None, seller, save='vendor_profile_none', expect=200)
call('POST', '/vendor/profile', {'businessName': f'Wag & Co {stamp}', 'legalName': 'Wag and Co Pvt Ltd', 'gstin': '27ABCDE1234F1Z5', 'phone': phone,
                                  'email': 'orders@wag.example', 'addressLine': '7 Baner Road', 'city': 'Pune', 'state': 'Maharashtra', 'pincode': '411045'}, seller, save='vendor_profile_created', expect=201)
idp, up = upload(seller, 'DOCUMENT', 'application/pdf', b'%PDF-1.4\n% ID proof\n%%EOF')
(OUT / 'vendor_document_upload.json').write_text(json.dumps({'success': True, 'data': up}, indent=2))
call('POST', '/vendor/documents', {'kind': 'ID_PROOF', 'mediaId': idp}, seller, save='vendor_profile_with_document', expect=201)
call('POST', '/vendor/submit', None, seller, save='vendor_submit_refused', expect=400)
gst, _ = upload(seller, 'DOCUMENT', 'application/pdf', b'%PDF-1.4\n% GST\n%%EOF')
call('POST', '/vendor/documents', {'kind': 'GST_CERTIFICATE', 'mediaId': gst}, seller, expect=201)
vid = call('POST', '/vendor/submit', None, seller, save='vendor_profile_submitted', expect=200)['id']
docs = call('GET', f'/admin/vendors/{vid}', None, admin)['documents']
call('POST', f'/admin/vendors/{vid}/review', {'decision': 'APPROVE', 'documents': [{'id': d['id'], 'status': 'ACCEPTED'} for d in docs]}, admin, expect=200)
call('GET', '/vendor/profile', None, seller, save='vendor_profile_approved', expect=200)
call('GET', '/users/me', None, seller, save='vendor_me', expect=200)
call('GET', '/product-categories', None, seller, save='vendor_categories', expect=200)

# ── catalogue ──
img, _ = upload(seller, 'IMAGE', 'image/jpeg', PHOTO.read_bytes())
p = call('POST', '/vendor/products', {
    'categoryId': cat['id'], 'title': f'Chicken Jerky {stamp}', 'brand': 'Wag', 'description': 'Single-ingredient chicken treats.', 'imageIds': [img],
    'variants': [{'sku': 'CJ-100', 'title': '100 g', 'mrpPaise': 34900, 'pricePaise': 29900, 'gstRateBps': 1800, 'stock': 40, 'weightGrams': 120},
                 {'sku': 'CJ-250', 'title': '250 g', 'mrpPaise': 74900, 'pricePaise': 64900, 'gstRateBps': 1800, 'stock': 3}],
}, seller, save='vendor_product_created', expect=201)
call('PATCH', f"/vendor/products/{p['id']}", {'status': 'ACTIVE'}, seller, save='vendor_product_live', expect=200)
v100 = [v for v in p['variants'] if v['sku'] == 'CJ-100'][0]['id']
call('PUT', f'/vendor/variants/{v100}/stock', {'stock': 30}, seller, save='vendor_stock', expect=200)
call('POST', '/vendor/coupons', {'code': f'WAG{stamp}', 'description': 'Launch offer', 'kind': 'PERCENT', 'value': 1500, 'maxDiscountPaise': 15000, 'startsAt': iso(-1), 'endsAt': iso(240), 'perUserLimit': 1}, seller, save='vendor_coupon_created', expect=201)
coupon = call('POST', '/vendor/coupons', {'code': f'FLAT{stamp}', 'kind': 'FLAT', 'value': 5000, 'minOrderPaise': 50000, 'startsAt': iso(-1), 'endsAt': iso(240)}, seller, expect=201)
call('PATCH', f"/vendor/coupons/{coupon['id']}", {'isActive': False}, seller, save='vendor_coupon_paused', expect=200)
call('GET', '/vendor/coupons', None, seller, save='vendor_coupons', expect=200)

# ── a customer buys twice ──
buyer = login(f'9864{stamp}32'[:10], 'Ravi Buyer')
addr = call('POST', '/users/me/addresses', {'label': 'Home', 'line1': '21 MG Road', 'locality': 'Camp', 'city': 'Pune', 'state': 'Maharashtra', 'pincode': '411001'}, buyer, expect=201)
def buy(qty, code=None):
    call('PUT', '/cart/items', {'variantId': v100, 'qty': qty}, buyer, expect=200)
    o = call('POST', '/orders', {'addressId': addr['id'], **({'couponCode': code} if code else {})}, buyer, expect=201)
    call('POST', f"/payments/{o['payment']['paymentId']}/simulate", None, buyer, expect=200)
    return o['order']['parcels'][0]['id']
first = buy(2, f'WAG{stamp}')
second = buy(1)
third = buy(1)
call('GET', '/vendor/orders?status=CONFIRMED', None, seller, save='vendor_orders_to_pack', expect=200)
call('GET', '/vendor/dashboard', None, seller, save='vendor_dashboard_busy', expect=200)
call('POST', f'/vendor/orders/{first}/pack', None, seller, save='vendor_order_packed', expect=200)
call('POST', f'/vendor/orders/{first}/ship', {'courier': 'Delhivery', 'trackingNumber': 'DL5550001IN'}, seller, save='vendor_order_shipped', expect=200)
call('POST', f'/vendor/orders/{first}/deliver', None, seller, save='vendor_order_delivered', expect=200)
call('POST', f'/vendor/orders/{second}/cancel', {'reason': 'Packet damaged in storage'}, seller, save='vendor_order_cancelled', expect=200)
call('POST', f'/sub-orders/{first}/return', {'reason': 'Dog is allergic to chicken'}, buyer, expect=200)
returns = call('GET', '/vendor/orders?status=RETURN_REQUESTED', None, seller, save='vendor_orders_returns', expect=200)
rid = returns[0]['returns'][0]['id']
call('POST', f'/vendor/returns/{rid}/decide', {'decision': 'APPROVE'}, seller, save='vendor_return_approved', expect=200)
call('POST', f'/vendor/returns/{rid}/decide', {'decision': 'RECEIVED', 'note': 'Sealed, unused'}, seller, save='vendor_return_received', expect=200)
for step in ('pack', 'ship', 'deliver'):  # a parcel that stays delivered, so earnings have something to show
    call('POST', f'/vendor/orders/{third}/{step}', {'courier': 'Blue Dart', 'trackingNumber': 'BD7770002IN'} if step == 'ship' else None, seller, expect=200)
call('GET', '/vendor/orders', None, seller, save='vendor_orders_all', expect=200)
call('GET', '/vendor/products', None, seller, save='vendor_products', expect=200)
call('GET', '/vendor/dashboard', None, seller, save='vendor_dashboard', expect=200)
call('GET', '/vendor/earnings', None, seller, save='vendor_earnings', expect=200)
# A published legal document (the terms screen reads the same shape for any document).
published = call('GET', '/legal', None)
if published: call('GET', f"/legal/{published[0]['slug']}", None, save='legal_doc', expect=200)
print('seller fixtures recorded:', len(list(OUT.glob('*.json'))))
