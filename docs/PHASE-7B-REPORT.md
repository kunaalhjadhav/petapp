# Phase 7b — Recommendations and the home screen: report

Phase 7 is split into three parts: 7a AI moderation and account risk (delivered), **7b recommendations and an admin-arranged home screen (this report)**, and 7c the PetApp Assistant.

## 1. Implemented

### Recommendations (spec §35)
Every recommended item says why it was picked, so people (and staff) can see the reasoning.

| What | Based on | Example reasons |
|---|---|---|
| **Products** | Their pets' species and age (puppy/kitten or senior products only for pets that age); categories and brands they bought; what they look at; sales in the last 30 days; seller rating. Out-of-stock items are left out. One seller can't fill the list. | "For Coco", "Suits Coco’s age", "You bought dog food before", "Buy again", "Popular this month" |
| **Services** | Distance from them; rating (weighted so a few 5-star reviews don't beat many 4.7s); whether the partner serves their pets; categories they booked or looked at; partners they booked before (and how they rated them). | "1.2 km away", "Rated 4.8 (40)", "You booked here before", "Good for Mia" |
| **Contests** | Contests open for entries that one of their pets can still enter (species rules, places left, not already entered); categories they entered or looked at; closing soon; free entry. Then contests open for voting. | "Bruno can enter", "Entries close in 2 days", "Free to enter", "Voting is open" |
| **Reels** | The trending score, lifted by people and pets they follow, their pets' species, hashtags and creators they liked or saved. One creator can't fill a page; their own reels are left out. | "From someone you follow", "Because you have a dog", "You like #zoomies" |

- **Signed out, or personalisation off:** the same rules without personal signals, so popular, nearby and well-rated items come first.
- **Not interested:** long-press an item in the app. It disappears at once and is never recommended to that person again.
- **Privacy controls** in the app's Settings:
  - Turn personalisation off. This also deletes what they viewed.
  - Clear viewing history and "Not interested" choices.
  - See what recommendations are based on.
- **Viewing history:** product, service-partner and contest pages viewed while signed in. It is recorded once per item per day, never when personalisation is off, and deleted after 90 days by default (a nightly job; the period is an admin setting).
- **Admins** can switch personalisation off for everyone.

### Home screen (spec §61)
- **Default sections** (the spec's list, created by the migration):
  1. Featured reels
  2. Trending pets
  3. Contests
  4. Challenges
  5. Pet services near you
  6. Picked for your pets
  7. Partner offers
  8. Coming up
- **Each section fills itself for the person looking,** and is left out when it has nothing to show:
  - **Trending pets:** pets gaining the most followers and likes this week.
  - **Partner offers:** coupons admins pick, shown only while usable.
  - **Coming up:** their own next bookings and contest deadlines first, then contests opening and challenges starting in the next 30 days.
- **Feature switches apply:** with the shop off, product and offer sections disappear (the same goes for services, contests and reels).
- **Admin dashboard → Configuration → Home screen:**
  - Add, rename, reorder (up/down), switch off or delete sections.
  - **Schedule** a section (show from / until).
  - **Limit a section** to some cities, or to people with a pet of certain species.
  - **Number of items** per section (1–20).
  - **Pin items** to the front of a section by pasting a link, @handle, slug, coupon code or id. Pins that can't be shown right now (ended, sold out, hidden) are marked and skipped.
  - **Preview** what someone in a chosen city sees, with each pick's reason, plus a list of sections left out and why ("only for other cities", "scheduled for later", "Services is switched off", "no offers picked yet").
  - **Recommendation settings:** personalisation on/off and how long viewing history is kept.
  - Every change is in the audit log.
  - **Permissions:** a new "home.manage" permission is given to admins. Viewing needs settings access.

### Customer app
- **New Home tab:**
  - **Top bar:** the place (your location or a chosen city), search and notifications (with the unread badge).
  - **Below the bar:** shortcuts to the parts that are switched on, then the sections, then posts (Following / Discover) as before.
- **Search:** pets by name, shop products, and posts by #hashtag.
- **Reels tab:** now "For you" (recommended), still paged with no repeats.
- **Shop:** a "Picked for your pets" row above the products when nothing is filtered. Offers open the seller's products.
- **Settings:** a Recommendations section (personalisation switch, clear history).
- **Shared place:** the chosen place is now shared by the home screen and services search.

### API additions
- **Home:** `GET /home` (the home screen for a place: `lat`, `lng`, `city`; without them, the saved address).
- **Recommendations:** `GET /recommendations/products`, `/services`, `/contests` and `/reels` (cursor-paged), and `POST /recommendations/dismiss`.
- **Personalisation:**
  - `GET /me/recommendations` and `PUT /me/recommendations` (personalisation on/off)
  - `DELETE /me/recommendations/history`
- **Admin home sections:**
  - `GET`/`POST /admin/home-sections`, `GET`/`PATCH`/`DELETE /admin/home-sections/{id}`
  - `PUT /admin/home-sections/order`
  - `POST /admin/home-sections/{id}/pins`, `DELETE /admin/home-sections/{id}/pins/{itemId}`
  - `GET /admin/home-sections/preview`
- **Changed:**
  - Product, service-partner and contest pages accept an optional sign-in (to record views).
  - Contest cards now include their category's id.
  - The product list accepts `vendorId` in the app.
- The API reference was regenerated (305 operations).

### Database
- **Migration `20261014090000_home_reco`:**
  - `HomeSection`, with the 8 default sections and checks on item count and schedule.
  - `InterestEvent`: viewing history, one row per item per day.
  - `RecoDismissal`: "Not interested".
- **New settings:** `reco.personalisationEnabled` (on) and `reco.historyDays` (90).

## 2. Verification
- **Backend unit tests:** 170 pass (17 new for the ranking rules: life stage, product/service/contest/reel ranking and reasons, diversity, section targeting, pins).
- **Backend end-to-end:** 148/148, including 13 new tests:
  - Products for the right pets and age.
  - Views recorded once a day and shaping picks.
  - "Not interested".
  - Personalisation off deleting history and stopping recording.
  - The platform switch.
  - Nearby services for the right pets.
  - Contests pets can still enter.
  - Reels paging without repeats, with followed creators first.
  - Admins building, ordering, targeting, scheduling and pinning sections.
  - Offers.
  - Feature switches.
  - Preview reasons.
  - "Coming up" with a booking.
  - The saved address used as a fallback.
  - History purge.
- **Dashboard browser tests:** 21/21, including 2 new ones (build a section, move it, limit it to a city, pin a pet, preview in two cities, delete; history-days validation).
- **Customer app:**
  - Contract check: 108 API calls; 483 field reads across 71 models, against responses recorded from the running API by the new `tool/record_home_fixtures.py`.
  - New Dart tests in `test/home_test.dart`, mirrored in Python (`scripts/check_home_mirrors.py`).
  - Name and bracket checks.
  - The partner and seller apps' checks still pass.
- **Live check:** a recorded home screen for a signed-in customer with a puppy showed:
  - The followed creator's reel first ("From someone you follow").
  - Trending pets, challenges and nearby partners.
  - Products ranked by what they had viewed.
  - The pinned offer and upcoming items.

## 3. Problems found and fixed
- **Dashboard deletes failed:** the API answers "204 No Content" when something is deleted, and the dashboard's API helper treated the empty reply as an error. It now accepts it (this affects every delete from now on).
- **Coupon percentages are in basis points** (1000 = 10%). The app's offer text and the tests now use the same unit.
- **Ranking weights** were tuned with the tests:
  - Someone you follow outranks a moderately trending stranger.
  - A partner you booked before beats one slightly nearer.
  - Puppy food sinks to the bottom for an adult dog rather than vanishing (life stage is read from the title, so it's a strong hint, not a rule).
- **The services search and the home screen kept separate places;** they now share one.
- **One run of an existing finance browser test failed** after many logins in a row (sign-in throttling); it passed on every rerun.

## 4. Known limitations
- **The customer app has not been compiled** (no Flutter SDK here). The checks above cover API calls, JSON fields and test expectations, but run `flutter analyze` and `flutter test` first.
- **Product age matching uses words in the title** ("puppy", "kitten", "senior", "7+"). Products have no age field yet; sellers could be given one later.
- **Products and breed:** products don't record a breed, so breed isn't used. Contests have no location, so location isn't used for them.
- **Candidate pools are capped:** 400 products, 80 nearby partners and 400 recent reels per request. This is fine for now; at scale, precompute per-segment lists in the worker.
- **The Reels "For you" order is cached for 10 minutes per person** so pages don't repeat. Pull to refresh re-ranks.
- **Trending pets** is one list for everyone (refreshed every 5 minutes), apart from hiding their own pets and blocked owners.
- **"Upcoming events"** covers bookings, contest deadlines and contests/challenges starting soon. PetApp has no separate events module yet.
- **City targeting** matches the city chosen in the app or the saved address. With "Use my location" and no saved address, city-limited sections aren't shown (there's no reverse geocoding).

## 5. Next: Phase 7c
The PetApp Assistant: in-app help finding services, products, contests and challenges, and getting around the app. It will clearly separate general guidance from veterinary diagnosis, and stays behind `ENABLE_AI_ASSISTANT`.
