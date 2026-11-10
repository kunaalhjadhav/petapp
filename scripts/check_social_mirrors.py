#!/usr/bin/env python3
"""Python mirror of the apps' social sign-in test (test/social_test.dart), with the rules re-implemented line for
line from lib/services/social_logic.dart (identical in all three Flutter apps). A stand-in where no Flutter SDK is
available. Also checks the three copies are still identical, and that the hash matches the API's
(createHash('sha256').update(nonce).digest('hex') in apps/backend/src/modules/auth/social.service.ts).
Usage: python3 scripts/check_social_mirrors.py
"""
import hashlib, pathlib, random, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APPS = ['customer-mobile', 'service-partner-mobile', 'product-partner-mobile']
CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-._'

def providers_for(is_web, is_android, is_ios, client_id):
    out = []
    if not is_web and is_android and client_id.strip(): out.append('google')
    if not is_web and is_ios: out.append('apple')
    return out

def random_nonce(length=32, r=None):
    if length < 16 or length > 128: raise ValueError(length)
    r = r or random.SystemRandom()
    return ''.join(CHARS[r.randrange(len(CHARS))] for _ in range(length))

def sha256_hex(s): return hashlib.sha256(s.encode('utf-8')).hexdigest()

def apple_name(given, family):
    name = ' '.join(p for p in ((given or '').strip(), (family or '').strip()) if p)
    if not name: return None
    return name[:80].strip() if len(name) > 80 else name

def google_error(code, message):
    m = message or ''
    if code == 'network_error' or 'ApiException: 7' in m: return 'No internet'
    if 'ApiException: 10' in m: return 'isn’t set up'
    return 'didn’t work'

fails = []
def eq(label, got, want):
    if got != want: fails.append(f'{label}: got {got!r}, want {want!r}')

cid = '123-abc.apps.googleusercontent.com'
eq('android+id', providers_for(False, True, False, cid), ['google'])
eq('android no id', providers_for(False, True, False, ''), [])
eq('android blank id', providers_for(False, True, False, '  '), [])
eq('ios', providers_for(False, False, True, cid), ['apple'])
eq('ios no id', providers_for(False, False, True, ''), ['apple'])
eq('web android', providers_for(True, True, False, 'x'), [])
eq('web ios', providers_for(True, False, True, 'x'), [])
n = random_nonce()
eq('nonce length', len(n), 32)
eq('nonce chars', bool(re.fullmatch(r'[0-9A-Za-z._-]+', n)), True)
eq('nonce 16/128', (len(random_nonce(16)), len(random_nonce(128))), (16, 128))
for bad in (15, 129):
    try: random_nonce(bad); fails.append(f'nonce {bad} accepted')
    except ValueError: pass
eq('nonce alphabet has every letter', len(set(CHARS)), 65)
eq('sha abc', sha256_hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
eq('sha empty', sha256_hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
eq('sha utf8', sha256_hex('nönce'), 'e47aecd0f3f6b05cee248e0203afef81c2d0e64bc033d45ea144af086bcbc715')
eq('name both', apple_name('Asha', 'Rao'), 'Asha Rao')
eq('name given', apple_name(' Asha ', None), 'Asha')
eq('name family', apple_name(None, 'Rao'), 'Rao')
eq('name blank', apple_name('', '  '), None)
eq('name none', apple_name(None, None), None)
eq('name long', len(apple_name('A' * 90, None)), 80)
eq('google 10', google_error('sign_in_failed', 'com.google.android.gms.common.api.ApiException: 10: '), 'isn’t set up')
eq('google net', google_error('network_error', None), 'No internet')
eq('google 7', google_error('sign_in_failed', 'ApiException: 7: '), 'No internet')
eq('google other', google_error('sign_in_failed', 'ApiException: 12500: '), 'didn’t work')

# The Dart source must still say what this mirror assumes.
src = (ROOT / 'apps/customer-mobile/lib/services/social_logic.dart').read_text()
eq('dart alphabet', re.search(r"_nonceChars = '([^']+)'", src).group(1), CHARS)
for needle in ['length < 16 || length > 128', "sha256.convert(utf8.encode(input))", 'name.length > 80', "'ApiException: 10'", "'ApiException: 7'"]:
    if needle not in src: fails.append(f'social_logic.dart no longer contains {needle!r}: update this mirror')
for f in ['lib/services/social_logic.dart', 'lib/services/social_sign_in.dart', 'lib/common/social_buttons.dart']:
    copies = {(ROOT / 'apps' / a / f).read_text() for a in APPS}
    if len(copies) != 1: fails.append(f'{f} differs between the three apps')
api = (ROOT / 'apps/backend/src/modules/auth/social.service.ts').read_text()
if "createHash('sha256').update(nonce).digest('hex')" not in api: fails.append('the API no longer hashes the nonce as sha256 hex')

if fails:
    print('MIRROR FAILURES:\n  ' + '\n  '.join(fails)); sys.exit(1)
print('OK: social sign-in rules hold in all three apps and match the API')
