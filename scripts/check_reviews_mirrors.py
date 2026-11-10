#!/usr/bin/env python3
"""Python mirror of the Phase 9b Dart tests (test/reviews_test.dart in the customer, partner and seller apps), run against
the same recorded fixtures, with the pure helpers in lib/features/reviews/reviews_logic.dart re-implemented line for line.
Also checks that reviews_logic.dart is the same file in all three apps, and that business_reviews.dart is the same in
the partner and seller apps. A stand-in where no Flutter SDK is available.
Usage: python3 scripts/check_reviews_mirrors.py
"""
import json, math, pathlib, re, sys
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parents[1]
APPS = {k: ROOT / 'apps' / v for k, v in (('customer', 'customer-mobile'), ('partner', 'service-partner-mobile'), ('seller', 'product-partner-mobile'))}
fx = lambda n, app='customer': json.load(open(APPS[app] / 'test' / 'fixtures' / f'{n}.json'))['data']
fails = []
def check(name, cond):
    if not cond: fails.append(name)

# ── the shared files ──
logic = {k: (a / 'lib' / 'features' / 'reviews' / 'reviews_logic.dart').read_text() for k, a in APPS.items()}
check('reviews_logic.dart is the same in all three apps', len(set(logic.values())) == 1)
biz = [(APPS[k] / 'lib' / 'features' / 'reviews' / 'business_reviews.dart').read_text() for k in ('partner', 'seller')]
check('business_reviews.dart is the same in the partner and seller apps', biz[0] == biz[1])
src = logic['customer']
check('limits match the API (4 photos, 3 screenshots)', 'reviewPhotoMax = 4' in src and 'reportEvidenceMax = 3' in src)
api_rules = (ROOT / 'apps' / 'backend' / 'src' / 'modules' / 'reviews' / 'reviews.rules.ts').read_text()
check('the API agrees on the limits', 'REVIEW_PHOTO_MAX = 4' in api_rules and 'REPORT_EVIDENCE_MAX = 3' in api_rules)

# ── reviews_logic.dart ──
def stars_text(rating):
    n = max(0, min(5, rating))
    return '★' * n + '☆' * (5 - n)

def dart_fixed1(x):
    # Dart's toStringAsFixed rounds half away from zero.
    return f'{math.floor(abs(x) * 10 + 0.5) / 10 * (1 if x >= 0 else -1):.1f}'

def rating_line(avg, count):
    return 'No reviews yet' if count == 0 else f"★ {dart_fixed1(avg)} · {count} review{'' if count == 1 else 's'}"

def rating_word(r):
    return ['Tap a star', 'Poor', 'Not great', 'OK', 'Good', 'Excellent'][max(0, min(5, r))]

def review_hint(r):
    if r >= 5: return 'What did you love? (optional)'
    if r == 4: return 'What was good? Anything to improve? (optional)'
    if r == 3: return 'What could have been better? (optional)'
    return 'What went wrong? It helps others, and the business. (optional)'

MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
def review_date(at, now):
    days = (now.date() - at.date()).days
    if days <= 0: return 'Today'
    if days == 1: return 'Yesterday'
    if days < 7: return f'{days} days ago'
    return f'{at.day} {MONTHS[at.month - 1]}' if at.year == now.year else f'{at.day} {MONTHS[at.month - 1]} {at.year}'

def review_filter(key):
    if key == 'photos': return {'photos': 'true'}
    n = int(key) if re.fullmatch(r'-?\d+', key) else None
    return {'stars': n} if n is not None and 1 <= n <= 5 else {}

def reply_problem(text):
    t = text.strip()
    if len(t) < 2: return 'Write a reply first.'
    if len(t) > 1000: return 'Keep it under 1,000 characters.'
    return None

def star_shares(counts):
    total = sum(counts)
    if total == 0: return [0] * len(counts)
    raw = [c * 100 / total for c in counts]
    out = [math.floor(r) for r in raw]
    order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - out[i]), i))
    left = 100 - sum(out)
    for i in order:
        if left == 0: break
        out[i] += 1
        left -= 1
    return out

# The Dart source still has each function this file mirrors.
for name in ('starsText', 'ratingLine', 'ratingWord', 'reviewHint', 'reviewDate', 'reviewFilter', 'replyProblem', 'starShares'):
    check(f'reviews_logic.dart defines {name}', re.search(r'\b' + name + r'\(', src) is not None)

