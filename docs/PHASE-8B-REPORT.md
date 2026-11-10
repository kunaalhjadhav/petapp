# Phase 8b — Privacy and legal: report

Phase 8 (production) has four parts:
- **8a:** observability and security (delivered)
- **8b (this report):** privacy and legal
- **8c:** the public web (SEO pages, legal pages, app links)
- **8d:** launch readiness (backups and a restore drill, load tests, CI security scans, the deploy pipeline, store builds, runbooks, the final checklist)

## 1. Implemented

### Legal documents (spec §70)
- **Eight documents,** seeded as drafts from templates written for an Indian consumer app (DPDP Act 2023, IT Rules 2021, Consumer Protection (E-Commerce) Rules 2020):
  - Terms of Service
  - Privacy Policy
  - Contest Terms
  - Refund Policy
  - Cancellation Policy
  - Service Partner Terms
  - Seller Terms
  - Community Guidelines

  Each describes how PetApp actually works: verified payments, GST and TDS, refunds to the original method, the grace period, automated moderation reviewed by staff, the assistant not being a vet. Each ends with the Grievance Officer contact the IT Rules require.
- **They are templates, not legal advice.** Names, addresses, providers and time limits are `{{placeholders}}`, and **publishing is refused until every one is filled in**, so an unreviewed draft can't go live by accident.
- **Versions:**
  - **Drafts:** a draft is edited in the dashboard (Markdown, with a preview), with a "what changed" summary.
  - **Publishing:** makes it current and retires the old version. A database rule allows only one current version per document.
  - **No edits after publishing:** published versions can't be edited; you start a new version instead.
  - **Audit:** publishing and drafts are recorded in the audit log.
- **Public API** (no sign-in): `GET /legal` and `GET /legal/{slug}`. The website pages come in 8c.

### Consent (spec §70)
- **Who accepts what:**
  - **Terms of Service and Privacy Policy:** everyone. The customer app asks on its next start after a new version is published, and the sheet can't be dismissed. When a document changed, it says "We've updated our terms" and shows what changed.
  - **Contest Terms:** before entering a contest. **Service Partner Terms** and **Seller Terms:** before submitting for verification.
  - **Enforced by the API, not just the apps:** the API refuses these actions with `403 TERMS_NOT_ACCEPTED`, naming the document. All three apps show it, record acceptance and try again.
- **Every acceptance is recorded:** the document, version, time, IP address and app.
  - **Marketing:** turning offers and news on or off is recorded too.
  - **Append-only:** a database trigger refuses changes to existing records.
- **The marketing switch** has moved from an unused profile field to **Settings → Your data and privacy**.

### Data export (right to access)
- **What's in it:** one JSON file with everything PetApp holds about the person:
  - profile, sign-ins, sessions and devices
  - addresses, pets and health records
  - posts, comments, likes, follows, blocks and reports made, notifications
  - orders, returns, bookings and reviews
  - payments, refunds and invoices
  - contests, votes, challenges and badges
  - payout accounts and payouts
  - assistant chats, viewing history, consents
  - their business profile, if they have one
- **What's never in it:** secrets and internal identifiers (password and token hashes, encrypted bank numbers, storage keys).
- **How it's made:**
  - **Built by the worker** (retried if storage fails) and stored privately under `exports/`.
  - **A notification** says when it's ready.
  - **Download:** a five-minute signed link.
- **Limits:** one in progress and one a day. Files are deleted after 7 days (`privacy.exportDays`).

### Account deletion (right to erasure)
- **The grace period:**
  - **Asking:** **Delete account** signs out everywhere. The answer says when the account will be erased (14 days by default, `privacy.deletionGraceDays`).
  - **Changing your mind:** signing in before then cancels the deletion, and the app says "Welcome back! Your account won't be deleted."
  - **The dashboard never cancels it by signing in.** A staff account waiting for deletion can't sign in to it.
- **Erasure (nightly, 05:00 India time):**
  - **Erased:**
    - the profile and sign-ins, sessions, devices, addresses, notifications, cart
    - follows, blocks, likes and saves, with other people's counts corrected
    - comment text, posts with their photos and videos in storage
    - pets' private details
    - assistant chats, viewing history, exports, risk records
    - bank account numbers
  - **Kept without the profile,** as tax and accounting law requires: orders, bookings, payments, refunds, invoices, the ledger, payouts, and contest records.
  - **Businesses** owned by the account are suspended and their products taken off sale.
  - **The phone number becomes free.** Signing in with it later starts a brand-new account.
- **Held back, never half-done:** an account isn't erased while something is in progress:
  - an order or booking
  - a return, refund or payout
  - money owed to them
  - for their business, customers' bookings and orders

  The reason is recorded and shown to staff, and it's tried again every night.
- **No race with signing in:** erasure and "sign in to cancel" each claim the account with a conditional update, so exactly one wins.

### Admin dashboard
- **Configuration → Legal documents:**
  - **The list:** every document, who must accept it, the current version, how many people accepted it, and the draft with placeholders still to fill in.
  - **Each version:** editor, preview, placeholder list, **Publish…** (optionally from a future date), version history.
