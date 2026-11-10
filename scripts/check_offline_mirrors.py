#!/usr/bin/env python3
"""Python mirror of the customer app's Phase 10b Dart test (test/offline_test.dart): lib/api/offline_logic.dart
re-implemented line for line, plus checks that the client, payments and sign-out use it. A stand-in where no Flutter
SDK is available. Usage: python3 scripts/check_offline_mirrors.py
"""
import pathlib, re, sys
from datetime import datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / 'apps' / 'customer-mobile' / 'lib'
src = (APP / 'api' / 'offline_logic.dart').read_text()
client = (APP / 'api' / 'api_client.dart').read_text()
pay = (APP / 'services' / 'payment_service.dart').read_text()
auth = (APP / 'state' / 'auth_controller.dart').read_text()
shell = (APP / 'features' / 'home' / 'home_shell.dart').read_text()
api = (APP / 'api' / 'petapp_api.dart').read_text()
fails = []
def check(name, cond):
    if not cond: fails.append(name)

paths = re.findall(r"r'(\^[^']+\$)'", src[src.index('cacheablePaths'):src.index('];')])
check('cache list read', len(paths) >= 10)
# Every kept path is one the app actually reads, so the list can't drift from the API calls.
reads = set(re.findall(r"_c\.get\('([^'$]+)'", api)) | {'/feed', '/feed/trending'}
for p in paths:
    check(f'{p} is read by the app', any(re.fullmatch(p, r) for r in reads))
for bad in ('/payments', '/chat', '/cart', '/me/payout'):
    check(f'{bad} never kept', not any(re.match(p, bad + '/x') or re.match(p, bad) for p in paths))

def cache_key(path, query):
    if not any(re.search(p, path) for p in paths): return None
    q = {k: v for k, v in (query or {}).items() if v is not None}
    if 'cursor' in q or (q.get('page') is not None and str(q['page']) != '1'): return None
    return path if not q else path + '?' + '&'.join(f'{k}={q[k]}' for k in sorted(q))

def friendly(status, msg):
    if status == 0: return 'No internet connection. Check your network and try again.'
    if status in (408, 504): return 'The connection is slow. Please try again.'
    if status == 429: return msg or 'Too many tries. Wait a moment and try again.'
    if status == 503: return msg or 'PetApp is busy right now. Please try again in a moment.'
    if status >= 500: return 'Something went wrong on our side. Please try again in a moment.'
    return msg or 'Something went wrong. Please try again.'

def saved_ago(at, now):
    m = int((now - at).total_seconds() // 60)
    if m < 1: return 'just now'
    if m < 60: return f'{m} min ago'
    h = m // 60
    return f'{h} h ago' if h < 24 else f'{h // 24} d ago'

for s in ("'No internet connection. Check your network and try again.'", "'The connection is slow. Please try again.'",
          "'Something went wrong on our side. Please try again in a moment.'", "'PetApp is busy right now. Please try again in a moment.'",
          "'just now'", "'\\$m min ago'", 'const pendingPaymentTtl = Duration(days: 3);'):
    check(f'dart has {s}', s.replace('\\$', '$') in src)

check('key', cache_key('/users/me', None) == '/users/me')
check('key sorted', cache_key('/contests', {'when': 'open', 'limit': 50}) == '/contests?limit=50&when=open')
check('key null cursor', cache_key('/notifications', {'cursor': None}) == '/notifications')
check('key cursor', cache_key('/notifications', {'cursor': 'abc'}) is None)
check('key page', cache_key('/orders', {'page': 2}) is None)
check('key payments', cache_key('/payments/x', None) is None and cache_key('/chat/conversations', None) is None)
check('friendly', friendly(502, 'Bad gateway').startswith('Something went wrong on our side') and friendly(404, 'Pet not found.') == 'Pet not found.')
check('friendly 503', friendly(503, None).startswith('PetApp is busy') and friendly(503, 'Downloads x').startswith('Downloads'))
now = datetime(2026, 10, 24, 12)
check('ago', [saved_ago(now - d, now) for d in (timedelta(seconds=20), timedelta(minutes=5), timedelta(hours=3), timedelta(days=2))] == ['just now', '5 min ago', '3 h ago', '2 d ago'])

check('client retries reads only', "method == 'GET' ? const [Duration(milliseconds: 400), Duration(milliseconds: 1200)] : const []" in src)
check('client serves the cache offline', 'isConnectionFailure(e) && key != null && cache != null' in client and 'offlineSince.value =' in client)
check('server internals hidden', 'status >= 500 && status != 503 ? const [] : errors' in client)
check('send timeout counts as offline', 'DioExceptionType.sendTimeout' in client)
check('payment kept when verification fails offline', 'PendingPayments.add(' in pay and 'throw PaymentPending()' in pay)
check('sign-out forgets local data', auth.count('await _forgetLocalData();') == 2 and 'offlineCacheProvider).clear()' in auth)
check('pending confirmed on start and resume', shell.count('_confirmPendingPayments()') >= 3 and 'const OfflineBanner()' in shell)

# The partner and seller apps follow the same rules (Phase 10b, final): retries, saved screens, the offline bar,
# cleared at sign-out; never money or chats.
for app, api_file in (('service-partner-mobile', 'partner_api.dart'), ('product-partner-mobile', 'vendor_api.dart')):
    L = ROOT / 'apps' / app / 'lib'
    lg = (L / 'api' / 'offline_logic.dart').read_text()
    cl = (L / 'api' / 'api_client.dart').read_text()
    pv = (L / 'state' / 'providers.dart').read_text()
    hm = (L / 'features' / 'home.dart').read_text()
    av = (L / 'api' / api_file).read_text()
    ps = re.findall(r"r'(\^[^']+\$)'", lg[lg.index('cacheablePaths'):lg.index('];')])
    reads = set(re.findall(r"_c\.get(?:Paged)?\('([^'$]+)'", av))
    check(f'{app}: cache list read', len(ps) >= 4)
    for x in ps:
        check(f'{app}: {x} is read by the app', any(re.fullmatch(x, r) for r in reads))
        check(f'{app}: {x} is not money or chat', not re.search(r'earnings|payout|statement|invoice|chat', x))
    for fn in ('String? cacheKey(', 'List<Duration> retryDelaysFor(', 'String savedAgo('):
        mine = lg[lg.index(fn):lg.index('\n}', lg.index(fn)) if '{' in lg[lg.index(fn):lg.index(fn)+200] else lg.index('\n', lg.index(fn))]
        check(f'{app}: {fn} same as the customer app', mine in src)
    check(f'{app}: client serves the cache offline', 'isConnectionFailure(e) && key != null && cache != null' in cl and 'DioExceptionType.sendTimeout' in cl)
    check(f'{app}: sign-out clears saved screens', pv.count('offlineCacheProvider).clear()') == 2 and 'cache: ref.watch(offlineCacheProvider)' in pv)
    check(f'{app}: offline bar', 'const OfflineBanner()' in hm and "showing what was saved ${savedAgo(at, DateTime.now())}" in hm)
    check(f'{app}: kept on the phone', 'PrefsOfflineCache()' in (ROOT / 'apps' / app / 'lib' / 'main.dart').read_text())

if fails:
    print('FAIL:', *fails, sep='\n  '); sys.exit(1)
print(f'offline mirrors: OK ({len(paths)} kept screens in the customer app, and the partner and seller apps)')
