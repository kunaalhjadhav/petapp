#!/usr/bin/env python3
"""Checks the Flutter app against the real API, without needing Flutter.

1. Every API call in lib/ (`_c.get('/path')`, `_posts('/path')` …) must exist in docs/openapi.json
   with that HTTP method.
2. Every JSON key a model's fromJson reads (`j['key']`) must appear in real API responses for
   that model (test/fixtures, recorded from a running API). Optional keys are listed explicitly.

Run:  python3 apps/customer-mobile/tool/contract_check.py      (exit code 1 on any mismatch)
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

def posts():
    out = []
    for n in ['feed', 'trending', 'reels', 'hashtag_posts', 'user_posts', 'pet_posts', 'saved']:
        out += fx(n)['items']
    return out + [fx('post_get'), fx('post_create'), fx('reel_create')]

ASK = ['assistant_services', 'assistant_products', 'assistant_contests', 'assistant_challenges', 'assistant_link', 'assistant_care', 'assistant_urgent', 'assistant_dose', 'assistant_bookings']

def assistant_cards(kind):
    return [c['item'] for n in ASK for c in fx(n)['answer']['cards'] if c['type'] == kind]

def chat_messages():
    pages = [fx(n)['items'] for n in ('chat_messages', 'chat_messages_older', 'ticket_messages')]
    return [m for p in pages for m in p] + [fx(n) for n in ('chat_send_text', 'chat_send_booking', 'chat_send_photo', 'chat_send_product', 'chat_reply_seller', 'ticket_reply')]

def home_sections():
    return fx('home_personal')['sections'] + fx('home_anon')['sections']

def home_items(kind):
    return [i for sec in home_sections() if sec['kind'] == kind for i in sec['items']]

samples = {
    'Tokens': [fx('auth_result')['tokens'], fx('auth_refresh')],
    'AuthResult': [fx('auth_result'), fx('auth_restored')],
    'Me': [fx('me'), fx('me_judge'), fx('me_member')],
    'PersonRef': [p['author'] for p in posts()] + [c['author'] for c in fx('comments')['items']] + [n['actor'] for n in fx('notifications')['items'] if n['actor']] + fx('blocks'),
    'PublicProfile': [fx('user_profile'), fx('user_profile_member')],
    'Species': fx('species'),
    'Breed': fx('breeds'),
    'PetRef': [x for p in posts() for x in p['pets']] + fx('user_profile')['pets'],
    'Pet': [fx('pet_create'), fx('pet_view_public'), fx('pet_view_owner'), fx('pet_view_owner_discoverable')] + fx('pets_mine') + fx('discover_nearby') + fx('discover_trending')
        + [e['pet'] for e in fx('discover_contest_entries') + fx('discover_challenge_entries')],
    'Media': [m for p in posts() for m in p['media']] + [fx('image_media_ready'), fx('video_media_ready'), fx('image_upload_complete')],
    'Counts': [p['counts'] for p in posts()],
    'Post': posts(),
    'Comment': fx('comments')['items'] + fx('replies')['items'] + [fx('comment_create')],
    'AppNotification': fx('notifications')['items'] + fx('notifications_9d')['items'],
    'NotificationPrefs': [fx('notification_prefs'), fx('notification_prefs_9d')],
    'CursorPage': [fx('feed'), fx('comments'), fx('notifications')],
    'UploadTicket': [fx('image_upload_create'), fx('video_upload_create'), fx('upload_single_create'), fx('upload_multipart_create')],
    # resumable uploads (Phase 9e)
    'UploadProgress': [fx('upload_progress')],
    'PartUrl': fx('upload_parts')['parts'],
    # contests (Phase 3)
    'ContestCard': fx('contests_live') + fx('contests_with_members_flag') + [fx('contest_detail_open'), fx('contest_detail_entered')],
    'Prize': [p for c in fx('contests_live') for p in c['prizes']],
    'ContestTask': fx('contest_detail_open')['tasks'],
    'ContestDetail': [fx('contest_detail_open'), fx('contest_detail_pending'), fx('contest_detail_entered')],
    'MyEntry': fx('contest_detail_pending')['viewer']['entries'] + fx('contest_detail_entered')['viewer']['entries'],
    'Checkout': [fx('contest_register')['payment'], fx('contest_detail_pending')['viewer']['entries'][0]['payment'], fx('membership_purchase')['payment']],
    'RegisterResult': [fx('contest_register')],
    'Leaderboard': [fx('contest_leaderboard')],
    'BoardRow': fx('contest_leaderboard')['rows'],
    # challenges, badges, judging (Phase 3c)
    'ChallengeMine': [fx('challenge_detail_joined')['mine'], fx('challenge_detail_done')['mine']],
    'ChallengeCard': fx('challenges_active') + [fx('challenge_detail_joined'), fx('challenge_detail_members_flag')],
    'ChallengeDetail': [fx('challenge_detail_joined'), fx('challenge_detail_done')],
    'CheckInResult': [fx('challenge_checkin')],
    'ChallengeRank': fx('challenge_board')['rows'],
    'ChallengeBoard': [fx('challenge_board')],
    'EarnedBadge': fx('badges_mine'),
    'Criterion': [c for x in fx('judge_contests') for c in x['criteria']],
    'JudgeContest': fx('judge_contests'),
    'JudgeEntry': fx('judge_entries') + fx('judge_entries_scored'),
    # services marketplace (Phase 4)
    'ServiceCategory': fx('service_categories'),
    'NearbyPartner': fx('services_nearby'),
    'ServiceOffer': fx('service_partner')['services'],
    'ReviewView': fx('partner_reviews') + fx('partner_reviews_page') + fx('product_reviews') + fx('product_reviews_photos') + fx('service_partner_reviewed')['reviews'] + fx('shop_product_reviewed')['reviews']
        + [fx('product_review_created'), fx('product_review_mine'), fx('booking_review_photo')['review'], fx('booking_detail_reviewed')['review']],
    'SearchHit': [h for n in ['search_pets', 'search_users', 'search_reels', 'search_products', 'search_services', 'search_partners', 'search_contests', 'search_challenges'] for h in fx(n)]
        + [h for g in fx('search_all')['groups'] for h in g['items']],
    'SearchGroup': fx('search_all')['groups'],
    'SearchAll': [fx('search_all')],
    'SearchFilters': [fx('search_filters')],
    'ContestEntryCard': fx('discover_contest_entries'),
    'ChallengeEntryCard': fx('discover_challenge_entries'),
    'PincodeInfo': [fx('location_pincode')],
    'PlaceHit': fx('location_search_pin')['places'] + fx('location_search_area')['places'] + fx('location_search_city')['places'],
    'Coverage': [fx('location_coverage'), fx('location_coverage_outside')],
    'CityOption': fx('location_cities'),
    'Delivery': [fx('shop_preview_delivery')['delivery'], fx('shop_preview_undeliverable')['delivery']],
    'RatingSummary': [fx('shop_product_reviewed')['ratingSummary'], fx('service_partner_reviewed')['ratingSummary']],
    'PartnerPage': [fx('service_partner'), fx('service_partner_reviewed')],
    'SlotDay': [fx('service_slots')],
    'BookingView': [fx('booking_create'), fx('booking_detail'), fx('booking_detail_completed'), fx('booking_cancel'), fx('booking_review'), fx('booking_review_photo'), fx('booking_detail_reviewed')] + fx('bookings_mine'),
    # shop (Phase 5)
    'ShopCategory': fx('shop_categories'),
    'ProductCard': fx('shop_products') + fx('shop_products_rated'),
    'ProductVariantView': fx('shop_product')['variants'],
    'ProductDetail': [fx('shop_product'), fx('shop_product_reviewed')],
    'CartLine': fx('shop_cart')['items'] + fx('shop_cart_problem')['items'],
    'CartParcel': fx('shop_cart')['parcels'] + fx('shop_preview')['parcels'],
    'Cart': [fx('shop_cart'), fx('shop_preview'), fx('shop_preview_bad_coupon'), fx('shop_cart_problem'), fx('shop_preview_delivery'), fx('shop_preview_undeliverable')],
    'Address': fx('shop_addresses'),
    'ParcelItem': [i for n in ['shop_order_shipped', 'shop_order_return', 'shop_order_cancelled', 'shop_order_delivered', 'shop_order_reviewed'] for p in fx(n)['parcels'] for i in p['items']],
    'Parcel': [p for n in ['shop_order_shipped', 'shop_order_return', 'shop_order_cancelled', 'shop_order_delivered', 'shop_order_reviewed'] for p in fx(n)['parcels']],
    'RefundView': fx('shop_order_cancelled')['refunds'],
    'ShopOrder': [fx('shop_placed')['order'], fx('shop_order_shipped'), fx('shop_order_return'), fx('shop_order_cancelled')],
    'ShopOrderSummary': fx('shop_orders'),
    'RefundItem': fx('me_refunds'),
    'Invoice': fx('me_invoices'),
    'InvoiceLink': [fx('invoice_link')],
    'PayoutAccount': [a for n in ['me_payout_account_verified'] for a in fx(n).values() if a],
    'PayoutAccounts': [fx('me_payout_account_none'), fx('me_payout_account_verified')],
    'Payout': [p for n in ['me_payouts', 'me_payouts_due', 'me_payouts_none'] for p in fx(n)['payouts']],
    'PayoutSummary': [fx('me_payouts'), fx('me_payouts_due'), fx('me_payouts_none')],
    'StatementLine': fx('me_statement')['items'],
    'Statement': [fx('me_statement')],
    # home screen and recommendations (Phase 7b)
    'HomeFeed': [fx('home_personal'), fx('home_anon')],
    'HomeSectionView': home_sections(),
    'Picked': [i for sec in home_sections() for i in sec['items']] + fx('reco_products') + fx('reco_reels')['items'],
    'HomeOffer': home_items('PARTNER_OFFERS'),
    'UpcomingItem': home_items('UPCOMING_EVENTS'),
    'RecoSettings': [fx('reco_settings'), fx('reco_settings_off'), fx('reco_settings_cleared')],
    # PetApp Assistant (Phase 7c)
    'AssistantInfo': [fx('assistant_info')],
    'AskResult': [fx(n) for n in ASK],
    'AssistantMessageView': [m for n in ASK for m in (fx(n)['question'], fx(n)['answer'])] + [fx('assistant_rate')] + fx('assistant_conversation')['messages'],
    'AssistantConversation': fx('assistant_conversations') + [fx('assistant_conversation')],
    'AssistantBooking': assistant_cards('BOOKING'),
    'AssistantLink': assistant_cards('LINK'),
    'CareNote': assistant_cards('CARE'),
    # Privacy and legal (Phase 8b)
    'LegalDocSummary': fx('legal_list'),
    'LegalDoc': [fx('legal_doc')],
    'ConsentStatus': [fx('consents_pending'), fx('consents_accepted')],
    'ConsentDoc': fx('consents_pending')['documents'] + fx('consents_accepted')['documents'],
    'DataExports': [fx('data_exports_requested'), fx('data_exports')],
    'DataExportItem': fx('data_exports_requested')['items'] + fx('data_exports')['items'],
    'ExportLink': [fx('data_export_link')],
    'DeletionScheduled': [fx('account_deletion')],
    # Chat and support (Phase 9a)
    'ChatConversation': fx('chat_inbox')['items'],
    'ChatCounterpart': [c['counterpart'] for c in fx('chat_inbox')['items']] + [fx(n)['counterpart'] for n in ('chat_header', 'ticket_header')],
    'ChatHeader': [fx('chat_header'), fx('chat_blocked'), fx('ticket_header'), fx('chat_start_product')['conversation'], fx('chat_start_booking')['conversation']],
    'ChatTicketRef': [fx('ticket_header')['ticket']],
    'ChatMessage': chat_messages(),
    'ChatRef': [m['ref'] for m in chat_messages() if m['ref']],
    'ChatPage': [fx('chat_messages'), fx('chat_messages_older'), fx('ticket_messages')],
    'ChatStart': [fx('chat_start_product'), fx('chat_start_booking')],
    'ChatUnread': [fx('chat_unread')],
    'RealtimeTicket': [fx('chat_realtime_ticket')],
    'SupportTopic': fx('support_topics') + fx('help_center')['categories'],
    'HelpFaq': fx('help_center')['faqs'] + fx('help_center_search')['faqs'],
    'HelpCenter': [fx('help_center'), fx('help_center_search')],
    # memberships (Phase 9d)
    'MembershipPlan': fx('membership_plans') + [p['plan'] for n in ('membership_me_member',) for p in [fx(n)['current']] + fx(n)['upcoming']],
    'MembershipPeriod': [fx('membership_me_member')['current']] + fx('membership_me_member')['upcoming'],
    'MyMembership': [fx('membership_me_none'), fx('membership_me_member')],
    'SupportTicket': fx('tickets_mine') + [fx('ticket_created'), fx('ticket_detail'), fx('ticket_closed')],
}
samples['Media'] += [m['media'] for m in chat_messages() if m['media']]
# The home screen's items are the same models as elsewhere: check them too.
for cls, kind in [('Post', 'FEATURED_REELS'), ('Pet', 'TRENDING_PETS'), ('ContestCard', 'ACTIVE_CONTESTS'), ('ChallengeCard', 'CHALLENGES'), ('NearbyPartner', 'NEARBY_SERVICES'), ('ProductCard', 'RECOMMENDED_PRODUCTS')]:
    samples[cls] = samples[cls] + home_items(kind)
samples['Pet'] += fx('pets_search')
# The assistant's cards reuse the shop, services and contest models.
for cls, kind in [('NearbyPartner', 'SERVICE'), ('ProductCard', 'PRODUCT'), ('ContestCard', 'CONTEST'), ('ChallengeCard', 'CHALLENGE')]:
    samples[cls] = samples[cls] + assistant_cards(kind)
samples['ProductCard'] += fx('reco_products')
samples['Post'] += fx('reco_reels')['items']
# Keys that legitimately appear only sometimes (owner-only, video-only, …) — still must exist somewhere.
OPTIONAL = {'Pet': {'microchipId', 'restricted', 'owner', 'about'}}

models = open(os.path.join(APP, 'lib', 'api', 'models.dart')).read()
checked = 0
for cls, objs in samples.items():
    m = re.search(r'factory ' + cls + r'(?:<T>)?\.fromJson\(Json j[^)]*\)(.*?)(?=\n  (?:factory|[A-Z]\w* copyWith|static|bool get|double get|String\? imageFor|\w+ \w+;)|\n}\n)', models, re.S)
    if not m:
        errors.append(f'model: no fromJson found for {cls}')
        continue
    keys = set(re.findall(r"\bj\['(\w+)'\]", m.group(1)))
    seen = set().union(*(o.keys() for o in objs if isinstance(o, dict)))
    for k in sorted(keys):
        checked += 1
        if k not in seen:
            errors.append(f'field: {cls}.fromJson reads "{k}", which never appears in real {cls} responses (seen: {", ".join(sorted(seen))})')
# Nested reads inside fromJson bodies: `<var>['key']` where <var> is a sub-object of the response.
summaries = [fx('me_payouts'), fx('me_payouts_due'), fx('me_payouts_none')]
for cls, var, parent, objs in [
    ('RefundItem', 'a', 'about', fx('me_refunds')),
    ('Payout', 'a', 'account', [p for x in summaries for p in x['payouts']]),
    ('PayoutSummary', 'a', 'account', summaries),
    ('Statement', 't', 'totals', [fx('me_statement')]), ('Statement', 'm', 'meta', [fx('me_statement')]),
]:
    body = re.search(r'factory ' + cls + r'\.fromJson\(Json j\)(.*?)\n  }', models, re.S).group(1)
    seen = set().union(*(o[parent].keys() for o in objs if isinstance(o.get(parent), dict)))
    reads = set(re.findall(r"\b" + var + r"\['(\w+)'\]", body))
    if not reads or not seen:
        errors.append(f'check: expected {cls}.fromJson to read {parent} through `{var}[...]`, with samples')
    for k in sorted(reads):
        checked += 1
        if k not in seen:
            errors.append(f'field: {cls}.fromJson reads {parent}.{k}, which never appears (seen: {", ".join(sorted(seen))})')
# Sub-object reads written inline: _map(j['issuer'])['name'].
for part in ['issuer', 'recipient']:
    body = re.search(r'factory Invoice\.fromJson\(Json j\)(.*?)(?=\n  [A-Za-z/]|\n}\n)', models, re.S).group(1)
    seen = set().union(*(i[part].keys() for i in fx('me_invoices')))
    for k in sorted(set(re.findall(r"_map\(j\['" + part + r"'\]\)\['(\w+)'\]", body))):
        checked += 1
        if k not in seen:
            errors.append(f'field: Invoice.fromJson reads {part}.{k}, which never appears (seen: {", ".join(sorted(seen))})')
# Nested reads outside fromJson.
api = open(os.path.join(APP, 'lib', 'api', 'petapp_api.dart')).read()
for key, fixture in [('unread', 'notifications'), ('unread', 'notifications_unread'), ('count', 'like'), ('count', 'save')]:
    checked += 1
    if key not in fx(fixture):
        errors.append(f'field: petapp_api.dart reads "{key}" from {fixture}, which has no such key')
print(f'fields: {checked} reads checked across {len(samples)} models')

if errors:
    print('\n'.join(['', 'CONTRACT MISMATCHES:'] + errors))
    sys.exit(1)
print('OK: the app matches the API contract')
