# Privacy and legal

How PetApp handles personal data, and what staff need to do before launch. This describes the software. It is not legal advice: have a lawyer review the legal documents and this setup against the Digital Personal Data Protection Act, 2023 (DPDP Act), the IT Act 2000 with the IT Rules 2021, and the Consumer Protection (E-Commerce) Rules 2020.

## Before launch

1. **Legal documents.** In the dashboard, open **Configuration → Legal documents**. Eight drafts are seeded from templates:
   - Terms of Service
   - Privacy Policy
   - Contest Terms
   - Refund Policy
   - Cancellation Policy
   - Service Partner Terms
   - Seller Terms
   - Community Guidelines
2. **Have a lawyer review each one.** Check that the policies match how you actually operate: refund windows, cancellation fees, payout timing, data retention.
3. **Fill in every `{{placeholder}}`:**
   - company legal name and registered address
   - Grievance Officer name and email
   - payment gateway, cloud provider and region, AI provider
   - time limits
4. **Publish.** Publishing is refused while placeholders remain.
5. **Match the settings to the policies.** Check that the retention settings below agree with what the Privacy Policy says.

## Legal documents and consent

- **Versions.** Each document has numbered versions:
  - **A draft** is edited in the dashboard: Markdown text, a "what changed" summary, and whether people must accept it.
  - **Publishing** makes the draft the current version and retires the previous one.
  - **Published versions can't be edited.** Start a new version instead.
  - **Audit.** Publishing is recorded in the audit log (`legal.publish`).
- **Public reading.** `GET /api/v1/legal` and `GET /api/v1/legal/{slug}` need no sign-in. The customer app links them from the sign-in screen and from **Settings → Your data and privacy**.
- **Who must accept what:**

  | Document | Asked of | When |
  |---|---|---|
  | Terms of Service, Privacy Policy | everyone | on the next app start after a version is published |
  | Contest Terms | anyone entering a contest | when they enter (the API refuses entry until accepted) |
  | Service Partner Terms | service partners | when they submit for verification |
  | Seller Terms | sellers | when they submit their store |

  The API refuses these actions with `403` and the error code `TERMS_NOT_ACCEPTED`, naming the document. The apps then show it, record acceptance and try again.
- **Consent records** (`ConsentRecord`) store who accepted which version, when, from which IP address and app.
  - **Marketing:** turning offers and news on or off is recorded too.
  - **Append-only:** a database trigger refuses any change to an existing row, so the history is evidence.
  - **After erasure:** the records are kept.

## Data export (right to access)

- **Asking for a copy.** In **Settings → Your data and privacy**, a person asks for a copy of their data. One can be in progress at a time, and at most one a day.
- **Building it.** The worker builds one JSON file containing:
  - profile, sign-in methods and sessions, devices, addresses
  - pets and health records
  - posts, comments, likes, saves, follows, blocks and reports made
  - notifications
  - orders, returns, bookings and reviews
  - payments, refunds and invoices
  - contest and challenge entries, votes and badges
  - payout accounts and payouts
  - assistant chats, viewing history, consents
  - their business profile, if they have one
- **What's never included:** secrets and internal identifiers (password and token hashes, encrypted bank numbers, storage keys).
- **Storage.** The file is stored privately under `exports/` and is never served through the CDN.
- **When it's ready.** A notification says so, and the app downloads it through a five-minute signed link.
- **Expiry.** Copies expire after `privacy.exportDays` (7) and the file is deleted nightly.

## Account deletion (right to erasure)

1. **The request.** **Delete account** signs the person out everywhere and marks the account for deletion.
2. **The grace period.** It lasts `privacy.deletionGraceDays` (14). Signing in during it cancels the deletion: the app says "Welcome back! Your account won't be deleted."
3. **Erasure.** After the grace period the nightly job (05:00 India time) erases the account.
4. **Held back.** An account is held back, and tried again each night, while any of these is in progress:
   - an order parcel not yet delivered
   - a booking not yet completed
   - a return
   - a refund not yet paid
   - a payout in progress
   - money still owed to them

   For their business, the same applies to customer bookings and orders not yet done. The reason is shown on the dashboard's **Privacy requests** page.

