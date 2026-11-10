# Deployment, operations and recovery

## Environments

| | Development | Staging | Production |
|---|---|---|---|
| Config | `.env` | secret manager | secret manager |
| SMS | `console` allowed | `smslocal` (required) | `smslocal` (required) |
| Swagger | on | on (`SWAGGER_ENABLED=true`) | off |
| Demo seed | allowed | allowed | refused |
| Deploy | local | automatic after CI on `main` | manual approval (GitHub environment) |

The API refuses to start with invalid configuration: short secrets, identical JWT secrets, the console SMS provider on staging or production, or missing SMSLocal credentials.

## Release procedure

Releases go through `.github/workflows/deploy.yml`:
1. **Build:** after CI passes on `main` (or on a manual run), it builds the images and pushes them to GitHub's container registry, tagged with the commit: API, migrate, website, ops, and the dashboard for staging and for production.
2. **Staging:** it deploys to staging and runs the smoke test (`scripts/ops/smoke.mjs`).
3. **Production:** after someone approves the `production` environment, it deploys there and runs the smoke test again.

**On each server,** `infrastructure/deploy/deploy.sh <tag> <env>` does the following, using `infrastructure/deploy/compose.yml`:
1. pulls the images
2. on production, takes a backup
3. runs the migrations
4. starts the new version
5. waits for `/ready`; if the new version doesn't become ready, it starts the previous tag again (kept in `.deployed-tag`) and fails the deploy

**One-time server setup:**
- Docker with Compose v2, the env files the compose file names, and `docker login ghcr.io`.
- The GitHub secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and `DEPLOY_PATH` in each environment.

**Load balancer:**
- With more than one API server, put them behind a load balancer and roll one at a time.
- Liveness: `GET /health`.
- Readiness: `GET /ready`, which returns 503 until Postgres and Redis respond.

**WebSockets (chat):** the load balancer must pass `Upgrade` requests through on `/api/v1/chat/ws`, with an idle timeout above 60 seconds (the server pings every 25). No sticky sessions are needed: events reach every API instance through Redis.

**Rolling back by hand:** run the workflow with an older tag, or `./deploy.sh <old tag> production` on the server. See [runbooks/rollback.md](runbooks/rollback.md).

Before the first launch, work through [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md).

Migrations must be backward-compatible with the previous release (expand, then contract), so a rollback never needs a down-migration.

## Managed database and Redis over TLS

Managed PostgreSQL (DigitalOcean, AWS RDS, Azure, Aiven…) signs its TLS certificate with the provider's own CA. The Node driver treats `sslmode=require` as full verification against public CAs, so without the CA it refuses to connect ("self-signed certificate in certificate chain").
- Download the provider's CA certificate and set `DATABASE_CA_CERT` (PEM, or base64 of the file). Keep `?sslmode=require` in `DATABASE_URL`.
- The API, the worker, the seed, backups (`pg_dump`) and the restore drill then verify the server against it, hostname included.
- `REDIS_CA_CERT` does the same for a managed Redis or Valkey on `rediss://`.
- **If the `migrate` job refuses the certificate:** Prisma Migrate uses the URL's `sslmode=require`. Add `&sslaccept=accept_invalid_certs` to `DATABASE_URL`. The API, the worker and backups drop that parameter and still verify against `DATABASE_CA_CERT`.

The step-by-step first deployment is in [GO-LIVE.md](GO-LIVE.md).

## Secrets

Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Store them in AWS Secrets Manager, GCP Secret Manager or Doppler, never in the repo or the image.

| Secret | If you rotate it |
|---|---|
| `JWT_ACCESS_SECRET` | Access tokens become invalid; users refresh silently |
| `JWT_REFRESH_SECRET` | Everyone signs in again |
| `OTP_PEPPER` | Only affects codes in flight (5 minutes) |

## Backups and disaster recovery

| Asset | Mechanism | Target |
|---|---|---|
| PostgreSQL | Managed service with automated daily snapshots + point-in-time recovery (WAL), retained 14–35 days; weekly logical dump to another region | **RPO ≤ 5 min**, **RTO ≤ 1 h** |
| Object storage (Phase 2) | Versioning + a lifecycle rule, cross-region replication for media | RPO ≤ 15 min |
| Redis | Cache, rate limits and queues only; AOF on. Losing it loses in-flight jobs, which are retried from Postgres state | Rebuilt, not restored |

**Nightly logical backups** (`scripts/ops/backup.mjs`, in the `ops` image):
- **What's in a backup:** a `pg_dump` of one consistent snapshot, and a manifest of the row count of every table, the ledger totals and the applied migrations, all taken from that same snapshot.
- **Encryption:** with `BACKUP_ENCRYPTION_KEY`, the file is encrypted (AES-256-GCM) before it leaves the server. Uploads also use server-side encryption.
- **Where it goes:** to `BACKUP_BUCKET` under `postgres/YYYY/MM/DD/`. Backups older than `BACKUP_KEEP_DAYS` (35) are deleted.
- **Heartbeat:** `BACKUP_HEARTBEAT_URL` is pinged after each success.
- **How to run it:** on the server, `docker compose -f infrastructure/deploy/compose.yml --profile jobs run --rm backup`, from cron at 01:30 India time. Locally: `npm run ops:backup -- --out backups`.