# ── customer test/reviews_test.dart ──
p = fx('shop_product_reviewed')
check('product rating', p['ratingCount'] == 1 and p['ratingAvg'] == 4)
s = p['ratingSummary']
check('five rows, 5 first', [x['stars'] for x in s['stars']] == [5, 4, 3, 2, 1])
check('rows add up', sum(x['count'] for x in s['stars']) == s['count'])
r = p['reviews'][0]
check('first name and initial', r['by'] == 'Riya S.')
check('verified', r['verified'] is True)
check('one ready photo', len(r['photos']) == 1 and r['photos'][0]['status'] == 'READY')
check('reply', r['reply'].startswith('Thank you'))
plain = fx('shop_product')
check('older product page has no reviews', not plain.get('reviews') and plain.get('ratingSummary') is None)
check('rated cards', fx('shop_products_rated')[0]['ratingCount'] > 0)
lst = fx('product_reviews')
check('review list', lst and all(1 <= x['rating'] <= 5 for x in lst))
check('photo filter', all(x['photos'] for x in fx('product_reviews_photos')))
before = fx('shop_order_delivered')['parcels'][0]['items'][0]
check('can review once delivered', before['canReview'] is True and before['productId'] and before['review'] is None)
after = fx('shop_order_reviewed')['parcels'][0]['items'][0]
check('reviewed item', after['canReview'] is False and after['review']['rating'] == 4)
mine = fx('product_review_mine')
check('my review has a status', mine['status'] == 'VISIBLE')
b = fx('booking_review_photo')
check('booking review with photo', b['review']['rating'] == 5 and len(b['review']['photos']) == 1)
check('booking shows the reply', fx('booking_detail_reviewed')['review']['reply'] is not None)
page = fx('service_partner_reviewed')
check('partner summary', page['ratingSummary']['count'] == page['ratingCount'])
check('partner review verified', page['reviews'][0]['verified'] is True)

check('starsText', stars_text(4) == '★★★★☆' and stars_text(9) == '★★★★★')
check('ratingLine', rating_line(4.25, 12) == '★ 4.3 · 12 reviews' and rating_line(5, 1) == '★ 5.0 · 1 review' and rating_line(0, 0) == 'No reviews yet')
check('ratingWord', rating_word(0) == 'Tap a star' and rating_word(5) == 'Excellent')
check('reviewHint', review_hint(1).startswith('What went wrong?'))
check('reviewFilter', review_filter('photos') == {'photos': 'true'} and review_filter('3') == {'stars': 3} and review_filter('all') == {} and review_filter('9') == {})
check('replyProblem', reply_problem(' a ') == 'Write a reply first.' and reply_problem('Thanks!') is None and reply_problem('x' * 1001) == 'Keep it under 1,000 characters.')
check('starShares', star_shares([1, 1, 1, 0, 0]) == [34, 33, 33, 0, 0] and star_shares([0] * 5) == [0] * 5 and sum(star_shares([2, 1, 0, 0, 0])) == 100)
now = datetime(2026, 10, 18, 12)
check('reviewDate', [review_date(datetime(*d), now) for d in ((2026, 10, 18, 1), (2026, 10, 17, 23), (2026, 10, 14), (2026, 3, 2), (2025, 12, 31))]
      == ['Today', 'Yesterday', '4 days ago', '2 Mar', '31 Dec 2025'])
routes = (APPS['customer'] / 'lib' / 'features' / 'notifications' / 'notifications_screen.dart').read_text()
check("routeFor('Product') opens the product", "'Product' => '/product/$entityId'" in routes)

# ── partner and seller test/reviews_test.dart ──
for app, summary, items in (('partner', 'partner_reviews_summary', 'partner_reviews_mine'), ('seller', 'vendor_reviews_summary', 'vendor_reviews')):
    o = fx(summary, app)
    check(f'{app}: five rows', [x['stars'] for x in o['summary']['stars']] == [5, 4, 3, 2, 1])
    check(f'{app}: rows add up', sum(x['count'] for x in o['summary']['stars']) == o['summary']['count'])
    check(f'{app}: something to reply to', o['unanswered'] > 0)
    first = fx(items, app)[0]
    check(f'{app}: can reply', first['reply'] is None and first['status'] == 'VISIBLE')
p0 = fx('partner_reviews_mine', 'partner')[0]
check('partner: booking and service', p0['booking']['code'] and p0['booking']['service'] and p0['product'] is None)
check('partner: name shape', re.fullmatch(r'\S+( \S\.)?', p0['by']) is not None)
check('partner: reply recorded', fx('partner_review_reply', 'partner')['reply'])
v0 = fx('vendor_reviews', 'seller')[0]
check('seller: product and order', v0['product']['title'] and v0['order']['code'])
check('seller: a replied review', any(x['reply'] and x['repliedAt'] for x in fx('vendor_reviews_all', 'seller')))

if fails:
    print('FAILED:\n  ' + '\n  '.join(fails))
    sys.exit(1)
print('reviews mirrors: OK')
