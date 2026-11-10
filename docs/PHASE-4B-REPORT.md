# Phase 4b — Services marketplace screens: report

## 1. Implemented

### Admin dashboard: new "Marketplace" menu

| Screen | What it does |
|---|---|
| **Service partners** | The verification queue, defaulting to "Waiting for review", with tabs for approved, rejected, suspended and not submitted. Search by business, city or phone. Shows the owner, location, number of services and documents, and how long they've waited. |
| **Partner review** | A "still missing" checklist. **Documents** with status, opened through short-lived signed links (staff only, never public). **Approve** asks for an accept or reject decision on each document, with an optional note to the partner. **Reject** and **suspend** need a reason the partner sees; reinstate is also available. Also shows business details with a Google Maps link to the exact pin, services with prices and modes, opening hours in India time, bookings by status, money from completed bookings (total, platform fees, partner earnings), the rating, a per-partner **commission** override, and the history. |
| **Bookings** | Every booking: code, time, service, pet, mode, partner, customer, status, price and refund. Filters for upcoming or past, status, and partner (linked from the partner page). **Admin cancellation** needs a reason and always gives a full refund. |
| **Service categories** | Name, commission and visibility in the app. Add categories and change commission (new bookings only). |

The audit log names marketplace events in plain words, checked against the action names the API actually logs.

### Customer app

- **Pet services** (shop icon on Home, when the feature is on):
  - **Where:** uses your location, or a city you pick if location is off or refused.
  - **Filters:** category chips and "Comes to my home".
  - **Results:** distance, area, rating and starting price.
- **Partner page:** services with duration, price and where they're offered; address; opening hours; reviews with partner replies.
- **Booking:**
  - **Day and time:** pick from the next 14 days and see the free times, **always shown in India time**, whatever the phone's time zone.
  - **Pet:** only species the service accepts can be chosen; others are shown with the reason.
  - **Where:** at the centre or at home (the address is checked against the partner's travel radius).
  - **Payment:** pay via checkout. If the person closes checkout, the slot stays held for a few minutes, and they can pay later from My bookings.
- **My bookings:** Upcoming and Past.
  - **Booking page:** the code to read out, India time, the partner (with phone once confirmed), cancellation showing the refund amount, pay-later for held bookings, and a star rating with comment after the visit.
- Notifications about bookings and partners open the right screen.

## 2. API additions

The admin bookings list now accepts `partnerId`, and `when=upcoming|past` (it previously ignored `when`). Upcoming bookings are sorted soonest first. There's a new end-to-end test for both.

## 3. Tests

| Suite | Result |
|---|---|
| API end-to-end, services | **11 passed**, stable across 4 consecutive runs (new: admin booking filters, plus repeated three-way booking races) |
| API end-to-end, all suites | **86 passed** in 6 suites; API unit **92 passed** |
| Dashboard unit | **9 passed** (new: opening hours such as `9:00 am` and midnight, commission percentages) |
| Dashboard browser | **13 passed**. New: verify the demo partner — queue, pending ID, services and hours, map link, a **signed document link**, accept and approve, commission override, history — plus the categories and bookings pages |
| App contract | **79 API calls and 278 field reads across 43 models** match real responses. New fixtures come from running the whole marketplace flow against the API: onboarding, KYC upload, approval, search, slots, booking, payment, cancellation, completion and review |
| App fixture assertions | 20 of 20 new ones hold, including **the first slot being 9:00 am India time** |
| App brackets and imports | 39 files: no problems, every import resolves, every package declared |

The dev seed now includes service categories and a fictional demo partner, **Pawfect Grooming Spa**, waiting for review. The browser test resets it before and after, so it can rerun.

## 4. Problems caught before shipping

1. **The admin bookings filters didn't work.** The "this partner's bookings" link would have failed (the API didn't accept `partnerId`), and "Upcoming / Past" was silently ignored. Both are fixed in the API and tested.
2. **The category toggle would have been rejected.** The category update endpoint needs the whole category, not just the changed field. The dashboard now always sends the key and name.
3. **Audit labels:** my first guesses didn't match the action names the API logs (e.g. `partner.approve`, not `partner.review`). Corrected after checking the code.
4. **The pet picker accepted every species.** The app now records each pet's species and offers only pets the service accepts.
5. **The fixture recorder:** adding a service returns the whole partner profile, and bookings don't take a `notes` field. The recorder (and these notes) follow the real API.

### Fixed during final verification

The new repeated-race test had **two isolation bugs**, both in the test rather than the app:

1. **Rate limiting.** It fired many rounds of real bookings without resetting the rate-limit counters, so later rounds were (correctly) rejected with 429. It now resets them each round, like the other suites.
2. **Shared booking day.** It booked on the same day as the review test and included rounds at 18:00 and 19:00, after the 18:00 close. The database (correctly) refused the overlapping booking. The races now run on a day of their own, at six times 90 minutes apart, inside opening hours. Each booking blocks 75 minutes (60 for the service plus a 15-minute buffer).

**Result:** across 4 runs, 28 concurrent booking races each had exactly one winner and never a server error. That's the database exclusion constraint doing its job.

## 5. Setup notes

- **App:** adds the `geolocator` package. Add the location permissions listed in `apps/customer-mobile/README.md`.
- **Dashboard:** no new settings. Switch on **Services marketplace** in Features & settings for the app side.

## 6. Not yet built

- **The partner app** (4c): onboarding, KYC upload, services, hours, the bookings calendar, start, complete or no-show, and earnings. Partners currently need the API to do these.
- **Executing refunds and paying partners** (Phase 6).
- **Booking reminders** (Phase 8).
- **Maps inside the app.** Addresses and distance are shown; an in-app map can come later.
