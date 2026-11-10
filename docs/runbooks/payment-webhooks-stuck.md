# PaymentWebhooksStuck: payment events received but not processed (page)

**Impact:** customers may have paid but still see "pending". Their place or stock is held for 30 minutes.

1. **The worker isn't needed for this; the API processes webhooks itself.** Look in the logs for `webhooks/payments` errors and in Sentry.
2. **The webhook secret changed?** Signature failures are refused, not stored, so they show up as gateway retries instead. Check that `RAZORPAY_WEBHOOK_SECRET` matches the Razorpay dashboard.
3. **The database is slow or down:** see [database-down.md](database-down.md).
4. **Once fixed,** the gateway's retries are processed. Then run a reconciliation (dashboard → Finance → Reconciliation): it compares every payment with the gateway's own records and lists any capture we never confirmed. Press **Recover payment** next to each missed capture on that page: it confirms the payment the same way a webhook would, or refunds it when the entry can no longer be honoured.
5. **Customer contacts support** about a payment: search the payment id in Finance. Reconciliation is the source of truth; never mark a payment paid by hand.
