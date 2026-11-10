# API reference

Generated from the running API (443 operations). Interactive docs: `/api/docs`; machine-readable: `docs/openapi.json`.
Regenerate with `python3 scripts/gen_api_md.py` after exporting `/api/docs-json`.

Every response uses one envelope:

```json
{ "success": true, "data": {}, "message": "Success", "meta": { "requestId": "…" } }
{ "success": false, "message": "Validation failed", "errors": [{ "message": "…" }], "requestId": "…" }
```

- **Auth:** `Authorization: Bearer <accessToken>`.
- **Page-numbered lists** take `page` and `limit` (max 100) and return totals in `meta`.
- **Feeds and comments** use cursors: pass `nextCursor` from the previous page as `cursor`. A `null` cursor means the end.
- **Rate limits:** 120 requests a minute per IP by default, with stricter limits on sign-in, OTP, uploads, posts, comments and reports. Going over returns `429`.

**Status codes:**

| Code | Meaning |
|---|---|
| `200` / `201` | Success |
| `400` | Validation failed, or a business rule was broken |
| `401` | Not signed in, or the session expired |
| `403` | Not allowed, or the account is inactive |
| `404` | Not found. Also returned for things this caller may not see, such as other users' private data, blocked users and disabled features |
| `409` | Duplicate |
| `429` | Rate limited |
| `503` | A provider is not configured or is unavailable |

## Admin · Analytics

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/analytics/{tab}` | Admin token + permission |

## Admin · Audit

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/audit-logs` | Admin token + permission |

## Admin · Auth

| Method | Path | Access |
|---|---|---|
| POST | `/api/v1/admin/auth/login` | Public |
| POST | `/api/v1/admin/auth/login/mfa` | Admin token + permission |
| POST | `/api/v1/admin/auth/logout` | Admin token + permission |
| GET | `/api/v1/admin/auth/me` | Admin token + permission |
| POST | `/api/v1/admin/auth/mfa/disable` | Admin token + permission |
| POST | `/api/v1/admin/auth/mfa/enable` | Admin token + permission |
| POST | `/api/v1/admin/auth/mfa/recovery-codes` | Admin token + permission |
| POST | `/api/v1/admin/auth/mfa/setup` | Admin token + permission |
| POST | `/api/v1/admin/auth/password` | Admin token + permission |
| POST | `/api/v1/admin/auth/password/forgot` | Admin token + permission |
| GET | `/api/v1/admin/auth/password/reset` | Admin token + permission |
| POST | `/api/v1/admin/auth/password/reset` | Admin token + permission |
| POST | `/api/v1/admin/auth/staff/{id}/mfa-reset` | Admin token + permission |
| POST | `/api/v1/admin/auth/staff/{id}/password-reset` | Admin token + permission |

## Admin · Challenges

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/badges` | Admin token + permission |
| POST | `/api/v1/admin/badges` | Admin token + permission |
| PATCH | `/api/v1/admin/badges/{id}` | Admin token + permission |
| GET | `/api/v1/admin/challenges` | Admin token + permission |
| POST | `/api/v1/admin/challenges` | Admin token + permission |
| GET | `/api/v1/admin/challenges/{id}` | Admin token + permission |
| PATCH | `/api/v1/admin/challenges/{id}` | Admin token + permission |
| GET | `/api/v1/admin/challenges/{id}/leaderboard` | Admin token + permission |
| POST | `/api/v1/admin/challenges/{id}/status` | Admin token + permission |

## Admin · Contests

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/contest-categories` | Admin token + permission |
| POST | `/api/v1/admin/contest-categories` | Admin token + permission |
| PATCH | `/api/v1/admin/contest-categories/{id}` | Admin token + permission |
| PATCH | `/api/v1/admin/contest-entries/{id}/status` | Admin token + permission |
| POST | `/api/v1/admin/contest-prizes/{id}/award` | Admin token + permission |
| POST | `/api/v1/admin/contest-votes/{id}/review` | Admin token + permission |
| GET | `/api/v1/admin/contests` | Admin token + permission |
| POST | `/api/v1/admin/contests` | Admin token + permission |
| GET | `/api/v1/admin/contests/{id}` | Admin token + permission |
| PATCH | `/api/v1/admin/contests/{id}` | Admin token + permission |
| GET | `/api/v1/admin/contests/{id}/finance/{participants}` | Admin token + permission |
| GET | `/api/v1/admin/contests/{id}/flagged-votes` | Admin token + permission |
| POST | `/api/v1/admin/contests/{id}/freeze` | Admin token + permission |
| GET | `/api/v1/admin/contests/{id}/leaderboard` | Admin token + permission |
| POST | `/api/v1/admin/contests/{id}/legal-approval` | Admin token + permission |
| POST | `/api/v1/admin/contests/{id}/transition` | Admin token + permission |
| POST | `/api/v1/admin/contests/{id}/winners` | Admin token + permission |

