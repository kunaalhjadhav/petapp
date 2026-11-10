#!/usr/bin/env python3
"""Python mirror of the apps' crash-report scrubbing test (test/crash_reporting_test.dart), with scrubText re-implemented
from lib/services/crash_reporting.dart (identical in all three apps, which this also checks).
Usage: python3 scripts/check_scrub_mirrors.py
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
copies = {a: (ROOT / 'apps' / a / 'lib' / 'services' / 'crash_reporting.dart').read_text() for a in ['customer-mobile', 'service-partner-mobile', 'product-partner-mobile']}
fails = []
if len(set(copies.values())) != 1: fails.append('the three apps have different crash_reporting.dart files')

def scrub(s):
    s = re.sub(r'(?i)Bearer\s+[A-Za-z0-9\-_.]+', 'Bearer [token]', s)
    s = re.sub(r'eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+', '[token]', s)
    s = re.sub(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}', '[email]', s)
    s = re.sub(r'(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}', '[phone]', s)
    return s

cases = [
    ('OTP failed for +91 98123 45678', 'OTP failed for [phone]'), ('call 9812345678 now', 'call [phone] now'),
    ('owner asha.k@example.in', 'owner [email]'), ('Authorization: Bearer abc.def-ghi_123', 'Authorization: Bearer [token]'),
    ('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_nature-x', 'token [token]'),
    ('Order PA-2026-000123 failed: 503', 'Order PA-2026-000123 failed: 503'), ('price 49900 paise', 'price 49900 paise'),
]
fails += [f'{i!r} -> {scrub(i)!r}, want {w!r}' for i, w in cases if scrub(i) != w]
if fails:
    print('MIRROR FAILURES:\n  ' + '\n  '.join(fails)); sys.exit(1)
print(f'OK: {len(cases)} scrubbing cases hold, and all three apps use the same code')
