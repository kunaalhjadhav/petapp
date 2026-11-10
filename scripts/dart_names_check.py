#!/usr/bin/env python3
"""Cheap stand-in for the analyzer's name resolution: for each Dart file, the public top-level names it can see
(its own plus those of every project file it imports, honouring `show`) must not collide, and relative imports
must exist. Usage: python3 scripts/dart_names_check.py apps/<app>"""
import os, re, sys, glob
app = sys.argv[1]
lib = os.path.join(app, 'lib')
pkg = re.search(r'^name:\s*(\S+)', open(os.path.join(app, 'pubspec.yaml')).read(), re.M).group(1)
DECL = re.compile(r'^(?:abstract\s+|sealed\s+|final\s+|base\s+)*(?:class|enum|mixin|typedef|extension)\s+([A-Za-z_]\w*)|^(?:final|const|var|late\s+final)\s+(?:[\w<>?,\s]+\s+)?([A-Za-z_]\w*)\s*=|^(?:[\w<>?,\[\]\s]+?\s+)?([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(', re.M)
def decls(path):
    names = set()
    for line in open(path).read().splitlines():
        if line.startswith((' ', '\t', '/', '}', ')', '@', 'import', 'export', 'part', 'library')) or not line.strip(): continue
        m = DECL.match(line)
        if m:
            n = next(g for g in m.groups() if g)
            if n not in ('if', 'for', 'while', 'switch', 'return') and not n.startswith('_'): names.add(n)
    return names
def resolve(src, uri):
    if uri.startswith('package:' + pkg + '/'): return os.path.join(lib, uri.split('/', 1)[1])
    if uri.startswith(('package:', 'dart:')): return None
    return os.path.normpath(os.path.join(os.path.dirname(src), uri))
errors = 0
files = glob.glob(os.path.join(app, 'lib', '**', '*.dart'), recursive=True) + glob.glob(os.path.join(app, 'test', '**', '*.dart'), recursive=True)
for f in files:
    src = open(f).read()
    seen = {n: 'self' for n in decls(f)}
    for m in re.finditer(r"^import\s+'([^']+)'(?:\s+as\s+\w+)?(?:\s+show\s+([\w,\s]+))?(?:\s+hide\s+([\w,\s]+))?;", src, re.M):
        uri, show, hide = m.group(1), m.group(2), m.group(3)
        if ' as ' in m.group(0): continue
        p = resolve(f, uri)
        if p is None: continue
        if not os.path.exists(p):
            print(f'{os.path.relpath(f, app)}: import {uri} does not exist'); errors += 1; continue
        names = decls(p)
        if show: names &= {x.strip() for x in show.split(',')}
        if hide: names -= {x.strip() for x in hide.split(',')}
        for n in names:
            if n in seen and seen[n] != p:
                print(f'{os.path.relpath(f, app)}: "{n}" comes from both {os.path.relpath(p, app)} and {seen[n] if seen[n] == "self" else os.path.relpath(seen[n], app)}'); errors += 1
            seen.setdefault(n, p)
print(f'{len(files)} files: {errors} problem(s)')
sys.exit(1 if errors else 0)