## Admin · Finance

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/finance/accounts` | Admin token + permission |
| GET | `/api/v1/admin/finance/accounts/{code}/entries` | Admin token + permission |
| GET | `/api/v1/admin/finance/invoices` | Admin token + permission |
| POST | `/api/v1/admin/finance/invoices/commission` | Admin token + permission |
| GET | `/api/v1/admin/finance/invoices/{id}/pdf` | Admin token + permission |
| GET | `/api/v1/admin/finance/overview` | Admin token + permission |
| POST | `/api/v1/admin/finance/payments/{id}/recover` | Admin token + permission |
| GET | `/api/v1/admin/finance/payout-accounts` | Admin token + permission |
| POST | `/api/v1/admin/finance/payout-accounts/{id}/disable` | Admin token + permission |
| GET | `/api/v1/admin/finance/payout-batches` | Admin token + permission |
| POST | `/api/v1/admin/finance/payout-batches` | Admin token + permission |
| GET | `/api/v1/admin/finance/payout-batches/{id}` | Admin token + permission |
| POST | `/api/v1/admin/finance/payout-batches/{id}/approve` | Admin token + permission |
| POST | `/api/v1/admin/finance/payout-batches/{id}/cancel` | Admin token + permission |
| GET | `/api/v1/admin/finance/payouts/preview` | Admin token + permission |
| GET | `/api/v1/admin/finance/prizes` | Admin token + permission |
| POST | `/api/v1/admin/finance/prizes/{id}/approve` | Admin token + permission |
| GET | `/api/v1/admin/finance/reconciliation/issues` | Admin token + permission |
| POST | `/api/v1/admin/finance/reconciliation/issues/{id}/resolve` | Admin token + permission |
| POST | `/api/v1/admin/finance/reconciliation/run` | Admin token + permission |
| GET | `/api/v1/admin/finance/reconciliation/runs` | Admin token + permission |
| GET | `/api/v1/admin/finance/refunds` | Admin token + permission |
| POST | `/api/v1/admin/finance/refunds/{id}/retry` | Admin token + permission |
| POST | `/api/v1/admin/finance/refunds/{id}/settle-manually` | Admin token + permission |
| GET | `/api/v1/admin/finance/settlements` | Admin token + permission |
| POST | `/api/v1/admin/finance/settlements/sync` | Admin token + permission |
| GET | `/api/v1/admin/finance/tax-report` | Admin token + permission |
| GET | `/api/v1/admin/finance/transactions/{id}` | Admin token + permission |
| GET | `/api/v1/admin/finance/trial-balance` | Admin token + permission |

## Admin · Home screen

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/home-sections` | Admin token + permission |
| POST | `/api/v1/admin/home-sections` | Admin token + permission |
| PUT | `/api/v1/admin/home-sections/order` | Admin token + permission |
| GET | `/api/v1/admin/home-sections/preview` | Admin token + permission |
| DELETE | `/api/v1/admin/home-sections/{id}` | Admin token + permission |
| GET | `/api/v1/admin/home-sections/{id}` | Admin token + permission |
| PATCH | `/api/v1/admin/home-sections/{id}` | Admin token + permission |
| POST | `/api/v1/admin/home-sections/{id}/pins` | Admin token + permission |
| DELETE | `/api/v1/admin/home-sections/{id}/pins/{itemId}` | Admin token + permission |

