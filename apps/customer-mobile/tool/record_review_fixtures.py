#!/usr/bin/env python3
"""Records real review and report responses (Phase 9b) for the customer, partner and seller apps.

Needs: API + worker running (SMS_PROVIDER=console, log at $API_LOG), object storage, the seeded super admin, and demo
data with a delivered parcel and a completed booking that nobody has reviewed yet. `psql` access to the dev database
(DATABASE_URL) is used ONLY to find those people and things.

Run:  python3 apps/customer-mobile/tool/record_review_fixtures.py
"""
import os, pathlib, shutil, subprocess, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixture_api import OUT, admin_token, call, flag, login, put_bytes  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[3]
PARTNER_OUT = ROOT / 'apps' / 'service-partner-mobile' / 'test' / 'fixtures'
SELLER_OUT = ROOT / 'apps' / 'product-partner-mobile' / 'test' / 'fixtures'
DB = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/petapp')
PHOTO = (ROOT / 'apps' / 'backend' / 'test' / 'fixtures' / 'photo-gps.jpg').read_bytes()

def sql(q):
    return [r.split('|') for r in subprocess.run(['psql', DB, '-tAc', q], capture_output=True, text=True, check=True).stdout.split('\n') if r]

def copy(name, *dirs):
    for d in dirs: shutil.copy(OUT / f'{name}.json', d / f'{name}.json')

def photo(token, private):
    up = call('POST', '/media/uploads', {'kind': 'IMAGE', 'mimeType': 'image/jpeg', 'sizeBytes': len(PHOTO), 'private': private}, token, expect=201)
    put_bytes(up['upload']['url'], up['upload']['headers'], PHOTO)
    call('POST', f"/media/{up['media']['id']}/complete", None, token, expect=200)
    for _ in range(120):
        if call('GET', f"/media/{up['media']['id']}", None, token)['status'] == 'READY': return up['media']['id']
        time.sleep(0.25)
    raise SystemExit('photo never got ready: is the worker running?')

admin = admin_token()
for f in ('ENABLE_SERVICES', 'ENABLE_MARKETPLACE'): flag(admin, f)
local = lambda p: p.replace('+91', '')

# A delivered parcel with a product its buyer hasn't reviewed, and a completed booking without a review.
parcel = sql("""SELECT s.id, o.id, cu.phone, vu.phone, v2."productId" FROM "SubOrder" s JOIN "Order" o ON o.id = s."orderId" JOIN "User" cu ON cu.id = o."userId"
  JOIN "Vendor" v ON v.id = s."vendorId" JOIN "User" vu ON vu.id = v."userId" JOIN "OrderItem" i ON i."subOrderId" = s.id JOIN "ProductVariant" v2 ON v2.id = i."variantId"
  JOIN "Product" p ON p.id = v2."productId"
  WHERE s.status = 'DELIVERED' AND s."deliveredAt" IS NOT NULL AND v.status = 'APPROVED' AND p.status = 'ACTIVE' AND cu.status = 'ACTIVE' AND vu.status = 'ACTIVE'
    AND NOT EXISTS (SELECT 1 FROM "ProductReview" r WHERE r."customerId" = o."userId" AND r."productId" = v2."productId") LIMIT 1""")
booking = sql("""SELECT b.id, cu.phone, pu.phone, p.id FROM "Booking" b JOIN "User" cu ON cu.id = b."customerId" JOIN "ServicePartner" p ON p.id = b."partnerId"
  JOIN "User" pu ON pu.id = p."userId" WHERE p.status = 'APPROVED' AND cu.status = 'ACTIVE' AND pu.status = 'ACTIVE' AND b.status = 'COMPLETED'
    AND NOT EXISTS (SELECT 1 FROM "ServiceReview" r WHERE r."bookingId" = b.id) LIMIT 1""")
if not parcel or not booking: raise SystemExit('Needs a delivered parcel and a completed booking that have no reviews yet (run the demo seed).')
sub_id, order_id, buyer_phone, seller_phone, product_id = parcel[0]
booking_id, cust_phone, partner_phone, partner_id = booking[0]

# ── a product review from a verified purchase ──
buyer = login(local(buyer_phone), 'Riya Sharma')
call('GET', f'/orders/{order_id}', None, buyer, save='shop_order_delivered', expect=200)
pic = photo(buyer, False)
call('POST', f'/products/{product_id}/reviews', {'rating': 4, 'comment': 'My beagle loves these. The bag reseals well; a little pricey.', 'photoIds': [pic]}, buyer, save='product_review_created', expect=201)
call('GET', f'/orders/{order_id}', None, buyer, save='shop_order_reviewed', expect=200)
call('GET', f'/products/{product_id}/reviews/mine', None, buyer, save='product_review_mine', expect=200)

seller = login(local(seller_phone), 'Wag Seller')
call('GET', '/vendor/reviews/summary', None, seller, save='vendor_reviews_summary', expect=200)
mine = call('GET', '/vendor/reviews?unanswered=true', None, seller, save='vendor_reviews', expect=200)
target = next(r for r in mine if r['product'] and r['product']['id'] == product_id)
call('POST', f"/vendor/reviews/{target['id']}/reply", {'reply': 'Thank you, Riya! A smaller pack is coming soon.'}, seller, save='vendor_review_reply', expect=200)
call('GET', '/vendor/reviews', None, seller, save='vendor_reviews_all', expect=200)
for n in ('vendor_reviews_summary', 'vendor_reviews', 'vendor_reviews_all', 'vendor_review_reply'): copy(n, SELLER_OUT)

call('GET', f'/products/{product_id}', None, None, save='shop_product_reviewed', expect=200)
call('GET', f'/products/{product_id}/reviews', None, None, save='product_reviews', expect=200)
call('GET', f'/products/{product_id}/reviews?photos=true&sort=highest', None, None, save='product_reviews_photos', expect=200)
call('GET', '/products?sort=rating&limit=10', None, None, save='shop_products_rated', expect=200)

# ── a service review with a photo, and the partner's reply ──
cust = login(local(cust_phone), 'Kabir Mehta')
spic = photo(cust, False)
call('POST', f'/bookings/{booking_id}/review', {'rating': 5, 'comment': 'Gentle with Coco and on time. Will book again.', 'photoIds': [spic]}, cust, save='booking_review_photo', expect=201)
partner = login(local(partner_phone), 'Meera Groomer')
call('GET', '/partner/reviews/summary', None, partner, save='partner_reviews_summary', expect=200)
pr = call('GET', '/partner/reviews?unanswered=true', None, partner, save='partner_reviews_mine', expect=200)
sr = next(r for r in pr if r['booking'] and r['booking']['id'] == booking_id)
call('POST', f"/partner/reviews/{sr['id']}/reply", {'reply': 'Thank you, Kabir! Coco was a delight.'}, partner, save='partner_review_reply', expect=200)
for n in ('partner_reviews_summary', 'partner_reviews_mine', 'partner_review_reply'): copy(n, PARTNER_OUT)
call('GET', f'/bookings/{booking_id}', None, cust, save='booking_detail_reviewed', expect=200)
call('GET', f'/service-partners/{partner_id}', None, None, save='service_partner_reviewed', expect=200)
call('GET', f'/service-partners/{partner_id}/reviews', None, None, save='partner_reviews_page', expect=200)

# ── a report with a screenshot ──
shot = photo(cust, True)
call('POST', '/reports', {'targetType': 'PRODUCT_REVIEW', 'targetId': target['id'], 'reason': 'SPAM', 'details': 'Looks copied from another site.', 'evidenceIds': [shot]}, cust, save='report_created', expect=201)
print('recorded review and report fixtures')
