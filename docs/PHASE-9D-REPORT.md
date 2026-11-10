# Phase 9d — Analytics, memberships and reminders: report

Phase 9d covers:
- admin analytics (spec §55)
- the membership architecture (spec §40), off by default
- reminders and notification categories (spec §36), including opt-in promotions

## 1. Implemented

### Admin analytics (spec §55)
The dashboard has a new **Analytics** page (**Workspace → Analytics**) with five reports. Each one covers any range of India-time days (the last 7, 30 or 90 days in one tap, up to a year), compares every figure with the same number of days just before, draws each daily trend, and downloads as a CSV.

| Report | Figures | Charts and tables |
|---|---|---|
| **Users** | daily active (average), active on the last day, monthly active, active in the period, new sign-ups, daily ÷ monthly active, day-1, day-7 and day-30 retention | daily active users, sign-ups; retention by sign-up week |
| **Reels** | views, completion rate, likes, comments, shares, saves, engagement rate, reels published, people who posted | views, watched to the end, engagement; most-viewed reels |
| **Contests** | registrations, people who entered, entry fees paid and refunded, votes, people who voted, votes held for review, winners declared, contests open now | registrations, votes; each contest with its figures |
| **Shop** | orders, gross sales (GMV), average order value, items sold, buyers, coupon discounts, parcels cancelled, returns, return rate, refunds | orders, GMV; top sellers |
| **Services** | bookings, booking value, average booking, customers, visits completed, PetApp booking fees, cancellation rate, cancelled by partners, no-show rate, home visits | bookings, booking value; partner performance |

- **How activity is counted:**
  - **Active users:** someone counts as active on a day when they use the app signed in. One row per person per day is kept (`UserActivity`), never what they did. Staff on the dashboard aren't counted.
  - **Reels:** views are counted once per viewer per reel per day, per day (`PostDailyStat`). The app now reports when a reel plays to its end, which gives the completion rate.
- **Access and privacy:** only totals and averages are shown, never one person's activity. The new permission `analytics.read` is held by admins and Finance.
- **Caching:** reports are cached for five minutes, or an hour for ranges that have ended.

### Memberships (spec §40)
- **Plans:**
  - Free, Plus (₹149 a month) and Premium (₹399 a month) are seeded. Prices, lengths, order and benefits are edited in **Growth → Membership plans**, and admins can add plans (a yearly plan, say).
  - A price change applies to new purchases only.
- **Benefits, each enforced by the API:**

  | Benefit | What it does |
  |---|---|
  | **Members-only contests** | A contest marked members-only takes entries only from members whose plan includes this. |
  | **Premium challenges** | The same for challenges marked members-only. |
  | **Member discounts** | Coupons marked members-only (PetApp's, or a seller's own offer) work only for members. |
  | **Priority booking** | Premium members see and book service slots this many days further ahead than everyone else (30 by default). |
  | **Member badge** | "Plus member" shows on the profile. |

- **Off by default:** **ENABLE_MEMBERSHIPS** is off. While it's off, the app shows no plans and nothing is members-only. Even when it's on, nothing is members-only until an admin marks a contest, challenge or coupon. Someone who already paid keeps their benefits if the feature is switched off later.
- **Buying and renewing:**
  - Memberships are paid through the payment gateway and start only when the payment is verified. Each one is a fixed period; nothing renews on its own.
  - People can renew early: the new period starts when the current one ends, up to `memberships.maxPeriodsAhead` periods ahead.
  - Switching to another plan waits until the current one ends.
  - A payment that can't be honoured any more (the person switched plans meanwhile) is refunded automatically.
- **Accounting:** the fee is booked as membership revenue, less GST at the fees rate. This adds the `MEMBERSHIP_REVENUE` account and `MEMBERSHIP_EARNED` postings.
- **Staff:**
  - **Growth → Members** lists every membership, with filters for current, paid ahead, ended and unpaid, plan, and name or phone.
  - Staff can give a membership (a goodwill gesture or a prize) or end one early, with a reason. Both are audited, and the person is told.
  - New permissions: `memberships.read` (Support agents and Finance have it) and `memberships.manage` (admins).
- **Notifications:** people are told when their membership starts, when it's renewed, three days before a paid membership ends without a renewal, and when it ends.

### Reminders and notification categories (spec §36)

| Notification | When it's sent | Setting |
|---|---|---|
| **Booking reminder** | before a confirmed visit | `reminders.bookingHoursBefore`, 24 hours by default. Visits booked less than 3 hours ahead aren't reminded. |
| **Contest reminder: submit** | before submissions close, to entrants who haven't submitted | `reminders.contestHoursBefore` |
| **Contest reminder: voting** | before voting closes, to entrants still in the running | `reminders.contestHoursBefore` |
| **New votes** | "Luna got 12 new votes", at most once an hour per entry, counted at the end of the hour | votes held as suspected fraud don't count |
| **Membership** | started, renewed, ending soon, ended, or ended by PetApp | — |
| **Promotions** | offers and announcements written in **Growth → Promotions** | only to people who opted in |