## Admin · Legal

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/legal` | Admin token + permission |
| POST | `/api/v1/admin/legal` | Admin token + permission |
| DELETE | `/api/v1/admin/legal/{id}` | Admin token + permission |
| GET | `/api/v1/admin/legal/{id}` | Admin token + permission |
| PATCH | `/api/v1/admin/legal/{id}` | Admin token + permission |
| POST | `/api/v1/admin/legal/{id}/publish` | Admin token + permission |

## Admin · Locations

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/locations/cities` | Admin token + permission |
| POST | `/api/v1/admin/locations/cities` | Admin token + permission |
| DELETE | `/api/v1/admin/locations/cities/{id}` | Admin token + permission |
| GET | `/api/v1/admin/locations/cities/{id}` | Admin token + permission |
| PATCH | `/api/v1/admin/locations/cities/{id}` | Admin token + permission |
| POST | `/api/v1/admin/locations/cities/{id}/import` | Admin token + permission |
| POST | `/api/v1/admin/locations/cities/{id}/localities` | Admin token + permission |
| GET | `/api/v1/admin/locations/cities/{id}/pincodes` | Admin token + permission |
| POST | `/api/v1/admin/locations/cities/{id}/pincodes` | Admin token + permission |
| GET | `/api/v1/admin/locations/coverage` | Admin token + permission |
| DELETE | `/api/v1/admin/locations/localities/{id}` | Admin token + permission |
| PATCH | `/api/v1/admin/locations/localities/{id}` | Admin token + permission |
| GET | `/api/v1/admin/locations/partners` | Admin token + permission |
| PATCH | `/api/v1/admin/locations/partners/{id}` | Admin token + permission |
| DELETE | `/api/v1/admin/locations/pincodes/{code}` | Admin token + permission |
| PATCH | `/api/v1/admin/locations/pincodes/{code}` | Admin token + permission |
| GET | `/api/v1/admin/locations/states` | Admin token + permission |
| GET | `/api/v1/admin/locations/zones` | Admin token + permission |
| POST | `/api/v1/admin/locations/zones` | Admin token + permission |
| GET | `/api/v1/admin/locations/zones/check` | Admin token + permission |
| DELETE | `/api/v1/admin/locations/zones/{id}` | Admin token + permission |
| PATCH | `/api/v1/admin/locations/zones/{id}` | Admin token + permission |

## Admin · Marketplace

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/coupons` | Admin token + permission |
| POST | `/api/v1/admin/coupons` | Admin token + permission |
| PATCH | `/api/v1/admin/coupons/{id}` | Admin token + permission |
| GET | `/api/v1/admin/orders` | Admin token + permission |
| GET | `/api/v1/admin/product-categories` | Admin token + permission |
| POST | `/api/v1/admin/product-categories` | Admin token + permission |
| PATCH | `/api/v1/admin/product-categories/{id}` | Admin token + permission |
| GET | `/api/v1/admin/products` | Admin token + permission |
| POST | `/api/v1/admin/products/{id}/block` | Admin token + permission |
| GET | `/api/v1/admin/vendors` | Admin token + permission |
| GET | `/api/v1/admin/vendors/{id}` | Admin token + permission |
| PATCH | `/api/v1/admin/vendors/{id}/commission` | Admin token + permission |
| POST | `/api/v1/admin/vendors/{id}/review` | Admin token + permission |

## Admin · Memberships

| Method | Path | Access |
|---|---|---|
| POST | `/api/v1/admin/memberships/grant` | Admin token + permission |
| GET | `/api/v1/admin/memberships/members` | Admin token + permission |
| GET | `/api/v1/admin/memberships/plans` | Admin token + permission |
| POST | `/api/v1/admin/memberships/plans` | Admin token + permission |
| PATCH | `/api/v1/admin/memberships/plans/{id}` | Admin token + permission |
| GET | `/api/v1/admin/memberships/summary` | Admin token + permission |
| POST | `/api/v1/admin/memberships/{id}/revoke` | Admin token + permission |

## Admin · Moderation

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/moderation/cases` | Admin token + permission |
| GET | `/api/v1/admin/moderation/cases/{id}` | Admin token + permission |
| POST | `/api/v1/admin/moderation/cases/{id}/resolve` | Admin token + permission |
| GET | `/api/v1/admin/moderation/reports` | Admin token + permission |
| GET | `/api/v1/admin/moderation/reports/summary` | Admin token + permission |

## Admin · Overview

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/overview` | Admin token + permission |

## Admin · PetApp Assistant

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/assistant/feedback` | Admin token + permission |
| GET | `/api/v1/admin/assistant/status` | Admin token + permission |

## Admin · Pets

| Method | Path | Access |
|---|---|---|
| PATCH | `/api/v1/admin/breeds/{id}` | Admin token + permission |
| GET | `/api/v1/admin/pets` | Admin token + permission |
| GET | `/api/v1/admin/pets/{id}` | Admin token + permission |
| PATCH | `/api/v1/admin/pets/{id}/status` | Admin token + permission |
| PATCH | `/api/v1/admin/pets/{id}/verify` | Admin token + permission |
| GET | `/api/v1/admin/species` | Admin token + permission |
| POST | `/api/v1/admin/species` | Admin token + permission |
| PATCH | `/api/v1/admin/species/{id}` | Admin token + permission |
| GET | `/api/v1/admin/species/{id}/breeds` | Admin token + permission |
| POST | `/api/v1/admin/species/{id}/breeds` | Admin token + permission |

