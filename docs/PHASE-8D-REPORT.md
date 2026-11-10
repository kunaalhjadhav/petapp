# Phase 8d — Launch readiness: report

Phase 8d is the last phase. It doesn't add features. It makes PetApp safe to run in production:
- backups that are proven to restore
- measured capacity
- security scanning
- a deploy pipeline that rolls back on its own
- signed store builds with crash reporting
- a runbook for every alert
- a go-live checklist with a script that checks it

## 1. Implemented

### Backups and restore drill
- **`scripts/ops/backup.mjs`** (`npm run ops:backup`):
  - **One snapshot:** `pg_dump` and a manifest taken from the same database snapshot (`pg_export_snapshot`). The manifest records the row count of every table, the ledger totals and the applied migrations.
  - **Encryption:** optional AES-256-GCM before upload (`BACKUP_ENCRYPTION_KEY`), plus server-side encryption in the bucket.
  - **Where it goes:** to `BACKUP_BUCKET` under `postgres/YYYY/MM/DD/`, or a local folder with `--out`.
  - **Retention:** backups older than `BACKUP_KEEP_DAYS` (35) are deleted.
  - **Heartbeat:** `BACKUP_HEARTBEAT_URL` is pinged after each success, so a missed night alerts someone.
- **`scripts/ops/restore-drill.mjs`** (`npm run ops:restore-drill`):
  1. Checks the checksum and decrypts.
  2. Restores into a new scratch database.
  3. Checks every table's row count against the manifest.
  4. Checks the ledger totals, and that every ledger transaction balances.
  5. Checks the database rules that protect money and consent (append-only consent records, one published version per legal document, one verified payout account, one open payout per payee, PostGIS) and the migrations.
  6. Drops the scratch database.

  It fails if anything doesn't match or the drill takes over the 1-hour RTO, and `--report` writes a JSON record.
- **`infrastructure/Dockerfile.ops`:** the ops image, with Node 22, the PostgreSQL 16 client and the S3 SDK. It has a `backup` service in both compose files.
- **CI:** runs a backup and the drill on every change.

### Capacity
- **`load/petapp.js` (k6):**
  - **Two scenarios:** browsing while signed out, and members on the home screen, feed, shop and services.
  - **Thresholds:** set per endpoint.
  - **How to run it:** `load/README.md`.
  - **For staging:** `RATE_LIMIT_MULTIPLIER` raises the rate limits so a single load generator isn't throttled; production refuses it.
- **Measured:** see `load/RESULTS.md`, on one 2-vCPU machine running everything.

  | Load | Failed | Browse p95 | Member p95 |
  |---|---|---|---|
  | 84 requests a second | 0% | 20 ms | 53 ms |
  | 140 requests a second | 0% | 53 ms | 134 ms (`/home` 298 ms) |

  - **Saturation:** a single API process saturates at about 115–140 requests a second, CPU-bound in Node; Postgres stayed under 10%.
  - **Sizing:** plan on about 100 requests a second per API process.
- **Fixed from the profile:** product recommendations are now cached for two minutes per person (or per species when signed out). Prices and stock are still read fresh. The cache is cleared when someone hides a product, clears their history or changes personalisation.

### Security scanning
- **`.github/workflows/security.yml`** runs on every push and weekly:
  - `npm audit`: fails on a high advisory in shipped code, or a critical one anywhere
  - gitleaks over the whole git history
  - CodeQL (security-extended)
- **`.github/dependabot.yml`:** grouped update PRs for npm, the three Flutter apps, Docker and GitHub Actions.
- **Dependencies fixed:**
  - Prisma upgraded to 7.10.1.
  - Shipped dependencies pinned to fixed versions: multer, body-parser, lodash, js-yaml, postcss, sharp and qs.
  - Development tooling pinned: handlebars (critical), picomatch and tmp.
  - **Shipped dependencies now have no high or critical advisories.**
