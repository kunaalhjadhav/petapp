#!/usr/bin/env python3
"""Python mirror of the customer app's Phase 9a Dart test (test/chat_test.dart), run against the same recorded
fixtures, with the pure Dart helpers in lib/features/chat/chat_logic.dart (mergeMessages, afterCursor, ChatEvent.parse,
realtimeUri, reconnectDelay, dayLabel, timeLabel, seenText, refLines) re-implemented line for line.
A stand-in where no Flutter SDK is available.
Usage: python3 scripts/check_chat_mirrors.py
"""
import base64, json, pathlib, re, sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / 'apps' / 'customer-mobile'
fx = lambda n, app=APP: json.load(open(app / 'test' / 'fixtures' / f'{n}.json'))['data']
fails = []
def check(name, cond):
    if not cond: fails.append(name)

def date(v):
    return datetime.fromisoformat(v.replace('Z', '+00:00')) if isinstance(v, str) else None

# ── chat_logic.dart ──
def realtime_uri(base, path, ticket):
    b = urlparse(base)
    scheme = 'wss' if b.scheme == 'https' else 'ws'
    return f"{scheme}://{b.hostname}{f':{b.port}' if b.port else ''}{path}?{urlencode({'ticket': ticket})}"

def reconnect_delay(attempt):
    return 30 if attempt >= 5 else 1 << attempt

KNOWN = {'hello', 'pong', 'message', 'read', 'typing', 'conversation'}
def parse_event(raw):
    try:
        j = json.loads(raw)
    except Exception:
        return None
    if not isinstance(j, dict) or j.get('type') not in KNOWN: return None
    return {'type': j['type'], 'conversationId': j.get('conversationId'), 'message': j.get('message') if isinstance(j.get('message'), dict) else None,
            'side': j.get('side'), 'at': date(j.get('at')), 'status': j.get('status')}

def after_cursor(m):
    iso = date(m['createdAt']).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.') + f"{date(m['createdAt']).microsecond // 1000:03d}Z"
    return base64.urlsafe_b64encode(f"{iso}|{m['id']}".encode()).decode().rstrip('=')

def merge(current, incoming):
    by_id = {m['id']: m for m in current}
    for m in incoming:
        if m.get('clientId'):
            for k in [k for k, old in by_id.items() if k != m['id'] and old.get('clientId') == m['clientId'] and k.startswith('local:')]:
                del by_id[k]
        by_id[m['id']] = m
    return sorted(by_id.values(), key=lambda m: (date(m['createdAt']), m['id']))

MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
def day_label(t, now):
    d, today = t.date(), now.date()
    days = (today - d).days
    if days == 0: return 'Today'
    if days == 1: return 'Yesterday'
    if 1 < days < 7: return WEEKDAYS[d.weekday()]
    return f'{d.day} {MONTHS[d.month - 1]}' if d.year == today.year else f'{d.day} {MONTHS[d.month - 1]} {d.year}'

def time_label(t):
    h12 = 12 if t.hour % 12 == 0 else t.hour % 12
    return f"{h12}:{t.minute:02d} {'am' if t.hour < 12 else 'pm'}"

def seen_text(msgs, other_read_at):
    visible = [m for m in msgs if m['side'] != 'SYSTEM']
    if not visible: return None
    last = visible[-1]
    if not last['mine'] or last.get('sending') or last.get('failed'): return None
    return 'Seen' if other_read_at is not None and not other_read_at < date(last['createdAt']) else 'Sent'

def rupees(paise):
    r, p = divmod(paise, 100)
    s = str(r)
    last3, rest = (s[-3:], s[:-3]) if len(s) > 3 else (s, '')
    parts = []
    while len(rest) > 2: parts.insert(0, rest[-2:]); rest = rest[:-2]
    if rest: parts.insert(0, rest)
    whole = ','.join(parts + [last3])
    return f'₹{whole}' if p == 0 else f'₹{whole}.{p:02d}'

