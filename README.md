# PetApp

A pet ecosystem platform: pet profiles, social reels, paid contests, a services marketplace, a product marketplace, partner apps and an admin dashboard. It is built in phases (see `docs/ROADMAP.md`).

**This release covers Phases 1–8d and 9a–9e:** foundation and admin dashboard (1, 1b); social core, notifications and moderation, and the customer app (2a–2c, see `apps/customer-mobile/README.md`); contests with payments, contest screens, and challenges with badges (3a–3c); and the services marketplace — API, screens and the partner app (4a–4c, see `apps/service-partner-mobile/README.md`); and the product marketplace — API, screens and the seller app (5a–5c, see `apps/product-partner-mobile/README.md`); and finance — ledger, refunds, reconciliation and tax reports (6a), payouts, prizes, settlements and invoices (6b), the finance screens in the dashboard (6c), and money in the apps — payouts, statements, invoices, refunds and prize money (6d), AI moderation assist with account fraud-risk scoring (7a), recommendations with an admin-arranged home screen (7b), the PetApp Assistant (7c), observability with a security test suite (8a), privacy and legal — data export, account deletion, consents and legal documents (8b), the public website with SEO and app links (8c), and launch readiness — deploys, backups, load tests, security scans, store builds, crash reporting and runbooks (8d).** Phase 9a adds chat between customers and partners or sellers, and the support center (spec §37 and §58). Phase 9b adds product reviews from verified purchases, photos and replies on reviews, and reporting for every kind of content with a reports dashboard (spec §38 and §59). Phase 9c adds global search, pet discovery and the location database with delivery zones and service coverage (spec §43–45 and §62). Phase 9d adds admin analytics, membership plans (off by default), reminders and opt-in promotions (spec §55, §40 and §36). Phase 9e adds staff password change and reset by email, and resumable video uploads (spec §84). Phase 10 hardens it: two-factor sign-in for staff (10a), and offline handling and friendly errors in the apps (10b, spec §84–85). The final release adds the map provider with place search (spec §19) and checks the whole spec off in `docs/FINAL-VERIFICATION.md`. It includes the backend API and media worker, database, auth, roles and permissions, users, pets, posts and reels, feeds, moderation, the staff dashboard, tests, Docker and CI.

## Requirements

- Node.js 22 (20 works too) and npm 10
- Docker Desktop, to run PostgreSQL and Redis locally. You can use your own Postgres 16 and Redis 7 instead.

## Quick start — Windows (PowerShell)

```powershell
# 1. Unzip, then open PowerShell in the project folder
cd D:\PetApp\petapp

# 2. Start PostgreSQL, Redis and MinIO (object storage) — the API runs locally for fast reloads
docker compose up -d postgres redis minio minio-init

# 3. Create your .env from the template
Copy-Item .env.example .env
# Generate three secrets and paste them into .env
#   (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, OTP_PEPPER):
1..3 | ForEach-Object { node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" }
# In .env also set:
#   SEED_ADMIN_EMAIL=you@yourdomain.com
#   SEED_ADMIN_PASSWORD=<12+ characters>
#   SEED_DEMO_DATA=true

# 4. Install. This also generates the Prisma client and builds the shared types.
npm install

# 5. Check the committed migrations match the schema (should print nothing and exit 0)
npm run db:check-drift

# 6. Create the tables, then seed roles, species, flags, the first admin and demo data
npm run db:deploy
npm run db:seed

# 7. Run the API with hot reload
npm run dev

# 8. In another window, run the media worker (needs FFmpeg on PATH: winget install Gyan.FFmpeg)
npm run worker
```

Then open:

- http://localhost:4000/api/docs — interactive API docs. Use **Authorize** to paste a token.
- http://localhost:4000/ready — should report the database and Redis as `ok`.

### Try it

With `SMS_PROVIDER=console`, the OTP is printed in the API terminal as `[DEV SMS → +91******0001] 123456 is your PetApp…`.

