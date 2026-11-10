# Phase 9c — Search, discovery and locations: report

Phase 9c covers:
- global search (spec §43)
- the location database (spec §44)
- admin location management (spec §45)
- pet discovery (spec §62)

## 1. Implemented

### Global search (spec §43)
- **What one search finds:**
  - pets and people
  - reels, including by #hashtag
  - products, services and service businesses
  - contests and challenges
- **Tabs:** the **All** tab shows the best few of each kind, each with **See all**. Each kind also has its own tab.
- **Filters that fit each kind:**

  | Kind | Filters |
  |---|---|
  | Pets | animal |
  | Products | category, animal, in stock |
  | Services | category, home visit, near me (sorted by distance) |
  | Businesses | category, near me |
  | Contests | category; open, voting or finished |
  | Challenges | on now, starting soon or finished |

  - A single filters endpoint tells the app which kinds are switched on and what each filter's choices are.
- **Ranking:** exact names first, then names that start with the words, then a word that starts with them, then anything containing them. Ties go to popularity. Trigram indexes (`pg_trgm`) keep it fast.
- **Privacy:**
  - **What can be found:** only public things — public pets, published public reels, listed products, approved businesses, and contests and challenges people can see.
  - **People:** only their name, photo and city are shown, never a phone number or email. Staff accounts never appear.
  - **Blocked people:** people you blocked (or who blocked you) and their pets and reels never appear.
  - **Abuse limits:** queries are cleaned and capped, and search is rate-limited.

### Pet discovery (spec §62)
- **Trending:** pets gaining followers and engagement this week.
- **Pets near you:**
  - **Opt-in:** each owner turns it on per pet ("Show in Pets near you", off by default). The phone's position is rounded to about 1 km before it's saved.
  - **What others see:** only a distance rounded up to whole kilometres, never coordinates.
  - **Who's left out:** your own pets and people you blocked.
- **Popular reels.**
- **Contest and challenge participants:** pets entered in open or voting contests, and pets in challenges that are on now, by points.
- **Sharing:** pet profiles keep their share button, and the website page from Phase 8c.

### Location database (spec §44)
- **What it holds:** countries, states, cities, areas (localities) and PIN codes, each with optional coordinates. Points are PostGIS geography kept in step by database triggers.
- **Seeded:** India, its 36 states and union territories, and 32 major cities.
- **Public lookups:**
  - states and cities
  - a city's areas
  - a PIN code's city, state and area
  - the nearest city and area to a point
  - service coverage at a point

### Admin location management (spec §45)
The dashboard has a new **Locations** section.
- **Cities and areas:**
  - Add and edit cities, with switches to turn a city off and to make its services live.
  - Add areas one by one.
  - Add PIN codes one by one, or import a CSV (`pincode,area,lat,lng`). Imports have a **Check** step that changes nothing, and errors are listed line by line. A PIN code already in another city is reported, not moved.
- **Delivery zones:**
  - **What a zone covers:** PIN codes or prefixes (`4110*`), cities and states.
  - **What it sets:** whether the shop delivers there, the shipping per parcel and the free-above amount (blank means the standard settings), and the earliest and latest delivery days.
  - **Matching:** the most specific zone wins.
  - **Checking:** a PIN-code checker shows which zone applies.
  - **Outside every zone:** the standard shipping applies, unless `marketplace.deliveryZonesOnly` is on.
- **Service coverage:**
  - Shows each city's approved partners and home-visit partners within `locations.coverageRadiusKm`, and how many partners are outside coverage.
  - Services are switched on city by city. Until one city is on, services show everywhere.
- **Partner locations:**
  - Every partner's address, map point, home-visit radius, nearest city and coverage.
  - Filters: near a city, or outside coverage.
  - Staff can correct a location with a reason, which goes in the audit log. Partners still set their own radius in their app.
- **Access:** new permissions `locations.read` (Support agents have it) and `locations.manage` (admins). Every change is audited.

### Checkout
- **Pricing for an address:** the checkout preview can be priced for one address. Shipping follows its zone, and the result says whether the shop delivers there and how fast.
- **Placing the order:** an order to an address the shop doesn't deliver to is refused.
- **In the app:** checkout now shows the delivery time and the final shipping for the chosen address before paying.

### In the customer app
- **Search:** the new global search replaces the old pets-products-hashtags search.
- **Discover pets:** a new **Discover pets** screen, opened from the home shortcuts.
- **Pets near you:** a **Show in Pets near you** switch on your pet's page.
- **Addresses:** they fill in the city, state and area from the PIN code.
- **City picker:** it uses the location database instead of a built-in list. The built-in list stays only as a fallback when the cities can't be loaded.
- **Coverage:** the services screen shows a notice where PetApp services aren't available yet.

## 2. Verification

| Check | Result |
|---|---|
| API unit tests | 217 pass (8 new: location and search rules) |
| API end-to-end tests | 240 pass, 19 suites (14 new in `locations.e2e`). Covers: <br>• the seed, states and cities, permissions <br>• areas, and CSV import with a dry run, errors and conflicts across cities <br>• PIN code and point lookups <br>• coverage turned on city by city <br>• partner locations, with corrections and audit rows <br>• protected deletes <br>• delivery zones at checkout (zone shipping, delivery time, a state match from the address, zones-only mode, blocked zones) <br>• search across every kind (ranking, private pets, drafts and hidden reels left out, filters, near me, blocks, staff accounts, switched-off features) <br>• pets near you (opt-in, rounded distance, no coordinates, your own pets left out, the radius cap) <br>• trending pets, reels, and contest and challenge entries |
| Dashboard browser tests | 33 pass (3 new: an area and an import with a check first; a delivery zone added, checked and deleted; coverage switched on and off, and the partner locations page) |
| Dashboard unit tests | 20 pass |
| Website browser and unit tests | 13 and 13 pass |
| App ↔ API contract checks, all three apps | Pass (new fixtures recorded from the running API by `record_search_fixtures.py`) |
| Python mirrors of the Dart tests | 9 sets pass (new: `check_search_mirrors.py`) |
| Lint, typecheck, bracket and name checks | Pass |
| API reference | Regenerated: 414 operations |

## 3. Problems found and fixed
- **Unknown PIN codes in the zone checker:** a PIN code that isn't in the database can only match zones listed by PIN code. At checkout the address's own state is used too, so state zones still apply. The test was changed to show both cases.
- **Textareas:** in the new forms, textareas were squashed to one line by the shared input style. They now grow to their row count.
- **Byte-order mark:** a literal byte-order mark in the CSV parser failed lint. It's now written as an escape.

## 4. Known limitations
- **The Flutter apps weren't compiled here,** because no SDK is available. CI's mobile jobs run `flutter analyze` and `flutter test`, including the new `search_test.dart`. The logic is covered by the Python mirrors and the contract check.
- **No full PIN code database:** India's PIN codes (about 19,000) aren't bundled. Import the ones for your launch cities from India Post's open data, using the CSV format above. Until then, unknown PIN codes still work; the city is typed by hand.
- **Recent searches** are kept for the session only, on the device.
- **Delivery zones apply to the whole order,** not per seller. The shipping charge is still per parcel, as before.
- **Partner apps:** partners still pick their point with GPS during onboarding. Their app doesn't use the PIN code lookup yet.

## 5. Next: Phase 9d
- admin analytics
- membership plans (off by default)
- booking and contest reminders
