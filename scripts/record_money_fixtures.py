#!/usr/bin/env python3
"""Records real API responses for the money screens in all three apps (Phase 6d): statements, payouts, payout accounts,
invoices and download links for sellers and partners; refunds, invoices and prize money for customers.

Needs the API and worker running (SMS_PROVIDER=console logging to $API_LOG, default /tmp/api.log; PAYMENT_PROVIDER and
PAYOUT_PROVIDER fake), object storage, the seeded super admin ($SEED_ADMIN_EMAIL / $SEED_ADMIN_PASSWORD) and psql
($DATABASE_URL). Turns on the marketplace, services and contests. To make money payable at once it sets
finance.payoutHoldDays to 0 for the run and puts it back afterwards. psql is used only to move a booking and a contest's
voting deadline into the past, and to give a second staff account the Finance role (payout batches need a second person).

Run from the repo root:  python3 scripts/record_money_fixtures.py
"""
import datetime as dt, json, os, pathlib, re, subprocess, time, urllib.error, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SELLER = ROOT / 'apps' / 'product-partner-mobile' / 'test' / 'fixtures'
PARTNER = ROOT / 'apps' / 'service-partner-mobile' / 'test' / 'fixtures'
CUSTOMER = ROOT / 'apps' / 'customer-mobile' / 'test' / 'fixtures'
API = os.environ.get('API_URL', 'http://localhost:4000') + '/api/v1'
LOG = os.environ.get('API_LOG', '/tmp/api.log')
DB = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/petapp').split('?')[0]

def call(method, path, body=None, token=None, save=None, expect=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req) as r: status, raw = r.status, r.read()
    except urllib.error.HTTPError as e: status, raw = e.code, e.read()
    j = json.loads(raw)
    if expect and status != expect: raise SystemExit(f'{method} {path} -> {status} {raw[:600]}')
    if save:
        folder, name = save
        (folder / f'{name}.json').write_text(json.dumps(j, indent=2, ensure_ascii=False) + '\n')
    return j.get('data') if isinstance(j, dict) else j

def unthrottle():
    subprocess.run("redis-cli --scan --pattern 'throttle:*' | xargs -r redis-cli del >/dev/null", shell=True)

def sql(q):
    return subprocess.run(['psql', DB, '-qAt', '-c', q], check=True, capture_output=True, text=True).stdout.strip()

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
    wait('the upload', lambda: call('GET', f'/media/{mid}', None, token)['status'] == 'READY')
    return mid

def upload_pdf(token, text):
    return upload(token, 'DOCUMENT', 'application/pdf', b'%PDF-1.4\n% ' + text.encode() + b'\n%%EOF')

def wait(what, check, tries=120, pause=0.5):
    for _ in range(tries):
        v = check()
        if v: return v
        time.sleep(pause)
    raise SystemExit(f'timed out waiting for {what}: is the worker running?')

def pay_out(admin, checker, payee_type):
    """Prepare a batch for one payee type (admin), approve it (a second person), and wait for the worker to pay it."""
    b = call('POST', '/admin/finance/payout-batches', {'payeeType': payee_type, 'note': 'Fixture payout'}, admin, expect=201)
    call('POST', f"/admin/finance/payout-batches/{b['id']}/approve", None, checker, expect=200)
    wait('the payout', lambda: all(p['status'] in ('PROCESSED', 'CANCELLED') for p in call('GET', f"/admin/finance/payout-batches/{b['id']}", None, admin)['payouts']))
    return b

stamp = str(int(time.time()))[-4:]
iso = lambda h: (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=h)).isoformat()
unthrottle()
ADMIN_EMAIL = os.environ.get('SEED_ADMIN_EMAIL', 'admin@petapp.local')
admin = call('POST', '/admin/auth/login', {'email': ADMIN_EMAIL, 'password': os.environ.get('SEED_ADMIN_PASSWORD', 'ChangeMe-Admin-2026')}, expect=200)['tokens']['accessToken']
for f in ['ENABLE_MARKETPLACE', 'ENABLE_SERVICES', 'ENABLE_CONTESTS', 'ENABLE_PUBLIC_VOTING']:
    call('PATCH', f'/admin/flags/{f}', {'enabled': True}, admin, expect=200)
