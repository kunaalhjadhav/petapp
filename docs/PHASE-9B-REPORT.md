# Phase 9b — Reviews and reporting: report

Phase 9b covers:
- reviews and ratings (spec §38)
- the reporting system and its dashboard (spec §59)

## 1. Implemented

### Reviews (spec §38)
- **What can be reviewed:**
  - products
  - services and the partners who provide them
  - both are 1–5 stars, with optional words and up to 4 photos
- **Only real customers:**
  - **Products:** someone can review a product only once a parcel with it has been delivered to them. The review keeps that parcel and the size bought, and shows **Verified purchase**.
  - **Services:** reviewed after a completed booking, as before, and shown as **Verified booking**.
  - **One review each:** one per person per product, and one per booking.
- **Ratings:**
  - Products now have an average and a count, and so do sellers (across all their products).
  - Product pages, partner pages and seller dashboards show a breakdown by stars.
  - Averages are recomputed in the same database transaction that adds, hides or restores a review. That includes a moderator hiding one from a case, which previously didn't update a partner's rating.
- **Replies:**
  - Sellers and partners have a **Reviews** screen in their app, with unanswered reviews first.
  - They can reply once, publicly. The reviewer gets a notification that opens the product or the booking.
  - The business also gets a notification for each new review.
- **Moderation:**
  - Reviews with words or photos are checked by AI moderation.
  - **Community → Reviews** in the dashboard lists product and service reviews, with search and star filters. A reported or flagged review links to its case.
  - **Hide** (with a note for the audit log) takes a review out of the rating at once, and **Show again** restores it. A hidden review still shows to its writer and to the business, marked as hidden, and can't be replied to.
- **Privacy:** reviews show the reviewer's first name and initial ("Riya S."), never their full name. This now also applies to existing service reviews.

### Reporting (spec §59)
- **What can be reported:**
  - a person, a pet, a post or reel, a comment
  - a product, a service business
  - a product or service review
  - a contest entry
  - a chat message
- **What a report holds:** a reason, optional details, and up to 3 screenshots. Screenshots are uploaded as private photos that only moderators can see, through links that expire.
- **Reports from the apps:** every report button in the customer app opens one report screen. New report buttons were added to:
  - products
  - partner pages
  - each review
  - contest entries on the leaderboard
- **The reports dashboard (Community → Reports):** one row per report. Each row shows:

  | Column | What it shows |
  |---|---|
  | Report type | What kind of thing was reported |
  | Reason | The reason and the reporter's details |
  | Reporter | Who sent the report |
  | Reported entity | A short label, its owner and its status |
  | Evidence | Screenshot thumbnails |
  | Status | Open, action taken or dismissed |
  | Moderator | Who decided the case |
  | Resolution | The decision and its note |

  - **Header:** counts for open reports, today, the last 7 days, action taken and dismissed, plus open reports by type.
  - **Filters:** status, type, reason, a search of the details or the reporter, and a date range in India time.
  - **Decisions:** rows link to the case, where the decision is made.
- **Cases:**
  - Show the screenshots under each report.
  - Show reviews with their photos and the business's reply.
  - A reported business can't be hidden from a case. It is suspended from its partner page, where bookings and payouts are handled, and the case page says so.

### Website
- **Product and service pages:** the rating, the star breakdown and the latest reviews, with photos and replies.
- **Search engine data:** `aggregateRating` and up to three `review` items.
- **Bug fixed:** service pages read the review date from a field the API never sent. They now use the right one.

### Privacy
- **Data export:** includes product reviews and the screenshots attached to reports.
- **Erasure:** keeps a review's stars, so ratings stay honest, but removes its words and photos and shows the reviewer as "PetApp user". Report details and screenshots are removed.

## 2. Verification

| Check | Result |
|---|---|
| API unit tests | 209 pass (5 new: review rules) |
| API end-to-end tests | 226 pass, 18 suites. 11 new tests in `reviews.e2e` cover: delivery required, photo ownership, one review each, ratings and breakdowns on pages and cards, sorting by rating, filters, seller and partner replies with notifications, the admin list, hiding and restoring (ratings follow, audit rows), reporting every type with screenshots, the reports dashboard (filters, dates, summary, moderator and outcome), hidden service reviews leaving the partner's rating, and erasure. `trust.e2e` was updated because listings are now reportable. |
| Dashboard browser tests | 30 pass (2 new: hiding and restoring a review checks the product's rating; a report row through to its case and back with the moderator and outcome) |
| Dashboard unit tests | 20 pass |
| Website browser tests | 13 pass (new: a product with a review, a verified purchase, first name and initial only, and its structured data) |
| Website unit tests | 13 pass |
| App ↔ API contract checks, all three apps | Pass, against new fixtures recorded from the running API by `record_review_fixtures.py` |
| Python mirrors of the Dart tests | 8 sets pass (new: `check_reviews_mirrors.py`, which also checks the shared files are the same in each app) |
| Bracket and name checks, lint, typecheck | Pass |
| API reference | Regenerated: 378 operations |

## 3. Problems found and fixed
- **Hidden reviews still counted:** when a moderator hid a service review from a case, the partner's average didn't change. Every path that changes a review's visibility now recomputes the rating in the same transaction.
- **Website review dates:** service pages read `createdAt`, which the API never sent. They now use `at`.
- **Report screen choices:** the newest Flutter radio-group widget isn't in the Flutter version the release build pins (3.27). The report screen uses a plain list of choices instead.
- **Rounding of the star bars:** with ties, the percentages could add up differently from run to run. They now always add up to 100, with ties going to the higher star.

## 4. Known limitations
- **The Flutter apps weren't compiled here,** because no SDK is available. CI's mobile jobs run `flutter analyze` and `flutter test`, including the new `reviews_test.dart` in each app. The logic is covered by the Python mirrors and contract checks.
- **Reviews can't be edited or deleted** by their writer once posted, and replies can't be edited. Staff can hide either.
- **Star-only ratings aren't checked by AI:** a review with no words and no photos has nothing to check. It still counts towards the rating, and can be reported or hidden like any other.
- **Unverified reviews aren't possible.** Everyone who can review is verified, so the "verified" label is on every review.

## 5. Next: Phase 9c
- global search
- pet discovery (nearby and trending pets)
- the location database, with cities, areas, coverage and delivery zones managed in the dashboard
