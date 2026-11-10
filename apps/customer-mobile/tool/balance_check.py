#!/usr/bin/env python3
"""Bracket balance for Dart sources, aware of strings, raw strings, ${} interpolation and comments.
A cheap stand-in for the analyzer when no Dart SDK is available. Usage: balance_check.py [files…]"""
import glob, sys

PAIRS = {')': '(', ']': '[', '}': '{'}

def check(src):
    stack = []  # entries: ('(' | '[' | '{' | 'interp', line)
    i, n, line = 0, len(src), 1
    def string(i, quote, raw):
        nonlocal line
        triple = src.startswith(quote * 3, i)
        q = quote * 3 if triple else quote
        i += len(q)
        while i < n:
            c = src[i]
            if c == '\n':
                if not triple: return None, f'line {line}: unterminated string'
                line += 1
            if not raw and c == '\\': i += 2; continue
            if src.startswith(q, i): return i + len(q), None
            if not raw and c == '$' and i + 1 < n and src[i + 1] == '{':
                j, err = code(i + 2, interp=True)
                if err: return None, err
                i = j; continue
            i += 1
        return None, f'line {line}: unterminated string'
    def code(i, interp=False):
        nonlocal line
        depth = 0
        while i < n:
            c = src[i]
            if c == '\n': line += 1
            if src.startswith('//', i):
                j = src.find('\n', i); i = n if j < 0 else j; continue
            if src.startswith('/*', i):
                j = src.find('*/', i + 2)
                if j < 0: return None, f'line {line}: unterminated comment'
                line += src.count('\n', i, j); i = j + 2; continue
            if c in '\'"':
                raw = i > 0 and src[i - 1] == 'r' and (i < 2 or not (src[i - 2].isalnum() or src[i - 2] == '_'))
                j, err = string(i, c, raw)
                if err: return None, err
                i = j; continue
            if c in '([{':
                stack.append((c, line)); depth += 1
            elif c in ')]}':
                if interp and c == '}' and depth == 0: return i + 1, None
                if not stack or stack[-1][0] != PAIRS[c]:
                    opened = f"'{stack[-1][0]}' from line {stack[-1][1]}" if stack else 'nothing'
                    return None, f"line {line}: '{c}' closes {opened}"
                stack.pop(); depth -= 1
            i += 1
        if interp: return None, f'line {line}: unterminated ${{…}}'
        return i, None
    _, err = code(0)
    if err: return err
    if stack: return f"'{stack[-1][0]}' opened on line {stack[-1][1]} is never closed"
    return None

files = sys.argv[1:] or glob.glob('lib/**/*.dart', recursive=True) + glob.glob('test/**/*.dart', recursive=True)
bad = 0
for f in files:
    err = check(open(f, encoding='utf-8').read())
    if err:
        bad += 1; print(f'{f}: {err}')
print(f'{len(files)} files checked, {bad} with problems')
sys.exit(1 if bad else 0)
