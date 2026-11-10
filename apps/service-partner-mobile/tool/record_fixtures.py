#!/usr/bin/env python3
"""Records real API responses for the partner app's tests and contract check.

Needs the API and worker running (SMS_PROVIDER=console logging to $API_LOG, default /tmp/api.log; PAYMENT_PROVIDER=fake),
storage, and the seeded super admin. Turns on ENABLE_SERVICES. Moves one booking's time into the past with psql so the
partner can start and complete it (DATABASE_URL, default the local dev database).
"""
import datetime as dt, json, os, pathlib, re, subprocess, time, urllib.error, urllib.request

APP = pathlib.Path(__file__).resolve().parents[1]
OUT = APP / 'test' / 'fixtures'
API = os.environ.get('API_URL', 'http://localhost:4000') + '/api/v1'
LOG = os.environ.get('API_LOG', '/tmp/api.log')
DB = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/petapp')

def call(method, path, body=None, token=None, save=None, expect=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req) as r: status, raw = r.status, r.read()
    except urllib.error.HTTPError as e: status, raw = e.code, e.read()
    j = json.loads(raw)
    if expect and status != expect: raise SystemExit(f'{method} {path} -> {status} {raw[:400]}')
    if save: (OUT / f'{save}.json').write_text(json.dumps(j, indent=2, ensure_ascii=False))
    return j.get('data') if isinstance(j, dict) else j

def unthrottle():
    subprocess.run("redis-cli --scan --pattern 'throttle:*' | xargs -r redis-cli del >/dev/null", shell=True)

def login(phone, name, save=None):
    unthrottle()
    call('POST', '/auth/otp/request', {'phone': phone}, expect=200)
    for _ in range(40):
        m = re.findall(r'DEV SMS → \+91\*+' + phone[-4:] + r'\] (\d{6})', open(LOG).read())
        if m: break
        time.sleep(0.25)
    d = call('POST', '/auth/otp/verify', {'phone': phone, 'code': m[-1]}, expect=200)
    t = d['tokens']['accessToken']
    call('PATCH', '/users/me', {'name': name}, t, expect=200)
    return t

def sql(q):
    subprocess.run(['psql', DB, '-q', '-c', q], check=True, capture_output=True)

stamp = str(int(time.time()))[-4:]
unthrottle()
admin = call('POST', '/admin/auth/login', {'email': os.environ.get('SEED_ADMIN_EMAIL', 'admin@petapp.local'), 'password': os.environ.get('SEED_ADMIN_PASSWORD', 'ChangeMe-Admin-2026')}, expect=200)['tokens']['accessToken']
call('PATCH', '/admin/flags/ENABLE_SERVICES', {'enabled': True}, admin, expect=200)
subprocess.run('redis-cli del platform:flags >/dev/null', shell=True)
cats = call('GET', '/admin/service-categories', None, admin, expect=200)
cat = next((c for c in cats if c['key'] == 'grooming'), None) or call('POST', '/admin/service-categories', {'key': 'grooming', 'name': 'Grooming', 'commissionBps': 1500}, admin, expect=201)
call('GET', '/service-categories', save='categories', expect=200)

# ── onboarding ──
partner = login(f'9873{stamp}07'[:10], 'Priya Groomer')
call('GET', '/partner/profile', None, partner, save='profile_none')  # 404 before onboarding
call('POST', '/partner/profile', {
    'businessName': 'Pawfect Grooming', 'kind': 'BUSINESS', 'phone': f'9873{stamp}07'[:10], 'addressLine': '12 Hill Road', 'area': 'Bandra West',
    'city': 'Mumbai', 'state': 'Maharashtra', 'pincode': '400050', 'lat': 19.0596, 'lng': 72.8295, 'homeVisitRadiusKm': 5, 'concurrency': 1, 'slotStepMin': 30,
}, partner, save='profile_created', expect=201)
pdf = b'%PDF-1.4\n% ID proof\n%%EOF'
up = call('POST', '/media/uploads', {'kind': 'DOCUMENT', 'mimeType': 'application/pdf', 'sizeBytes': len(pdf)}, partner, save='document_upload', expect=201)
req = urllib.request.Request(up['upload']['url'], data=pdf, method='PUT')
for k, v in up['upload']['headers'].items(): req.add_header(k, v)
urllib.request.urlopen(req).read()
call('POST', f"/media/{up['media']['id']}/complete", None, partner, expect=200)
call('POST', '/partner/documents', {'kind': 'ID_PROOF', 'mediaId': up['media']['id']}, partner, save='profile_with_document', expect=201)
call('POST', '/partner/submit', None, partner, save='submit_refused', expect=400)
svc = call('POST', '/partner/services', {'categoryId': cat['id'], 'name': 'Full groom', 'description': 'Bath, trim and nails.', 'durationMin': 60, 'bufferMin': 15, 'pricePaise': 79900, 'modes': ['AT_CENTER', 'AT_HOME']}, partner, save='profile_with_service', expect=201)
service_id = svc['services'][0]['id']
call('PATCH', f'/partner/services/{service_id}', {'pricePaise': 84900}, partner, expect=200)
call('PUT', '/partner/hours', {'hours': [{'weekday': d, 'opensMin': 540, 'closesMin': 1080} for d in range(7)]}, partner, save='profile_with_hours', expect=200)
far = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30)).replace(hour=3, minute=30, second=0, microsecond=0)
call('POST', '/partner/time-off', {'startsAt': far.isoformat(), 'endsAt': (far + dt.timedelta(hours=8)).isoformat(), 'reason': 'Family function'}, partner, save='profile_with_time_off', expect=201)
call('POST', '/partner/submit', None, partner, save='profile_submitted', expect=200)

