# Phase 9e — Staff passwords and resumable uploads: report

Phase 9e covers:
- staff password change and reset by email, through an email provider
- resumable uploads (spec §84: "Video upload should support resumable uploads where possible")

## 1. Implemented

### Email provider
- **Setting it up:** `EMAIL_PROVIDER` takes one of three values.

  | Value | What it does |
  |---|---|
  | `smtp` | Sends through any SMTP service: Amazon SES, SendGrid, Mailgun, Zoho or Google Workspace. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM`. |
  | `console` | For development: prints emails, with their links, in the API log. |
  | `none` | Sends nothing. This is the default. |

- **Production checks:** production and staging refuse `console`. They also require `DASHBOARD_URL` to be an https address, because reset links point to it.
- **Security:** STARTTLS is required on port 587. The mailer can't read files or URLs.
- **Library:** this uses nodemailer 10. Version 6 has known high-severity advisories, and `npm audit` is clean with 10.

### Staff passwords
- **Your account** (click your name, top right): change your password by typing the current one and the new one twice.
  - Every other session ends; this one stays signed in.
  - The owner gets an email that the password changed.
  - Until a staff member changes the password they were given, every dashboard page shows a reminder. This includes the first admin from `SEED_ADMIN_PASSWORD`.
- **Password rules:**
  - 12 to 128 characters.
  - Refused: common passwords (with or without digits or a year at the end, and anything starting "changeme"), repeating patterns, too few different characters, and the person's name or email.
  - A new password can't be the same as the current one.
  - The rules are explained in words on the form.
- **Forgot your password?** (on the sign-in page):
  - **Same answer for any address,** so it can't be used to find staff accounts. The email is sent in the background, so the response takes the same time either way.
  - **Who gets a link:** only active staff accounts with a password.
  - **Limits:** at most 3 links an hour to one address, and 5 requests a minute per IP.
- **Reset links:**
  - **Single use and short-lived:** 30 minutes by default (`PASSWORD_RESET_TTL_MINUTES`).
  - **Stored safely:** only as a SHA-256 hash.
  - **One at a time:** a newer link replaces an older one.
  - **The page:** it checks the link first and shows a masked address ("p•••@petapp.in"), or says the link has expired.
  - **After a reset:** every session ends, and the owner gets an email.
- **Admins** can send a staff member a reset link from their page under **People** ("Send password reset"). The link goes only to that staff member's email; the admin never sees it. This needs `users.roles.assign`.
- **Audit log:** every step is recorded: changed, a failed change, a link requested, a link sent by an admin, and a reset.

### Resumable uploads (spec §84)
- **When parts are used:** the app asks for a resumable upload for videos. Files over `media.resumableAboveMb` (16 MB) come back as **MULTIPART**, in parts of `media.uploadPartMb` (8 MB, at least 5). Smaller files still go in one request.
- **Signed parts:** the app asks for part addresses ten at a time (`POST /media/:id/parts`). Each one is signed for that part's exact length.
- **Retries and resuming:**
  - A failed part is retried on its own, up to five times, waiting 1, 2, 4, 8 and 16 seconds.
  - An expired address is fetched again.
  - `GET /media/:id/upload` says which parts arrived and which are missing.
  - If the connection stays down, the New post screen shows **Upload paused**. **Retry** sends only the missing parts.
- **Joining:** `POST /media/:id/complete` checks that every part is there at its exact length before joining them. Otherwise it names the missing parts. The joined file then goes through the usual checks and processing.
- **Clean-up:** the nightly job aborts a resumable upload left unfinished for a day, so storage doesn't keep paying for its parts.

## 2. Verification

| Check | Result |
|---|---|
| API unit tests | 235 pass (7 new: password rules and reset tokens, part sizes and progress, email settings) |
| API end-to-end tests | 271 pass, 21 suites (10 new in `accounts.e2e`). Covers: <br>• the given-password reminder <br>• changing a password: wrong current password, weak passwords, other sessions ended, the email notice and audit rows <br>• forgot password: the same answer for any address, links only to staff, stored hashed <br>• resetting: once only, every session ended, older links invalid <br>• expiry and the hourly limit <br>• admin-sent links and their permission <br>• small files kept to one upload <br>• a large file in parts: an interruption, resuming, finishing early refused, joined <br>• a video sent in parts and processed <br>• unfinished uploads aborted |
| Dashboard browser tests | 37 pass (1 new: forgot password, then the emailed link, a refused weak password, the new password, signing in, and changing it under Your account) |
| Dashboard unit tests | 24 pass |
| Website browser and unit tests | 13 and 13 pass |
| App ↔ API contract checks, all three apps | Pass (new fixtures recorded from the running API by `record_upload_fixtures.py`) |
| Python mirrors of the Dart tests | 11 sets pass (new: `check_upload_mirrors.py`) |
| Lint, typecheck, bracket and name checks, schema drift, `npm audit` (shipped code) | Pass |
| API reference | Regenerated: 436 operations |

## 3. Problems found and fixed
- **Presigned uploads would have failed on real S3:**
  - **The cause:** the AWS SDK now adds a checksum to signed upload URLs by default, and it signed the checksum of an *empty* body. Amazon S3 refuses the real file with that checksum ("BadDigest"). The local test storage didn't check it, so tests passed.
  - **The fix:** storage now adds checksums only when required, and a test checks that part URLs carry no checksum.
  - **Who it affected:** every photo, video and document upload since Phase 2, but only when pointed at AWS S3.
- **A wrong current password signed staff out:** the API first answered with 401, which the dashboard treats as "session ended". It now answers 400, so the form shows the error.
- **The admin sign-in limit:** this was 5 a minute per address, and is now 10. Staff in one office share an IP, and each try still costs a bcrypt check.
- **nodemailer 6** had 15 published advisories, so version 10 is used.

## 4. Known limitations
- **The Flutter apps weren't compiled here,** because no SDK is available. CI's mobile jobs run `flutter analyze` and `flutter test`, including the new `upload_test.dart`. The logic is covered by the Python mirror and the contract check.
- **Resuming after the app closes:** a paused upload resumes while the app stays open (Retry). If the app is closed, the next attempt starts that video again. The parts already sent are cleared away after a day.
- **Partner and seller apps:** they upload photos and documents only, which stay single requests.
- **Customer email sign-in:** app users who signed up with email and a password don't get a reset link (staff only). App sign-in is by phone OTP.
- **No MFA for staff yet.** Two-factor sign-in for the dashboard would be a good next step.

## 5. Phase 9 complete
Phases 9a–9e are delivered: chat and support, reviews and reporting, search, discovery and locations, analytics, memberships and reminders, and staff passwords and resumable uploads. Paid votes stay off, as agreed.
