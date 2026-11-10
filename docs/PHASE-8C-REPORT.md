# Phase 8c — Public website, SEO and app links: report

Phase 8 (production) has four parts:
- **8a:** observability and security (delivered)
- **8b:** privacy and legal (delivered)
- **8c (this report):** the public website, SEO and app links
- **8d:** launch readiness (backups and a restore drill, load tests, CI security scans, the deploy pipeline, store builds, runbooks, the final checklist)

## 1. Implemented

### The public website (`apps/web`, spec §64)
A new Next.js app for the pages people land on from shared links and search engines:

| Page | What it shows |
|---|---|
| `/pet/{handle}` | The pet, its facts (species, breed, age, city, followers, personality) and latest posts |
| `/reel/{id}` | A reel or photo post, titled by its pets |
| `/contest/{slug}` | Stage in words, fee, deadlines in IST, how winners are chosen, prizes (with the TDS note), what to submit, rules |
| `/challenge/{slug}` | Dates, check-ins, points, badge |
| `/product/{slug}` | Photos, sizes with MRP and price, the seller |
| `/service/{slug}` | Services and prices, a week of opening hours, address, reviews |
| `/legal`, `/legal/{slug}` | The published policies, rendered from the same Markdown as the apps |
| `/` | What PetApp does, contests open now, store links |

- **SEO on every page** (spec §64):
  - **Basics:** title, description and canonical URL.
  - **Link previews:** Open Graph and Twitter cards, so links shared on WhatsApp show the photo. Pages without a photo get the PetApp card at `/og`.
  - **Structured data:**

    | Page | schema.org type |
    |---|---|
    | Pets | `ProfilePage` |
    | Reels | `VideoObject` (with duration) |
    | Photo posts | `SocialMediaPosting` |
    | Contests and challenges | online `Event`, with fee and status |
    | Products | `Product` with an `Offer` or `AggregateOffer` in rupees |
    | Service partners | `LocalBusiness` with address, map point, opening hours, services and rating |
    | Product pages | also `BreadcrumbList` |
- **`sitemap.xml`:** public pets, products, service partners, contests, challenges and policies, with when each last changed.
- **`robots.txt`:** points at the sitemap and keeps bookings and old redirect links out.
- **Staging stays out of search:** unless `SITE_INDEXABLE=true`, every page says `noindex` and `robots.txt` disallows everything.
- **Privacy:**
  - **Only what is already public:** private pets are "not found"; followers-only pets show only their name and are never indexed; switched-off features have no pages.
  - **No people's names:** not even the pet owner's, which the API returns for public pets. Posts are titled by their pets.
  - **Bookings:** the booking page only hands over to the app.
- **Design:** every page opens with its subject engraved on a pet ID tag (a punched hole with a brass eyelet). Pets and businesses without a photo get their initial stamped on it. Built phone-first, with an **Open in PetApp** bar at the bottom. The tag swings in once on load, and not for people who prefer reduced motion.

### App links (spec §63)
- **The spec's links open the customer app:**
  - `petapp://pet/{id or handle}`, `petapp://reel/{id}`, `petapp://contest/{id}`, `petapp://product/{id}`, `petapp://service/{id}`, `petapp://booking/{id}`, `petapp://challenge/{id}`
  - the older `petapp://app/post/{id}`
- **HTTPS App Links and Universal Links:**
  - **The website publishes** `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` from settings, for the same seven paths.
  - **The app** declares the domain (manifest and Associated Domains).
  - **The result:** `https://<site>/pet/bruno` opens the app when it's installed, and the web page otherwise.
- **The app handles links itself:**
  - **Why:** Flutter's built-in handling turns `petapp://pet/123` into `/123`, because it drops the host.
  - **How:** `lib/services/deep_links.dart` maps a link to a screen with a tested function, accepts only our scheme and our own domain, and re-encodes keys so a link can't reach another screen.
  - **Before sign-in:** a link opened before signing in waits and opens afterwards.
- **Sharing:**
  - **Share buttons** on pets, contests, challenges, products and service partners, plus the existing one on posts.
  - **They share website links,** so everyone gets a preview and people with the app land in it.
  - **Old links:** `/p/{id}` share links still work and now redirect to `/reel/{id}`.

