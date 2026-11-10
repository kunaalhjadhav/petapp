# Phase 4a — Services marketplace API: report

## 0. How this phase came together

The services backend (module, migration and end-to-end tests) was written in an earlier working session whose notes weren't carried over. Before delivering it, I **audited it rather than trusting it**:

- **Wiring:** checked that it type-checks, is wired into the app, and that its migration is applied.
- **Schema consistency:** checked the committed migrations against the schema statement by statement. They match; the only two differences come from my checking tool not understanding PostGIS columns and GIST indexes.
- **Tests:** ran its unit and end-to-end tests, then the **whole** backend suite to confirm nothing from Phases 1–3 broke.

The audit found **one real bug** (section 4), now fixed.

## 1. Implemented

| Area | What it does |
|---|---|
| **Partner onboarding** | A user creates a partner profile (business, contact, address, map location, at-centre and/or home visits with a travel radius). They upload KYC and licence documents, which are stored **privately** and seen by admins only through short-lived links. They add services and weekly opening hours (several windows a day, such as a lunch break) and time off, then **submit**. Admins approve, reject (with a reason) or suspend. Approval grants the Service partner role. Suspension hides the partner everywhere. |
| **Categories and commission** | Admin-managed service categories, each with a commission in basis points. Commission can be overridden per partner. Every booking stores its price, platform fee and partner earning in paise. |
| **Nearby search** | PostGIS geography distance by radius (default 15 km, configurable), filtered by category and mode, with distance, rating and starting price. Home visits only match customers inside the partner's travel radius. |
| **Slots** | Computed in India time from opening hours, with time off, the buffer between bookings, minimum lead time (60 minutes) and the maximum days ahead (60). Partners with several staff get several bookings at the same time ("staff slots"). |
| **No double booking** | A **Postgres exclusion constraint** refuses overlapping active bookings on the same staff slot. This holds even under concurrent requests or a code bug. When two customers race for the same slot, exactly one wins, and that's tested. |
| **Booking and payment** | A booking holds its slot for 15 minutes while unpaid. It's confirmed only by a server-verified payment, using the same payments module as contests. A late payment revives the booking if the slot is still free; otherwise the payment is marked for refund. Bookings get a short code people can read out on the phone, such as `PB-7KQ2MX` (no confusable 0/O or 1/I). |
| **Lifecycle** | Confirmed → in progress → completed, or no-show. Customers, partners and admins can cancel. |
| **Refund policy** | Customers who cancel 24 hours or more ahead get a full refund. Later but before the start, they get 50%. After the start, nothing. When a partner, admin or the system cancels, the customer always gets a full refund. All the numbers are platform settings. Refunds are recorded for execution in Phase 6. |
| **Reviews** | One per completed booking, from that booking's customer. Partners can reply. The rating average is kept consistent, and moderators can hide a review. |
| **Notifications** | Booking confirmed (to the customer, plus "New booking" to the partner), booking cancelled, partner approved or rejected, and review received. |
| **Feature switch** | Everything is behind **Services marketplace** (`ENABLE_SERVICES`). |

The API grew from 147 to **184 operations**. They're listed in `docs/API.md`, with access levels and feature flags.

## 2. Database

Migration `20261005090000_services`:

- **Extensions:** creates `postgis` and `btree_gist`.
- **Tables:** categories, partners (with a `geography(Point, 4326)` column and a GIST index), documents, services, hours, time off, bookings and reviews.
- **Notification types:** appended with `ALTER TYPE … ADD VALUE`.
- **Raw SQL (things Prisma can't express):**
  - a trigger that keeps `location` in step with `lat`/`lng`;
  - the exclusion constraint `Booking_no_overlap` on (partner, staff slot, time range) for active bookings.

**Docker and CI already use the `postgis/postgis:16-3.4` image.** On your own server, install PostGIS (on Ubuntu, `apt install postgresql-16-postgis-3`) before running migrations.

## 3. Tests

| Suite | Result |
|---|---|
| API unit | **92 passed**. New: India midnight and weekday, slots inside opening hours (09:00 IST = 03:30 UTC), lunch breaks, buffers, time off, staff slots, lead time, commission split in paise, refunds by who cancels and how early, booking codes |
| API end-to-end | **84 passed in 6 suites**. New: **9 services tests** |
| Mobile contract | Still passes against the changed API |

**What the 9 services tests cover:**

- Onboarding through approval.
- Nearby search by radius, category and mode.
- Holds that only verified payments confirm.
- **Two customers racing for one slot: exactly one wins.**
- Hold expiry and late payment, both the revived and the refunded case.
- Home-visit travel radius, and partners can't book themselves.
- The refund policy at each threshold.
- Completion, one review per booking, and an honest rating average.
- Suspension and the feature switch.

## 4. Bug found and fixed in the audit

**An expired hold blocked the slot it had released.** The app would show a slot as free after an unpaid hold expired, but booking it returned "That time isn't available any more". Inside the booking transaction, free slots were computed *before* stale holds were expired, so the expired hold still counted as busy.

Expired holds are now released first, in the same transaction that computes and books the slot. This also closes a small race window. The end-to-end test that caught it now passes.

## 5. Not yet built

- **Screens.** Coming in **4b**: the dashboard verification queue, partner review, categories and commission, and bookings; and customer app screens for search, partner page, slot picker, booking with checkout, my bookings, cancellation and reviews.
- **Partner app** (4c): onboarding, KYC upload, services, hours, the bookings calendar and earnings.
- **Payouts to partners, executing refunds, GST invoices and TDS** (Phase 6).
- **Booking reminders** (Phase 8 scheduler).
