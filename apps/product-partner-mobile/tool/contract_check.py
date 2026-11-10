#!/usr/bin/env python3
"""Checks the seller Flutter app against the real API, without needing Flutter.

1. Every API call in lib/ (`_c.get('/path')`, `_posts('/path')` …) must exist in docs/openapi.json
   with that HTTP method.
2. Every JSON key a model's fromJson reads (`j['key']`) must appear in real API responses for
   that model (test/fixtures, recorded from a running API). Optional keys are listed explicitly.

Run:  python3 apps/product-partner-mobile/tool/contract_check.py      (exit code 1 on any mismatch)
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

profiles = [fx(n) for n in ['vendor_profile_created', 'vendor_profile_with_document', 'vendor_profile_submitted', 'vendor_profile_approved']]
products = fx('vendor_products') + [fx('vendor_product_created'), fx('vendor_product_live')]
orders = fx('vendor_orders_to_pack') + fx('vendor_orders_returns') + fx('vendor_orders_all') + [fx(n) for n in
          ['vendor_order_packed', 'vendor_order_shipped', 'vendor_order_delivered', 'vendor_order_cancelled', 'vendor_return_approved', 'vendor_return_received']]
dashboards = [fx('vendor_dashboard_busy'), fx('vendor_dashboard')]
earn = fx('vendor_earnings')
coupons = fx('vendor_coupons') + [fx('vendor_coupon_created'), fx('vendor_coupon_paused')]
summaries = [fx('vendor_payouts_due'), fx('vendor_payouts')]
payouts = [p for x in summaries for p in x['payouts']]
statement = fx('vendor_statement')
invoices = fx('vendor_invoices')
samples = {
    'LegalDoc': [fx('legal_doc')],
    'Tokens': [json.load(open(os.path.join(APP, '..', 'customer-mobile', 'test', 'fixtures', 'auth_result.json')))['data']['tokens']],
    'Me': [fx('vendor_me')],
    'Category': fx('vendor_categories'),
    'VendorDocument': [d for p in profiles for d in p['documents']],
    'VendorProfile': profiles,
    'UploadTicket': [fx('vendor_document_upload')],
    'Photo': [i for p in products for i in p.get('images', [])],
    'Variant': [v for p in products for v in p['variants']],
    'Product': products,
    'StockLevel': [fx('vendor_stock')],
    'OrderItem': [i for o in orders for i in o['items']],
    'ReturnRequest': [r for o in orders for r in o['returns']],
    'ShipTo': [o['shipTo'] for o in orders],
    'VendorOrder': orders,
    'Coupon': coupons,
    'SalesWindow': [w for d in dashboards for w in d['sales'].values()],
    'StockAlert': [a for d in dashboards for a in d['stockAlerts']],
    'Dashboard': dashboards,
    'MonthEarnings': earn['months'],
    'Earnings': [earn],
    'PayoutAccount': [a for n in ['vendor_payout_account_failed', 'vendor_payout_account_verified'] for a in fx(n).values() if a],
    'PayoutAccounts': [fx(n) for n in ['vendor_payout_account_none', 'vendor_payout_account_failed', 'vendor_payout_account_verified']],
    'Payout': payouts,
    'PayoutSummary': summaries,
    'StatementLine': statement['items'],
    'Statement': [statement],
    'Invoice': invoices,
    'InvoiceLink': [fx('vendor_invoice_link')],
}
# Chat and support (Phase 9a): the same models as the customer app.
_chat_pages = [fx('chat_messages_seller'), fx('ticket_messages')]
_chat_msgs = [m for p in _chat_pages for m in p['items']] + [fx(n) for n in ('chat_reply_seller', 'ticket_reply')]
_headers = [fx('chat_header_seller'), fx('ticket_header'), fx('chat_start_order_seller')['conversation']]
samples.update({
    'ChatConversation': fx('chat_inbox_seller')['items'],
    'ChatCounterpart': [c['counterpart'] for c in fx('chat_inbox_seller')['items']] + [h['counterpart'] for h in _headers],
    'ChatHeader': _headers,
    'ChatTicketRef': [fx('ticket_header')['ticket']],
    'ChatPhoto': [m['media'] for m in _chat_msgs if m['media']],
    'ChatMessage': _chat_msgs,
    'ChatRef': [m['ref'] for m in _chat_msgs if m['ref']],
    'ChatPage': _chat_pages,
    'ChatStart': [fx('chat_start_order_seller')],
    'ChatUnread': [fx('chat_unread_seller')],
    'RealtimeTicket': [fx('chat_realtime_ticket')],
    'SupportTopic': fx('support_topics') + fx('help_center')['categories'],
    'HelpFaq': fx('help_center')['faqs'],
    'HelpCenter': [fx('help_center')],
    'BusinessReview': fx('vendor_reviews') + fx('vendor_reviews_all'),
    'ReviewsOverview': [fx('vendor_reviews_summary')],
    'RatingSummary': [fx('vendor_reviews_summary')['summary']],
    'SupportTicket': fx('tickets_mine_seller') + [fx('ticket_created_seller'), fx('ticket_detail'), fx('ticket_closed')],
})
# The same models are recorded from the customer side too (other counterparts and card types).
_cust = lambda n: json.load(open(os.path.join(APP, '..', 'customer-mobile', 'test', 'fixtures', n + '.json')))['data']
_cust_msgs = [m for n in ('chat_messages', 'chat_messages_older') for m in _cust(n)['items']] + [_cust(n) for n in ('chat_send_booking', 'chat_send_product', 'chat_reply_seller', 'chat_send_photo')]
samples['ChatRef'] += [m['ref'] for m in _cust_msgs if m['ref']]
samples['ChatCounterpart'] += [_cust('chat_header')['counterpart']] + [c['counterpart'] for c in _cust('chat_inbox')['items']]
samples['ChatHeader'] += [_cust('chat_header'), _cust('chat_blocked')]
# Keys a model reads that are legitimately absent from some responses are fine as long as they appear in at least one.

models = open(os.path.join(APP, 'lib', 'api', 'models.dart')).read()
checked = 0
for cls, objs in samples.items():
    if not objs:
        errors.append(f'fixtures: no real {cls} responses recorded')
        continue
    m = re.search(r'factory ' + cls + r'\.fromJson\(Json j[^)]*\)(.*?)(?=\n  (?:factory|Json toJson|bool get|int get|String get|static|final|String\? url)|\n}\n)', models, re.S)
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
# Nested reads inside fromJson bodies: `<var>['key']` where <var> is a sub-object of the response.
NESTED = [
    ('Dashboard', 'store', 'store', dashboards), ('Dashboard', 'todo', 'todo', dashboards), ('Dashboard', 'sales', 'sales', dashboards),
    ('Earnings', 'd', 'delivered', [earn]), ('Earnings', 'p', 'inProgress', [earn]),
    ('UploadTicket', 'u', 'upload', [fx('vendor_document_upload')]),
    ('VendorOrder', 'c', 'customer', orders),
    ('Payout', 'a', 'account', payouts), ('PayoutSummary', 'a', 'account', summaries),
    ('Statement', 't', 'totals', [statement]), ('Statement', 'm', 'meta', [statement]),
]
for cls, var, parent, objs in NESTED:
    body = re.search(r'factory ' + cls + r'\.fromJson\(Json j\)(.*?)\n  }', models, re.S).group(1)
    seen = set().union(*(o[parent].keys() for o in objs if isinstance(o.get(parent), dict)))
    reads = set(re.findall(r"\b" + var + r"(?:\?)?\['(\w+)'\]", body))
    if not reads:
        errors.append(f'check: expected {cls}.fromJson to read {parent} through `{var}[...]`')
    for k in sorted(reads):
        checked += 1
        if k not in seen:
            errors.append(f'field: {cls}.fromJson reads {parent}.{k}, which never appears (seen: {", ".join(sorted(seen))})')
# Sub-object reads written inline: (j['category'] as Map)?['name'], _map(j['media'])['id'], i['width'] in Photo sizes.
INLINE = [
    ('Product', r"j\['category'\] as Map<String, dynamic>\?\)\?\['(\w+)'\]", [p['category'] for p in products if p.get('category')]),
    ('UploadTicket', r"_map\(j\['media'\]\)\['(\w+)'\]", [fx('vendor_document_upload')['media']]),
    ('Photo', r"\bi\['(\w+)'\]", [s for p in products for i in p.get('images', []) for s in i['images']]),
    ('Invoice', r"_map\(j\['issuer'\]\)\['(\w+)'\]", [i['issuer'] for i in invoices]),
    ('Invoice', r"_map\(j\['recipient'\]\)\['(\w+)'\]", [i['recipient'] for i in invoices]),
]
for cls, rx, objs in INLINE:
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
