#!/usr/bin/env python3
"""Records real chat and support responses (Phase 9a) for the customer, partner and seller apps.

Needs: API + worker running (SMS_PROVIDER=console, log at $API_LOG), object storage, the seeded super admin, demo data
(an approved service partner with a booking, an approved seller with an order), and `psql` access to the dev database
(DATABASE_URL), used ONLY to find those demo people.

Run:  python3 apps/customer-mobile/tool/record_chat_fixtures.py
"""
import json, os, pathlib, shutil, subprocess, sys, time, urllib.request
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

def photo(token):
    up = call('POST', '/media/uploads', {'kind': 'IMAGE', 'mimeType': 'image/jpeg', 'sizeBytes': len(PHOTO), 'private': True}, token, expect=201)
    put_bytes(up['upload']['url'], up['upload']['headers'], PHOTO)
    call('POST', f"/media/{up['media']['id']}/complete", None, token, expect=200)
    for _ in range(120):
        if call('GET', f"/media/{up['media']['id']}", None, token)['status'] == 'READY': return up['media']['id']
        time.sleep(0.25)
    raise SystemExit('photo never got ready: is the worker running?')

admin = admin_token()
for f in ('ENABLE_CHAT', 'ENABLE_SERVICES', 'ENABLE_MARKETPLACE'): flag(admin, f)

booking = sql("""SELECT b.id, cu.phone, pu.phone FROM "Booking" b JOIN "User" cu ON cu.id = b."customerId" JOIN "ServicePartner" p ON p.id = b."partnerId"
  JOIN "User" pu ON pu.id = p."userId" WHERE p.status = 'APPROVED' AND cu.status = 'ACTIVE' AND pu.status = 'ACTIVE' AND b.status = 'COMPLETED' LIMIT 1""")[0]
order = sql("""SELECT s.id, cu.phone, vu.phone, s."vendorId" FROM "SubOrder" s JOIN "Order" o ON o.id = s."orderId" JOIN "User" cu ON cu.id = o."userId"
  JOIN "Vendor" v ON v.id = s."vendorId" JOIN "User" vu ON vu.id = v."userId" WHERE v.status = 'APPROVED' AND cu.status = 'ACTIVE' AND vu.status = 'ACTIVE' LIMIT 1""")[0]
product = sql(f"""SELECT id FROM "Product" WHERE "vendorId" = '{order[3]}' AND status = 'ACTIVE' LIMIT 1""")[0][0]
local = lambda p: p.replace('+91', '')

cust = login(local(booking[1]), 'Kabir Customer')
partner = login(local(booking[2]), 'Meera Groomer')

# ── customer ↔ service partner, about a booking ──
start = call('POST', '/chat/conversations', {'bookingId': booking[0]}, cust, save='chat_start_booking', expect=200)
conv = start['conversation']['id']
stamp = str(int(time.time()))
call('POST', f'/chat/conversations/{conv}/messages', {'clientId': f'k{stamp}a', 'body': 'Hi! Can I book the same groomer next Saturday?'}, cust, save='chat_send_text', expect=201)
call('POST', f'/chat/conversations/{conv}/messages', {'clientId': f'k{stamp}b', 'refType': 'BOOKING', 'refId': booking[0]}, cust, save='chat_send_booking', expect=201)
call('POST', f'/chat/conversations/{conv}/messages', {'clientId': f'k{stamp}c', 'mediaId': photo(cust), 'body': 'This is how Coco looked after last time 😍'}, cust, save='chat_send_photo', expect=201)
call('GET', '/chat/unread', None, partner, save='chat_unread_partner', expect=200)
call('GET', '/chat/conversations?as=partner', None, partner, save='chat_inbox_partner', expect=200)
call('GET', f'/chat/conversations/{conv}', None, partner, save='chat_header_partner', expect=200)
call('POST', f'/chat/conversations/{conv}/read', None, partner, expect=200)
call('POST', f'/chat/conversations/{conv}/messages', {'clientId': f'm{stamp}a', 'body': 'Yes! Saturday 11am is free. Book it from our page and I’ll be there.'}, partner, save='chat_reply_partner', expect=201)
call('GET', f'/chat/conversations/{conv}/messages?limit=30', None, partner, save='chat_messages_partner', expect=200)
call('GET', '/chat/unread', None, cust, save='chat_unread', expect=200)
call('GET', f'/chat/conversations/{conv}', None, cust, save='chat_header', expect=200)
page = call('GET', f'/chat/conversations/{conv}/messages?limit=2', None, cust, save='chat_messages', expect=200)
call('GET', f"/chat/conversations/{conv}/messages?before={page['nextCursor']}", None, cust, save='chat_messages_older', expect=200)
call('POST', f'/chat/conversations/{conv}/read', None, cust, save='chat_read', expect=200)
call('POST', '/chat/realtime-ticket', None, cust, save='chat_realtime_ticket', expect=200)
call('POST', f'/chat/conversations/{conv}/block', None, cust, save='chat_blocked', expect=200)
call('POST', f'/chat/conversations/{conv}/unblock', None, cust, expect=200)
copy('chat_start_booking', PARTNER_OUT)
for n in ('chat_unread_partner', 'chat_inbox_partner', 'chat_header_partner', 'chat_reply_partner', 'chat_messages_partner', 'chat_realtime_ticket'): copy(n, PARTNER_OUT)