subprocess.run('redis-cli del platform:flags >/dev/null', shell=True)

# A second staff member with the Finance role approves payout batches (maker-checker).
CHECKER_EMAIL, CHECKER_PASSWORD = f'fixture-finance-{stamp}@petapp.local', f'Fixture-Finance-{stamp}!'
import_hash = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{CHECKER_PASSWORD}', 10))"], capture_output=True, text=True, check=True, cwd=ROOT).stdout.strip()
uid = sql(f"""INSERT INTO "User" (id, name, email, "passwordHash", "emailVerifiedAt", "createdAt", "updatedAt")
              VALUES (gen_random_uuid(), 'Fixture Finance', '{CHECKER_EMAIL}', '{import_hash}', now(), now(), now()) RETURNING id""").splitlines()[0]
sql(f"""INSERT INTO "UserRole" ("userId", "roleId", "createdAt") SELECT '{uid}', id, now() FROM "Role" WHERE key = 'FINANCE'""")
unthrottle()
checker = call('POST', '/admin/auth/login', {'email': CHECKER_EMAIL, 'password': CHECKER_PASSWORD}, expect=200)['tokens']['accessToken']

hold = next((s['value'] for s in call('GET', '/admin/settings', None, admin, expect=200) if s['key'] == 'finance.payoutHoldDays'), 7)
call('PUT', '/admin/settings/finance.payoutHoldDays', {'value': 0}, admin, expect=200)
try:
    # ══════════════ seller ══════════════
    cat = call('POST', '/admin/product-categories', {'key': f'chews-{stamp}', 'name': f'Chews {stamp}', 'commissionBps': 1200}, admin, expect=201)
    sphone = f'9881{stamp}41'[:10]
    seller = login(sphone, 'Meera Shah')
    call('POST', '/vendor/profile', {'businessName': f'Wag & Co {stamp}', 'legalName': 'Wag and Co Pvt Ltd', 'gstin': '27ABCDE1234F1Z5', 'phone': sphone,
                                      'email': 'orders@wag.example', 'addressLine': '7 Baner Road', 'city': 'Pune', 'state': 'Maharashtra', 'pincode': '411045'}, seller, expect=201)
    for kind in ('ID_PROOF', 'GST_CERTIFICATE'):
        call('POST', '/vendor/documents', {'kind': kind, 'mediaId': upload_pdf(seller, kind)}, seller, expect=201)
    vid = call('POST', '/vendor/submit', None, seller, expect=200)['id']
    docs = call('GET', f'/admin/vendors/{vid}', None, admin)['documents']
    call('POST', f'/admin/vendors/{vid}/review', {'decision': 'APPROVE', 'documents': [{'id': d['id'], 'status': 'ACCEPTED'} for d in docs]}, admin, expect=200)
    photo = upload(seller, 'IMAGE', 'image/jpeg', (ROOT / 'apps' / 'backend' / 'test' / 'fixtures' / 'photo-gps.jpg').read_bytes())
    p = call('POST', '/vendor/products', {'categoryId': cat['id'], 'title': f'Yak Chew {stamp}', 'brand': 'Wag', 'description': 'Long-lasting yak milk chew.', 'imageIds': [photo],
                                           'variants': [{'sku': 'YC-1', 'title': 'Medium', 'mrpPaise': 59900, 'pricePaise': 49900, 'gstRateBps': 1800, 'stock': 50}]}, seller, expect=201)
    call('PATCH', f"/vendor/products/{p['id']}", {'status': 'ACTIVE'}, seller, expect=200)
    variant = p['variants'][0]['id']

    # A customer buys twice: one parcel is delivered (an invoice; earnings), the other is cancelled (a refund).
    cphone = f'9882{stamp}42'[:10]
    buyer = login(cphone, 'Ravi Kumar')
    addr = call('POST', '/users/me/addresses', {'label': 'Home', 'line1': '21 MG Road', 'locality': 'Indiranagar', 'city': 'Bengaluru', 'state': 'Karnataka', 'pincode': '560038'}, buyer, expect=201)
    def buy(qty):
        call('PUT', '/cart/items', {'variantId': variant, 'qty': qty}, buyer, expect=200)
        o = call('POST', '/orders', {'addressId': addr['id']}, buyer, expect=201)
        call('POST', f"/payments/{o['payment']['paymentId']}/simulate", None, buyer, expect=200)
        return o['order']['parcels'][0]['id']
    kept, cancelled = buy(2), buy(1)
    for step in ('pack', 'ship', 'deliver'):
        call('POST', f'/vendor/orders/{kept}/{step}', {'courier': 'Delhivery', 'trackingNumber': 'DL1234567IN'} if step == 'ship' else None, seller, expect=200)
    call('POST', f'/sub-orders/{cancelled}/cancel', {'reason': 'Ordered the wrong size'}, buyer, expect=200)

    call('GET', '/vendor/payout-account', None, seller, save=(SELLER, 'vendor_payout_account_none'), expect=200)
    call('GET', '/vendor/payouts', None, seller, save=(SELLER, 'vendor_payouts_due'), expect=200)
    # The bank refuses an account ending 0000 (fake provider), then accepts a good one in the legal name.
    call('POST', '/vendor/payout-account', {'method': 'BANK', 'holderName': 'Wag and Co Pvt Ltd', 'ifsc': 'HDFC0001234', 'accountNumber': '50100123450000'}, seller, save=(SELLER, 'vendor_payout_account_failed'), expect=201)
    call('POST', '/vendor/payout-account', {'method': 'BANK', 'holderName': 'Wag and Co Pvt Ltd', 'ifsc': 'HDFC0001234', 'accountNumber': '50100123456789'}, seller, save=(SELLER, 'vendor_payout_account_verified'), expect=201)
    call('POST', '/vendor/payout-account', {'method': 'BANK', 'holderName': 'Wag', 'ifsc': 'HDFC123', 'accountNumber': '12'}, seller, save=(SELLER, 'vendor_payout_account_invalid'), expect=400)
    pay_out(admin, checker, 'VENDOR')
    call('GET', '/vendor/payouts', None, seller, save=(SELLER, 'vendor_payouts'), expect=200)
    call('GET', '/vendor/statement', None, seller, save=(SELLER, 'vendor_statement'), expect=200)
    inv = call('GET', '/vendor/invoices', None, seller, save=(SELLER, 'vendor_invoices'), expect=200)
    call('POST', f"/invoices/{inv[0]['id']}/link", None, seller, save=(SELLER, 'vendor_invoice_link'), expect=200)

    # The customer's side: the refund (once the worker has sent it) and the invoice.
    wait('the refund', lambda: any(r['status'] == 'PROCESSED' for r in call('GET', '/me/refunds', None, buyer)))

    # ══════════════ service partner ══════════════
    cats = call('GET', '/admin/service-categories', None, admin, expect=200)
    scat = next((c for c in cats if c['key'] == 'grooming'), None) or call('POST', '/admin/service-categories', {'key': 'grooming', 'name': 'Grooming', 'commissionBps': 1500}, admin, expect=201)
    pphone = f'9883{stamp}43'[:10]
    partner = login(pphone, 'Priya Nair')
    call('POST', '/partner/profile', {'businessName': f'Pawfect Grooming {stamp}', 'kind': 'BUSINESS', 'phone': pphone, 'addressLine': '12 Hill Road', 'area': 'Bandra West',
                                       'city': 'Mumbai', 'state': 'Maharashtra', 'pincode': '400050', 'lat': 19.0596, 'lng': 72.8295, 'homeVisitRadiusKm': 5, 'concurrency': 1, 'slotStepMin': 30}, partner, expect=201)
    call('POST', '/partner/documents', {'kind': 'ID_PROOF', 'mediaId': upload_pdf(partner, 'ID')}, partner, expect=201)
    service_id = call('POST', '/partner/services', {'categoryId': scat['id'], 'name': 'Full groom', 'description': 'Bath, trim and nails.', 'durationMin': 60, 'bufferMin': 15, 'pricePaise': 84900, 'modes': ['AT_CENTER']}, partner, expect=201)['services'][0]['id']
    call('PUT', '/partner/hours', {'hours': [{'weekday': d, 'opensMin': 540, 'closesMin': 1080} for d in range(7)]}, partner, expect=200)
    pid = call('POST', '/partner/submit', None, partner, expect=200)['id']
    doc = [d for d in call('GET', f'/admin/partners/{pid}', None, admin)['documents'] if d['kind'] == 'ID_PROOF'][0]['id']
    call('POST', f'/admin/partners/{pid}/review', {'decision': 'APPROVE', 'documents': [{'id': doc, 'status': 'ACCEPTED'}]}, admin, expect=200)
    dog = [s for s in call('GET', '/species', expect=200) if s['key'] == 'dog'][0]['id']
    pet = call('POST', '/pets', {'name': 'Coco', 'speciesId': dog}, buyer, expect=201)['id']
    def book(day_offset):
        day = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=5.5, days=day_offset)).date().isoformat()
        slots = call('GET', f'/partner-services/{service_id}/slots?date={day}', expect=200)
        start = slots['slots'][0]['startsAt'] if isinstance(slots, dict) else slots[0]['startsAt']
        b = call('POST', '/bookings', {'serviceId': service_id, 'petId': pet, 'startsAt': start, 'mode': 'AT_CENTER'}, buyer, expect=201)
        call('POST', f"/payments/{b['payment']['paymentId']}/simulate", None, buyer, expect=200)
        return b['id']
    done, dropped = book(2), book(3)
    sql(f"""UPDATE "Booking" SET "startsAt" = now() - interval '10 minutes', "endsAt" = now() + interval '50 minutes' WHERE id = '{done}'""")
    call('POST', f'/partner/bookings/{done}/start', None, partner, expect=200)
    call('POST', f'/partner/bookings/{done}/complete', None, partner, expect=200)
    call('POST', f'/bookings/{dropped}/cancel', {'reason': 'Travelling that week'}, buyer, expect=200)

    call('GET', '/partner/payout-account', None, partner, save=(PARTNER, 'payout_account_none'), expect=200)
    call('POST', '/partner/payout-account', {'method': 'UPI', 'holderName': 'Priya Nair', 'vpa': f'priya{stamp}@okicici'}, partner, save=(PARTNER, 'payout_account_verified'), expect=201)
    pay_out(admin, checker, 'PARTNER')
    call('GET', '/partner/payouts', None, partner, save=(PARTNER, 'payouts'), expect=200)
    call('GET', '/partner/statement', None, partner, save=(PARTNER, 'statement'), expect=200)
    pinv = call('GET', '/partner/invoices', None, partner, save=(PARTNER, 'invoices'), expect=200)
    call('POST', f"/invoices/{pinv[0]['id']}/link", None, partner, save=(PARTNER, 'invoice_link'), expect=200)
    # Replacing a working account: the new one waits out a safety hold; the old one keeps being paid meanwhile.
    call('POST', '/partner/payout-account', {'method': 'BANK', 'holderName': 'Priya Nair', 'ifsc': 'ICIC0000104', 'accountNumber': '000401234567'}, partner, save=(PARTNER, 'payout_account_replaced'), expect=201)
    call('GET', '/partner/payouts', None, partner, save=(PARTNER, 'payouts_on_hold'), expect=200)

    # ══════════════ customer: refunds and invoices ══════════════
    wait('the booking refund', lambda: sum(r['status'] == 'PROCESSED' for r in call('GET', '/me/refunds', None, buyer)) >= 2)
    call('GET', '/me/refunds', None, buyer, save=(CUSTOMER, 'me_refunds'), expect=200)
    cinv = call('GET', '/me/invoices', None, buyer, save=(CUSTOMER, 'me_invoices'), expect=200)
    call('POST', f"/invoices/{cinv[0]['id']}/link", None, buyer, save=(CUSTOMER, 'invoice_link'), expect=200)

    # ══════════════ customer: a contest winner's prize money ══════════════
    ccat = call('POST', '/admin/contest-categories', {'key': f'money-{stamp}', 'name': 'Best Trick', 'group': 'TALENT'}, admin, expect=201)
    contest = call('POST', '/admin/contests', {
        'title': f'Diwali Trick Cup {stamp}', 'description': 'Show us your best trick.', 'categoryId': ccat['id'], 'feePaise': 9900,
        'minParticipants': 2, 'maxParticipants': 50, 'publicWeight': 100, 'votesPerUserPerDay': 1,
        'registrationOpensAt': iso(-1), 'registrationClosesAt': iso(1), 'submissionClosesAt': iso(2), 'votingClosesAt': iso(3),
        'finance': {'prizePoolPct': 60, 'platformFeePct': 20, 'gatewayPct': 2, 'gstOnPlatformFeePct': 18, 'promotionPct': 5, 'refundReservePct': 5, 'judgeFeesPaise': 0},
        'tasks': [{'type': 'TEXT', 'title': 'Describe the trick in one line'}],
        'prizes': [{'rank': 1, 'title': 'Winner', 'kind': 'CASH', 'amountPaise': 15_000_00}],
    }, admin, expect=201)
    cid = contest['id']
    for to in ['REVIEW', 'SCHEDULED']: call('POST', f'/admin/contests/{cid}/transition', {'to': to}, admin, expect=200)
    call('POST', f'/admin/contests/{cid}/legal-approval', {'note': 'Fixture: counsel ref LGL-FIX-002'}, admin, expect=200)
    call('POST', f'/admin/contests/{cid}/transition', {'to': 'LIVE'}, admin, expect=200)
    winner = login(f'9884{stamp}44'[:10], 'Asha Rao')
    entries = []
    for i, (tok, pet_name) in enumerate([(winner, 'Tara'), (login(f'9885{stamp}45'[:10], 'Kabir Das'), 'Bolt')]):
        pet_id = call('POST', '/pets', {'name': pet_name, 'speciesId': dog}, tok, expect=201)['id']
        reg = call('POST', f'/contests/{cid}/register', {'petId': pet_id}, tok, expect=201)
        call('POST', f"/payments/{reg['payment']['paymentId']}/simulate", None, tok, expect=200)
        task = call('GET', f'/contests/{cid}', None, tok, expect=200)['tasks'][0]['id']
        call('POST', f"/contest-entries/{reg['entryId']}/submissions", {'taskId': task, 'text': 'Rolls over, then high-fives.'}, tok, expect=201)
        entries.append(reg['entryId'])
    call('POST', f'/admin/contests/{cid}/transition', {'to': 'VOTING'}, admin, expect=200)
    call('POST', f'/contest-entries/{entries[0]}/vote', None, buyer, expect=200)
    sql(f"""UPDATE "Contest" SET "votingClosesAt" = now() - interval '1 minute' WHERE id = '{cid}'""")
    call('POST', f'/admin/contests/{cid}/transition', {'to': 'EVALUATION'}, admin, expect=200)
    call('POST', f'/admin/contests/{cid}/freeze', None, admin, expect=200)
    call('POST', f'/admin/contests/{cid}/transition', {'to': 'WINNER_DECLARATION'}, admin, expect=200)
    call('POST', f'/admin/contests/{cid}/winners', None, admin, expect=200)
    call('GET', '/me/payouts', None, winner, save=(CUSTOMER, 'me_payouts_none'), expect=200)
    call('GET', '/me/payout-account', None, winner, save=(CUSTOMER, 'me_payout_account_none'), expect=200)
    prize = next(p for p in call('GET', '/admin/finance/prizes?status=PENDING', None, admin, expect=200) if p['contest']['id'] == cid)
    call('POST', f"/admin/finance/prizes/{prize['id']}/approve", None, checker, expect=200)
    call('POST', '/me/payout-account', {'method': 'UPI', 'holderName': 'Asha Rao', 'vpa': f'asha{stamp}@oksbi'}, winner, save=(CUSTOMER, 'me_payout_account_verified'), expect=201)
    call('GET', '/me/payouts', None, winner, save=(CUSTOMER, 'me_payouts_due'), expect=200)
    pay_out(admin, checker, 'USER')
    call('GET', '/me/payouts', None, winner, save=(CUSTOMER, 'me_payouts'), expect=200)
    call('GET', '/me/statement', None, winner, save=(CUSTOMER, 'me_statement'), expect=200)
finally:
    call('PUT', '/admin/settings/finance.payoutHoldDays', {'value': hold}, admin, expect=200)
print('money fixtures recorded for seller, partner and customer apps')