## Admin · Platform

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/flags` | Admin token + permission |
| PATCH | `/api/v1/admin/flags/{key}` | Admin token + permission |
| GET | `/api/v1/admin/settings` | Admin token + permission |
| PUT | `/api/v1/admin/settings/{key}` | Admin token + permission |

## Admin · Privacy

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/privacy/deletions` | Admin token + permission |
| POST | `/api/v1/admin/privacy/deletions/{userId}/cancel` | Admin token + permission |
| POST | `/api/v1/admin/privacy/deletions/{userId}/erase` | Admin token + permission |

## Admin · Promotions

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/promotions` | Admin token + permission |
| POST | `/api/v1/admin/promotions` | Admin token + permission |
| GET | `/api/v1/admin/promotions/audience` | Admin token + permission |
| POST | `/api/v1/admin/promotions/{id}/cancel` | Admin token + permission |

## Admin · Reviews

| Method | Path | Access |
|---|---|---|
| POST | `/api/v1/admin/product-reviews/{id}/status` | Admin token + permission |
| GET | `/api/v1/admin/reviews` | Admin token + permission |
| POST | `/api/v1/admin/service-reviews/{id}/status` | Admin token + permission |

## Admin · Roles

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/permissions` | Admin token + permission |
| GET | `/api/v1/admin/roles` | Admin token + permission |
| POST | `/api/v1/admin/roles` | Admin token + permission |
| DELETE | `/api/v1/admin/roles/{key}` | Admin token + permission |
| PATCH | `/api/v1/admin/roles/{key}` | Admin token + permission |

## Admin · Services

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/bookings` | Admin token + permission |
| POST | `/api/v1/admin/bookings/{id}/cancel` | Admin token + permission |
| GET | `/api/v1/admin/partners` | Admin token + permission |
| GET | `/api/v1/admin/partners/{id}` | Admin token + permission |
| PATCH | `/api/v1/admin/partners/{id}/commission` | Admin token + permission |
| POST | `/api/v1/admin/partners/{id}/review` | Admin token + permission |
| GET | `/api/v1/admin/service-categories` | Admin token + permission |
| POST | `/api/v1/admin/service-categories` | Admin token + permission |
| PATCH | `/api/v1/admin/service-categories/{id}` | Admin token + permission |

## Admin · Support

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/support/assignees` | Admin token + permission |
| GET | `/api/v1/admin/support/categories` | Admin token + permission |
| POST | `/api/v1/admin/support/categories` | Admin token + permission |
| PATCH | `/api/v1/admin/support/categories/{id}` | Admin token + permission |
| GET | `/api/v1/admin/support/faqs` | Admin token + permission |
| POST | `/api/v1/admin/support/faqs` | Admin token + permission |
| PATCH | `/api/v1/admin/support/faqs/{id}` | Admin token + permission |
| POST | `/api/v1/admin/support/faqs/{id}/delete` | Admin token + permission |
| GET | `/api/v1/admin/support/summary` | Admin token + permission |
| GET | `/api/v1/admin/support/tickets` | Admin token + permission |
| POST | `/api/v1/admin/support/tickets` | Admin token + permission |
| GET | `/api/v1/admin/support/tickets/{id}` | Admin token + permission |
| PATCH | `/api/v1/admin/support/tickets/{id}` | Admin token + permission |
| GET | `/api/v1/admin/support/tickets/{id}/messages` | Admin token + permission |
| POST | `/api/v1/admin/support/tickets/{id}/messages` | Admin token + permission |

## Admin · System

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/system` | Admin token + permission |
| POST | `/api/v1/admin/system/queues/{name}/retry` | Admin token + permission |

## Admin · Trust & safety

| Method | Path | Access |
|---|---|---|
| POST | `/api/v1/admin/ai/assess` | Admin token + permission |
| GET | `/api/v1/admin/ai/assessments` | Admin token + permission |
| GET | `/api/v1/admin/ai/status` | Admin token + permission |
| GET | `/api/v1/admin/risk` | Admin token + permission |
| GET | `/api/v1/admin/risk/{userId}` | Admin token + permission |
| POST | `/api/v1/admin/risk/{userId}/recompute` | Admin token + permission |
| POST | `/api/v1/admin/risk/{userId}/review` | Admin token + permission |

## Admin · Users

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/admin/users` | Admin token + permission |
| GET | `/api/v1/admin/users/{id}` | Admin token + permission |
| PUT | `/api/v1/admin/users/{id}/roles` | Admin token + permission |
| PATCH | `/api/v1/admin/users/{id}/status` | Admin token + permission |