```powershell
$api = "http://localhost:4000/api/v1"
Invoke-RestMethod -Method Post "$api/auth/otp/request" -ContentType "application/json" -Body '{"phone":"9000000001"}'
# read the code from the API terminal, then:
$r = Invoke-RestMethod -Method Post "$api/auth/otp/verify" -ContentType "application/json" -Body '{"phone":"9000000001","code":"123456"}'
$h = @{ Authorization = "Bearer $($r.data.tokens.accessToken)" }
Invoke-RestMethod "$api/pets/mine" -Headers $h          # demo user Aanya's pets: Bruno, Mishti, Kiwi
Invoke-RestMethod "$api/pets/bruno.demo"                 # public view, no private fields
```

### Admin dashboard

Open a second PowerShell window in the project folder:

```powershell
Copy-Item apps\admin-dashboard\.env.example apps\admin-dashboard\.env.local
npm run dev:admin
```

Then open http://localhost:3000 and sign in with your `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`.

The dashboard calls the API from its own server, so `BACKEND_URL` in `.env.local` must point to the API (`http://localhost:4000` locally). Staff only see the menu items and buttons their role allows.

Admin sign-in is limited to 5 attempts a minute. Waiting a minute clears the limit.

#### Finance screens

Staff with the **Finance** role (or a super admin) see a **Finance** menu: money overview, refunds, reconciliation, payouts, payout accounts, prizes, settlements, invoices, tax report and the ledger. Viewing needs `finance.read`; buttons that move or record money need `finance.manage`.

A payout batch must be approved by a different person from the one who prepared it. To try this locally, give a second staff account the Finance role on the **People** page.

If you are upgrading from an earlier phase, run the seed once more so the Finance role exists (it is idempotent and leaves your data alone):

```powershell
npm run db:seed
```

### Everything in Docker

```powershell
docker compose up --build
```

This starts Postgres, Redis, a one-shot `migrate` job, the API on port 4000 and the admin dashboard on port 3000. Seed from your host afterwards with `npm run db:seed`.

## macOS / Linux

The steps are the same. Use `cp .env.example .env`, and generate secrets with `node -e "…"` three times.

## Scripts (run from the repo root)

