#!/usr/bin/env python3
"""Python mirror of the customer app's Phase 9e Dart test (test/upload_test.dart), run against the same recorded
fixtures, with lib/services/upload_logic.dart re-implemented line for line. A stand-in where no Flutter SDK is available.
Usage: python3 scripts/check_upload_mirrors.py
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / 'apps' / 'customer-mobile'
fx = lambda n: json.load(open(APP / 'test' / 'fixtures' / f'{n}.json'))['data']
src = (APP / 'lib' / 'services' / 'upload_logic.dart').read_text()
svc = (APP / 'lib' / 'services' / 'upload_service.dart').read_text()
fails = []
def check(name, cond):
    if not cond: fails.append(name)

for name in ('partRange', 'batchesOf', 'retryDelay', 'retryable', 'overallProgress'):
    check(f'upload_logic.dart defines {name}', re.search(r'\b' + name + r'\(', src) is not None)
check('videos ask for resumable uploads', "resumable: type.kind == 'VIDEO'" in svc)
check('interruption keeps what was sent', 'throw UploadInterrupted(Map.of(ids)' in svc)

MB = 1024 * 1024
def part_range(n, part, size):
    start = (n - 1) * part
    return (start, min(start + part, size))
batches = lambda parts, size=10: [parts[i:i + size] for i in range(0, len(parts), size)]
retry_delay = lambda attempt: 30 if attempt >= 5 else 1 << attempt
retryable = lambda c: c is None or c == 0 or c in (403, 408, 429) or c >= 500
overall = lambda done, cur, total: 1 if total <= 0 else max(0.0, min(1.0, (done + cur) / total))

small, big = fx('upload_single_create')['upload'], fx('upload_multipart_create')['upload']
check('single', small['method'] == 'PUT' and small['url'].startswith('http'))
check('multipart', big['method'] == 'MULTIPART' and 'url' not in big and big['partSize'] == 8 * MB and big['partCount'] == 3)
parts = fx('upload_parts')['parts']
check('parts', [p['partNumber'] for p in parts] == [1, 2] and all(p['length'] == 8 * MB for p in parts))
check('part headers', parts[0]['headers']['Content-Length'] == str(8 * MB) and 'partNumber=1' in parts[0]['url'])
p = fx('upload_progress')
check('progress', p['method'] == 'MULTIPART' and p['uploaded'] == [1] and p['missing'] == [2, 3] and p['uploadedBytes'] == p['partSize'])
size = p['sizeBytes']
check('ranges', part_range(1, p['partSize'], size) == (0, p['partSize']) and part_range(3, p['partSize'], size) == (2 * p['partSize'], size))
check('batches', batches([1, 2, 3, 4, 5], 2) == [[1, 2], [3, 4], [5]] and batches([], 10) == [])
check('delays', [retry_delay(i) for i in range(7)] == [1, 2, 4, 8, 16, 30, 30])
check('retryable', all(retryable(c) for c in [None, 0, 403, 408, 429, 500, 503]) and not any(retryable(c) for c in [400, 401, 404, 413]))
check('overall', overall(50, 25, 100) == 0.75 and overall(0, 0, 0) == 1 and overall(90, 50, 100) == 1)
missing = json.load(open(APP / 'test' / 'fixtures' / 'upload_complete_missing.json'))
check('finishing early names the missing parts', missing['success'] is False and missing['errors'][0]['code'] == 'MISSING_PARTS' and missing['errors'][0]['message'] == '2,3')

if fails:
    print('FAILED:\n  ' + '\n  '.join(fails))
    sys.exit(1)
print('upload mirrors: OK')