## Auth

| Method | Path | Access |
|---|---|---|
| POST | `/api/v1/auth/apple` | Public |
| POST | `/api/v1/auth/email/login` | Public |
| POST | `/api/v1/auth/email/register` | Public |
| POST | `/api/v1/auth/google` | Public |
| POST | `/api/v1/auth/logout` | User token |
| POST | `/api/v1/auth/logout-all` | User token |
| POST | `/api/v1/auth/otp/request` | Public |
| POST | `/api/v1/auth/otp/verify` | Public |
| POST | `/api/v1/auth/refresh` | Public |

## Challenges

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/challenges` | Optional sign-in · needs ENABLE_CONTESTS |
| GET | `/api/v1/challenges/{idOrSlug}` | Optional sign-in · needs ENABLE_CONTESTS |
| POST | `/api/v1/challenges/{id}/check-in` | User token · needs ENABLE_CONTESTS |
| POST | `/api/v1/challenges/{id}/join` | User token · needs ENABLE_CONTESTS |
| GET | `/api/v1/challenges/{id}/leaderboard` | Optional sign-in · needs ENABLE_CONTESTS |
| GET | `/api/v1/users/me/badges` | User token · needs ENABLE_CONTESTS |
| GET | `/api/v1/users/{id}/badges` | Optional sign-in · needs ENABLE_CONTESTS |

## Chat

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/chat/conversations` | User token |
| POST | `/api/v1/chat/conversations` | User token |
| GET | `/api/v1/chat/conversations/{id}` | User token |
| POST | `/api/v1/chat/conversations/{id}/block` | User token |
| GET | `/api/v1/chat/conversations/{id}/messages` | User token |
| POST | `/api/v1/chat/conversations/{id}/messages` | User token |
| POST | `/api/v1/chat/conversations/{id}/read` | User token |
| POST | `/api/v1/chat/conversations/{id}/unblock` | User token |
| POST | `/api/v1/chat/realtime-ticket` | User token |
| GET | `/api/v1/chat/unread` | User token |

## Config

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/config/flags` | Public |

## Contests

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/contest-categories` | Public · needs ENABLE_CONTESTS |
| GET | `/api/v1/contest-entries/{id}` | Public · needs ENABLE_CONTESTS |
| POST | `/api/v1/contest-entries/{id}/submissions` | User token · needs ENABLE_CONTESTS |
| POST | `/api/v1/contest-entries/{id}/vote` | User token · needs ENABLE_CONTESTS + ENABLE_PUBLIC_VOTING |
| GET | `/api/v1/contests` | Public · needs ENABLE_CONTESTS |
| GET | `/api/v1/contests/{idOrSlug}` | Optional sign-in · needs ENABLE_CONTESTS |
| GET | `/api/v1/contests/{id}/leaderboard` | Public · needs ENABLE_CONTESTS |
| POST | `/api/v1/contests/{id}/register` | User token · needs ENABLE_CONTESTS |
| PUT | `/api/v1/judge/contest-entries/{id}/scores` | User token · needs ENABLE_CONTESTS |
| GET | `/api/v1/judge/contests` | User token · needs ENABLE_CONTESTS |
| GET | `/api/v1/judge/contests/{id}/entries` | User token · needs ENABLE_CONTESTS |

## Discover

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/discover/challenge-entries` | User token |
| GET | `/api/v1/discover/contest-entries` | User token |
| GET | `/api/v1/discover/pets/nearby` | User token |
| GET | `/api/v1/discover/pets/trending` | User token |
| GET | `/api/v1/discover/reels` | User token |

## Health

| Method | Path | Access |
|---|---|---|
| GET | `/health` | Public |
| GET | `/ready` | Public |

## Home & recommendations

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/home` | User token |
| GET | `/api/v1/me/recommendations` | User token |
| PUT | `/api/v1/me/recommendations` | User token |
| DELETE | `/api/v1/me/recommendations/history` | User token |
| GET | `/api/v1/recommendations/contests` | User token |
| POST | `/api/v1/recommendations/dismiss` | User token |
| GET | `/api/v1/recommendations/products` | User token |
| GET | `/api/v1/recommendations/reels` | User token |
| GET | `/api/v1/recommendations/services` | User token |