- **Community → Privacy requests:**
  - **Tabs:** accounts waiting to be erased, held back (with why), and erased, with counts and data exports in the last 30 days.
  - **Actions:** **Erase now** and **Cancel deletion**.
- **New permissions:**
  - `legal.manage`: edit and publish.
  - `privacy.manage`: erase or cancel.

  Both go to Admin and Super admin.

### Apps
- **Customer app:**
  - **Settings → Your data and privacy:**
    - offers and news
    - a copy of your data (ask, status, download)
    - policies and terms, with the version you accepted
    - delete account, explaining the grace period
  - **Policy screens** render the Markdown, and can be read from the sign-in screen before signing in.
  - **Terms sheets:** on app start for updated terms, and when entering a contest.
  - **After deleting,** the sign-in screen says when the account will be erased.
  - **The "copy ready" notification** opens Your data.
- **Partner and seller apps:** submitting for verification shows the Service Partner Terms or Seller Terms when PetApp requires them, records acceptance and submits.

### API and database
- **New endpoints:** 17 new operations; the API reference was regenerated (333 operations).
- **Migration `20261016090000_privacy`:**
  - `LegalDocument` (one published version per document)
  - `ConsentRecord` (append-only)
  - `DataExport`
  - the `DATA_EXPORT_READY` notification
- **New settings:** `privacy.deletionGraceDays` (1–90) and `privacy.exportDays` (1–30), validated.
- **Worker jobs:** `build-export`, `purge-exports` (04:50) and `purge-deleted-accounts` (05:00).
- **Seed:** creates the eight drafts, leaving existing documents alone.

## 2. Verification
- **Backend unit tests:** 198 pass (5 new: templates, placeholders, audiences, export cleaning).
- **Backend end-to-end:** 194/194, including 17 new tests in `test/privacy.e2e-spec.ts`:
  - **Legal documents:**
    - drafts from templates, nothing public until published
    - placeholders block publishing
    - only staff with the permission can edit
    - versioning with a required summary
  - **Consent:**
    - accepted once
    - asked again as "updated"
    - marketing history, with the profile update refusing to change it
    - the database refusing edits to consent records
    - contest entry blocked until the Contest Terms are accepted
    - store submission blocked until the Seller Terms are accepted
  - **Data export:**
    - built by the real worker into storage, then downloaded through the signed link
    - contains the profile, pets with health details, addresses and sign-ins, and no secrets
    - once a day, and not visible to others
    - the ready notification, expiry and file deletion
  - **Deletion:**
    - grace period and sign-out
    - signing in cancels it
    - nothing happens early
    - held back by an unpaid refund (logged once), then erased with everyone's counts corrected and records kept
    - the phone number starts a new account
    - staff cancel and erase
    - a waiting staff account can't use the dashboard
- **Dashboard:**
  - **Browser tests:** 25/25, including 2 new ones:
    - a document drafted, refused with placeholders, filled in, published, rendered and served by the public API
    - a deletion cancelled and another erased, checked in the database
  - **Unit tests:** 19, including the Markdown reader (it never injects HTML).
- **Customer app:**
  - **Contract check:** 123 calls and 555 field reads across 86 models, against responses recorded from the running API by the new `tool/record_privacy_fixtures.py`.
  - **Dart tests** in `test/privacy_test.dart`, mirrored in Python (`scripts/check_privacy_mirrors.py`).
  - **Name and bracket checks** pass.
- **Partner and seller apps:** contract checks pass with the terms document; a new test renders it.

## 3. Problems found and fixed
- **Marketing consent could be changed without a record.** The profile update (`PATCH /users/me`) accepted `marketingConsent`. It's now refused there (400), so every change goes through `PUT /me/marketing` and is recorded.
- **Signing in during the grace period was refused.** Accounts waiting for deletion were treated like blocked ones. Signing in now cancels the deletion as promised, in the apps only.
- **The one-request-at-a-time lock for exports failed.** It was read as a query result. It now runs as a statement, like the other locks.
- **An export failed when storage was missing.** It is retried with backoff and marked failed only after the last try, so the person can ask again.
- **The document preview showed raw Markdown.** The dashboard and all three apps now render the same Markdown subset with the same rules, as text, never as HTML.

## 4. Known limitations
- **The legal texts need a lawyer.** They are careful templates, but PetApp's real policies (refund windows, cancellation fees, retention periods) must be confirmed and the placeholders filled in.
- **Photos and videos aren't inside the export file.** They're listed, and people can save them from the app. A ZIP with the media files is a possible later addition.
- **Not built yet:**
  - **Nominating someone** to exercise rights after death or incapacity, under the DPDP Act. This is handled by the Grievance Officer by email.
  - **A per-person consent history** in the dashboard.
- **Kept on purpose after erasure (confirm retention with your lawyer):**
  - verification documents of service partners and sellers, for compliance
  - consent records, including the IP address, as evidence
- **Partner and seller apps** don't have their own export or delete screens. It's the same account as the customer app, where both are available.
- **English only.**

## 5. Next: Phase 8c
The public web:
- shareable pages for pets, reels, contests, products and service partners, with Open Graph previews and structured data
- the sitemap and robots.txt
- the legal documents as web pages
- app links: `https://` links open the app when installed, and the website otherwise