- **Secrets:** `.gitleaks.toml` reports no leaks. `.gitignore` now covers build output, browser-test sign-ins, backups and signing keys.

### Deploy pipeline
- **`.github/workflows/deploy.yml`:**
  1. After CI passes on `main`, it builds and pushes the API, migrate, website, ops and dashboard images to GitHub's registry, tagged with the commit.
  2. It deploys to staging and smoke-tests it.
  3. After approval of the `production` environment, it deploys to production and smoke-tests again.
- **`infrastructure/deploy/deploy.sh`:**
  1. pulls the images
  2. backs up first (production only)
  3. migrates
  4. starts the new version
  5. waits for `/ready`

  If the new version doesn't become ready, it starts the previous version again.
- **`scripts/ops/smoke.mjs`** (`npm run ops:smoke`) checks a running deployment:
  - health and readiness
  - public endpoints and the error format
  - that anonymous requests are refused
  - that metrics are private and the API docs are off in production
  - the website and its styles, robots rules for the environment, and the app-link files
  - the admin sign-in page
  - HTTPS with HSTS

### Store builds and crash reporting
- **`.github/workflows/mobile-release.yml`:** choose an app, a build number and the platforms.
  1. It checks the code.
  2. It generates the platform folders and applies PetApp's settings.
  3. It builds an obfuscated, signed App Bundle and IPA.
  4. It uploads to Play internal testing and TestFlight when those keys are set.
- **`scripts/mobile/configure_platforms.py`** applies, idempotently:
  - each app's permissions
  - Android App Links and iOS Associated Domains (customer app)
  - release signing from `key.properties`, for both Groovy and Kotlin Gradle files
  - iOS usage texts
  - cleartext traffic for debug builds only

  It has tests.
- **Crash reporting (Sentry or GlitchTip) in all three apps:**
  - **Switching it on:** with `--dart-define=SENTRY_DSN`; nothing is sent without it.
  - **What reports leave out:** no IP addresses, user details or screenshots. Tokens, emails and phone numbers are masked in messages and breadcrumbs.
  - **Tests:** a Dart test per app, mirrored in Python here.
- **`apps/web` `/account-deletion`:** the deletion page both stores ask for.
- **`docs/STORE-RELEASE.md`:** app IDs, signing, the listing checklist, the Play Data safety answers and the App Store privacy label.

### Runbooks and go-live
- **`docs/runbooks/`:** 15 runbooks.
  - **Alerts:** API, worker or database down; error rate; slow API; queue backlog; failing jobs; stuck payment webhooks; payment failures; refunds and payouts.
  - **Procedures:** rollback, restoring the database, rotating secrets, security incidents (with the CERT-In 6-hour and DPDP reporting duties), and sign-in problems.
  - **Linking:** every alert links to its runbook, and CI fails if one is missing (`npm run ops:check-runbooks`).
- **`docs/LAUNCH-CHECKLIST.md`:** what to check before the first production release, and how to check each line.
- **`scripts/ops/preflight.mjs`** (`npm run ops:preflight`):
  - **The production env file:** secrets, real providers, CDN media links, backups, monitoring, website and app-link settings.
  - **The live platform,** with an admin token:
    - every legal document is published
    - the company details for invoices are filled in
    - no test providers or failing dependencies, according to System health
  - **Result:** any FAIL blocks the launch.

### Docs
- **Updated:**
  - `DEPLOYMENT.md`: the pipeline, backups, the drill and rollback
  - `SECURITY.md`: scanning and accepted advisories
  - `OBSERVABILITY.md`: runbooks, the backup heartbeat and mobile crash reporting
  - `README.md`, the app READMEs and `.env.example`: the `BACKUP_*` settings and `RATE_LIMIT_MULTIPLIER`
  - `ROADMAP.md`: every phase delivered
- **Regenerated:** `docs/API.md` (334 operations).

## 2. Verification