## Invoices

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/invoices/{id}/file` | Public |
| POST | `/api/v1/invoices/{id}/link` | User token |
| GET | `/api/v1/invoices/{id}/pdf` | User token |
| GET | `/api/v1/me/invoices` | User token |
| GET | `/api/v1/partner/invoices` | User token · needs ENABLE_SERVICES |
| GET | `/api/v1/vendor/invoices` | User token |

## Legal

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/legal` | User token |
| GET | `/api/v1/legal/{slug}` | User token |

## Locations

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/locations/cities` | User token |
| GET | `/api/v1/locations/cities/{slug}` | User token |
| GET | `/api/v1/locations/coverage` | User token |
| GET | `/api/v1/locations/pincodes/{code}` | User token |
| GET | `/api/v1/locations/resolve` | User token |
| GET | `/api/v1/locations/search` | User token |
| GET | `/api/v1/locations/states` | User token |

## Media

| Method | Path | Access |
|---|---|---|
| POST | `/api/v1/media/uploads` | User token · needs ENABLE_REELS |
| GET | `/api/v1/media/{id}` | User token · needs ENABLE_REELS |
| POST | `/api/v1/media/{id}/complete` | User token · needs ENABLE_REELS |
| POST | `/api/v1/media/{id}/parts` | User token · needs ENABLE_REELS |
| GET | `/api/v1/media/{id}/upload` | User token · needs ENABLE_REELS |

## Memberships

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/memberships/me` | User token |
| GET | `/api/v1/memberships/plans` | User token |
| POST | `/api/v1/memberships/purchase` | User token |

## Notifications

| Method | Path | Access |
|---|---|---|
| POST | `/api/v1/devices` | User token |
| DELETE | `/api/v1/devices/{token}` | User token |
| GET | `/api/v1/notifications` | User token |
| GET | `/api/v1/notifications/preferences` | User token |
| PUT | `/api/v1/notifications/preferences` | User token |
| POST | `/api/v1/notifications/read` | User token |
| GET | `/api/v1/notifications/unread-count` | User token |

## Partner

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/partner/bookings` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/partner/bookings/{id}/cancel` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/partner/bookings/{id}/complete` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/partner/bookings/{id}/no-show` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/partner/bookings/{id}/start` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/partner/documents` | User token · needs ENABLE_SERVICES |
| DELETE | `/api/v1/partner/documents/{id}` | User token · needs ENABLE_SERVICES |
| GET | `/api/v1/partner/earnings` | User token · needs ENABLE_SERVICES |
| PUT | `/api/v1/partner/hours` | User token · needs ENABLE_SERVICES |
| GET | `/api/v1/partner/profile` | User token · needs ENABLE_SERVICES |
| PATCH | `/api/v1/partner/profile` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/partner/profile` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/partner/services` | User token · needs ENABLE_SERVICES |
| PATCH | `/api/v1/partner/services/{id}` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/partner/submit` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/partner/time-off` | User token · needs ENABLE_SERVICES |
| DELETE | `/api/v1/partner/time-off/{id}` | User token · needs ENABLE_SERVICES |

## Payee statements

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/me/refunds` | User token |
| GET | `/api/v1/me/statement` | User token |
| GET | `/api/v1/partner/statement` | User token · needs ENABLE_SERVICES |
| GET | `/api/v1/vendor/statement` | User token |

## Payments

| Method | Path | Access |
|---|---|---|
| POST | `/api/v1/payments/{id}/simulate` | User token |
| POST | `/api/v1/payments/{id}/verify` | User token |
| POST | `/api/v1/webhooks/payments` | Public |

## Payouts (payees)

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/me/payout-account` | User token |
| POST | `/api/v1/me/payout-account` | User token |
| GET | `/api/v1/me/payouts` | User token |
| GET | `/api/v1/partner/payout-account` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/partner/payout-account` | User token · needs ENABLE_SERVICES |
| GET | `/api/v1/partner/payouts` | User token · needs ENABLE_SERVICES |
| GET | `/api/v1/vendor/payout-account` | User token |
| POST | `/api/v1/vendor/payout-account` | User token |
| GET | `/api/v1/vendor/payouts` | User token |
| POST | `/api/v1/webhooks/payouts` | Public |

## PetApp Assistant

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/assistant` | User token |
| DELETE | `/api/v1/assistant/conversations` | User token |
| GET | `/api/v1/assistant/conversations` | User token |
| DELETE | `/api/v1/assistant/conversations/{id}` | User token |
| GET | `/api/v1/assistant/conversations/{id}` | User token |
| POST | `/api/v1/assistant/messages` | User token |
| POST | `/api/v1/assistant/messages/{id}/rating` | User token |

