# JobsFailing: jobs failing after all their retries

1. **System health → the queue → recent failures** shows the error of each failed job. Sentry has the full stack.
2. **Common causes:**
   - **media:** a corrupt or unsupported file. The post shows "failed" to its owner; nothing to do.
   - **notifications:** push credentials expired (`FCM_PRIVATE_KEY`). Renew them in Firebase.
   - **maintenance `build-export`:** storage unreachable. The person can ask again; check `/ready`.
   - **maintenance `purge-deleted-accounts`:** an account that can't be erased logs why. Accounts held back by an order or refund are not failures.
3. **After fixing the cause,** press **Retry failed** on System health (it's recorded in the audit log).