**Restore drill (quarterly, and after big schema changes):** `npm run ops:restore-drill` takes the latest backup and:
1. checks its checksum and decrypts it
2. restores it into a new scratch database
3. checks every table's row count against the manifest
4. checks the ledger totals, and that every ledger transaction balances
5. checks the database rules that protect money and consent: the append-only and one-published rules, one verified payout account, one open payout, and PostGIS
6. checks the applied migrations, then drops the scratch database

It fails if the drill takes longer than the 1-hour RTO.
- **Where it restores:** set `RESTORE_ADMIN_URL` to a separate restore server, never the live primary.
- **Record:** keep the JSON report (`--report`) as the drill record.
- **CI:** the CI pipeline runs a backup and the drill on every change.

**A real restore:** see [runbooks/restore-database.md](runbooks/restore-database.md).

## Observability

See [OBSERVABILITY.md](OBSERVABILITY.md): JSON logs with request ids, error tracking (`ERROR_TRACKER=sentry`), Prometheus metrics on the API (`/metrics`) and worker (`:9464/metrics`), alert rules in `infrastructure/monitoring/alerts.yml`, and the dashboard's **System health** page.

## Payments, refunds and reconciliation

- **Webhook:** in the Razorpay dashboard, point a webhook at `https://<api>/api/v1/webhooks/payments` with the events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed` and `refund.failed`. Its secret is `RAZORPAY_WEBHOOK_SECRET`.
- **The worker must run.** It sends owed refunds every 30 seconds and reconciles nightly at 02:30 India time. If it's down, refunds wait (nothing is lost) and the dashboard shows them as pending.
- **Upgrading to Phase 6a:** after the migration, run a reconciliation once (dashboard → Finance, or `POST /api/v1/admin/finance/reconciliation/run`).
  - It posts ledger entries for all existing payments, deliveries, bookings and refunds.
  - Earnings are posted at the tax rates and PANs on file at that moment.
- **Ledger safety:**
  - Ledger rows can't be updated or deleted; the database refuses.
  - `TRUNCATE` is not blocked by those row triggers. In production, the application's database user should not own the tables or hold `TRUNCATE` (test suites use it to reset).
- **Tax rates** (`finance.tcsBps`, `finance.tdsBps`, `finance.tdsNoPanBps`, `finance.gstOnFeesBps`) are settings. Confirm them with your tax adviser before going live, and when rules change.

## Payouts and invoices (Phase 6b)

- **RazorpayX:** set `PAYOUT_PROVIDER=razorpayx`, `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER` (the current account payouts leave from) and `RAZORPAYX_WEBHOOK_SECRET`. The fake provider is refused in staging and production.
- **Webhook:** point a RazorpayX webhook at `https://<api>/api/v1/webhooks/payouts` with the `payout.*` and `fund_account.validation.*` events.
- **`PAYOUT_DATA_KEY`:** 32 random bytes, base64. Required in staging/production; it encrypts bank account numbers. Keep it in the secret manager and back it up. **Losing it makes stored account numbers unreadable**, and payees would have to add their accounts again. To generate one in PowerShell 7: `[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`.
- **Before issuing commission invoices:** set `company.legalName`, `company.gstin`, `company.pan`, `company.address`, `company.state` and `invoice.commissionSac` in Settings. Confirm the SAC code and the GST rate on entry fees (`finance.gstOnEntryFeesBps`) with your tax adviser.
- **Payout batches** need two finance staff: one prepares, another approves. Give at least two people the Finance role.
- **Privacy jobs (worker, India time):** expired data downloads are deleted at 04:50, and accounts past their deletion grace period are erased at 05:00 (see `docs/PRIVACY.md`). Data exports are stored privately under `exports/` in the media bucket. Keep that prefix private (no CDN or public access).
- **The worker** also sends payouts every 30 seconds, rechecks pending bank validations, and books gateway settlements nightly at 02:00 India time, before the 02:30 reconciliation.


## Public website and app links (Phase 8c)
- **Run the website** (`infrastructure/Dockerfile.web`) as its own service on your main domain (e.g. `https://petapp.in`), next to the API and the dashboard.
- **Set its environment:**
  - `SITE_URL` and `API_URL` (the API's internal address).
  - `SITE_INDEXABLE=true` on production only.
  - The store links.
  - The app-link keys: `ANDROID_PACKAGE_NAME`, `ANDROID_SHA256_FINGERPRINTS`, `IOS_APP_ID`.
- **Check the app-link files** after each deploy: `https://<domain>/.well-known/assetlinks.json` and `https://<domain>/.well-known/apple-app-site-association` must answer `200` with JSON, over HTTPS, without redirects. Android and iOS refuse app links otherwise.
- **Build the customer app** with `--dart-define=SHARE_BASE_URL=https://<domain>` and the same domain in its manifest and Associated Domains (see `apps/customer-mobile/README.md`).
- **Submit the sitemap** (`https://<domain>/sitemap.xml`) in Google Search Console once the site is live.
- **Photo links:** set the API's `MEDIA_PUBLIC_BASE_URL` to the CDN, so share previews keep their photos.