## Pets

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/pets` | Public |
| POST | `/api/v1/pets` | User token |
| GET | `/api/v1/pets/mine` | User token |
| GET | `/api/v1/pets/{idOrHandle}` | Optional sign-in |
| DELETE | `/api/v1/pets/{id}` | User token |
| PATCH | `/api/v1/pets/{id}` | User token |
| DELETE | `/api/v1/pets/{id}/follow` | User token |
| POST | `/api/v1/pets/{id}/follow` | User token |
| POST | `/api/v1/pets/{id}/vaccinations` | User token |
| DELETE | `/api/v1/pets/{id}/vaccinations/{vid}` | User token |

## Posts & reels

| Method | Path | Access |
|---|---|---|
| DELETE | `/api/v1/comments/{id}` | User token · needs ENABLE_REELS |
| GET | `/api/v1/comments/{id}/replies` | Optional sign-in · needs ENABLE_REELS |
| GET | `/api/v1/feed` | User token · needs ENABLE_REELS |
| GET | `/api/v1/feed/trending` | Optional sign-in · needs ENABLE_REELS |
| GET | `/api/v1/hashtags/trending` | Optional sign-in · needs ENABLE_REELS |
| GET | `/api/v1/hashtags/{tag}/posts` | Optional sign-in · needs ENABLE_REELS |
| GET | `/api/v1/pets/{id}/posts` | Optional sign-in · needs ENABLE_REELS |
| POST | `/api/v1/posts` | User token · needs ENABLE_REELS |
| DELETE | `/api/v1/posts/{id}` | User token · needs ENABLE_REELS |
| GET | `/api/v1/posts/{id}` | Optional sign-in · needs ENABLE_REELS |
| PATCH | `/api/v1/posts/{id}` | User token · needs ENABLE_REELS |
| GET | `/api/v1/posts/{id}/comments` | Optional sign-in · needs ENABLE_REELS |
| POST | `/api/v1/posts/{id}/comments` | User token · needs ENABLE_REELS |
| DELETE | `/api/v1/posts/{id}/like` | User token · needs ENABLE_REELS |
| POST | `/api/v1/posts/{id}/like` | User token · needs ENABLE_REELS |
| DELETE | `/api/v1/posts/{id}/save` | User token · needs ENABLE_REELS |
| POST | `/api/v1/posts/{id}/save` | User token · needs ENABLE_REELS |
| POST | `/api/v1/posts/{id}/share` | User token · needs ENABLE_REELS |
| POST | `/api/v1/posts/{id}/view` | Optional sign-in · needs ENABLE_REELS |
| GET | `/api/v1/users/me/saved` | User token · needs ENABLE_REELS |
| GET | `/api/v1/users/{id}/posts` | Optional sign-in · needs ENABLE_REELS |

## Privacy

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/me/consents` | User token |
| POST | `/api/v1/me/consents` | User token |
| GET | `/api/v1/me/data-exports` | User token |
| POST | `/api/v1/me/data-exports` | User token |
| GET | `/api/v1/me/data-exports/{id}/link` | User token |
| PUT | `/api/v1/me/marketing` | User token |

## Public web

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/public/sitemap` | User token |

## Reviews

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/products/{idOrSlug}/reviews` | User token |
| POST | `/api/v1/products/{id}/reviews` | User token |
| GET | `/api/v1/products/{id}/reviews/mine` | User token |
| GET | `/api/v1/service-partners/{id}/reviews` | Optional sign-in · needs ENABLE_SERVICES |

## Reviews · Business

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/partner/reviews` | User token · needs ENABLE_SERVICES |
| GET | `/api/v1/partner/reviews/summary` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/partner/reviews/{id}/reply` | User token · needs ENABLE_SERVICES |
| GET | `/api/v1/vendor/reviews` | User token |
| GET | `/api/v1/vendor/reviews/summary` | User token |
| POST | `/api/v1/vendor/reviews/{id}/reply` | User token |

## Safety