- **Each reminder goes out once,** and the worker checks them every 15 minutes.
- **New settings in the app:**
  - **Reminders** and **Votes on your entries** are on by default.
  - **Offers and announcements** is off until the person turns it on. Turning it on or off is recorded as evidence of marketing consent.
- **Promotions:**
  - **Audience:** everyone who opted in, members who opted in, or one city.
  - **Timing:** sent now or scheduled up to 30 days ahead; queued ones can be cancelled.
  - **Limits:** at most `promotions.dailyLimit` a day per person. Never sent to staff.
  - **Links:** a promotion can only open a page inside the app (`/shop`, `/contest/…`). The API refuses other links and the app ignores them.
  - **Audience size:** the page shows how many people a promotion can reach right now.

### In the customer app
- **Membership screen:** shows your plan, the plans with their benefits, joining or renewing through the payment gateway, and earlier memberships. It opens from Settings and from your profile when memberships are on.
- **Member badges:** shown on profiles.
- **Members-only labels:** on contests ("Members only") and challenges ("Premium · members only").
- **Settings:** new switches for reminders, votes and offers.
- **Notification taps:** a membership notification opens the Membership screen; a promotion opens its page in the app.
- **Reels:** they report when they've played to the end.

### Dashboard
- **New pages:** **Analytics**, **Membership plans**, **Members** and **Promotions**.
- **Members-only switches:** on the contest form, the new-challenge form and the new-coupon form.
- **Finance:** shows membership payments and postings by name.
- **Audit log:** names every new action.

### Privacy
- **Data export:** a copy of someone's data now includes their memberships and the days they used the app.
- **Account deletion:** erasing an account deletes those days, and ends any running membership. Membership records stay with their payments as financial records.

## 2. Verification

| Check | Result |
|---|---|
| API unit tests | 228 pass (11 new: analytics, membership and reminder rules, and the new notification texts) |
| API end-to-end tests | 261 pass, 20 suites (21 new in `insights.e2e`). Covers: <br>• activity counted once a day, app sessions only <br>• active users, sign-ups and retention <br>• permissions, date checks and caching <br>• reel views, completions and engagement <br>• orders, GMV and average order value <br>• bookings, cancellations and partner performance <br>• contest reminders (once each, respecting the setting) <br>• vote updates (once an hour, held votes left out, respecting the setting) <br>• voting-close reminders and contest analytics <br>• booking reminders (once, not for last-minute bookings, switched off at 0) <br>• memberships hidden while off; buying through the gateway, with the ledger posting, notification and badge <br>• renewing ahead within the limit, and waiting to switch plans <br>• refunding a payment that can't be honoured <br>• members-only contests, premium challenges and member coupons <br>• priority booking <br>• staff plans, gifts and ending memberships, with audit rows <br>• the ending-soon warning and expiry <br>• promotions: opt-in, audiences, links, push setting, daily limit and cancelling |
| Dashboard browser tests | 36 pass (3 new: the analytics reports, dates and CSV; adding a plan, then giving and ending a membership; scheduling and cancelling a promotion) |
| Dashboard unit tests | 24 pass (4 new: figures, comparisons, ranges and the CSV) |
| Website browser and unit tests | 13 and 13 pass |
| App ↔ API contract checks, all three apps | Pass (new fixtures recorded from the running API by `record_membership_fixtures.py`) |
| Python mirrors of the Dart tests | 10 sets pass (new: `check_membership_mirrors.py`) |
| Lint, typecheck, bracket and name checks, schema drift | Pass |
| API reference | Regenerated: 429 operations |

## 3. Problems found and fixed
- **Notifications sent before the payment committed:** the "Welcome" notification was queued inside the payment's transaction, so the worker could read the membership before it started, and say "until its end date". The worker now waits and retries until the membership has started.
- **Renewals:** a renewal said "Welcome to Plus" again. It now says "Membership renewed" with the new end date.
- **Chart axis labels:** labels were too small and showed "0.5" for counts. They are now larger, use whole numbers for small counts, and leave room for amounts in rupees.

## 4. Known limitations
- **The Flutter apps weren't compiled here,** because no SDK is available. CI's mobile jobs run `flutter analyze` and `flutter test`, including the new `membership_test.dart`. The logic is covered by the Python mirror and the contract check.
- **Analytics history starts now:** daily active users and per-day reel views are recorded from Phase 9d onwards. Earlier days show none.
- **Membership revenue is booked at payment,** not spread over the membership's length. Ending a membership early doesn't refund it automatically; finance records a refund when one is owed.
- **Memberships don't renew automatically.** Recurring payments (e-mandates) are not built.
- **Promotions are sent one push at a time** per device. That's fine for tens of thousands of people; for more, a provider's topic or batch sending should be added.
- **The partner and seller apps** don't show memberships, and the seller app has no members-only switch on coupons yet. PetApp staff can mark any coupon members-only in the dashboard.

## 5. Next: Phase 9e
- staff password change and reset by email (an email provider)
- resumable uploads (spec §84)
