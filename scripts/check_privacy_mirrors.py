#!/usr/bin/env python3
"""Python mirror of the customer app's Phase 8b Dart test (test/privacy_test.dart), run against the same recorded
fixtures, with the pure Dart helpers (parseLegalMarkdown, mdInline, sizeText, exportStatusText, deletionNotice)
re-implemented line for line. A stand-in where no Flutter SDK is available.
Usage: python3 scripts/check_privacy_mirrors.py
"""
import json, math, pathlib, re, sys
from datetime import datetime

APP = pathlib.Path(__file__).resolve().parents[1] / 'apps' / 'customer-mobile'
fx = lambda n: json.load(open(APP / 'test' / 'fixtures' / f'{n}.json'))['data']
fails = []
def check(name, cond):
    if not cond: fails.append(name)

def md_inline(line):
    out, last = [], 0
    for m in re.finditer(r'\*\*(.+?)\*\*', line):
        if m.start() > last: out.append((line[last:m.start()], False))
        out.append((m.group(1), True)); last = m.end()
    if last < len(line): out.append((line[last:], False))
    return out

def parse(src):
    blocks, para, lst = [], None, None
    def close():
        nonlocal para, lst
        if para is not None: blocks.append(('paragraph', 0, para, []))
        if lst is not None: blocks.append(('list', 0, [], lst))
        para = lst = None
    for raw in src.replace('\r\n', '\n').split('\n'):
        line = raw.rstrip()
        if not line.strip(): close(); continue
        h = re.match(r'^(#{1,3})\s+(.*)$', line)
        if h: close(); blocks.append(('heading', len(h.group(1)), [md_inline(h.group(2))], [])); continue
        it = re.match(r'^(\s*)[-*]\s+(.*)$', line)
        if it:
            if para is not None: close()
            if lst is None: lst = []
            if len(it.group(1)) >= 2 and lst: lst[-1]['children'].append(md_inline(it.group(2)))
            else: lst.append({'text': md_inline(it.group(2)), 'children': []})
            continue
        if lst is not None: close()
        if para is None: para = []
        para.append(md_inline(line.strip()))
    close()
    return blocks

MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
def day(iso):
    if not iso: return ''
    d = datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone()
    return f'{d.day} {MONTHS[d.month - 1]} {d.year}'
def size_text(b):
    if b >= 1024 * 1024: return f'{b / (1024 * 1024):.1f} MB'
    return f'{math.ceil(b / 1024)} KB'
def export_status(e):
    if e['status'] == 'PENDING': return 'Being prepared. We’ll notify you when it’s ready.'
    if e['status'] == 'READY': return f"Ready{' · ' + size_text(e['sizeBytes']) if e['sizeBytes'] is not None else ''} · download until {day(e['expiresAt'])}"
    if e['status'] == 'FAILED': return 'Couldn’t be prepared. Please ask again.'
    return 'Expired'
def deletion_notice(r):
    when = f"on {day(r['eraseAfter'])}" if r.get('eraseAfter') else f"in {r['graceDays']} days"
    return f'Your account will be deleted {when}. Changed your mind? Sign in before then to keep it.'

lst = fx('legal_list')
check('legal list', {'terms-of-service', 'privacy-policy'} <= {d['slug'] for d in lst} and lst[0]['requiresAcceptance'])
doc = fx('legal_doc')
check('legal doc', doc['title'] == 'Privacy Policy' and doc['body'].startswith('# Privacy Policy') and '{{' not in doc['body'])
p = fx('consents_pending')
check('pending', p['pending'] == ['terms-of-service', 'privacy-policy'] and all(d['acceptedVersion'] is None and not d['updated'] for d in p['documents'] if d['pending']) and not p['marketing']['granted'])
a = fx('consents_accepted')
check('accepted', a['pending'] == [] and all(d['acceptedVersion'] == d['version'] and d['acceptedAt'] for d in a['documents']) and a['marketing']['granted'])
asked = fx('data_exports_requested')
check('asked', asked['items'][0]['status'] == 'PENDING' and not asked['canRequest'] and export_status(asked['items'][0]).startswith('Being prepared'))
ready = fx('data_exports')
st = export_status(ready['items'][0])
check('ready', ready['items'][0]['status'] == 'READY' and st.startswith('Ready · ') and 'KB' in st and 'download until' in st and ready['nextAllowedAt'])
link = fx('data_export_link')
check('link', re.match(r'^petapp-data-\d{4}-\d{2}-\d{2}\.json$', link['fileName']) and link['url'].startswith('http'))
check('sizes', size_text(840 * 1024) == '840 KB' and size_text(3 * 1024 * 1024 + 200000) == '3.2 MB')
r = fx('account_deletion')
check('deletion', r['graceDays'] == 14 and deletion_notice(r).startswith('Your account will be deleted on ') and deletion_notice(r).endswith('Sign in before then to keep it.'))
check('deletion days', deletion_notice({'graceDays': 14}).startswith('Your account will be deleted in 14 days.'))
check('restored', fx('auth_restored').get('accountRestored') is True and fx('auth_result').get('accountRestored') is not True)
b = parse('# Title\n\nFirst line\nsecond line\n\n## Rights\n- **See** data\n  - in the app\n- delete it\nAfter')
check('md kinds', [x[0] for x in b] == ['heading', 'paragraph', 'heading', 'list', 'paragraph'])
check('md details', b[0][1] == 1 and len(b[1][2]) == 2 and len(b[3][3]) == 2 and b[3][3][0]['text'][0][1] and b[3][3][0]['children'][0][0][0] == 'in the app')
check('md unmatched', md_inline('no ** close') == [('no ** close', False)])
d = parse(doc['body'])
check('md doc', d[0][0] == 'heading' and len([x for x in d if x[0] == 'heading' and x[1] == 2]) > 4)
if fails:
    print('MIRROR FAILURES:', ', '.join(fails)); sys.exit(1)
print('OK: privacy test expectations hold against the recorded fixtures')
