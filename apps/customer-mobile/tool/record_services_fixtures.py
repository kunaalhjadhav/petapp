#!/usr/bin/env python3
"""Records real services-marketplace responses into test/fixtures (and gives the dashboard real shapes).

Needs: API + worker running (SMS_PROVIDER=console, PAYMENT_PROVIDER=fake, storage configured), the seeded
super admin, and `psql` access to the dev database (DATABASE_URL) — used ONLY to move one booking into the
past so it can be completed and reviewed without waiting for real time to pass.
"""
import datetime as dt, os, subprocess, time
from fixture_api import admin_token, call, flag, login, put_bytes

stamp = str(int(time.time()))[-4:]
admin = admin_token()
flag(admin, 'ENABLE_SERVICES')
cat = call('POST', '/admin/service-categories', {'key': f'grooming-{stamp}', 'name': 'Grooming', 'commissionBps': 1500}, admin, expect=201)
call('GET', '/admin/service-categories', None, admin, save='admin_service_categories', expect=200)

# ── partner onboarding ──
partner = login(f'9873{stamp}07'[:10], 'Meera Groomer')
BANDRA = {'lat': 19.0596, 'lng': 72.8295}
call('POST', '/partner/profile', {'businessName': f'Pawfect Grooming {stamp}', 'kind': 'BUSINESS', 'about': 'Gentle grooming for dogs and cats.',
     'phone': '9873000007', 'addressLine': '12 Hill Road', 'area': 'Bandra West', 'city': 'Mumbai', 'state': 'Maharashtra', 'pincode': '400050',
     **BANDRA, 'homeVisitRadiusKm': 5}, partner, save='partner_profile_created', expect=201)
pdf = b'%PDF-1.4\n% fixture KYC document\n'
up = call('POST', '/media/uploads', {'kind': 'DOCUMENT', 'mimeType': 'application/pdf', 'sizeBytes': len(pdf)}, partner, expect=201)
put_bytes(up['upload']['url'], up['upload']['headers'], pdf)
call('POST', f"/media/{up['media']['id']}/complete", None, partner, expect=200)
call('POST', '/partner/documents', {'kind': 'ID_PROOF', 'mediaId': up['media']['id']}, partner, expect=201)
species = call('GET', '/species', expect=200)
dog = [s for s in species if s['key'] == 'dog'][0]['id']
profile = call('POST', '/partner/services', {'categoryId': cat['id'], 'name': 'Full groom', 'description': 'Bath, trim, nails and ears.',
           'durationMin': 60, 'bufferMin': 15, 'pricePaise': 79900, 'modes': ['AT_CENTER', 'AT_HOME'], 'speciesIds': [dog]}, partner, save='partner_service_added', expect=201)
svc = profile['services'][0]  # adding a service returns the updated partner profile
call('PUT', '/partner/hours', {'hours': [{'weekday': d, 'opensMin': 9 * 60, 'closesMin': 20 * 60} for d in range(7)]}, partner, expect=200)
call('POST', '/partner/submit', None, partner, expect=200)
call('GET', '/partner/profile', None, partner, save='partner_profile_submitted', expect=200)

# ── admin review ──
call('GET', '/admin/partners?status=SUBMITTED', None, admin, save='admin_partners', expect=200)
pid = call('GET', '/partner/profile', None, partner)['id']
detail = call('GET', f'/admin/partners/{pid}', None, admin, save='admin_partner_detail', expect=200)
doc = [d for d in detail['documents'] if d['kind'] == 'ID_PROOF'][0]['id']
call('POST', f'/admin/partners/{pid}/review', {'decision': 'APPROVE', 'documents': [{'id': doc, 'status': 'ACCEPTED'}]}, admin, save='admin_partner_review', expect=200)

# ── customer: search, slots, book, pay, cancel ──
cust = login(f'9874{stamp}08'[:10], 'Kabir Customer')
pet = call('POST', '/pets', {'name': 'Coco', 'speciesId': dog}, cust, expect=201)['id']
call('GET', '/service-categories', None, cust, save='service_categories', expect=200)
call('GET', f"/services/nearby?lat={BANDRA['lat'] + 0.01}&lng={BANDRA['lng']}&categoryId={cat['id']}", None, cust, save='services_nearby', expect=200)
call('GET', f'/service-partners/{pid}', None, cust, save='service_partner', expect=200)
ist = dt.timezone(dt.timedelta(hours=5, minutes=30))
day = (dt.datetime.now(ist) + dt.timedelta(days=2)).date().isoformat()
slots = call('GET', f"/partner-services/{svc['id']}/slots?date={day}", None, cust, save='service_slots', expect=200)['slots']
b1 = call('POST', '/bookings', {'serviceId': svc['id'], 'petId': pet, 'startsAt': slots[0]['startsAt'], 'mode': 'AT_CENTER'}, cust, save='booking_create', expect=201)
call('POST', f"/payments/{b1['payment']['paymentId']}/simulate", None, cust, expect=200)
b2 = call('POST', '/bookings', {'serviceId': svc['id'], 'petId': pet, 'startsAt': slots[4]['startsAt'], 'mode': 'AT_HOME',
          'address': {'line': '5 Carter Road, Bandra', 'lat': BANDRA['lat'] + 0.005, 'lng': BANDRA['lng']}}, cust, expect=201)
call('POST', f"/payments/{b2['payment']['paymentId']}/simulate", None, cust, expect=200)
call('GET', '/bookings', None, cust, save='bookings_mine', expect=200)
call('GET', f"/bookings/{b1['id']}", None, cust, save='booking_detail', expect=200)
call('POST', f"/bookings/{b2['id']}/cancel", {'reason': 'Plans changed'}, cust, save='booking_cancel', expect=200)

# ── complete and review (moves booking 1 into the past in the DEV database) ──
db = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/petapp')
subprocess.run(['psql', db, '-qc', f"""UPDATE "Booking" SET "startsAt" = now() - interval '2 hours', "endsAt" = now() - interval '1 hour' WHERE id = '{b1['id']}'"""], check=True)
call('GET', '/partner/bookings', None, partner, save='partner_bookings', expect=200)
call('POST', f"/partner/bookings/{b1['id']}/start", None, partner, expect=200)
call('POST', f"/partner/bookings/{b1['id']}/complete", None, partner, expect=200)
call('POST', f"/bookings/{b1['id']}/review", {'rating': 5, 'comment': 'Coco came back fluffy and calm. Thank you!'}, cust, save='booking_review', expect=201)
call('GET', f"/bookings/{b1['id']}", None, cust, save='booking_detail_completed', expect=200)
call('GET', f'/service-partners/{pid}/reviews', None, cust, save='partner_reviews', expect=200)
call('GET', '/admin/bookings', None, admin, save='admin_bookings', expect=200)
print('services fixtures recorded for partner', pid)
