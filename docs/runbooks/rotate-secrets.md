# Rotate secrets

Rotate on a schedule (yearly), when someone with access leaves, and **immediately** if a secret may have leaked (see [security-incident.md](security-incident.md)). Generate new values with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`, store them in the secret manager, then redeploy.

| Secret | What happens when it changes |
|---|---|
| `JWT_ACCESS_SECRET` | Access tokens stop working; the apps refresh silently |
| `JWT_REFRESH_SECRET` | Everyone signs in again. Do this after a leak |
| `OTP_PEPPER` | Codes in flight (5 minutes) stop working |
| `PAYOUT_DATA_KEY` | **Don't just replace it**: it encrypts bank account numbers. Re-encrypt first (decrypt with the old key, encrypt with the new one, in one maintenance window) |
| `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Change them in the Razorpay dashboard and in the secret manager at the same time; webhooks retry meanwhile |
| `METRICS_TOKEN` | Update Prometheus's scrape config with it |
| `BACKUP_ENCRYPTION_KEY` | Keep the old key for as long as backups made with it are retained |
| S3 / SMS / FCM / AI keys | Create the new key at the provider, deploy, then delete the old one |
| Android upload key, iOS certificate | Through Play Console (upload key reset) and the Apple Developer portal |