status = lambda s: '' if s is None else s[0] + s[1:].lower().replace('_', ' ')
def ref_lines(r):
    if r.get('code') is None and r.get('title') is None:
        return ({'BOOKING': 'Booking', 'ORDER': 'Order'}.get(r['type'], 'Product'), 'No longer available')
    if r['type'] == 'BOOKING':
        st = date(r.get('startsAt'))
        when = '' if st is None else f"{st.astimezone().day} {MONTHS[st.astimezone().month - 1]}, {time_label(st.astimezone())}"
        return (' · '.join(x for x in [r.get('title'), r.get('petName')] if x is not None), ' · '.join(x for x in [when, status(r.get('status'))] if x))
    if r['type'] == 'ORDER':
        parts = []
        if r.get('units') is not None: parts.append(f"{r['units']} item{'' if r['units'] == 1 else 's'}")
        if r.get('totalPaise') is not None: parts.append(rupees(r['totalPaise']))
        parts.append(status(r.get('status')))
        return (f"Order {r.get('code') or ''}".strip(), ' · '.join(x for x in parts if x))
    sub = 'Not available right now' if r.get('available') is False else rupees(r['pricePaise']) if r.get('pricePaise') is not None else ''
    return (r.get('title') or 'Product', sub)

# ── the Dart test, step by step ──
inbox = fx('chat_inbox')['items']
check('inbox: one SHOP conversation with a seller', len(inbox) == 1 and inbox[0]['kind'] == 'SHOP' and inbox[0]['counterpart']['type'] == 'SELLER' and inbox[0]['unread'] == 1 and inbox[0]['lastMessageText'])
h = fx('chat_header')
check('header', h['side'] == 'CUSTOMER' and h['counterpart']['type'] == 'PARTNER' and h['canSend'] and h['kind'] != 'SUPPORT')
b = fx('chat_blocked')
check('blocked header', not b['canSend'] and b['blockedByMe'] and 'Unblock' in b['cannotSendReason'])
p = fx('chat_messages')
check('page', len(p['items']) == 2 and p['more'] and not p['items'][0]['mine'])
img = p['items'][-1]['media']
best = sorted(img['images'], key=lambda i: i['width'])
pick = next((i for i in best if i['width'] >= 480), best[-1])['url']
check('private photo', img['status'] == 'READY' and '/private/' in pick)

bk = fx('chat_send_booking')['ref']
check('booking card', ' · ' in ref_lines(bk)[0] and ref_lines(bk)[1].endswith('Completed'))
check('product card', ref_lines(fx('chat_send_product')['ref'])[1].startswith('₹'))
o = fx('chat_reply_seller')['ref']
check('order card title', ref_lines(o)[0].startswith('Order SO-'))
check('order card subtitle', ref_lines(o)[1] == '1 item · ₹348 · Cancelled')
check('missing card', ref_lines({'type': 'BOOKING', 'id': 'x'})[1] == 'No longer available')

newest, older = fx('chat_messages')['items'], fx('chat_messages_older')['items']
allm = merge(merge([], newest), older)
check('merge count', len(allm) == len(newest) + len(older))
check('merge order', all(date(allm[i - 1]['createdAt']) <= date(allm[i]['createdAt']) for i in range(1, len(allm))))
check('merge idempotent', len(merge(allm, newest)) == len(allm))
sent = fx('chat_send_text')
local = {'id': f"local:{sent['clientId']}", 'side': 'CUSTOMER', 'mine': True, 'body': sent['body'], 'clientId': sent['clientId'], 'createdAt': datetime.now(timezone.utc).isoformat(), 'sending': True}
m = merge([local], [sent])
check('local replaced', len(m) == 1 and m[0]['id'] == sent['id'] and not m[0].get('sending'))

check('cursor matches the server', after_cursor(p['items'][-1]) == p['nextCursor'])

reply = fx('chat_reply_partner')
e = parse_event(json.dumps({'type': 'message', 'conversationId': reply['conversationId'], 'message': reply}))
check('message event', e and e['type'] == 'message' and e['message']['side'] == 'BUSINESS')
r = parse_event('{"type":"read","conversationId":"c","side":"STAFF","at":"2026-10-18T10:00:00.000Z"}')
check('read event', r['at'] == datetime(2026, 10, 18, 10, tzinfo=timezone.utc))
check('typing event', parse_event('{"type":"typing","conversationId":"c","side":"BUSINESS"}')['side'] == 'BUSINESS')
check('bad events', parse_event('{"type":"evil"}') is None and parse_event('not json') is None and parse_event('[1,2]') is None)