| Command | What it does |
|---|---|
| `npm run dev` | API with hot reload |
| `npm run dev:admin` | Admin dashboard with hot reload (http://localhost:3000) |
| `npm run build` | Build shared types, the API and the dashboard |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript strict |
| `npm test` | Unit tests: API (48) and dashboard helpers (5) |
| `npm run test:e2e` | API end-to-end tests (28) against **`DATABASE_URL_TEST`** + Redis DB 15. The test database is reset first and must have "test" in its name. |
| `npm run test:e2e -w @petapp/admin-dashboard` | Browser tests (9) against the running dashboard and API with demo data. Run `npx playwright install chromium` once first, and set `E2E_ADMIN_PASSWORD`. The tests restore what they change, so you can run them repeatedly. |
| `npm run db:migrate` | Create a new migration while developing (needs `SHADOW_DATABASE_URL`) |
| `npm run db:deploy` | Apply migrations (staging and production too) |
| `npm run db:seed` | Idempotent seed |
| `npm run db:check-drift` | Fails if the migrations and `schema.prisma` differ |
| `npm run db:studio` | Prisma Studio |
| `npm run ops:backup -- --out backups` | Back up the database (to the backup bucket without `--out`) |
| `npm run ops:restore-drill -- --manifest <file>` | Restore a backup into a scratch database and verify it (the latest in the bucket without `--manifest`) |
| `npm run ops:smoke` | Smoke-test a running deployment (local by default; `--api`, `--web`, `--admin`, `--env` for others) |
| `npm run ops:preflight -- --env-file prod.env` | Is a production configuration ready to launch? |
| `npm run load:test` | Load test with k6 (see `load/README.md`; staging only) |

## Email (staff passwords)

Set `EMAIL_PROVIDER=smtp` with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM`. Any SMTP service works (Amazon SES, SendGrid, Mailgun, Zoho, Google Workspace). Set `DASHBOARD_URL` to the dashboard's https address: password-reset links point there. Without email (`EMAIL_PROVIDER=none`), staff can still change their password when signed in, but "Forgot password" says to ask an administrator. In development, `EMAIL_PROVIDER=console` prints emails, links included, in the API log.

## Maps (place search)

The customer app's place picker searches PIN codes, cities and areas in PetApp's own location database first (**Locations** in the dashboard). Set `MAP_PROVIDER=google` with `GOOGLE_MAPS_KEY` (a Google Cloud key with only the Geocoding API enabled, restricted to the API servers' IP addresses) to also find streets, landmarks and areas the database doesn't have yet, and to name the area at someone's position ("Near Bandra West"). Answers are cached for a day. With `MAP_PROVIDER=none` (the default) nothing leaves PetApp, and search still works from the database.

## SMS (SMSLocal)

Set `SMS_PROVIDER=smslocal` and fill in `SMSLOCAL_API_URL`, `SMSLOCAL_API_KEY` and `SMSLOCAL_SENDER_ID`.

- **DLT:** once your template is approved, set `SMSLOCAL_DLT_TEMPLATE_ID` (and `SMSLOCAL_DLT_ENTITY_ID` if required). Change `OTP_MESSAGE_TEMPLATE` to match the approved text exactly.
- **Request format:** the provider sends SMSLocal's published JSON shape (`api_key`, `sender`, `message`, `recipient`). Confirm the endpoint and field names against your SMSLocal dashboard's API page. If they differ, the only file to change is `apps/backend/src/providers/sms/smslocal.provider.ts`.
- Until DLT is active, keep `SMS_PROVIDER=console` for development.

## AI moderation

New posts, comments, pet profiles, names, product listings, service reviews and contest entries are checked in the background. A confident result opens a case in **Moderation**; a moderator always decides. Every check is kept with its result, confidence, reason, model and version (**AI moderation** page).

- **Without a key** (the default, `AI_PROVIDER=rules`): PetApp's built-in rules catch obvious spam, scams, abuse and cruelty wording, and copied photos. No network, no cost.
- **With Claude:** set these on the API and the worker, then restart both:

```powershell
# in .env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
AI_MODERATION_MODEL=claude-haiku-5-5
```

Photos are sent to the model as short-lived links to a resized copy, so the storage URLs must be reachable from the internet (a CDN or S3 in staging/production; not a local MinIO).

**Account risk** scores accounts from signals (new accounts voting in bursts, many accounts on one network, copied photos, payment problems). High-risk accounts are listed for staff review and their contest votes are held until someone looks. Nobody is blocked or banned automatically.

After upgrading, run `npm run db:seed` once so the new settings appear with their descriptions.

## Home screen and recommendations

The customer app's **Home** tab shows sections that admins arrange in the dashboard (**Configuration → Home screen**): featured reels, trending pets, contests, challenges, nearby services, recommended products, partner offers and "coming up". Admins can reorder, rename, switch off, schedule, limit to cities or to owners of some species, and pin items to the front. **Preview** shows what someone in a chosen city sees, and why any section is left out.

Each section fills itself for the person looking, and every pick says why ("For Bruno", "1.2 km away", "You bought dog food before"):

- **Products:** their pets' species and age, past purchases (categories and brands), what they look at, and what sells.
- **Services:** distance, rating, their pets, past bookings and what they look at.
- **Contests:** ones their pets can still enter, past entries, closing soon, free entry.
- **Reels** (also the Reels tab): trending, lifted by who they follow, their pets' species, and hashtags and creators they like.

People can long-press an item for **Not interested**, and turn personalisation off or clear their viewing history in **Settings**. Admins can switch personalisation off for everyone and set how long viewing history is kept (90 days by default; older views are deleted nightly). No new environment variables are needed.

## PetApp Assistant

An in-app assistant (the ✨ button on Home) that finds nearby services, products, contests and challenges, explains a contest's rules, shows your bookings, explains how to do things in the app, and gives general pet-care tips, with results shown as cards that open the right screen. Switch it on with the **ENABLE_AI_ASSISTANT** feature (Features & settings).

- **Without a key** (`AI_PROVIDER=rules`): built-in answers that understand common questions by keywords. Free, and the fallback if the model is down.
- **With Claude** (`AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`): Claude answers, looking things up through the app's own data (it can't make up services or prices). Model: `AI_ASSISTANT_MODEL` (default `claude-sonnet-5-5`).
- **Vet guardrails, enforced by the server:** emergencies (poisoning, breathing trouble, seizures, collapse…) always get a fixed "contact a vet now" answer with nearby vets; it never gives medicine doses; health answers are marked "general information, not a diagnosis".
- **Limits and privacy:** questions per person per day (40) and how long chats are kept (30 days) are set on the dashboard's **PetApp Assistant** page. People can delete their chats. Staff only see answers people chose to rate.

## Monitoring and security

- **Health:** `/health` and `/ready` on the API, and `:9464/health` on the worker.
- **Logs:** JSON lines with a request id on every line.
- **Errors:** set `ERROR_TRACKER=sentry` and `SENTRY_DSN`.
- **Metrics:** Prometheus at `/metrics` on the API and `:9464/metrics` on the worker, with `METRICS_TOKEN`. Alert rules are in `infrastructure/monitoring/`.
- **Dashboard:** **Configuration → System health** shows dependencies, connected services, money needing attention and background-job failures.

See `docs/OBSERVABILITY.md`. Security controls and the tests that cover each one are listed in `docs/SECURITY.md`.

## Privacy and legal

- **Legal documents** (**Configuration → Legal documents**): eight drafts are seeded from templates.
  - **Before launch:** have a lawyer review them, fill in every `{{placeholder}}`, and publish.
  - **Acceptance:** people accept the Terms and Privacy Policy in the app. Partners, sellers and contest entrants accept their terms before applying or entering.
- **People's data:**
  - **Settings → Your data and privacy** in the customer app: download a copy of your data, turn offers and news on or off, read the policies, delete your account.
  - **Deleting an account:** it is erased after a 14-day grace period; signing in before then cancels it. Records that tax law requires are kept without the profile.
- **Staff:** **Community → Privacy requests** shows deletions waiting, held back (with why) and erased, with **Erase now** and **Cancel deletion**.

See `docs/PRIVACY.md`.

## Public website and app links

- **`apps/web`** is the public website: pages for pets, reels, contests, challenges, products, service partners and the policies.
  - **Search:** each page has search metadata, link previews (Open Graph) and structured data, plus `sitemap.xml` and `robots.txt`.
  - **Privacy:** nothing private or about people is shown or listed.
- **App links:** `petapp://pet/{handle}` (and reel, contest, challenge, product, service, booking) open the customer app, and so do the website's `https` links once the app-link settings are filled in. The app's share buttons share website links.
- **Search engines** may index the site only where `SITE_INDEXABLE=true`, so staging stays out of search results.

See `apps/web/README.md`.

## Chat and support (Phase 9a)

- **Chat:** customers message service partners (from their page or a booking) and sellers (from a product or an order). Text, private photos, and booking, product or order cards. Delivered live over a WebSocket, with push when the app is closed. Report and block from the conversation. Switch on **ENABLE_CHAT** in Features & settings.
- **Privacy:** staff can't read private chats; a moderator sees a message only when it's reported or flagged.
- **Support center:** **Support → Tickets** in the dashboard: a queue with priority, topic, assignment and six statuses, replies, notes only staff see, and **Message** on a person's page to start a conversation. **Help center** and **Topics** hold the FAQs people see in the apps and at `/help` on the website. Draft FAQs are seeded unpublished: check and publish them.
- **Push in the partner and seller apps:** pass the same Firebase `--dart-define`s as the customer app.
- **Behind a load balancer:** it must pass WebSocket upgrades on `/api/v1/chat/ws` (see `docs/DEPLOYMENT.md`).

## Reviews and reporting (Phase 9b)

- **Reviews:** people review a product once it's delivered to them (shown as "Verified purchase") and a service once the visit is completed ("Verified booking"): 1–5 stars, words and up to 4 photos. Products, sellers and partners show the average and a star breakdown, in the apps and on the website (with review structured data).
- **Replies:** sellers and partners see their reviews in their app (**Reviews**, with the ones still to answer first) and reply once, publicly. The reviewer gets a notification.
- **Reporting:** people can report a person, pet, post, reel, comment, product, business, review, contest entry or chat message, with up to 3 private screenshots.
- **Dashboard:** **Community → Reports** lists every report with its type, reason, reporter, what was reported, screenshots, status, moderator and outcome; decisions are made on the case. **Community → Reviews** lists product and service reviews, and hiding one takes it out of the rating at once.

## Search, discovery and locations (Phase 9c)

- **Search:** one search for pets, people, reels (#hashtags), products, services, businesses, contests and challenges, with filters that fit each kind (animal, category, home visits, near me, in stock, open or finished).
- **Discover pets:** trending pets, pets near you (owners opt in per pet; distances are rounded), popular reels, and pets in open contests and challenges.
- **Locations:** India's states and 32 major cities are seeded. **Locations** in the dashboard manages cities, areas and PIN codes (with CSV import), **Delivery zones** (shipping and delivery time by PIN code, city or state, used at checkout), **Service coverage** (the cities where services are live) and **Partner locations**.
- **In the app:** addresses fill in from a PIN code, checkout shows the delivery time before paying, and services say when PetApp isn't in an area yet.

## Analytics, memberships and reminders (Phase 9d)

- **Analytics** (**Workspace → Analytics**): users (daily and monthly active, sign-ups, day-1/7/30 retention), reels (views, watched to the end, likes, comments, shares, saves, engagement), contests (registrations, entry fees, votes, winners), the shop (orders, GMV, average order value, returns) and services (bookings, value, cancellations, partner performance), for any dates, compared with the period before, with a CSV download.
- **Memberships** (**Growth → Membership plans, Members**): Free, Plus and Premium are seeded; prices, lengths and benefits are editable. Benefits: members-only contests, premium challenges, member coupons, booking further ahead, and a member badge. Off until **ENABLE_MEMBERSHIPS** is on, and nothing is members-only until an admin marks it.
- **Reminders:** before a booked visit, before contest submissions or voting close, and before a membership ends. Entrants also hear about new votes, at most once an hour.
- **Promotions** (**Growth → Promotions**): offers and announcements as notifications, only to people who opted in, by audience (everyone, members, or a city), now or scheduled.

## Staff passwords and resumable uploads (Phase 9e)

- **Passwords:** staff change their password under **Your account** (top right); the dashboard reminds anyone still using the password they were given. **Forgot your password?** on the sign-in page emails a link (needs `EMAIL_PROVIDER=smtp`, see *Email* above). Admins can send a staff member a link from their page under **People**.
- **Resumable uploads:** the app sends videos larger than `media.resumableAboveMb` (16 MB) in parts of `media.uploadPartMb` (8 MB). A dropped connection re-sends only the part it was on; if the connection stays down, **Retry** carries on where it stopped.

## Hardening (Phase 10)

- **Two-factor sign-in for staff:** under **Your account → Two-factor sign-in**, scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), type a code, and keep the ten recovery codes. Sign-in then asks for a code after the password. A lost phone: sign in with a recovery code, or ask an admin to reset it (**People** → the person → **Reset two-factor**). Set `MFA_DATA_KEY` in staging and production. To require it for everyone, turn on `security.requireStaffMfa` in **Settings**.
- **Offline in the apps:** all three apps show saved copies of key screens when there's no connection (with a "You're offline" notice) and retry reads after a dropped connection. The customer app also confirms a payment later if the gateway took it while PetApp couldn't be reached. All three apps show friendly messages instead of server errors (spec §85: "Payment verification is pending", "Registration is currently closed", "This service is unavailable at this location", "Your video is still being processed").

## Launch and operations

**First deployment:** follow [docs/GO-LIVE.md](docs/GO-LIVE.md). To try everything online for free first, use [docs/RENDER.md](docs/RENDER.md) (Render's free plan, demo mode).

- **Deploys:** pushing to `main` deploys to staging after CI, then to production once someone approves (`.github/workflows/deploy.yml`). A failed health check rolls back automatically.
- **Backups:** nightly encrypted database backups, and a restore drill that proves a backup is complete. CI runs both.
- **Security scans:** dependency, secret and code scanning run on every push and weekly. Dependabot keeps dependencies current.
- **Store builds:** the **mobile release** workflow builds signed Android and iOS releases of each app and uploads them to Play internal testing and TestFlight. See `docs/STORE-RELEASE.md`.
- **Crash reporting:** the apps report crashes to Sentry when built with `SENTRY_DSN`. Personal details are masked.
- **On-call:** each alert links to its runbook in `docs/runbooks/`.
- **Load test results:** in `load/RESULTS.md`.
- **Before going live:** work through **`docs/LAUNCH-CHECKLIST.md`**.

## Project layout

```
apps/backend        NestJS API
apps/admin-dashboard  Next.js staff dashboard
apps/web            Next.js public website (SEO pages, app links)
apps/customer-mobile  Flutter customer app (Android + iOS)
apps/service-partner-mobile  Flutter app for service partners (Android + iOS)
apps/product-partner-mobile  Flutter app for product sellers (Android + iOS)
packages/types      shared role/permission/flag keys and response types
prisma/             schema, migrations, seed
infrastructure/     Dockerfiles (API, dashboard, website, ops), deploy compose + script, monitoring rules
scripts/ops         backup, restore drill, smoke test, preflight, runbook check
scripts/mobile      store-build platform configuration
load/               k6 load test and results
docs/               architecture, ERD, roles & permissions, API, roadmap, deployment, phase reports
.github/workflows   CI (lint, types, drift, unit, e2e, build, image scan) and deploy (staging → approval → production)
```

## Docs

- `docs/RENDER.md`: host the whole system free on Render as a demo (one-click Blueprint, `render.yaml`)
- `docs/GO-LIVE.md`: step by step from the zip to a live site (GitHub, a server, a managed database, HTTPS, backups)
- `docs/FINAL-VERIFICATION.md`: the spec's production checklist (§86) and deliverables (§89), item by item, with the tests that prove each
- `docs/ARCHITECTURE.md`
- `docs/ERD.md` (all phases)
- `docs/RBAC.md`
- `docs/API.md` and `docs/openapi.json`
- `docs/ROADMAP.md`
- `docs/DEPLOYMENT.md` (deploys, backups, restore drill, RPO/RTO)
- `docs/LAUNCH-CHECKLIST.md`
- `docs/STORE-RELEASE.md`
- `docs/runbooks/`
- `docs/SECURITY.md`, `docs/OBSERVABILITY.md`, `docs/PRIVACY.md`
- `docs/PHASE-1-REPORT.md`, `docs/PHASE-1B-REPORT.md`, `docs/PHASE-2A-REPORT.md`, `docs/PHASE-2B-REPORT.md`, `docs/PHASE-2C-REPORT.md`, `docs/PHASE-3A-REPORT.md`, `docs/PHASE-3B-REPORT.md`, `docs/PHASE-3C-REPORT.md`, `docs/PHASE-4A-REPORT.md`, `docs/PHASE-4B-REPORT.md`, `docs/PHASE-4C-REPORT.md`, `docs/PHASE-5A-REPORT.md`, `docs/PHASE-5B-REPORT.md`, `docs/PHASE-5C-REPORT.md`, `docs/PHASE-6A-REPORT.md`, `docs/PHASE-6B-REPORT.md`, `docs/PHASE-6C-REPORT.md`, `docs/PHASE-6D-REPORT.md`, `docs/PHASE-7A-REPORT.md`, `docs/PHASE-7B-REPORT.md`, `docs/PHASE-7C-REPORT.md`, `docs/PHASE-8A-REPORT.md`, `docs/PHASE-8B-REPORT.md`, `docs/PHASE-8C-REPORT.md`, `docs/PHASE-8D-REPORT.md`, `docs/PHASE-9A-REPORT.md` to `docs/PHASE-9E-REPORT.md`, `docs/PHASE-10-REPORT.md`
