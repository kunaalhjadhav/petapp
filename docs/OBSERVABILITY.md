# Observability

How to see what PetApp is doing in staging and production: logs, errors, metrics, alerts and the dashboard's **System health** page.

## Health checks

| Endpoint | What it means | Use it for |
|---|---|---|
| `GET /health` (API) | The process is up | Liveness probe; restart if it fails |
| `GET /ready` (API) | Database, Redis and file storage all answer within 2 s (503 otherwise) | Readiness probe; stop sending traffic while it fails |
| `GET :9464/health` (worker) | The worker process is up | Worker liveness probe |

## Logs

- **Format:** one JSON object per line in staging and production (`LOG_FORMAT=json` is the default there; `pretty` locally). Ship stdout to your log store: CloudWatch, Loki, Datadog or Google Cloud Logging.
- **Fields:** `time`, `level`, `service` (`api` or `worker`), `context` (the class), `msg`. Within a request: `requestId` (the same as the `X-Request-Id` response header and the `requestId` in error responses) and `userId` once signed in.
- **Access log:** one line per request with `method`, `route` (the pattern, e.g. `/api/v1/posts/:id`), `status` and `ms`. Slow requests (over 1 s) and 5xx responses are warnings. `/health`, `/ready` and `/metrics` aren't logged.
- **Never logged:** query strings, request bodies, and any field named like a secret (password, token, OTP, code, PAN, account number, VPA, key, signature, cookie, authorization). These are replaced with `[redacted]`.
- **Level:** `LOG_LEVEL` (`debug`, `info`, `warn`, `error`; default `info`).

**Finding a problem a person reported:** ask for the time, or the error's reference (the request id shown in the app's error details), and search the logs for `requestId`.

## Error tracking

- **Setup:** set `ERROR_TRACKER=sentry` and `SENTRY_DSN` (Sentry, or a compatible service such as GlitchTip). Set `APP_RELEASE` to the git commit in CI so errors are tied to a release.
- **What's reported:**
  - unexpected API errors (5xx), with the route, request id and user id
  - background jobs that failed after all their retries, with the queue and job
  - unhandled promise rejections in either process

  Ordinary answers like "not found" or "not allowed" aren't reported.
- **Volume:** at most 60 reports a minute per process, so an outage can't flood the service.
- **Mechanism:** reports are sent over Sentry's envelope HTTP API, so no SDK is bundled.

## Metrics (Prometheus)

Scrape `GET /metrics` on every API instance and `GET :9464/metrics` on every worker, with `Authorization: Bearer $METRICS_TOKEN`. Without a token, metrics are served only outside staging/production. There's an example scrape config in `infrastructure/monitoring/prometheus.yml`.

| Metric | Labels | Meaning |
|---|---|---|
| `petapp_http_requests_total` | method, route, status | API requests (route patterns only, so ids never become labels; unknown URLs are `unmatched`) |
| `petapp_http_request_duration_seconds` | method, route, status_class | API response time histogram |
| `petapp_queue_jobs` | queue, state | Jobs waiting, running, scheduled and failed per queue (media, maintenance, notifications, trust) |
| `petapp_jobs_completed_total` / `petapp_jobs_failed_total` | queue, job, final | Jobs done and failed attempts (`final="true"`: no retries left) |
| `petapp_job_duration_seconds` | queue | Job run time histogram |
| `petapp_db_up`, `petapp_db_ping_seconds` | | Database reachable, and how fast |
| `petapp_payments_last_hour` | status | Payments created in the last hour by status (CREATED, CAPTURED, FAILED…) |
| `petapp_payment_webhooks_unprocessed` | | Gateway webhooks received over 5 minutes ago and not yet handled |
| `petapp_money_attention` | kind | Failed refunds and payouts (7 days), refunds owed for over a day |
| `petapp_api_*`, `petapp_worker_*` | | Node.js process metrics (CPU, memory, event loop lag, GC) |

Database internals (connections, slow queries, replication lag, disk) come from your managed database's own monitoring, e.g. RDS Performance Insights or Cloud SQL Insights, or from `postgres_exporter`. Redis is covered the same way, by ElastiCache metrics or `redis_exporter`.

**Chat:** `petapp_chat_connections` is the number of open chat WebSockets on each API instance.

## Alerts

`infrastructure/monitoring/alerts.yml` has starting rules, checked with `promtool`:

- **Pages** (someone acts now):
  - API, worker or database down
  - over 2% of requests failing
  - payment webhooks stuck
  - most payments failing
- **Tickets** (someone acts today):
  - slow API (p95 over 1 s)
  - queue backlog
  - jobs failing after retries
  - refunds overdue
  - failed refunds or payouts

**Runbooks:** every alert has a `runbook` annotation that points at a page in [runbooks/](runbooks/README.md), which says what to check and what to do. CI fails if an alert has no runbook (`npm run ops:check-runbooks`).

**Backups:** set `BACKUP_HEARTBEAT_URL` to a dead-man's-switch check, such as healthchecks.io or Better Stack, so a missed night pages someone.

## In the dashboard: System health

**Configuration → System health** shows:
- whether the database, Redis and storage answer, and how fast
- which providers are configured; test-only ones such as `fake` payments or `console` SMS are highlighted in production
- money needing attention, with links to the finance pages
- each queue's backlog and its most recent failures, with the error

People with settings access can retry a queue's failed jobs after fixing the cause; the retry is audited.

## Mobile apps

The three Flutter apps report crashes and uncaught errors to Sentry (or GlitchTip) when built with `--dart-define=SENTRY_DSN=…`. `APP_ENV` names the environment, and the release is the app's version and build.
- **What reports leave out:** no IP addresses, user details or screenshots are sent. Tokens, emails and phone numbers are masked in messages and breadcrumbs (`lib/services/crash_reporting.dart`, tested in `test/crash_reporting_test.dart`).
- **Without a DSN:** nothing is sent.
- **Readable stack traces:** upload the symbol files from the release build's artifacts.

See [STORE-RELEASE.md](STORE-RELEASE.md#crash-reporting).