| Method | Path | Access |
|---|---|---|
| POST | `/api/v1/reports` | User token |
| GET | `/api/v1/users/me/blocks` | User token |
| DELETE | `/api/v1/users/{id}/block` | User token |
| POST | `/api/v1/users/{id}/block` | User token |

## Search

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/search` | User token |
| GET | `/api/v1/search/filters` | User token |
| GET | `/api/v1/search/{type}` | User token |

## Services

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/bookings` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/bookings` | User token · needs ENABLE_SERVICES |
| GET | `/api/v1/bookings/{id}` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/bookings/{id}/cancel` | User token · needs ENABLE_SERVICES |
| POST | `/api/v1/bookings/{id}/review` | User token · needs ENABLE_SERVICES |
| GET | `/api/v1/partner-services/{id}/slots` | Optional sign-in · needs ENABLE_SERVICES |
| GET | `/api/v1/service-categories` | Optional sign-in · needs ENABLE_SERVICES |
| GET | `/api/v1/service-partners/{idOrSlug}` | Optional sign-in · needs ENABLE_SERVICES |
| GET | `/api/v1/services/nearby` | Optional sign-in · needs ENABLE_SERVICES |

## Shop

| Method | Path | Access |
|---|---|---|
| DELETE | `/api/v1/cart` | User token |
| GET | `/api/v1/cart` | User token |
| PUT | `/api/v1/cart/items` | User token |
| POST | `/api/v1/checkout/preview` | User token |
| GET | `/api/v1/orders` | User token |
| POST | `/api/v1/orders` | User token |
| GET | `/api/v1/orders/{id}` | User token |
| GET | `/api/v1/product-categories` | Optional sign-in |
| GET | `/api/v1/products` | Optional sign-in |
| GET | `/api/v1/products/{idOrSlug}` | Optional sign-in |
| POST | `/api/v1/sub-orders/{id}/cancel` | User token |
| POST | `/api/v1/sub-orders/{id}/return` | User token |

## Species

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/species` | Public |
| GET | `/api/v1/species/{id}/breeds` | Public |

## Support

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/support/categories` | User token |
| GET | `/api/v1/support/faqs` | User token |
| POST | `/api/v1/support/faqs/{id}/feedback` | User token |
| GET | `/api/v1/support/tickets` | User token |
| POST | `/api/v1/support/tickets` | User token |
| GET | `/api/v1/support/tickets/{id}` | User token |
| POST | `/api/v1/support/tickets/{id}/close` | User token |

## Users

| Method | Path | Access |
|---|---|---|
| DELETE | `/api/v1/users/me` | User token |
| GET | `/api/v1/users/me` | User token |
| PATCH | `/api/v1/users/me` | User token |
| GET | `/api/v1/users/me/addresses` | User token |
| POST | `/api/v1/users/me/addresses` | User token |
| DELETE | `/api/v1/users/me/addresses/{id}` | User token |
| PATCH | `/api/v1/users/me/addresses/{id}` | User token |
| GET | `/api/v1/users/{id}` | Optional sign-in |
| DELETE | `/api/v1/users/{id}/follow` | User token |
| POST | `/api/v1/users/{id}/follow` | User token |

## Vendor

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/vendor/coupons` | User token |
| POST | `/api/v1/vendor/coupons` | User token |
| PATCH | `/api/v1/vendor/coupons/{id}` | User token |
| GET | `/api/v1/vendor/dashboard` | User token |
| POST | `/api/v1/vendor/documents` | User token |
| DELETE | `/api/v1/vendor/documents/{id}` | User token |
| GET | `/api/v1/vendor/earnings` | User token |
| GET | `/api/v1/vendor/orders` | User token |
| POST | `/api/v1/vendor/orders/{id}/cancel` | User token |
| POST | `/api/v1/vendor/orders/{id}/deliver` | User token |
| POST | `/api/v1/vendor/orders/{id}/pack` | User token |
| POST | `/api/v1/vendor/orders/{id}/ship` | User token |
| GET | `/api/v1/vendor/products` | User token |
| POST | `/api/v1/vendor/products` | User token |
| PATCH | `/api/v1/vendor/products/{id}` | User token |
| GET | `/api/v1/vendor/profile` | User token |
| PATCH | `/api/v1/vendor/profile` | User token |
| POST | `/api/v1/vendor/profile` | User token |
| POST | `/api/v1/vendor/returns/{id}/decide` | User token |
| POST | `/api/v1/vendor/submit` | User token |
| PUT | `/api/v1/vendor/variants/{id}/stock` | User token |
