# Runbooks

What to do when something goes wrong. Every alert in `infrastructure/monitoring/alerts.yml` names its runbook.

| Severity | Means | Response |
|---|---|---|
| **page** | Customers are affected now (can't use the app, or money is at risk) | On-call acknowledges within 15 minutes, any time |
| **ticket** | Something is degrading or needs staff work | Next working day |

**Alerts:**

| Alert | Runbook |
|---|---|
| ApiDown | [api-down.md](api-down.md) |
| WorkerDown | [worker-down.md](worker-down.md) |
| DatabaseDown | [database-down.md](database-down.md) |
| HighErrorRate | [high-error-rate.md](high-error-rate.md) |
| SlowApi | [slow-api.md](slow-api.md) |
| QueueBacklog | [queue-backlog.md](queue-backlog.md) |
| JobsFailing | [jobs-failing.md](jobs-failing.md) |
| PaymentWebhooksStuck | [payment-webhooks-stuck.md](payment-webhooks-stuck.md) |
| PaymentFailuresSpike | [payment-failures-spike.md](payment-failures-spike.md) |
| RefundsOverdue, MoneyFailures | [refunds-and-payouts.md](refunds-and-payouts.md) |

**Procedures:**
- [rollback.md](rollback.md): go back to the previous release
- [restore-database.md](restore-database.md): restore the database, and the quarterly drill
- [rotate-secrets.md](rotate-secrets.md): replace leaked or old secrets
- [security-incident.md](security-incident.md): a breach or suspected breach, including the legal reporting deadlines
- [sign-in-problems.md](sign-in-problems.md): people can't get OTP codes or sign in

**Where to look first:**

| | |
|---|---|
| Dashboard | **Configuration → System health** shows dependencies, connected services, queues and failed jobs, and money needing attention |
| Logs | JSON lines with a `requestId`. A customer's error screen shows the same id, so search for it |
| Errors | Sentry, each with the route, request id and release |
| Metrics | Grafana or Prometheus, from `/metrics` (API) and `:9464/metrics` (worker) |
| On the server | `cd <deploy path> && IMAGE_TAG=$(cat .deployed-tag) DEPLOY_ENV=production docker compose -f compose.yml ps` (and `logs --tail 200 api`) |

**After every page,** write a short note covering what happened, the impact, the timeline, the cause, and what will stop it recurring. Link it from the alert's runbook if the runbook missed something.
