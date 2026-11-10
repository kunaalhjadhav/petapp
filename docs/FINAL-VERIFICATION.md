# Final verification

This document checks the spec's final production checklist (§86) and deliverables (§89) one by one. For each item it says how the item is verified and where. The test names are the suites in `apps/backend/test` (end-to-end, against real Postgres, Redis and S3-compatible storage) and the dashboard and website browser tests. CI runs all of them on every push (`.github/workflows/ci.yml`).

## 1. Production checklist (spec §86)

| Item | How it's built | Verified by |
|---|---|---|
| **Authentication** | Phone OTP for the apps: hashed and peppered codes, expiry, and caps on tries and sends. Email and password for staff (bcrypt), with two-factor (TOTP and recovery codes). 15-minute access tokens; rotating refresh tokens with reuse detection; a Redis deny-list. | `security.e2e` (OTP and token abuse), `accounts.e2e` (passwords, resets, two-factor), `app.e2e`, `token.service.spec`, `totp.rules.spec` |
| **Authorization** | Every person's data is scoped to them. Another person's ids answer 404. Partners and sellers see only their own bookings, orders and parcels. | `security.e2e` (IDOR, partners), every feature suite |
| **Database migrations** | 20 hand-written SQL migrations, applied with `prisma migrate deploy`. | CI drift check (the schema equals the migrated database), e2e runs on a fresh database |
| **Database indexes** | 159 indexes in the schema, including GiST (PostGIS) and trigram (search). The drift check fails if one is missing. | CI drift check, `load/RESULTS.md` |
| **Payment verification** | A payment is marked paid only after a server-side signature check or a signed webhook, never on the app's word. Amounts are checked. | `security.e2e` (payments), `contests.e2e` ("registers through a verified payment only"), `services.e2e`, `marketplace.e2e` |
| **Payment webhooks** | Signed and stored by event id. Handling is idempotent; a failed one is handled again when the gateway resends it. | `finance.e2e` ("a webhook whose handling failed last time is handled when the gateway sends it again"), runbook `payment-webhooks-stuck.md` |
| **Refunds** | Run through a ledger. Gateway outages are retried with backoff, and refunds can never add up to more than was paid. | `finance.e2e` (refund failures, the refund ceiling), `marketplace.e2e` (returns), `services.e2e` (cancellation policy) |
| **Contest calculations** | Contest fees, prizes, commissions, voting weights and tax rules are set in the admin dashboard. The ranking is frozen before winners are declared. | `contests.e2e` ("freezes the ranking, declares winners from it"), `contest.rules.spec` |
| **Voting security** | One vote per entry per day, plus a daily allowance. Counted under a database lock. No self-votes; phone verification and account age required. Risky votes are held for review. | `contests.e2e` ("holds back risky ones"), `security.e2e` (votes), `trust.e2e` |
| **Prize workflow** | A cash prize is approved with TDS withheld, paid out to the winner, and audited. | `finance.e2e` ("a cash prize is approved with TDS and paid to the winner"), `payouts.e2e` |
| **Partner payouts** | Bank-validated, encrypted payout accounts. Settlements, then payouts through RazorpayX; refused payouts go back on the balance. | `payouts.e2e`, `payout.provider.spec`, runbook `refunds-and-payouts.md` |
| **Product inventory** | Stock is reserved at checkout and never goes negative. Unpaid orders release it; cancellations restock. | `marketplace.e2e` ("three buyers race for the last two units: exactly one order succeeds") |
| **Booking conflicts** | Slots are held and confirmed in a transaction with retries. | `services.e2e` ("two customers racing for the same slot: exactly one wins", repeated three-way races) |
| **Notifications** | In-app notifications, push (FCM), and SMS and email through providers. Each kind has a setting; reminders go out once. | `notifications.e2e`, `insights.e2e` (reminders, promotions) |
| **File uploads** | Presigned per key, type and size, with content sniffing. Large videos go up in resumable multipart uploads; unfinished ones are aborted. | `security.e2e` (uploads), `social.e2e`, `accounts.e2e` (resumable) |
| **Video processing** | Worker steps: validate, scan, transcode (FFmpeg), thumbnails, several resolutions, HLS, then mark ready. "Your video is still being processed" is shown while it runs. | `social.e2e` (real FFmpeg in CI), `contests.e2e` (a processing reel can't be submitted yet) |
| **AI moderation** | Rules or Claude, behind `AiProvider`. User text is fenced; flags go to human review. | `trust.e2e`, `ai.provider.spec` |
| **Location search** | PostGIS distance search, the location database (states, cities, areas, PIN codes), delivery zones and service coverage. | `locations.e2e`, `services.e2e` (near me, home-visit radius: "This service is unavailable at this location") |
| **Maps** | `MapProvider` (`none`, `google`). Place search by PIN code, city, area or landmark, and named positions. Answers are cached, and an outage never stops PetApp's own answers. | `locations.e2e` (place search), `map.provider.spec`, `place_test.dart` and `check_place_mirrors.py` |
| **Search** | Global search across eight kinds, with filters. Wildcards are escaped and blocked people are hidden. | `locations.e2e` (global search), `security.e2e` (SQL injection) |
| **Reviews** | Verified purchases and completed bookings only. Photos, replies and moderation. | `reviews.e2e` |
| **Reporting** | Every kind of content can be reported, with screenshots. A reports dashboard handles the decisions. | `reviews.e2e`, dashboard browser tests |
| **Admin permissions** | RBAC: every admin endpoint checks a permission. Role changes apply at once; staff can't escalate their own permissions. | `security.e2e` (staff access), `permissions.guard.spec`, `docs/RBAC.md` |
| **Audit logs** | Append-only. Every financial and administrative action is recorded. | Asserted throughout the e2e suites (`auditLog.count`), dashboard **Audit log** |
| **Backup** | Nightly `pg_dump` to object storage with a heartbeat. Restore runbook. | CI "Backup and restore drill" (dump, restore into a scratch database, verify), runbook `restore-database.md` |
| **Monitoring** | Health and readiness checks, Prometheus metrics and alerts. Every alert has a runbook. | `observability.e2e`, CI "Every alert has a runbook", `docs/OBSERVABILITY.md` |
| **Logging** | Structured JSON logs with request ids; secret fields are redacted. Crash reports from the apps scrub personal data. | `observability.e2e`, `observability.spec` (redaction), the scrubbing mirror (7 cases, identical in all three apps) |
| **Rate limiting** | Per-IP limits in Redis, shared across instances. Stricter limits on sign-in, booking, registration, the assistant and place search. | `app.e2e`, `security.e2e`, `accounts.e2e` |
| **Security** | See `docs/SECURITY.md`. Helmet headers, CORS, body limits, encrypted secrets. Production refuses development providers. | `security.e2e`, `env.spec`, CI image scans (Trivy), `security.yml` (npm audit) |
| **Privacy** | Data export, account deletion with a grace period, consent records, retention jobs. Offline data is wiped at sign-out. | `privacy.e2e`, `docs/PRIVACY.md` |
| **Terms** | Versioned legal documents. Acceptance is required before contests and the shop, and recorded as evidence. | `privacy.e2e`, website browser tests |
| **CI/CD** | Every push runs the CI checks. Pushes to `main` deploy to staging, then to production after approval, with automatic rollback. | `.github/workflows/ci.yml`, `deploy.yml`, `docs/DEPLOYMENT.md` |
| **Docker** | Images for the API and worker, the dashboard, the website and ops, plus compose for development and deployment. | CI builds and scans every image |
| **Tests** | See section 3. | CI |
| **App builds** | Signed Android app bundles and iOS archives for all three apps, uploaded to Play internal testing and TestFlight. | `.github/workflows/mobile-release.yml`, `docs/STORE-RELEASE.md` |

## 2. Deliverables (spec §89)

| # | Deliverable | Where |
|---|---|---|
| 1 | Customer mobile application | `apps/customer-mobile` (Flutter) |
| 2 | Service Partner application | `apps/service-partner-mobile` |
| 3 | Product Partner application | `apps/product-partner-mobile` |
| 4 | Admin Dashboard | `apps/admin-dashboard` (Next.js 15) |
| 5 | Backend API | `apps/backend` (NestJS 11); 443 operations in `docs/API.md` |
| 6 | PostgreSQL database | Postgres 16 with PostGIS and pg_trgm (`docker-compose.yml`, `infrastructure/postgres-init.sql`) |
| 7 | Prisma schema | `prisma/schema.prisma` |
| 8 | Database migrations | `prisma/migrations` (20) |
| 9 | Seed scripts | `prisma/seed` (roles, admin, demo data, locations); the demo admin account (§82) |
| 10 | Redis configuration | `apps/backend/src/redis`, `queue`: cache, rate limits, token deny-list, BullMQ |
| 11 | Background workers | `apps/backend/src/worker` (media, notifications, refunds, payouts, reminders, retention); backups in the ops image (`infrastructure/Dockerfile.ops`) |
| 12 | Payment integration | `PaymentProvider` (Razorpay) |
| 13 | Notification integration | `PushProvider` (FCM), `SmsProvider` (SMSLocal), `EmailProvider` (SMTP) |
| 14 | Maps/location integration | `MapProvider` (Google), the location database, PostGIS |
| 15 | Object storage integration | `StorageService` (S3, R2, MinIO) |
| 16 | Video processing pipeline | Worker media jobs (FFmpeg, HLS) |
| 17 | AI integration architecture | `AiProvider`, `AssistantProvider` (Claude) |
| 18 | Contest engine | `modules/contests` and the admin contest builder |
| 19 | Voting engine | `modules/contests` (votes), `modules/trust` |
| 20 | Partner payout system | `modules/finance` (ledger, settlements, payouts, invoices) |
| 21 | Marketplace | `modules/marketplace` |
| 22 | Service booking system | `modules/services` |
| 23 | Authentication | `modules/auth` |
| 24 | RBAC | `modules/rbac`, `docs/RBAC.md` |
| 25 | Audit logs | `modules/audit` |
| 26 | API documentation | Swagger at `/api/docs` (when `SWAGGER_ENABLED`), `docs/openapi.json`, `docs/API.md` |
| 27 | Automated tests | Section 3 |
| 28 | Docker setup | `infrastructure/Dockerfile.*`, `docker-compose.yml`, `infrastructure/deploy/compose.yml` |
| 29 | CI/CD | `.github/workflows` |
| 30 | Production environment documentation | `.env.example`, `docs/DEPLOYMENT.md`, `docs/LAUNCH-CHECKLIST.md` |
| 31 | Privacy/security architecture | `docs/SECURITY.md`, `docs/PRIVACY.md` |
| 32 | Deployment documentation | `docs/DEPLOYMENT.md`, `docs/runbooks` (15), `docs/STORE-RELEASE.md` |

## 3. Test results at the final release

| Suite | Result |
|---|---|
| API unit tests | 251 pass |
| API end-to-end tests | 277 pass, 21 suites |
| Dashboard browser and unit tests | 38 and 24 pass |
| Website browser and unit tests | 13 and 13 pass |
| App ↔ API contract checks, all three apps | Pass |
| Python mirrors of the Dart tests | 13 sets pass |
| Lint, typecheck, bracket and name checks, schema drift, `npm audit` | Pass |

## 4. What this build can't prove by itself
These need real accounts, devices or people. They are tracked in `docs/LAUNCH-CHECKLIST.md`.
- **The Flutter apps weren't compiled in this workspace,** because no SDK is available. CI compiles, analyzes and tests all three apps (`flutter analyze`, `flutter test`) with Flutter 3.27.4. Run the same locally once before the first store build.
- **Live provider keys:** Razorpay and RazorpayX, SMSLocal with a DLT template, FCM, SMTP, Google Maps and Anthropic. Every provider is behind an interface and tested with recorded or simulated answers. The first live transaction of each kind should be checked by hand.
- **An independent penetration test,** on staging with production settings.
- **Store listings and signing keys** for Play and the App Store.
- **Legal review** of the terms, privacy policy and contest rules for India (including state gaming rules and GST and TDS treatment).
