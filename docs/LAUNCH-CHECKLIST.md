# Launch checklist

Work through this top to bottom before the first production release. Each line says how to check it. Two scripts do most of the checking:

- `npm run ops:preflight -- --env-file prod.env` checks the production configuration file.
- `npm run ops:preflight -- --env-file prod.env --api https://api.<domain> --admin-token <token>` also checks the live platform: published policies, company details for invoices, real providers, and dependencies that answer.

"FAIL" in preflight blocks the launch.

## 1. Accounts and access
- [ ] **MFA everywhere:** MFA on for every GitHub, cloud, Razorpay, Apple and Google account that can reach production.
- [ ] **Secrets in the manager:** production secrets live in the secret manager, and none were ever used in development. Generate fresh ones; see [DEPLOYMENT.md](DEPLOYMENT.md#secrets).
- [ ] **GitHub environment approval:** the `production` environment in GitHub requires a reviewer.
- [ ] **Deploy secrets:** the deploy secrets are set: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and `DEPLOY_PATH` in each of the `staging` and `production` environments (images are pushed with the built-in `GITHUB_TOKEN`).
- [ ] **First admin:** `SEED_ADMIN_PASSWORD` for production is a fresh, long password kept in the password manager. After the first sign-in, change it under **Your account** (the dashboard reminds you until you do). Each member of staff signs up with their own email address, and an admin gives them a role (open the person under **People**, then **Edit roles**); nobody shares the first admin account.

## 2. Configuration
- [ ] **Preflight passes:** `ops:preflight --env-file prod.env` shows no FAIL.
- [ ] **Real providers:** `PAYMENT_PROVIDER=razorpay` and `PAYOUT_PROVIDER=razorpayx`, with live keys; `SMS_PROVIDER=smslocal` with an approved DLT template; `EMAIL_PROVIDER=smtp` with SPF and DKIM set up for the sending domain, and `DASHBOARD_URL` set to the dashboard's https address (reset links point there). Send yourself a reset link to check it arrives.
- [ ] **Maps (optional):** `MAP_PROVIDER=google` with a `GOOGLE_MAPS_KEY` that has only the Geocoding API enabled and is restricted to the API servers' IP addresses; set a daily quota in Google Cloud. Add Google to the privacy policy's processors first.
- [ ] **Staff two-factor:** set `MFA_DATA_KEY` (32 random bytes, base64, different from `PAYOUT_DATA_KEY`; keep it: if it changes, authenticator codes stop working until each person signs in with a recovery code and sets two-factor up again, or an admin resets it). Have every staff member set up two-factor under **Your account**, then turn on `security.requireStaffMfa` in **Settings**.
- [ ] **Media:** `MEDIA_PUBLIC_BASE_URL` points at the CDN in front of the media bucket.
- [ ] **Edge settings:** `TRUST_PROXY` is set to your load balancer's hop count, and `CORS_ORIGINS` lists only the admin dashboard's address.
- [ ] **No debugging leftovers:** `SWAGGER_ENABLED` is off, and `RATE_LIMIT_MULTIPLIER` is unset (production refuses it anyway).
- [ ] **Payment webhooks:** the Razorpay webhook points at `https://api.<domain>/api/v1/webhooks/payments` with the events listed in DEPLOYMENT.md, and the RazorpayX webhook points at `https://api.<domain>/api/v1/webhooks/payouts`.

## 3. Legal and company details
- [ ] **Policies reviewed:** a lawyer has reviewed all eight documents in **Configuration → Legal documents**, every `{{placeholder}}` is filled in, and each one is published (preflight checks this).
- [ ] **Invoice details:** the company settings used on invoices are filled in: `company.*` legal name, GSTIN, PAN, address and state (`company.legalName`, `company.gstin`, `company.pan`, `company.address`, `company.state`) (preflight checks this).
- [ ] **Grievance Officer:** a named Grievance Officer and contact address appear in the Privacy Policy, as the IT Rules and DPDP Act require.
- [ ] **Contest fees:** a lawyer has confirmed contest entry fees, prizes and TDS for your states.

## 3b. Support
- [ ] **Help center:** the draft questions in **Support → Help center** are checked against your own policies, edited and published. `https://<domain>/help` shows them (the App Store's support URL).
- [ ] **Support staff:** each has a named account with the Support agent role, and someone watches **Support → Tickets** every working day.
- [ ] **Chat:** turn on **ENABLE_CHAT** when moderators are ready for reported messages; the load balancer passes WebSocket upgrades (see DEPLOYMENT.md).
- [ ] **Reports and reviews:** a moderator checks **Community → Reports** every day; review rules ("what we remove") are in the Community Guidelines, so hidden reviews can point to them.

## 3c. Locations
- [ ] **Cities:** the seeded cities are checked, and the ones you launch in have their areas and PIN codes imported (**Locations → Cities and areas → Import**), so addresses fill in from a PIN code.
- [ ] **Service coverage:** **Services live** is switched on for each launch city (until one is on, services show everywhere), and `locations.coverageRadiusKm` fits how far partners travel.
- [ ] **Delivery zones:** zones match your couriers' reach and prices; decide whether `marketplace.deliveryZonesOnly` should refuse addresses outside every zone.

## 3d. Memberships, reminders and promotions
- [ ] **Memberships:** set prices and benefits in **Membership plans** (prices include GST; confirm the GST rate on memberships with your tax adviser), mark any members-only contests, challenges or coupons, then turn on **ENABLE_MEMBERSHIPS**.
- [ ] **Reminders:** check `reminders.bookingHoursBefore` and `reminders.contestHoursBefore` (24 hours by default; 0 turns them off).
- [ ] **Promotions:** set `promotions.dailyLimit`; only people who opted in are reached.

## 4. Data safety
- [ ] **Nightly backup:** scheduled to run with the ops image: `docker compose -f infrastructure/deploy/compose.yml --profile jobs run --rm backup` on the server (cron or a systemd timer), at 01:30 India time, before the 02:30 reconciliation.
- [ ] **Backup bucket:** separate from media, in another account or region, versioned, and blocking deletes.
- [ ] **Encryption key:** `BACKUP_ENCRYPTION_KEY` is set and stored apart from the backups.
- [ ] **Backup heartbeat:** `BACKUP_HEARTBEAT_URL` alerts someone when a night's backup doesn't arrive.
- [ ] **Restore drill:** the drill passes against the first real backup (`npm run ops:restore-drill`, pointed at a restore server with `RESTORE_ADMIN_URL`), and its time is recorded against the 1-hour RTO.
- [ ] **Managed database:** point-in-time recovery is switched on. The logical dumps are the second line of defence, not the first.

## 5. Capacity
- [ ] **Load test on staging:** run against staging at your expected peak times two (`load/README.md`), with thresholds passing. Expect about 100 requests a second per API process; see [load/RESULTS.md](../load/RESULTS.md).
- [ ] **Two API processes:** at least two, behind the load balancer, plus one worker.

## 6. Monitoring and on-call
- [ ] **Metrics:** Prometheus scrapes the API and worker (`METRICS_TOKEN`), and the rules in `infrastructure/monitoring/alerts.yml` are loaded.
- [ ] **Alert routing:** pages reach a phone, tickets reach a queue, and each alert's `runbook` link opens.
- [ ] **Error tracking:** `ERROR_TRACKER=sentry` on the API and worker, and `SENTRY_DSN_MOBILE` for the app builds.
- [ ] **On-call:** someone is on call for launch week and has read [runbooks/README.md](runbooks/README.md).
- [ ] **System health is clean:** **Configuration → System health** shows nothing red.

## 7. Website and app links
- [ ] **Indexing:** the website runs with `SITE_INDEXABLE=true` in production only.
- [ ] **Android app links:** `ANDROID_SHA256_FINGERPRINTS` holds the Play app-signing key's fingerprint.
- [ ] **iOS universal links:** `IOS_APP_ID` holds your Team ID.
- [ ] **Links open the app:** `https://<domain>/pet/<handle>` opens the app on a real Android phone and a real iPhone.
- [ ] **Search Console:** the domain is verified, and `https://<domain>/sitemap.xml` is submitted.
- [ ] **Account deletion page:** `/account-deletion` shows the support email (`SUPPORT_EMAIL`).

## 8. Stores
- [ ] **Store listings:** each listing is complete, as in [STORE-RELEASE.md](STORE-RELEASE.md): the content rating, an 18+ audience, the Data safety form, the privacy label, the privacy policy and deletion URLs, and a reviewer's demo account.
- [ ] **Release builds tested:** builds from the mobile release workflow have been tested on real phones against production: sign-in, a live payment of ₹1 then refunded, push notifications, a deep link and a crash report.
- [ ] **Store URLs set:** after approval, `PLAY_STORE_URL` and `APP_STORE_URL` are set on the website.

## 9. Go
- [ ] **Deploy:** deploy through the pipeline (staging, then approval, then production).
- [ ] **Smoke test passes:** `npm run ops:smoke -- --api https://api.<domain> --web https://<domain> --admin https://admin.<domain> --env production` (the pipeline runs it too).
- [ ] **Live preflight passes:** `ops:preflight` with `--api` and `--admin-token` shows no FAIL.
- [ ] **First payment checked:** after the first real payment, open **Finance → Reconciliation** the next morning and check it is clean.
- [ ] **Rollback rehearsed:** know how to roll back ([runbooks/rollback.md](runbooks/rollback.md)), and try it once on staging.
