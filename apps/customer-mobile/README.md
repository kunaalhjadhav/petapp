# PetApp customer app (Flutter)

Android and iOS app for pet owners: sign in with your phone, add pets, post photos and reels,
follow people and pets, comment, and get notifications. The Home tab shows the sections admins arrange
(reels, trending pets, contests, challenges, nearby services, products picked for your pets, offers and
what's coming up), then posts; search finds pets, products and hashtags. PetApp Assistant (when switched on)
answers questions about services, products, contests and the app, with vet guardrails.

> **Build status:** this app was written against the real API, but in an environment that couldn't
> download the Flutter SDK, so **it has not been compiled yet**.
>
> **What *was* verified here:**
> - Every API call (115) matches the API spec.
> - Every JSON field the models read (519 reads across 78 models) matches responses recorded from the running API (`test/fixtures`).
> - The fixture-dependent test assertions were confirmed against that data.
> - Brackets balance in every file.
>
> **What wasn't:** the first `flutter analyze` may report a few small issues, which are quick to fix. CI's `mobile` job runs analyze and tests on every push.

## Requirements

- Flutter 3.24 or newer (Dart 3.5+)
- Android Studio (Android SDK) and/or Xcode
- The PetApp backend running (see the repo README), with **Reels and posts** switched on in the admin dashboard

## First-time setup

```bash
cd apps/customer-mobile
# Generate the android/ and ios/ folders (your lib/ and pubspec.yaml are kept as they are):
flutter create . --org com.petapp --project-name petapp --platforms android,ios
flutter pub get
flutter test                       # model, API client and helper tests
```

Then apply the platform settings below.

### Android: `android/app/src/main/AndroidManifest.xml`

Inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
<!-- Invoice PDFs open in the browser (http for the local API in debug builds). -->
<queries>
  <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="https"/></intent>
  <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="http"/></intent>
</queries>
```

Inside the main `<activity>`, so that links open the app: `petapp://pet/<handle>` (and reel, contest, challenge, product, service, booking), plus `https://<your site>/pet/…` links shared from the app or the website. Replace `petapp.in` with your website's domain (the `SHARE_BASE_URL` the app is built with):

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="petapp"/>
</intent-filter>
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="https" android:host="petapp.in"/>
  <data android:pathPrefix="/pet/"/>
  <data android:pathPrefix="/reel/"/>
  <data android:pathPrefix="/contest/"/>
  <data android:pathPrefix="/challenge/"/>
  <data android:pathPrefix="/product/"/>
  <data android:pathPrefix="/service/"/>
  <data android:pathPrefix="/booking/"/>
</intent-filter>
<!-- The app opens links itself (lib/services/deep_links.dart), so Flutter's own handling stays off: -->
<meta-data android:name="flutter_deeplinking_enabled" android:value="false"/>
```

For `https` links to open the app without asking, the website must publish `/.well-known/assetlinks.json` for your package and signing key: set `ANDROID_PACKAGE_NAME` and `ANDROID_SHA256_FINGERPRINTS` on the website (see `apps/web/README.md`). Get the fingerprint from Play Console → App integrity → App signing.

The local API uses plain `http`, which Android blocks by default. Allow it **in debug builds only**: in `android/app/src/debug/AndroidManifest.xml`, add `android:usesCleartextTraffic="true"` to `<application>`.

### iOS: `ios/Runner/Info.plist`

```xml
<key>NSPhotoLibraryUsageDescription</key>
<string>Choose photos and videos of your pets to share.</string>
<key>CFBundleURLTypes</key>
<array><dict><key>CFBundleURLSchemes</key><array><string>petapp</string></array></dict></array>
<!-- The app opens links itself (lib/services/deep_links.dart). -->
<key>FlutterDeepLinkingEnabled</key>
<false/>
<!-- Development only: allow http to your local machine -->
<key>NSAppTransportSecurity</key>
<dict><key>NSAllowsLocalNetworking</key><true/></dict>
```

For `https` links (Universal Links), add the **Associated Domains** capability in Xcode with `applinks:petapp.in` (your website's domain), and set `IOS_APP_ID` (`TEAMID.bundle.id`) on the website so it publishes `/.well-known/apple-app-site-association`.

For push, also enable the **Push Notifications** capability and **Background Modes → Remote notifications** in Xcode.

## Running

```bash
# Android emulator (reaches your computer at 10.0.2.2):
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000

# A real phone on the same Wi-Fi (use your computer's LAN IP):
flutter run --dart-define=API_BASE_URL=http://192.168.1.20:4000

# Release builds: also set the website, used for share links and https app links.
flutter build appbundle --dart-define=API_BASE_URL=https://api.petapp.in --dart-define=SHARE_BASE_URL=https://petapp.in
```

**Testing a link** on an Android emulator: `adb shell am start -a android.intent.action.VIEW -d "petapp://pet/bruno.demo"`. On the iOS simulator: `xcrun simctl openurl booted "petapp://pet/bruno.demo"`.

**Photos and videos on a real phone.** Media URLs must be reachable from the phone too. In the backend `.env`, use your LAN IP rather than `localhost`:

```
S3_PUBLIC_ENDPOINT=http://192.168.1.20:9000
MEDIA_PUBLIC_BASE_URL=http://192.168.1.20:9000/petapp-media
```

**Sign-in codes in development.** With `SMS_PROVIDER=console`, the OTP appears in the API's log.

## Contest payments (Razorpay)

With the backend on `PAYMENT_PROVIDER=fake` (development), entering a paid contest completes immediately, with no gateway. With `PAYMENT_PROVIDER=razorpay`, the app opens Razorpay's checkout. The API then verifies the payment's signature; the app never decides on its own that a payment succeeded.

For release builds on Android, add Razorpay's ProGuard rules to `android/app/proguard-rules.pro`:

```
-keepattributes *Annotation*
-dontwarn com.razorpay.**
-keep class com.razorpay.** {*;}
-optimizations !method/inlining/
-keepclasseswithmembers class * { public void onPayment*(...); }
```

On iOS, run `cd ios && pod install` after `flutter pub get`.

## Location (services near me)

The app asks for location when you open Pet services. If location is off or refused, you can pick a city instead, or search for an area, landmark or 6-digit PIN code (tap the place name at the top of Home). Search uses PetApp's location database, plus the map provider when the API has `MAP_PROVIDER=google` (see the main README). The logic is in `lib/features/home/place_logic.dart`, tested by `test/place_test.dart` and mirrored in `scripts/check_place_mirrors.py`; fixtures come from `tool/record_place_fixtures.py`.

- **Android:** add `<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>` and `ACCESS_FINE_LOCATION` to `AndroidManifest.xml`.
- **iOS:** add `NSLocationWhenInUseUsageDescription` to `Info.plist`, for example "Find pet services near you."

## Push notifications (optional)

Without Firebase settings the app works normally, just without push. To enable push:

1. Create a Firebase project and add an Android and/or iOS app to it.
2. Pass its settings at build time:
   ```bash
   flutter run --dart-define=API_BASE_URL=… \
     --dart-define=FIREBASE_API_KEY=… --dart-define=FIREBASE_APP_ID=… \
     --dart-define=FIREBASE_SENDER_ID=… --dart-define=FIREBASE_PROJECT_ID=…
   ```
3. Set `PUSH_PROVIDER=fcm` and the `FCM_*` service-account variables on the backend (see `.env.example`).

The app registers its device token after sign-in and **removes it before sign-out**, so a shared phone never receives the previous account's notifications.

## What's in it

| Tab | Features |
|---|---|
| Home | Following feed (people you follow and you) and Discover (trending). Photo carousels, inline video, like, comment, save, share, report and block, tappable #hashtags |
| Reels | Full-screen vertical reels (HLS). Plays the visible reel only, double-tap to like, counts a view after 1 s |
| Create | Up to 10 photos, or a reel of up to 60 s. Caption with #hashtags and @pet handles, tag your pets, followers-only option. Uploads go straight to storage with a progress bar |
| Alerts | Grouped notifications with an unread badge. Tapping one opens its post, pet or person |
| Me | Your posts, saved posts and pets. Settings: notification switches, recommendations, blocked people, sign out, delete account. **Your data and privacy:** download a copy of your data, offers and news on or off, the policies (with the version you accepted), and deleting your account (erased after a grace period; signing in before then keeps it) |
| Payments and refunds (wallet icon on your profile) | Every refund: what it was for (tapping opens the order, booking or contest), how much, where it is in plain words (on its way, refunded, delayed, paid by bank transfer) and the reference your bank can look up. Invoices for orders and bookings, opened as PDFs in the browser. Prize money: cash prizes won with TDS shown, the bank account or UPI ID they're paid to (checked with your bank), and payouts with their bank reference |
| Pet services (shop icon on Home, when the services marketplace is on) | Services near you, or in a city you choose: grooming, vets, training and more. Filter by category or "comes to my home". Each partner page shows services, prices, hours and reviews. Pick a day and time (always shown in India time), choose your pet (only species the service accepts), at the centre or at home, then pay. My bookings has the booking code, cancellation with the refund shown, pay-later for held bookings, and rating after the visit |
| Challenges (flame icon on Home, when contests are on) | Active, upcoming and past challenges. Join (free, paid or for contest entrants), check in once a day with a post or a note, track points, streak and rank, and earn badges, which show on your profile |
| Judging (gavel icon on your profile, for judges) | Contests you're assigned to. Read each entry's submissions and score every criterion 0–10, with the weighted score shown as you go |
| Shop (bag icon on Home, when the Marketplace is on) | Search, category chips, sort; product page with photos, sizes, MRP and discount, "only N left"; cart with quantity, problems per line ("Only 2 left"), coupons and a parcel-per-seller total; checkout with saved or new addresses and Razorpay; orders with tracking, cancel before packing, returns within the window, and refund status |
| Contests (trophy icon on Home, when switched on) | Live, upcoming and past contests. Enter a pet (free, or paid through Razorpay), complete tasks (choose one of your posts or write an answer), vote, and follow the leaderboard |

Policies and terms: when a new version of the Terms or Privacy Policy is published, the app asks you to accept it on its next start; entering a contest asks for the Contest Terms first. The policies can be read from the sign-in screen too.

Other screens: post detail with comments and replies, pet profile (follow, report, posts), someone else's profile (follow, report, block), and hashtag pages.

**Behaviour worth knowing:**
- **Sign-in tokens** are stored in the iOS Keychain or Android Keystore.
- **Session refresh:** when several requests find the session expired at once, the app refreshes it **once** and retries them all. This is covered by a unit test.
- **Likes and saves** update instantly and roll back if the request fails.
- **Feature switches:** if **Reels and posts** is switched off in the admin dashboard, the Reels and Create tabs show "Coming soon".

## Tests and checks

```bash
flutter test                         # Dart tests (models parse real API responses; refresh logic; helpers)
python3 tool/contract_check.py       # app ↔ API: endpoints and JSON fields (no Flutter needed)
python3 tool/balance_check.py        # bracket balance (no Flutter needed)
python3 tool/record_fixtures.py      # re-record fixtures from a running API after API changes
python3 ../../scripts/record_money_fixtures.py   # re-record the money fixtures (refunds, invoices, prize money)
python3 ../../scripts/check_money_mirrors.py     # the money tests' expectations, checked in Python against the fixtures
python3 tool/record_home_fixtures.py # re-record the home screen and recommendation fixtures
python3 ../../scripts/check_home_mirrors.py      # the home tests' expectations, checked in Python against the fixtures
python3 tool/record_assistant_fixtures.py   # re-record the PetApp Assistant fixtures
python3 tool/record_privacy_fixtures.py     # re-record the privacy and legal fixtures (development database only)
python3 ../../scripts/check_assistant_mirrors.py # the assistant tests' expectations, checked in Python against the fixtures
python3 ../../scripts/dart_names_check.py .      # imports exist and no name comes from two places
```

## Project layout

```
lib/
  api/        models, API client (envelope, errors, refresh), endpoints, secure session
  state/      Riverpod providers, auth controller, cursor pagination
  services/   uploads, push, phone formatting
  common/     shared widgets
  features/   auth · home (feed, shell) · posts · reels · create · pets · notifications · profile
  router.dart, theme.dart, config.dart, main.dart
test/         Dart tests + fixtures recorded from the real API
tool/         contract_check.py, balance_check.py, record_fixtures.py
```


## Release builds and crash reporting

Release builds for the stores come from the **mobile release** workflow; see `docs/STORE-RELEASE.md`. To build one yourself:
1. Generate the platform folders: `flutter create . --org com.petapp --project-name petapp --platforms android,ios`.
2. Apply PetApp's settings: `python ..\..\scripts\mobile\configure_platforms.py . --domain petapp.in`. This sets permissions, release signing and the iOS usage texts, plus app links for your domain.

Crash reporting turns on with `--dart-define=SENTRY_DSN=<dsn>` and `--dart-define=APP_ENV=production`. Without a DSN nothing is sent, and personal details are masked either way.

## Chat and help (Phase 9a)

- **Messages** (Me tab, when ENABLE_CHAT is on): conversations with service partners and sellers. Start one from a partner's page, a product (**Ask the seller**), a booking or an order. Text, photos (private) and booking, product or order cards; report and block from the conversation.
- **Live:** while the app is open it keeps a WebSocket to the API (`lib/services/chat_socket.dart`) and catches up after reconnecting; push covers the rest. Turn chat pushes off in Settings → Notifications → Messages.
- **Help & support** (Settings): the help center's answers, **Contact support**, and your tickets. Bookings and orders have **Get help**.
- **New package:** `web_socket_channel`. Run `flutter pub get`.
- **Tests:** `test/chat_test.dart`, mirrored in `scripts/check_chat_mirrors.py`. Fixtures come from `tool/record_chat_fixtures.py`.

## Reviews and reporting (Phase 9b)
- **Reviews:** order screens show **Write a review** for delivered items; booking screens show **Rate this visit**. Both open `WriteReviewScreen` (stars, words, up to 4 public photos). Product and partner pages show the star breakdown, the latest reviews and **See all** (filters by stars and photos, and sorting).
- **Reports:** every report button opens `ReportScreen` (`lib/features/safety/report_screen.dart`): a reason, optional details and up to 3 private screenshots. Products, businesses, reviews and contest entries can now be reported too.
- **Tests:** `test/reviews_test.dart`, mirrored in `scripts/check_reviews_mirrors.py`. Fixtures come from `tool/record_review_fixtures.py`. `lib/features/reviews/reviews_logic.dart` is shared with the partner and seller apps.

## Search, discovery and locations (Phase 9c)
- **Search** (`lib/features/home/search_screen.dart`): All, then one tab per kind with its filters; recent searches for the session. Results open through the same routes as deep links (`hitRoute` in `search_logic.dart`).
- **Discover** (`/discover`, from the home shortcuts): Trending, Near you, Reels, Contests, Challenges. Owners turn on "Show in Pets near you" on their pet's page; the position is rounded to about 1 km before it's saved.
- **Places:** the city picker uses the location database (with a built-in list if it can't load), addresses fill in from a PIN code, checkout confirms the delivery time and shipping for the chosen address, and services show a notice outside service coverage.
- **Tests:** `test/search_test.dart`, mirrored in `scripts/check_search_mirrors.py`. Fixtures come from `tool/record_search_fixtures.py`.

## Memberships, reminders and promotions (Phase 9d)
- **Membership** (`/membership`, from Settings and your profile when memberships are on): your plan, the plans with their benefits, joining or renewing through the payment gateway, and earlier memberships. Members show a badge on their profile; members-only contests and premium challenges are labelled.
- **Settings:** new switches for reminders, votes on your entries, and offers and announcements (off until you turn it on).
- **Notifications:** booking and contest reminders, vote updates and membership changes open the booking, contest or Membership screen; a promotion opens its page in the app (only links inside the app are followed).
- **Reels** report when a video plays to its end, for the completion rate in analytics.
- **Tests:** `test/membership_test.dart`, mirrored in `scripts/check_membership_mirrors.py`. Fixtures come from `tool/record_membership_fixtures.py`.

## Resumable uploads (Phase 9e)
- **Videos in parts** (`lib/services/upload_service.dart`): the app asks for a resumable upload; large videos come back as MULTIPART and go up in parts (addresses fetched ten at a time). A failed part is retried up to five times, waiting 1, 2, 4, 8 and 16 seconds; an expired address is fetched again.
- **Resume:** if the connection stays down, the New post screen shows **Upload paused** with **Retry**, which asks the API which parts arrived and sends only the rest.
- **Tests:** `test/upload_test.dart`, mirrored in `scripts/check_upload_mirrors.py`. Fixtures come from `tool/record_upload_fixtures.py`.

## Offline and errors (Phase 10b)
- **Saved screens** (`lib/api/offline_logic.dart`, `lib/services/prefs_cache.dart`): the last answer of a few screens (profile, pets, home, feeds, notifications, contests, challenges, bookings, orders, addresses, membership, feature switches) is kept on the phone, at most 40 of 256 KB each. Without a connection they show it, with a "You're offline · showing what was saved 5 min ago" bar. Cleared at sign-out and account deletion.
- **Retries:** a read that loses its connection is tried twice more (after 0.4 and 1.2 seconds). Writes never are, because the app can't know whether the server already did them.
- **Payments:** if the gateway took a payment but the app couldn't tell PetApp, it says "Payment verification is pending" and confirms it when the app starts or comes back to the foreground (`lib/services/pending_payments.dart`). Confirming is safe to repeat, and the gateway's webhook settles it on the server anyway.
- **Messages:** server errors read "Something went wrong on our side"; the server's own text is shown only for things people can act on.
- **Tests:** `test/offline_test.dart`, mirrored in `scripts/check_offline_mirrors.py`.

