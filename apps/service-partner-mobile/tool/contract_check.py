#!/usr/bin/env python3
"""Checks the partner Flutter app against the real API, without needing Flutter.

1. Every API call in lib/ (`_c.get('/path')`, `_posts('/path')` …) must exist in docs/openapi.json
   with that HTTP method.
2. Every JSON key a model's fromJson reads (`j['key']`) must appear in real API responses for
   that model (test/fixtures, recorded from a running API). Optional keys are listed explicitly.

Run:  python3 apps/service-partner-mobile/tool/contract_check.py      (exit code 1 on any mismatch)
"""
import glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(APP))
spec = json.load(open(os.path.join(ROOT, 'docs', 'openapi.json')))
errors = []

# ── 1. endpoints ──
def norm(path):
    path = path.split('?')[0]
    path = re.sub(r'\$\{[^}]+\}|\$[A-Za-z_]\w*', '{}', path)
    return re.sub(r'\{[^}]*\}', '{}', path)

known = {(m.upper(), norm(p.replace('/api/v1', '', 1))) for p, ops in spec['paths'].items() for m in ops}
calls = []
for f in glob.glob(os.path.join(APP, 'lib', '**', '*.dart'), recursive=True):
    src = open(f).read()
    for m in re.finditer(r"_c\.(get|getPaged|post|put|patch|delete)\('([^']+)'", src):
        calls.append(('GET' if m.group(1) == 'getPaged' else m.group(1).upper(), m.group(2), os.path.relpath(f, APP)))
    for m in re.finditer(r"_posts\('([^']+)'", src):
        calls.append(('GET', m.group(1), os.path.relpath(f, APP)))
for method, path, f in calls:
    if (method, norm(path)) not in known:
        errors.append(f'endpoint: {method} {path} ({f}) is not in the API')
print(f'endpoints: {len(calls)} calls checked against {len(known)} API operations')

# ── 2. JSON keys ──
FIX = os.path.join(APP, 'test', 'fixtures')
def fx(name):
    return json.load(open(os.path.join(FIX, name + '.json')))['data']

profiles = [fx(n) for n in ['profile_created', 'profile_with_document', 'profile_with_service', 'profile_with_hours', 'profile_with_time_off', 'profile_submitted', 'profile_approved']]
bookings = fx('bookings_upcoming') + fx('bookings_past') + [fx('booking_started'), fx('booking_completed'), fx('booking_cancelled')]
earn = fx('earnings')
summaries = [fx('payouts'), fx('payouts_on_hold')]
payouts = [p for x in summaries for p in x['payouts']]
statement = fx('statement')
invoices = fx('invoices')
samples = {
    'LegalDoc': [fx('legal_doc')],
    'Tokens': [json.load(open(os.path.join(APP, '..', 'customer-mobile', 'test', 'fixtures', 'auth_result.json')))['data']['tokens']],
    'Me': [fx('me_partner')],
    'Category': fx('categories'),
    'PartnerDocument': [d for p in profiles for d in p['documents']],
    'PartnerServiceItem': [s for p in profiles for s in p['services']],
    'OpeningHours': [h for p in profiles for h in p['hours']],
    'TimeOff': [t for p in profiles for t in p['timeOff']],
    'PartnerProfile': profiles,
    'Booking': bookings,
    'MonthEarnings': earn['months'],
    'Earnings': [earn],
    'UploadTicket': [fx('document_upload')],
    'PayoutAccount': [a for n in ['payout_account_verified', 'payout_account_replaced'] for a in fx(n).values() if a],
    'PayoutAccounts': [fx(n) for n in ['payout_account_none', 'payout_account_verified', 'payout_account_replaced']],
    'Payout': payouts,
    'PayoutSummary': summaries,
    'StatementLine': statement['items'],
    'Statement': [statement],
    'Invoice': invoices,
    'InvoiceLink': [fx('invoice_link')],
}
# Chat and support (Phase 9a): the same models as the customer app.
_chat_pages = [fx('chat_messages_partner'), fx('ticket_messages')]
_chat_msgs = [m for p in _chat_pages for m in p['items']] + [fx(n) for n in ('chat_reply_partner', 'ticket_reply')]
_headers = [fx('chat_header_partner'), fx('ticket_header'), fx('chat_start_booking')['conversation']]
samples.update({
    'ChatConversation': fx('chat_inbox_partner')['items'],
    'ChatCounterpart': [c['counterpart'] for c in fx('chat_inbox_partner')['items']] + [h['counterpart'] for h in _headers],
    'ChatHeader': _headers,
    'ChatTicketRef': [fx('ticket_header')['ticket']],
    'ChatPhoto': [m['media'] for m in _chat_msgs if m['media']],
    'ChatMessage': _chat_msgs,
    'ChatRef': [m['ref'] for m in _chat_msgs if m['ref']],
    'ChatPage': _chat_pages,
    'ChatStart': [fx('chat_start_booking')],
    'ChatUnread': [fx('chat_unread_partner')],
    'RealtimeTicket': [fx('chat_realtime_ticket')],
    'SupportTopic': fx('support_topics') + fx('help_center')['categories'],
    'HelpFaq': fx('help_center')['faqs'],
    'HelpCenter': [fx('help_center')],
    'BusinessReview': fx('partner_reviews_mine'),
    'ReviewsOverview': [fx('partner_reviews_summary')],
    'RatingSummary': [fx('partner_reviews_summary')['summary']],
    'SupportTicket': fx('tickets_mine_partner') + [fx('ticket_created_partner'), fx('ticket_detail'), fx('ticket_closed')],
})
# The same models are recorded from the customer side too (other counterparts and card types).
_cust = lambda n: json.load(open(os.path.join(APP, '..', 'customer-mobile', 'test', 'fixtures', n + '.json')))['data']
_cust_msgs = [m for n in ('chat_messages', 'chat_messages_older') for m in _cust(n)['items']] + [_cust(n) for n in ('chat_send_booking', 'chat_send_product', 'chat_reply_seller', 'chat_send_photo')]
samples['ChatRef'] += [m['ref'] for m in _cust_msgs if m['ref']]
samples['ChatCounterpart'] += [_cust('chat_header')['counterpart']] + [c['counterpart'] for c in _cust('chat_inbox')['items']]
samples['ChatHeader'] += [_cust('chat_header'), _cust('chat_blocked')]
OPTIONAL = {}

