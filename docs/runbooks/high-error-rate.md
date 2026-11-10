# HighErrorRate: over 2% of API requests are failing

1. **Did it start right after a deploy?** [Roll back](rollback.md) now and investigate afterwards. Migrations are always backward-compatible, so rolling back is safe.
2. **Find the failing routes:** Sentry groups errors by route and message. In Grafana, look at `petapp_http_requests_total{status=~"5.."}` by `route`.
3. **One route:** the cause is usually a provider (payments, SMS, storage) or a bad record. The error report has the request id; search the logs for it.
4. **All routes:** suspect a dependency. Check `/ready` and [database-down.md](database-down.md).
5. **A provider outage you can't fix:** switch the feature off in the dashboard (**Features & settings**), for example the marketplace during a payments outage, so people get a clear "coming soon" instead of errors. Switch it back on afterwards.
