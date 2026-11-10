# RefundsOverdue, MoneyFailures: refunds or payouts need finance staff

These are tickets, handled by the finance team in the dashboard (**Finance**).

- **Refunds owed for over a day** are retried automatically every 30 seconds.
  - **Still owed after a day:** usually the gateway refused it, for example because the original payment is too old. Open **Finance → Refunds**, read the reason, and either retry or record a refund paid another way (with the bank reference).
- **Failed payouts:** the amount is back on the payee's balance. Usually the bank account was closed or wrong. The payee is notified to update their payout account; the next batch pays them.
- **Never** edit amounts in the database. Every change goes through the dashboard, which writes the ledger and the audit log.
