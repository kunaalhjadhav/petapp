#!/usr/bin/env python3
"""Regenerate docs/API.md from the running API's OpenAPI document.

Usage:  curl -s localhost:4000/api/docs-json > docs/openapi.json && python3 scripts/gen_api_md.py
Access levels for public/optional routes are listed below because OpenAPI can't express them.
"""
import json, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = json.load(open(os.path.join(ROOT, 'docs', 'openapi.json')))

PUBLIC = {
    ('POST', '/api/v1/auth/otp/request'), ('POST', '/api/v1/auth/otp/verify'), ('POST', '/api/v1/auth/email/register'),
    ('POST', '/api/v1/auth/email/login'), ('POST', '/api/v1/auth/google'), ('POST', '/api/v1/auth/apple'),
    ('POST', '/api/v1/auth/refresh'), ('POST', '/api/v1/admin/auth/login'), ('GET', '/api/v1/config/flags'),
    ('GET', '/api/v1/species'), ('GET', '/api/v1/species/{id}/breeds'), ('GET', '/api/v1/pets'),
    ('GET', '/health'), ('GET', '/ready'),
    ('GET', '/api/v1/contest-categories'), ('GET', '/api/v1/contests'), ('GET', '/api/v1/contests/{id}/leaderboard'),
    ('GET', '/api/v1/contest-entries/{id}'), ('POST', '/api/v1/webhooks/payments'), ('POST', '/api/v1/webhooks/payouts'), ('GET', '/api/v1/invoices/{id}/file'),
}
OPTIONAL = {
    ('GET', '/api/v1/pets/{idOrHandle}'), ('GET', '/api/v1/users/{id}'), ('GET', '/api/v1/posts/{id}'),
    ('POST', '/api/v1/posts/{id}/view'), ('GET', '/api/v1/posts/{id}/comments'), ('GET', '/api/v1/comments/{id}/replies'),
    ('GET', '/api/v1/feed/trending'), ('GET', '/api/v1/hashtags/trending'), ('GET', '/api/v1/hashtags/{tag}/posts'),
    ('GET', '/api/v1/users/{id}/posts'), ('GET', '/api/v1/pets/{id}/posts'),
    ('GET', '/api/v1/contests/{idOrSlug}'),
    ('GET', '/api/v1/service-categories'), ('GET', '/api/v1/services/nearby'), ('GET', '/api/v1/service-partners/{idOrSlug}'),
    ('GET', '/api/v1/service-partners/{id}/reviews'), ('GET', '/api/v1/partner-services/{id}/slots'),
    ('GET', '/api/v1/product-categories'), ('GET', '/api/v1/products'), ('GET', '/api/v1/products/{idOrSlug}'),
    ('GET', '/api/v1/challenges'), ('GET', '/api/v1/challenges/{idOrSlug}'), ('GET', '/api/v1/challenges/{id}/leaderboard'), ('GET', '/api/v1/users/{id}/badges'),
}
FLAGGED = ('/api/v1/media', '/api/v1/posts', '/api/v1/comments', '/api/v1/feed', '/api/v1/hashtags', '/api/v1/users/me/saved')  # notifications are not flag-gated
FLAGGED_SUFFIX = ('/posts',)

groups = defaultdict(list)
for path, ops in spec['paths'].items():
    for method, op in ops.items():
        m = method.upper()
        if (m, path) in PUBLIC:
            access = 'Public'
        elif (m, path) in OPTIONAL:
            access = 'Optional sign-in'
        elif path.startswith('/api/v1/admin/'):
            access = 'Admin token + permission'
        else:
            access = 'User token'
        if path.startswith(FLAGGED) or (path.endswith(FLAGGED_SUFFIX) and path != '/api/v1/posts'):
            access += ' · needs ENABLE_REELS'
        if path.startswith(('/api/v1/service', '/api/v1/partner-services', '/api/v1/bookings', '/api/v1/partner/')):
            access += ' · needs ENABLE_SERVICES'
        if path.startswith(('/api/v1/contest', '/api/v1/judge', '/api/v1/challenges')) or path.endswith('/badges') and not path.startswith('/api/v1/admin'):
            access += ' · needs ENABLE_CONTESTS' + (' + ENABLE_PUBLIC_VOTING' if path.endswith('/vote') else '')
        groups[(op.get('tags') or ['Other'])[0]].append((path, m, access))

total = sum(len(v) for v in groups.values())
out = [
    '# API reference',
    '',
    f'Generated from the running API ({total} operations). Interactive docs: `/api/docs`; machine-readable: `docs/openapi.json`.',
    'Regenerate with `python3 scripts/gen_api_md.py` after exporting `/api/docs-json`.',
    '',
    'Every response uses one envelope:',
    '',
    '```json',
    '{ "success": true, "data": {}, "message": "Success", "meta": { "requestId": "…" } }',
    '{ "success": false, "message": "Validation failed", "errors": [{ "message": "…" }], "requestId": "…" }',
    '```',
    '',
    '- **Auth:** `Authorization: Bearer <accessToken>`.',
    '- **Page-numbered lists** take `page` and `limit` (max 100) and return totals in `meta`.',
    '- **Feeds and comments** use cursors: pass `nextCursor` from the previous page as `cursor`. A `null` cursor means the end.',
    '- **Rate limits:** 120 requests a minute per IP by default, with stricter limits on sign-in, OTP, uploads, posts, comments and reports. Going over returns `429`.',
    '',
    '**Status codes:**',
    '',
    '| Code | Meaning |',
    '|---|---|',
    '| `200` / `201` | Success |',
    '| `400` | Validation failed, or a business rule was broken |',
    '| `401` | Not signed in, or the session expired |',
    '| `403` | Not allowed, or the account is inactive |',
    '| `404` | Not found. Also returned for things this caller may not see, such as other users\' private data, blocked users and disabled features |',
    '| `409` | Duplicate |',
    '| `429` | Rate limited |',
    '| `503` | A provider is not configured or is unavailable |',
]
for tag in sorted(groups):
    out += ['', f'## {tag}', '', '| Method | Path | Access |', '|---|---|---|']
    for path, m, access in sorted(groups[tag]):
        out.append(f'| {m} | `{path}` | {access} |')
open(os.path.join(ROOT, 'docs', 'API.md'), 'w').write('\n'.join(out) + '\n')
print(f'docs/API.md: {total} operations in {len(groups)} groups')