### API
- **`GET /public/sitemap`** (no sign-in) lists what the website may put in its sitemap: public pets of active accounts, approved products and partners, public contests and challenges (only while their feature is on), and published policies.
  - **Limits:** up to 10,000 of each kind, cached for 10 minutes so crawlers can't load the database.
- **API reference:** regenerated (334 operations).

### Deployment
- **New files and changes:**
  - `infrastructure/Dockerfile.web`: every setting is read at run time, so one image serves every environment.
  - A `web` service in `docker-compose.yml`.
  - The website's settings in `.env.example`.
- **CI:**
  - builds, lints, type-checks and unit-tests the website
  - runs its browser tests next to the dashboard's
  - builds and scans its image
- **Steps for going live:** in `docs/DEPLOYMENT.md` and `apps/web/README.md` — domain, store links, signing-key fingerprints, Search Console.

## 2. Verification
- **Backend unit tests:** 198 pass.
- **Backend end-to-end:** 197/197, including 3 new tests for the sitemap data:
  - only public pets of active accounts are listed, and nothing about people
  - marketplaces are listed only while switched on
  - the data is cached
- **Website unit tests:** 11 pass:
  - formatting (rupees, hours, ages, ISO durations, description clipping)
  - links
  - structured data for every type
  - contest and challenge stages
  - post titles that never use people's names
  - JSON-LD can't break out of its script tag
  - the Markdown reader
- **Website browser tests:** 10 pass:
  - **A public pet:** title, description, canonical, Open Graph with the fallback card, structured data, the app link, and the owner's name appearing nowhere.
  - **Private and followers-only pets:** a private pet is a real 404 with nothing leaked; a followers-only pet is `noindex`.
  - **Structured data:** Product, LocalBusiness and Event.
  - **Old links:** `/p/` redirects with 308.
  - **Unknown things and path tricks** return 404.
  - **Bookings:** never indexed.
  - **Search files:** the sitemap leaves out private pets; robots.txt; both app-association files, with the right content type.
  - **Legal pages** render with headings.
  - **On a phone:** no sideways scrolling, the bar in reach, and the styles actually loaded.
- **Customer app:**
  - **Deep links:** a new Dart test, `test/deep_links_test.dart`, covers 21 links:
    - the spec's links
    - website links with and without `www` and with tracking parameters
    - older links
    - foreign domains, look-alike domains and malformed links, all refused

    It is mirrored in Python (`scripts/check_links_mirrors.py`).
  - **Other checks:** the contract, name and bracket checks pass for all three apps.

## 3. Problems found and fixed
- **Pages could be served without their styles** after a rebuild, when the running site was older than the build. The phone test now checks that the styles loaded, so this can't pass unnoticed.
- **`petapp://pet/123` would have opened the wrong screen:** Flutter treats `pet` as the host. The app now parses links itself, and the cases are tested.
- **Share previews for photo-less pages had no image.** They now use the PetApp card.
- **Some development posts showed "-1 comments".** The cause is a dashboard browser test that inserts comments straight into the database without counting them. The website never shows a negative count.

## 4. Known limitations
- **Reels don't play on the website.** Pages show the cover image with "Watch the reel in PetApp". HLS needs a player script on most browsers; that can be added later.
- **No public pages yet** for people, hashtags or seller storefronts. Pets, products and partners cover the spec's list.
- **One sitemap file,** up to 10,000 of each kind. A sitemap index is needed beyond about 50,000 URLs.
- **Photo links in previews** are signed and expire after an hour unless the API's `MEDIA_PUBLIC_BASE_URL` points at a CDN. That setting is needed in production.
- **App links can't be proven here:** they need the real domain over HTTPS and builds signed with the registered keys, so they can't be checked in this environment. Test them on a phone once the site is live; `docs/DEPLOYMENT.md` has the checks.
- **Flutter can't run here.** The Dart tests are written and their logic is mirrored in Python.
- **English only.**

## 5. Next: Phase 8d
Launch readiness:
- backups with a restore drill
- load tests
- security scans in CI
- the deploy pipeline
- store builds with crash reporting
- runbooks
- the final production checklist
