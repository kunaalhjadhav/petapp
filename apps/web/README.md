# PetApp website (`apps/web`)

The public website: the pages people land on from shared links and from search engines.

| Path | Shows |
|---|---|
| `/` | What PetApp is, contests open now, store links |
| `/pet/{handle}` | A public pet profile and its latest posts. Followers-only pets show only their name and are never indexed; private pets are not found |
| `/reel/{id}` | A reel or photo post (older `/p/{id}` and `/post/{id}` links redirect here) |
| `/contest/{slug}` | A contest: stage, fee, deadlines, how winners are chosen, prizes, what to submit, rules |
| `/challenge/{slug}` | A challenge: dates, check-ins, points, badge |
| `/product/{slug}` | A product: photos, sizes and prices, the seller |
| `/service/{slug}` | A service partner: services and prices, opening hours, address, reviews |
| `/booking/{id}` | Hands over to the app (bookings are private; never indexed) |
| `/legal`, `/legal/{slug}` | The published policies and terms |
| `/account-deletion` | How to delete an account, in the app or by email (`SUPPORT_EMAIL`). Google Play and the App Store ask for this link |
| `/sitemap.xml`, `/robots.txt` | For search engines |
| `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association` | So `https` links open the apps |

Every page has:
- a title and description
- a canonical URL
- Open Graph and Twitter cards for link previews in WhatsApp and elsewhere, using the page's photo or the PetApp card at `/og`
- schema.org structured data: `ProfilePage`, `VideoObject` or `SocialMediaPosting`, `Event`, `Product` with offers in rupees, `LocalBusiness` with hours and rating, and `BreadcrumbList`

Pages never show people's names: a pet page is about the pet, and a post is titled by its pets.

## Opening the app

Each page has an **Open in PetApp** bar, which links to `petapp://pet/{handle}` (and so on).

The `https` URLs are also App Links and Universal Links: on a phone with the app installed, the link opens the app directly. That needs:
- **Android:** `ANDROID_PACKAGE_NAME` and `ANDROID_SHA256_FINGERPRINTS`, the app-signing key's SHA-256 from Play Console → App integrity → App signing; add your upload key's too for testing. The app's manifest declares the domain.
- **iOS:** `IOS_APP_ID` (`TEAMID.bundle.id`). The app declares `applinks:<domain>` under Associated Domains.

See `apps/customer-mobile/README.md` for the app side.

## Settings

All of these are read when a page is rendered, so one build serves every environment.

| Variable | Example | |
|---|---|---|
| `SITE_URL` | `https://petapp.in` | The site's public address |
| `API_URL` | `http://backend:4000` | The API, called from the server only |
| `SITE_INDEXABLE` | `true` | Only on the production site. Anywhere else every page says `noindex` and `robots.txt` disallows all |
| `PLAY_STORE_URL`, `APP_STORE_URL` | | Store buttons appear once set |
| `SUPPORT_EMAIL` | `support@petapp.in` | For deletion requests from people without the app |
| `ANDROID_PACKAGE_NAME`, `ANDROID_SHA256_FINGERPRINTS` | `com.petapp.petapp`, `AB:CD:…` | Android App Links |
| `IOS_APP_ID` | `ABCDE12345.com.petapp.petapp` | iOS Universal Links |

**Caching:** pages are cached for 5 minutes and the sitemap for 10 (as is the API's sitemap data).

**Photo links:** in production, set `MEDIA_PUBLIC_BASE_URL` on the API so photo links are stable CDN URLs. Signed links expire after an hour, which is too short for share previews.

## Run it

```powershell
npm run dev -w @petapp/web            # http://localhost:3001, with the API running on :4000
npm run build -w @petapp/web
npm run test -w @petapp/web           # unit tests (structured data, formatting, links)
npm run test:e2e -w @petapp/web       # browser tests against a running site and API
```

Docker: `infrastructure/Dockerfile.web`, and the `web` service in `docker-compose.yml`.

## Design

The memorable element is that every page opens with its subject engraved on a pet ID tag: a white slab with a punched hole and a brass eyelet. A pet without a photo gets its initial stamped on the tag. The tag swings into place once on load, and doesn't move for people who prefer reduced motion.

**Colours:** a cool mist ground, collar-teal actions, ink text, and brass used only for the eyelet and ratings.

**Type:** Bricolage Grotesque (narrowed) for names and headings, and Instrument Sans for reading.

**Layout:** a single left-aligned column, readable on a phone first. The **Open in PetApp** bar stays at the bottom of the screen.

## Reviews (Phase 9b)
Product and service pages show the rating, a star breakdown and the latest reviews (first name and initial, "Verified purchase/booking", photos, the business's reply). Their structured data includes `aggregateRating` and up to three `review` items once there are reviews (`ratingLd` in `src/lib/seo.ts`).