# ── admin approval ──
pid = call('GET', '/partner/profile', None, partner)['id']
doc = [d for d in call('GET', f'/admin/partners/{pid}', None, admin)['documents'] if d['kind'] == 'ID_PROOF'][0]['id']
call('POST', f'/admin/partners/{pid}/review', {'decision': 'APPROVE', 'documents': [{'id': doc, 'status': 'ACCEPTED'}]}, admin, expect=200)
call('GET', '/partner/profile', None, partner, save='profile_approved', expect=200)

# ── customers book; the partner works the bookings ──
species = call('GET', '/species', expect=200)
dog = [s for s in species if s['key'] == 'dog'][0]['id']
def booked(phone, name, pet_name, day_offset):
    c = login(phone, name)
    pet = call('POST', '/pets', {'name': pet_name, 'speciesId': dog}, c, expect=201)['id']
    day = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=5.5, days=day_offset)).date().isoformat()
    slots = call('GET', f'/partner-services/{service_id}/slots?date={day}', save='slots' if day_offset == 2 else None, expect=200)
    start = slots['slots'][0]['startsAt'] if isinstance(slots, dict) else slots[0]['startsAt']
    b = call('POST', '/bookings', {'serviceId': service_id, 'petId': pet, 'startsAt': start, 'mode': 'AT_CENTER', 'note': 'Gentle with the ears please'}, c, expect=201)
    call('POST', f"/payments/{b['payment']['paymentId']}/simulate", None, c, expect=200)
    return c, b['id']
cust_a, b1 = booked(f'9874{stamp}08'[:10], 'Asha Customer', 'Coco', 2)
cust_b, b2 = booked(f'9875{stamp}09'[:10], 'Bilal Customer', 'Mango', 3)
call('GET', '/partner/bookings?when=upcoming', None, partner, save='bookings_upcoming', expect=200)
sql(f"""UPDATE "Booking" SET "startsAt" = now() - interval '10 minutes', "endsAt" = now() + interval '50 minutes' WHERE id = '{b1}'""")
call('POST', f'/partner/bookings/{b1}/start', None, partner, save='booking_started', expect=200)
call('POST', f'/partner/bookings/{b1}/complete', None, partner, save='booking_completed', expect=200)
call('POST', f'/partner/bookings/{b2}/cancel', {'reason': 'Groomer unwell today'}, partner, save='booking_cancelled', expect=200)
call('POST', f'/bookings/{b1}/review', {'rating': 5, 'comment': 'Coco looks amazing!'}, cust_a, expect=201)
review = call('GET', f'/service-partners/{pid}', None)['reviews'][0]['id']
call('POST', f'/partner/reviews/{review}/reply', {'reply': 'Thank you! See Coco soon.'}, partner, save='review_reply', expect=200)
call('GET', '/partner/bookings?when=past', None, partner, save='bookings_past', expect=200)
call('GET', '/partner/earnings', None, partner, save='earnings', expect=200)
call('GET', '/users/me', None, partner, save='me_partner', expect=200)
# A published legal document (the terms screen reads the same shape for any document).
published = call('GET', '/legal', None)
if published: call('GET', f"/legal/{published[0]['slug']}", None, save='legal_doc', expect=200)
print('partner fixtures recorded:', len(list(OUT.glob('*.json'))))