**Erased:**
- the profile: name, phone, email, password, photo, gender, birthday, city, preferences, marketing choice
- sign-in methods, sessions, push tokens
- addresses, notifications, cart
- follows, blocks, likes and saves (other people's counters are corrected)
- comment text
- posts (with captions and locations) and their photos and videos in storage
- pets' private details: health records, microchip, medical notes, birthday, weight, location, photos
- assistant chats, viewing history, data exports, risk records
- the details written in reports they made
- bank account numbers on payout accounts (the last four digits stay on past payouts)

**Kept without the profile,** because tax and accounting law require it:
- orders, bookings, payments, refunds and invoices
- ledger entries and payouts
- contest and challenge records
- the user row itself, empty, so those records still point somewhere

Pets stay only as names on past contest results.

Consent records and the audit log are kept as evidence.

**Businesses.** A service partner or seller business owned by the account is suspended. Its products are taken off sale, and its business records stay. Verification documents are kept for compliance; agree a retention period with your lawyer.

**Phone number.** It becomes free: signing in with it later starts a brand-new account.

**Staff.** On the dashboard's **Privacy requests** page:
- **Erase now** skips the rest of the grace period. It is still held back for the reasons above.
- **Cancel deletion** is for when the person asks support to cancel.

Both need the `privacy.manage` permission and are audited.

## Chats and support (Phase 9a)
- **In the data export:** conversations the person is in (as a customer), messages they sent as a business, and their support tickets. Staff notes are never included.
- **On erasure:** their conversations and support tickets are deleted. Messages they sent in other people's conversations (as a partner or seller) are blanked and shown as "removed".
- **Photos:** chat and ticket photos are private. They are stored under `private/` and only given out as signed links that expire after 15 minutes, to the people in the conversation (and staff, for tickets). Location data is stripped from them like every other photo.
- **Who reads chats:** nobody at PetApp, unless a message is reported or flagged by AI moderation. Moderators then see that message and a few around it.

## Reviews and reports (Phase 9b)
- **What's public on a review:** the stars, the words, the photos, the size bought, and the reviewer's first name and initial ("Riya S."). The full name, phone and order details stay private; the business sees the same first name and initial plus which order or booking it was.
- **Only real customers:** a product can be reviewed only by someone it was delivered to, and a service only after a completed booking.
- **Report screenshots** are private uploads: only moderators see them, through links that expire after 15 minutes. The reported person is never told who reported them.
- **In the data export:** product reviews (in `shop.reviews`), service reviews, and reports they made with their screenshot ids.
- **On erasure:** their reviews keep the stars (so ratings stay honest) but lose the words and photos, and show as "PetApp user". Report details and screenshots are removed.

## Search and discovery (Phase 9c)
- **Search finds only public things:** public pets, published public reels, listed products, approved businesses, and contests and challenges people can see. Searching people shows only their name, photo and city, never a phone number or email; staff accounts never appear. People you blocked (and who blocked you) and their pets and reels never appear.
- **Pets near you is opt-in,** per pet, by its owner ("Show in Pets near you", off by default). Turning it on saves the phone's position rounded to about 1 km. Others see only a distance rounded up to whole kilometres, never coordinates.
- **PIN code lookups** only read the location database; nothing about the person is stored.

## Analytics, memberships and promotions (Phase 9d)
- **Activity:** PetApp records the day someone used the app (India time), once a day, and nothing about what they did. Analytics show only totals and averages; no report lists a named customer's activity. Reel views are counted per day without who watched.
- **Promotions are opt-in:** "Offers and announcements" is off until the person turns it on. Turning it on or off is recorded (when, and by whom) as evidence of marketing consent. Promotions reach at most `promotions.dailyLimit` a day, and never staff.
- **Reminders and vote updates** are on by default and can be switched off in Settings; account and safety notices can't.
- **Memberships:** what someone bought, when, and for how much is kept with their payments (financial records). The member badge shows only the plan's name.
- **On erasure:** the days someone was active are deleted; a running membership ends, and the membership records stay with their payments as financial records. A copy of their data includes their memberships and the days they used the app.

## Staff accounts (Phase 9e)
- **Password resets:** a reset link stores only a hash of its token, when it was asked for, and the IP address that asked (to look into abuse). Links expire after 30 minutes and are deleted with the account.
- **Emails** to staff are only about their account: reset links, and a notice when their password changes or a recovery code is used.
- **Two-factor sign-in** (Phase 10a): the authenticator secret is stored encrypted; recovery codes only as hashes. Both are removed when two-factor is turned off or reset.

## Maps (final release)
- **Off by default** (`MAP_PROVIDER=none`): place search uses only PetApp's own location database.
- **With `MAP_PROVIDER=google`:** what someone types in the place search, and their position rounded to about 100 m (to name the area), are sent to Google's Geocoding API from PetApp's servers, never with a name, phone number or account id. Answers are cached for a day without saying who asked. List Google as a processor in the privacy policy before turning it on.

## Saved on the phone (Phase 10b)
- **Offline copies:** the customer app keeps the last answer of a few of the person's own screens (profile, pets, home, feed, notifications, bookings, orders, addresses, membership) on the phone, so they still show without a connection. Never payments or chats. Everything is deleted when the person signs out, is signed out, or deletes their account.
- **Payments waiting to be confirmed** (the gateway's payment id and signature, no card details) are kept until the API confirms them, for at most 3 days, and are deleted at sign-out.

## Retention

| Data | Kept for | Setting |
|---|---|---|
| Viewing history (recommendations) | 90 days | `reco.historyDays` |
| Assistant chats | 30 days | `assistant.historyDays` |
| Data export files | 7 days | `privacy.exportDays` |
| Deletion grace period | 14 days | `privacy.deletionGraceDays` |
| Financial records | as tax law requires (8 years is typical; confirm with your adviser) | not purged by PetApp |

Nightly jobs (India time):
- 04:30 viewing history
- 04:40 assistant chats
- 04:50 expired exports
- 05:00 account erasure

## Permissions

| Permission | Allows | Default roles |
|---|---|---|
| `settings.read` | Read legal documents in the dashboard | Admin, Super admin |
| `legal.manage` | Edit and publish legal documents | Admin, Super admin |
| `users.read` | See privacy requests | Moderator, Support, Admin, Super admin |
| `privacy.manage` | Erase now, or cancel a deletion | Admin, Super admin |

## API

- **Public:**
  - `GET /legal`
  - `GET /legal/{slug}`
- **Signed in:**
  - `GET /me/consents`, `POST /me/consents` (`{ slug, version }`)
  - `PUT /me/marketing` (`{ granted }`)
  - `GET /me/data-exports`, `POST /me/data-exports`
  - `GET /me/data-exports/{id}/link`
  - `DELETE /users/me` (answers with `graceDays` and `eraseAfter`)
- **Staff:**
  - `GET /admin/legal`, `GET /admin/legal/{id}`
  - `POST /admin/legal` (new version)
  - `PATCH /admin/legal/{id}`, `DELETE /admin/legal/{id}` (drafts only)
  - `POST /admin/legal/{id}/publish`
  - `GET /admin/privacy/deletions`
  - `POST /admin/privacy/deletions/{userId}/erase`
  - `POST /admin/privacy/deletions/{userId}/cancel`