t = fx('chat_realtime_ticket')
check('wss uri', realtime_uri('https://api.petapp.in', t['path'], 'abc') == 'wss://api.petapp.in/api/v1/chat/ws?ticket=abc')
check('ws uri', realtime_uri('http://10.0.2.2:4000', t['path'], 'a b') == 'ws://10.0.2.2:4000/api/v1/chat/ws?ticket=a+b')
check('backoff', [reconnect_delay(i) for i in range(8)] == [1, 2, 4, 8, 16, 30, 30, 30])

now = datetime(2026, 10, 18, 15)
check('today', day_label(datetime(2026, 10, 18, 9), now) == 'Today')
check('yesterday', day_label(datetime(2026, 10, 17, 23), now) == 'Yesterday')
check('weekday', day_label(datetime(2026, 10, 14, 9), now) == 'Wednesday')
check('this year', day_label(datetime(2026, 9, 2), now) == '2 Sep')
check('other year', day_label(datetime(2025, 12, 31), now) == '31 Dec 2025')
check('12 am', time_label(datetime(2026, 1, 1, 0, 5)) == '12:05 am')
check('pm', time_label(datetime(2026, 1, 1, 13, 40)) == '1:40 pm')
msgs = merge([], fx('chat_messages')['items'])
check('no receipt under theirs', seen_text(msgs, date(h['otherReadAt'])) is None)
mine = [x for x in merge(msgs, [sent]) if x['mine']]
last = date(mine[-1]['createdAt'])
check('seen', seen_text(mine, last) == 'Seen')
check('sent', seen_text(mine, last - timedelta(seconds=1)) == 'Sent' and seen_text(mine, None) == 'Sent')

hc = fx('help_center')
check('help topics', 'bookings' in [x['key'] for x in hc['categories']] and hc['faqs'])
check('help search', all('refund' in f"{f['question']} {f['answer']}".lower() for f in fx('help_center_search')['faqs']))
c = fx('ticket_created')
check('ticket code', re.fullmatch(r'T-[A-Z0-9]{6}', c['code']) and c['status'] == 'OPEN')
mt = fx('tickets_mine')[0]
check('waiting ticket', mt['statusLabel'] == 'Waiting for your reply' and mt['unread'] == 1)
cl = fx('ticket_closed')
check('closed ticket', not cl['canReply'] and cl['status'] in ('RESOLVED', 'CLOSED'))
th = fx('ticket_header')
check('ticket header', th['kind'] == 'SUPPORT' and th['counterpart']['name'] == 'PetApp Support')
staff = next(x for x in fx('ticket_messages')['items'] if x['side'] == 'STAFF')
check('staff message', staff['senderName'] and not staff['mine'])

# The partner and seller apps share chat_logic.dart: same file, same behaviour.
logic = (APP / 'lib' / 'features' / 'chat' / 'chat_logic.dart').read_text()
for other in ('service-partner-mobile', 'product-partner-mobile'):
    f = ROOT / 'apps' / other / 'lib' / 'features' / 'chat' / 'chat_logic.dart'
    check(f'{other} has the same chat_logic.dart', f.exists() and f.read_text() == logic)

# The partner and seller apps share their chat screens, live connection, push and chat models.
P, V = ROOT / 'apps' / 'service-partner-mobile' / 'lib', ROOT / 'apps' / 'product-partner-mobile' / 'lib'
for rel in ('features/chat/business_chat.dart', 'services/chat_socket.dart', 'services/push_service.dart'):
    check(f'{rel} is the same in the partner and seller apps', (P / rel).read_text() == (V / rel).read_text())
block = lambda f: f.read_text().split('// ── chat and support (Phase 9a)', 1)[1]
check('the chat models are the same in the partner and seller apps', block(P / 'api' / 'models.dart') == block(V / 'api' / 'models.dart'))

if fails:
    print('FAILED:', ', '.join(fails))
    sys.exit(1)
print('OK: chat mirrors pass')
