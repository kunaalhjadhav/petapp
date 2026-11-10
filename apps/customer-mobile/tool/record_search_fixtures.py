#!/usr/bin/env python3
"""Records real search, discovery and location responses (Phase 9c) for the customer app.

Needs: API + worker running (SMS_PROVIDER=console, log at $API_LOG), the seeded super admin, the seeded location
database, and demo data (pets, a partner in Mumbai, products, contests, challenges, a reel). `psql` access to the
dev database (DATABASE_URL) is used ONLY to find demo things. Everything this script adds for the recording (a
delivery zone, a city's services switch) is put back at the end.

Run:  python3 apps/customer-mobile/tool/record_search_fixtures.py
"""
import os, pathlib, subprocess, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixture_api import admin_token, call, flag, login  # noqa: E402

DB = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/petapp')

def sql(q):
    return [r.split('|') for r in subprocess.run(['psql', DB, '-tAc', q], capture_output=True, text=True, check=True).stdout.split('\n') if r]

admin = admin_token()
for f in ('ENABLE_SERVICES', 'ENABLE_MARKETPLACE', 'ENABLE_CONTESTS', 'ENABLE_REELS'): flag(admin, f)
dog = sql("""SELECT id FROM "PetSpecies" WHERE key = 'dog'""")[0][0]
mumbai = sql("""SELECT id FROM "City" WHERE slug = 'mumbai'""")[0][0]
product = sql("""SELECT v.id FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" JOIN "Vendor" s ON s.id = p."vendorId"
  WHERE p.status = 'ACTIVE' AND s.status = 'APPROVED' AND v."isActive" AND v.stock > 0 LIMIT 1""")[0][0]
word = lambda q: sql(q)[0][0].split(' ')[0].lower()
partner_word = word("""SELECT "businessName" FROM "ServicePartner" WHERE status = 'APPROVED' LIMIT 1""")
product_word = word("""SELECT title FROM "Product" WHERE status = 'ACTIVE' LIMIT 1""")
contest_word = word("""SELECT title FROM "Contest" WHERE status IN ('LIVE','VOTING','COMPLETED','WINNER_DECLARATION') LIMIT 1""")
challenge_word = word("""SELECT title FROM "Challenge" WHERE status = 'PUBLISHED' LIMIT 1""")
partner_at = sql("""SELECT lat, lng FROM "ServicePartner" WHERE status = 'APPROVED' LIMIT 1""")[0]

isha = login('9800000771', 'Isha Kulkarni')
dev = login('9800000772', 'Dev Kulkarni')

# ── a pet each, shown in "Pets near you" ──
mine = call('POST', '/pets', {'name': 'Biscuit', 'speciesId': dog, 'city': 'Mumbai'}, isha, expect=201)
call('PATCH', f"/pets/{mine['id']}", {'discoverable': True, 'latitude': 19.06, 'longitude': 72.84}, isha, save='pet_view_owner_discoverable', expect=200)
theirs = call('POST', '/pets', {'name': 'Bagel', 'speciesId': dog, 'city': 'Mumbai'}, dev, expect=201)
call('PATCH', f"/pets/{theirs['id']}", {'discoverable': True, 'latitude': 19.07, 'longitude': 72.85}, dev, expect=200)
# Dev's pet joins a challenge that's on, and enters an open contest (the dev payment gateway completes the fee).
challenge = sql("""SELECT id FROM "Challenge" WHERE status = 'PUBLISHED' AND kind = 'FREE' AND "startsAt" < now() AND "endsAt" > now() LIMIT 1""")[0][0]
call('POST', f'/challenges/{challenge}/join', {'petId': theirs['id']}, dev, expect=201)
contest = sql("""SELECT id FROM "Contest" WHERE status = 'LIVE' AND "registrationClosesAt" > now() AND cardinality("eligibleSpeciesIds") = 0 ORDER BY "createdAt" DESC LIMIT 1""")[0][0]
reg = call('POST', f'/contests/{contest}/register', {'petId': theirs['id']}, dev, expect=201)
if reg.get('payment'):
    call('POST', f"/payments/{reg['payment'].get('paymentId') or reg['payment']['id']}/simulate", None, dev, expect=200)
