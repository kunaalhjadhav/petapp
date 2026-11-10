#!/usr/bin/env python3
"""Python mirror of the customer app's deep-link test (test/deep_links_test.dart), with routeForLink and webHostsFor
re-implemented line for line from lib/services/deep_links.dart. A stand-in where no Flutter SDK is available.
Usage: python3 scripts/check_links_mirrors.py
"""
import sys
from urllib.parse import urlsplit, quote, unquote

def web_hosts(base):
    host = (urlsplit(base).hostname or '').lower()
    if not host: return set()
    bare = host[4:] if host.startswith('www.') else host
    return {bare, 'www.' + bare}

def segments(path):
    # Dart's Uri.pathSegments: split on "/", decode each, drop the leading empty one.
    parts = path.split('/')
    if parts and parts[0] == '': parts = parts[1:]
    return [unquote(p) for p in parts] if path else []

def route_for_link(link, hosts, scheme='petapp'):
    u = urlsplit(link)
    if u.scheme == scheme:
        host = u.netloc
        parts = ([host] if host and host != 'app' else []) + segments(u.path)
    elif u.scheme in ('https', 'http') and (u.hostname or '').lower() in hosts:
        parts = segments(u.path)
    else:
        return None
    segs = [s for s in parts if s]
    if len(segs) != 2: return None
    key = quote(segs[1], safe="-_.!~*'()")
    table = {'pet': '/pet/', 'reel': '/post/', 'post': '/post/', 'p': '/post/', 'contest': '/contest/', 'challenge': '/challenge/',
             'product': '/product/', 'service': '/service-partner/', 'service-partner': '/service-partner/', 'booking': '/booking/',
             'user': '/user/', 'hashtag': '/hashtag/', 'legal': '/legal/'}
    return table[segs[0]] + key if segs[0] in table else None

hosts = web_hosts('https://petapp.in')
r = lambda l: route_for_link(l, hosts)
cases = [
    ('petapp://pet/bruno.lab', '/pet/bruno.lab'), ('petapp://reel/6f1c', '/post/6f1c'), ('petapp://contest/glam-cup', '/contest/glam-cup'),
    ('petapp://product/yak-chew', '/product/yak-chew'), ('petapp://service/happy-paws', '/service-partner/happy-paws'),
    ('petapp://booking/b1', '/booking/b1'), ('petapp://challenge/walk-week', '/challenge/walk-week'),
    ('https://petapp.in/pet/bruno', '/pet/bruno'), ('https://www.petapp.in/reel/abc?utm_source=whatsapp', '/post/abc'),
    ('https://PETAPP.in/service/paws/', '/service-partner/paws'), ('https://petapp.in/p/abc', '/post/abc'),
    ('https://petapp.in/legal/privacy-policy', '/legal/privacy-policy'), ('petapp://app/post/abc', '/post/abc'),
    ('https://evil.example/pet/bruno', None), ('https://petapp.in.evil.example/pet/bruno', None), ('petapp://pet', None),
    ('petapp://pet/a/b', None), ('petapp://admin/users', None), ('https://petapp.in/', None), ('mailto:hi@petapp.in', None),
    ('petapp://pet/..%2Fsettings', '/pet/..%2Fsettings'),
]
fails = [f'{l}: got {r(l)!r}, want {w!r}' for l, w in cases if r(l) != w]
if fails:
    print('MIRROR FAILURES:\n  ' + '\n  '.join(fails)); sys.exit(1)
print(f'OK: {len(cases)} deep-link cases hold')
