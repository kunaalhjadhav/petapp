# Phase 8a — Observability and security: report

Phase 8 (production) is split into four parts:
- **8a (this report):** observability and security
- **8b:** privacy and legal (data export, the account deletion job, consents, legal documents)
- **8c:** the public web (SEO pages, legal pages, app links)
- **8d:** launch readiness (backups and a restore drill, load tests, CI security scans, the deploy pipeline, store builds, runbooks, the final checklist)

## 1. Implemented

### Observability (spec §67)
- **Structured logging:**
  - JSON lines in staging and production (readable locally), with time, level, service, class, message, and the request id and user id within a request.
  - One access-log line per request (method, route pattern, status, time); slow and failed requests are warnings.
  - Secrets and personal fields are redacted; query strings and bodies are never logged.
- **Error tracking:** `ERROR_TRACKER=sentry` with `SENTRY_DSN`, which also works with GlitchTip.
  - **What's reported:** unexpected API errors, background jobs that failed after all retries, and unhandled rejections. Each report carries the route, request id, user id, environment and release.
  - **Limits:** at most 60 reports a minute per process.
  - **Mechanism:** sent through Sentry's envelope HTTP API, so there's no heavy SDK.
- **Metrics (Prometheus):**
  - **API (`/metrics`):**
    - Requests and response times by route pattern (never raw URLs, so ids can't blow up the label count).
    - Queue depths, and database up/ping.
    - Payments in the last hour by status.
    - Unprocessed payment webhooks.
    - Failed refunds and payouts, and refunds owed for over a day.
    - Node process metrics.
  - **Worker (`:9464/metrics`, plus `:9464/health`):** jobs completed, jobs failed (final or not) and job run times per queue and job, plus queue depths.
  - **Access:** both need `METRICS_TOKEN` (compared in constant time), and are off without one in staging and production.
- **Health checks:** the existing `/health` and `/ready` (database, Redis, storage), now documented as liveness and readiness probes.
- **Alerts:** `infrastructure/monitoring/alerts.yml` has 11 rules, and there's an example `prometheus.yml`, both validated with `promtool`.
  - **Pages:** API, worker or database down; error rate over 2%; payment webhooks stuck; payment failure spike.
  - **Tickets:** p95 over 1 s; queue backlog; jobs failing after retries; refunds overdue; failed refunds or payouts.
- **Dashboard → Configuration → System health:**
  - **Dependencies:** database, Redis and storage, with response times.
  - **Connected providers:** test-only ones (fake payments, console SMS…) are highlighted in production.
  - **Money needing attention,** with links to the finance pages.
  - **Each queue:** waiting, running, scheduled and failed jobs, with recent failure messages, and **Retry failed** (audited).

### Security and fraud testing (spec §73)
A new end-to-end suite, `test/security.e2e-spec.ts`, attacks the API the way an outsider, a curious customer, a partner or a staff member would:

| Spec item | What the tests do |
|---|---|
| OTP abuse | Guess a code: wrong tries use it up, and even the right code then fails. SMS bombing: codes per number are capped per hour. |
| Rate-limit bypass | Rotate `X-Forwarded-For`: the per-IP limit still applies. |
| Token abuse | Tampered, `alg: none`, wrongly signed, expired and wrong-issuer tokens are all refused. After logout, the access and refresh tokens die at once. Replaying a used refresh token signs out the whole chain, including access tokens. |
| Unauthorized admin access | Customer tokens on six admin areas are refused. Staff tokens are refused in the app. A moderator can't do finance, settings, flags or the home screen. A customer can't sign in to the dashboard even with a password. |
| Partner access violations | Partner B can't see or complete partner A's booking. Seller B can't edit seller A's product, or pack or cancel their parcel. Nothing changes. |
| IDOR | Another customer's pet, address, order and assistant chat can't be read or changed (404). |
| Mass assignment | Setting status, roles, owner or verification through the API is rejected. |
| File upload attacks | SVG, HTML, executables, scripts, odd MIME parameters, huge or negative sizes, and storage-key injection are all refused. |
| SQL injection | Classic payloads in four search boxes and a hashtag return normal answers. Ids and numbers are validated. Tables are untouched. |
| Payment replay | Using another payment's genuine gateway reply fails. Confirming someone else's payment fails. A repeated confirmation changes nothing, and the ledger books it once. |
| Duplicate webhook | Forged signatures are refused. A genuine event sent twice is processed once. |
| Contest vote manipulation | No self-votes. Votes sent in parallel get no more than the daily allowance. Staff tokens can't vote. |

### API additions
- `GET /metrics` (token)
- `GET /admin/system` (settings read)
- `POST /admin/system/queues/{name}/retry` (settings manage)
- The API reference was regenerated (316 operations).

### Configuration
New settings: `LOG_FORMAT`, `LOG_LEVEL`, `ERROR_TRACKER`, `SENTRY_DSN`, `APP_RELEASE`, `METRICS_TOKEN` and `WORKER_METRICS_PORT`, all documented in `.env.example` and `docs/OBSERVABILITY.md`.

## 2. Problems found and fixed
The security suite found three real problems:
1. **Votes sent in parallel were all counted.** Four simultaneous votes from one person, for four different entries, were all accepted despite a one-vote daily allowance: each request counted "no votes yet" before any was saved. A person's votes in a contest are now counted and saved under a database lock, so exactly one gets through.
2. **Signing out didn't stop the access token.** After logout, or a stolen-refresh-token alarm, the 15-minute access token kept working until it expired. Revoked sessions are now kept on a Redis deny-list for the token's lifetime, so they stop at once.
   - **Suspended people:** the check comes after the account-status check, so they still see "this account is not active" rather than a generic sign-out.
   - **Refresh rotation:** this doesn't trigger the deny-list, so normal refreshes don't break requests in flight.
3. **Searching for "%" or "_" matched everything.** Prisma's `contains` doesn't escape SQL LIKE wildcards. All user-facing searches (pets, products, people, partners, the assistant's contest lookup) now escape them, so input is searched for literally.

Also fixed:
- The JSON logs repeated the message field.
- OTP limits in the security suite needed setting before the app module loads. The suite now imports a small env file first.

## 3. Verification
- **Backend unit tests:** 193 pass (11 new: JSON logging and redaction, the Sentry envelope, DSN parsing, stack frames, the per-minute cap, the error filter reporting only unexpected errors without leaking details, route labels, and search escaping).
- **Backend end-to-end:** 177/177, including 20 new tests:
  - 16 security tests.
  - 4 observability tests: health and readiness, request ids, `/metrics` access and contents, and the System health API with queue retry and permissions.
- **Dashboard browser tests:** 23/23, including a new System health test.
- **App contract checks** still pass for all three apps.
- **Checked live with `promtool`:**
  - The alert rules and the scrape config are valid.
  - Running API and worker metrics pass the lint, apart from three warnings about prom-client's own Node.js metric names.
- **Live run:** the API and worker emitted JSON logs with request ids. The worker's `:9464/health` and `/metrics` answered. The System health page showed a real problem (the local storage bucket had gone after a restart) until it was fixed.

## 4. Known limitations
- **No distributed tracing yet.** Request ids tie logs and errors together; OpenTelemetry tracing can be added later.
- **Database and Redis internals** come from the managed services' own monitoring, or from `postgres_exporter` and `redis_exporter`, rather than from PetApp.
- **Not yet in CI:** crash reporting for the Flutter apps, and dependency and secret scanning. Both come in 8d.
- **The security suite is not a penetration test.** An independent pen test on staging is still recommended before launch (see `docs/SECURITY.md`).

## 5. Next: Phase 8b
Privacy and legal:
- data export
- the account deletion job, anonymising records that must be kept for tax law
- consent records
- legal documents managed in the dashboard (privacy policy, terms, contest terms, refund and cancellation policies, partner and vendor terms, community guidelines)
- marketing consent
- the matching screens in the apps