# ── customer ↔ seller, about a product and an order ──
shopper = login(local(order[1]), 'Riya Shopper')
seller = login(local(order[2]), 'Wag Seller')
s = call('POST', '/chat/conversations', {'productId': product}, shopper, save='chat_start_product', expect=200)
sc = s['conversation']['id']
call('POST', f'/chat/conversations/{sc}/messages', {'clientId': f'r{stamp}a', 'body': 'Is this suitable for a 3-month-old puppy?', 'refType': 'PRODUCT', 'refId': product}, shopper, save='chat_send_product', expect=201)
call('POST', '/chat/conversations', {'subOrderId': order[0]}, seller, save='chat_start_order_seller', expect=200)
call('POST', f'/chat/conversations/{sc}/messages', {'clientId': f'w{stamp}a', 'refType': 'ORDER', 'refId': order[0], 'body': 'About your earlier order: it’s soft enough for puppies.'}, seller, save='chat_reply_seller', expect=201)
call('GET', '/chat/conversations?as=customer', None, shopper, save='chat_inbox', expect=200)
call('GET', '/chat/conversations?as=seller', None, seller, save='chat_inbox_seller', expect=200)
call('GET', f'/chat/conversations/{sc}', None, seller, save='chat_header_seller', expect=200)
call('GET', f'/chat/conversations/{sc}/messages', None, seller, save='chat_messages_seller', expect=200)
call('GET', '/chat/unread', None, seller, save='chat_unread_seller', expect=200)
for n in ('chat_start_order_seller', 'chat_reply_seller', 'chat_inbox_seller', 'chat_header_seller', 'chat_messages_seller', 'chat_unread_seller', 'chat_realtime_ticket'): copy(n, SELLER_OUT)

# ── support: help center, a ticket, a staff reply, waiting ──
faqs = call('GET', '/admin/support/faqs', None, admin, expect=200)
for f in faqs:
    if not f['published']: call('PATCH', f"/admin/support/faqs/{f['id']}", {'published': True}, admin, expect=200)
for app, out in (('customer', OUT), ('partner', PARTNER_OUT), ('seller', SELLER_OUT)):
    call('GET', f'/support/faqs?app={app}', None, None, save='help_center', expect=200)
    call('GET', f'/support/categories?app={app}', None, None, save='support_topics', expect=200)
    if out != OUT:
        copy('help_center', out); copy('support_topics', out)
call('GET', '/support/faqs?app=customer', None, None, save='help_center', expect=200)
call('GET', '/support/categories?app=customer', None, None, save='support_topics', expect=200)
call('GET', '/support/faqs?app=customer&q=refund', None, None, save='help_center_search', expect=200)
call('POST', f"/support/faqs/{faqs[0]['id']}/feedback", {'helpful': True}, None, expect=200)

topics = {t['key']: t['id'] for t in call('GET', '/support/categories?app=customer', None, None)}
t = call('POST', '/support/tickets', {'app': 'customer', 'categoryId': topics['bookings'], 'subject': 'Groomer arrived late', 'body': 'The groomer came an hour late on Saturday.',
         'refType': 'BOOKING', 'refId': booking[0], 'mediaIds': [photo(cust)]}, cust, save='ticket_created', expect=201)
call('POST', f"/admin/support/tickets/{t['id']}/messages", {'body': 'Sorry about that. We’ve spoken to the partner; we’re refunding the booking fee.', 'status': 'WAITING'}, admin, expect=201)
call('GET', '/support/tickets?app=customer', None, cust, save='tickets_mine', expect=200)
call('GET', f"/support/tickets/{t['id']}", None, cust, save='ticket_detail', expect=200)
call('GET', f"/chat/conversations/{t['conversationId']}", None, cust, save='ticket_header', expect=200)
call('GET', f"/chat/conversations/{t['conversationId']}/messages", None, cust, save='ticket_messages', expect=200)
call('POST', f"/chat/conversations/{t['conversationId']}/messages", {'clientId': f't{stamp}a', 'body': 'Thank you!'}, cust, save='ticket_reply', expect=201)
call('POST', f"/support/tickets/{t['id']}/close", None, cust, save='ticket_closed', expect=200)
pt = call('POST', '/support/tickets', {'app': 'partner', 'categoryId': topics['payouts'], 'subject': 'When is my next payout?', 'body': 'My statement shows earnings but no payout yet.'}, partner, save='ticket_created_partner', expect=201)
call('GET', '/support/tickets?app=partner', None, partner, save='tickets_mine_partner', expect=200)
copy('ticket_created_partner', PARTNER_OUT); copy('tickets_mine_partner', PARTNER_OUT)
st = call('POST', '/support/tickets', {'app': 'seller', 'categoryId': topics['payouts'], 'subject': 'Invoice question', 'body': 'Where do I find last month’s commission invoice?'}, seller, save='ticket_created_seller', expect=201)
call('GET', '/support/tickets?app=seller', None, seller, save='tickets_mine_seller', expect=200)
copy('ticket_created_seller', SELLER_OUT); copy('tickets_mine_seller', SELLER_OUT)
for n in ('ticket_detail', 'ticket_header', 'ticket_messages', 'ticket_reply', 'ticket_closed'): copy(n, PARTNER_OUT, SELLER_OUT)
print('recorded chat and support fixtures')