call('GET', '/discover/pets/nearby?lat=19.06&lng=72.84', None, isha, save='discover_nearby', expect=200)
call('GET', '/discover/pets/trending', None, isha, save='discover_trending', expect=200)
call('GET', '/discover/contest-entries', None, isha, save='discover_contest_entries', expect=200)
call('GET', '/discover/challenge-entries', None, isha, save='discover_challenge_entries', expect=200)
call('GET', '/discover/reels', None, isha, save='discover_reels', expect=200)

# ── search ──
call('GET', '/search/filters', None, isha, save='search_filters', expect=200)
call('GET', f'/search?q={challenge_word}', None, isha, save='search_all', expect=200)
call('GET', '/search/pets?q=bagel', None, isha, save='search_pets', expect=200)
call('GET', '/search/users?q=kulkarni', None, isha, save='search_users', expect=200)
call('GET', '/search/reels?q=%23zoomies', None, isha, save='search_reels', expect=200)
call('GET', f'/search/products?q={product_word}', None, isha, save='search_products', expect=200)
call('GET', f'/search/services?q=groom&lat={partner_at[0]}&lng={partner_at[1]}', None, isha, save='search_services', expect=200)
call('GET', f'/search/partners?q={partner_word}&lat={partner_at[0]}&lng={partner_at[1]}', None, isha, save='search_partners', expect=200)
call('GET', f'/search/contests?q={contest_word}', None, isha, save='search_contests', expect=200)
call('GET', f'/search/challenges?q={challenge_word}', None, isha, save='search_challenges', expect=200)

# ── locations ──
call('GET', '/locations/cities?stateCode=MH', None, None, save='location_cities', expect=200)
if not sql("""SELECT 1 FROM "Pincode" WHERE code = '400050'"""):
    call('POST', f'/admin/locations/cities/{mumbai}/import', {'csv': '400050,Bandra West,19.0596,72.8295'}, admin, expect=200)
call('GET', '/locations/pincodes/400050', None, None, save='location_pincode', expect=200)
call('GET', '/locations/coverage?lat=19.06&lng=72.84', None, None, save='location_coverage', expect=200)
call('PATCH', f'/admin/locations/cities/{mumbai}', {'servicesLive': True}, admin, expect=200)
call('GET', '/locations/coverage?lat=9.93&lng=76.26', None, None, save='location_coverage_outside', expect=200)
call('PATCH', f'/admin/locations/cities/{mumbai}', {'servicesLive': False}, admin, expect=200)

# ── delivery at checkout ──
address = call('POST', '/users/me/addresses', {'label': 'Home', 'line1': '12 Hill Road', 'locality': 'Bandra West', 'city': 'Mumbai', 'state': 'Maharashtra', 'pincode': '400050'}, isha, expect=201)
call('PUT', '/cart/items', {'variantId': product, 'qty': 1}, isha, expect=200)
zone = call('POST', '/admin/locations/zones', {'name': 'Mumbai city', 'pincodes': ['400*'], 'shippingFlatPaise': 0, 'minDays': 1, 'maxDays': 2}, admin, expect=201)
call('POST', '/checkout/preview', {'addressId': address['id']}, isha, save='shop_preview_delivery', expect=200)
call('PATCH', f"/admin/locations/zones/{zone['id']}", {'deliverable': False, 'note': 'Paused for the monsoon.'}, admin, expect=200)
call('POST', '/checkout/preview', {'addressId': address['id']}, isha, save='shop_preview_undeliverable', expect=200)
call('DELETE', f"/admin/locations/zones/{zone['id']}", None, admin, expect=200)
call('DELETE', '/cart', None, isha, expect=200)
print('recorded search, discovery and location fixtures')