| Check | Result |
|---|---|
| Lint and type check (API, dashboard, website, shared types) | Pass |
| API unit tests | 199 pass |
| API end-to-end tests (real Postgres, Redis, S3) | 197 pass, 16 suites |
| Dashboard browser tests (desktop and phone) | 25 pass |
| Website browser tests, including the account-deletion page | 11 pass |
| Dashboard and website unit tests | 19 and 11 pass |
| App ↔ API contract and bracket checks, all three apps | Pass |
| Python mirrors of the Dart tests (6 sets, including the crash-report masking) | Pass |
| `configure_platforms.py` tests | Pass |
| Backup, then restore drill | All checks pass; a wrong key and a tampered manifest are both caught |
| Smoke test against the local stack | 10 of 10 pass |
| Preflight | A dev env file fails, as it should. A complete production env file passes. Live checks correctly flag unpublished policies, missing company details and test providers |
| Alert rules (`promtool`), workflows (`actionlint`), runbook links | Pass |
| gitleaks | No leaks |
| `npm audit --omit=dev --audit-level=high` and `npm audit --audit-level=critical` | Pass |
| Load test | See above and `load/RESULTS.md` |

## 3. Problems found and fixed
- **Repeated work on the home screen:** product recommendations were re-ranked on every home-screen load. They're now cached.
- **Gaps in `.gitignore`:** build output (`.next`) and saved browser-test sign-ins weren't ignored, so they could have been committed.
- **Advisories:**
  - **Shipped code:** high advisories in multer, body-parser, lodash, js-yaml, postcss, sharp and qs, fixed by upgrades and overrides.
  - **Development tooling:** new advisories this week, including a critical in handlebars, fixed by overrides. The audit now has a second gate that fails on any critical advisory, development tooling included.
- **Sharp 0.35 typings:** the upgrade removed the `sharp.Metadata` type, so the media processor now derives its types from the function itself.
- **Release signing:** some Flutter templates write `signingConfig = signingConfigs.debug` and others leave out the `=`. The release-signing patch now handles both.
- **Runbook accuracy:** the runbooks were checked against the dashboard. Payments are recovered with **Recover payment** on the Reconciliation page. Staff passwords can't be reset or changed in the app.

## 4. Known limitations
- **No in-app chat between people (spec §37).** It wasn't built. The customer, partner and seller apps have no messaging; bookings and orders work without it.
- **Not run here:**
  - **Flutter:** the SDK couldn't be downloaded in this environment, so the Dart code is checked by the contract, bracket and mirror scripts. `flutter analyze` and `flutter test` run in CI.
  - **Store builds, store uploads and app links on real phones:** these need your signing keys, store accounts and a real domain.
- **Staff passwords can't be changed or reset in the app.** There's no change-password screen and no reset-by-email flow. A lost staff password needs an engineer to set a new hash in the database. The first admin's password comes from `SEED_ADMIN_PASSWORD`. Customers aren't affected, because they sign in with their phone number.
- **Accepted advisories:**
  - **Shipped code:** 7 moderate advisories, all in NestJS 10's own dependencies, which need a NestJS 11 upgrade.
  - **Development tooling:** high advisories in `braces` (no fix released yet), and in `glob` and `picomatch`, which the Nest 10 CLI pins exactly.
  - **Details:** see `docs/SECURITY.md`.
- **Load numbers are a floor:** they come from one small machine running everything. Re-run the load test on staging before launch, at your expected peak times two.
- **Restoring a backup is a separate job from the managed database's point-in-time recovery.** The nightly dumps are the second line of defence. Switch on point-in-time recovery in your database service.

## 5. Next
All phases are delivered.

**Before going live,** work through `docs/LAUNCH-CHECKLIST.md`. The items only you can do:
- have a lawyer review the policies, then publish them
- enter the company details used on invoices
- set up the live Razorpay, RazorpayX and SMSLocal (with DLT) accounts
- set up the store accounts and signing keys
- set the domain for app links
- arrange on-call