models = open(os.path.join(APP, 'lib', 'api', 'models.dart')).read()
checked = 0
for cls, objs in samples.items():
    m = re.search(r'factory ' + cls + r'\.fromJson\(Json j[^)]*\)(.*?)(?=\n  (?:factory|Json toJson|bool get|static)|\n}\n)', models, re.S)
    if not m:
        errors.append(f'model: no fromJson found for {cls}')
        continue
    body = m.group(1)
    keys = set(re.findall(r"\bj\['(\w+)'\]", body))
    seen = set().union(*(o.keys() for o in objs if isinstance(o, dict)))
    for k in sorted(keys):
        checked += 1
        if k not in seen:
            errors.append(f'field: {cls}.fromJson reads "{k}", which never appears in real {cls} responses (seen: {", ".join(sorted(seen))})')
# Nested reads inside fromJson bodies (customer., earnings., completed., upcoming.)
for cls, var, parent, objs in [('Booking', 'c', 'customer', bookings), ('Booking', 'e', 'earnings', bookings), ('Earnings', 'c', 'completed', [earn]), ('Earnings', 'u', 'upcoming', [earn]),
                                ('Payout', 'a', 'account', payouts), ('PayoutSummary', 'a', 'account', summaries),
                                ('Statement', 't', 'totals', [statement]), ('Statement', 'm', 'meta', [statement])]:
    body = re.search(r'factory ' + cls + r'\.fromJson\(Json j\)(.*?)\n  }', models, re.S).group(1)
    seen = set().union(*(o[parent].keys() for o in objs if isinstance(o.get(parent), dict)))
    reads = set(re.findall(r"\b" + var + r"\['(\w+)'\]", body))
    if not reads:
        errors.append(f'check: expected {cls}.fromJson to read {parent} through `{var}[...]`')
    for k in sorted(reads):
        checked += 1
        if k not in seen:
            errors.append(f'field: {cls}.fromJson reads {parent}.{k}, which never appears (seen: {", ".join(sorted(seen))})')
# Sub-object reads written inline: _map(j['issuer'])['name'].
for cls, rx, objs in [('Invoice', r"_map\(j\['issuer'\]\)\['(\w+)'\]", [i['issuer'] for i in invoices]), ('Invoice', r"_map\(j\['recipient'\]\)\['(\w+)'\]", [i['recipient'] for i in invoices])]:
    body = re.search(r'factory ' + cls + r'\.fromJson\(Json j\)(.*?)(?=\n  [A-Za-z/]|\n}\n)', models, re.S).group(1)
    reads = set(re.findall(rx, body))
    if not reads or not objs:
        errors.append(f'check: inline reads for {cls} not found or no samples')
        continue
    seen = set().union(*(o.keys() for o in objs))
    for k in sorted(reads):
        checked += 1
        if k not in seen:
            errors.append(f'field: {cls}.fromJson reads "{k}" in a sub-object, which never appears (seen: {", ".join(sorted(seen))})')
print(f'fields: {checked} reads checked across {len(samples)} models')

if errors:
    print('\n'.join(['', 'CONTRACT MISMATCHES:'] + errors))
    sys.exit(1)
print('OK: the app matches the API contract')
