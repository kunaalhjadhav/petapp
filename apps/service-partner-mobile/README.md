# PetApp for Partners (Flutter)

The app for service partners — groomers, vets, trainers, boarding, walkers and sitters — to get verified and run their bookings.

> **Build status:** written against the real API in an environment that can't download the Flutter SDK, so **it has not been compiled yet**.
>
> **Verified here:**
> - Every API call (26) exists in the API spec.
> - Every JSON field the models read (96) appears in responses recorded from the running API, through a partner's full journey (`test/fixtures`).
> - All 30 fixture-dependent test assertions hold.
> - Brackets balance in every file.
>
> The first `flutter analyze` may flag small issues. CI's `partner-app` job runs analyze and tests on every push.

## What partners can do

| Area | Features |
|---|---|
| **Get verified** | Checklist: business details (individual or business, address, "use my location", home-visit distance, GSTIN), documents, services, hours. Then submit for review, with the review status and any rejection reason shown |
| **Documents** | Take a photo, choose a photo, or choose a PDF. Files are uploaded straight to private storage and only the verification team can see them. Status per document (waiting, accepted, rejected with a note). Accepted documents can't be removed |
| **Services** | Category, name, what's included, price in rupees (converted exactly to paise), duration, gap after each booking, at your centre and/or home visit, pause or resume. Each service shows PetApp's fee: the partner's agreed rate if one is set, otherwise the category's standard rate (same rule the API uses) |
| **Hours and time off** | Opening hours per weekday (India time), and closed days with a reason |
| **Bookings** | Upcoming and past, with the customer, pet, note, home-visit address, and what you earn after the PetApp fee. Call the customer, start, mark complete, mark a no-show (only after the start time), or cancel with a reason (the customer is refunded in full) |
| **Money** | What's ready to be paid and what's still in the holding period; where it's paid (with the safety hold on a new account); recent payouts with their bank reference (UTR). **Statement:** every visit with PetApp's fee and TDS, and every payout. **Invoices:** invoices issued to customers in your name and PetApp's monthly fee invoices, opened as PDFs in the browser. Then earnings so far, what confirmed bookings will add, no-shows, and a month-by-month breakdown |
| **Payout account** | Add or change the bank account or UPI ID you're paid to, checked with your bank straight away. Only the last 4 digits are ever shown |
| **Business** | Rating, business details, documents, payout account, PetApp fee, sign out |

New and unverified partners only see the verification checklist; the workspace opens once an admin approves them.

## Setup

```bash
cd apps/service-partner-mobile
flutter create . --org com.petapp.partner --project-name petapp_partner --platforms android,ios
flutter pub get
flutter test
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000   # Android emulator
```

The **Services** feature switch must be on in the admin dashboard.

### Android: `android/app/src/main/AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.CAMERA"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
<queries>
  <intent><action android:name="android.intent.action.DIAL"/></intent>
  <!-- Invoice PDFs open in the browser (http for the local API in debug builds). -->
  <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="https"/></intent>
  <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="http"/></intent>
</queries>
```

For the local `http` API in debug builds, add `android:usesCleartextTraffic="true"` to `<application>` in `android/app/src/debug/AndroidManifest.xml`.

### iOS: `ios/Runner/Info.plist`

```xml
<key>NSCameraUsageDescription</key><string>Photograph your verification documents.</string>
<key>NSPhotoLibraryUsageDescription</key><string>Choose photos of your verification documents.</string>
<key>NSLocationWhenInUseUsageDescription</key><string>Set your business location so nearby customers can find you.</string>
<key>LSApplicationQueriesSchemes</key><array><string>tel</string></array>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
```

## Tests and checks

```bash
flutter test                         # models parse real API responses; money and time formatting
python3 tool/contract_check.py       # app ↔ API, no Flutter needed
python3 tool/balance_check.py        # bracket balance
python3 tool/record_fixtures.py      # re-record from a running API (runs a full partner journey)
python3 ../../scripts/record_money_fixtures.py   # re-record the money fixtures for all three apps
python3 ../../scripts/check_money_mirrors.py     # the money tests' expectations, checked in Python against the fixtures
python3 ../../scripts/dart_names_check.py .      # imports exist and no name comes from two places
```

## Shared code

The API client (envelope, readable errors, single-flight token refresh), secure session storage and phone rules are **copied** from the customer app (`apps/customer-mobile/lib/api`, `lib/services/phone.dart`), so both apps behave identically. If either app's copy changes, update the other. A shared Dart package is planned in Phase 8.


## Release builds and crash reporting

Release builds for the stores come from the **mobile release** workflow; see `docs/STORE-RELEASE.md`. To build one yourself:
1. Generate the platform folders: `flutter create . --org com.petapp.partner --project-name petapp_partner --platforms android,ios`.
2. Apply PetApp's settings: `python ..\..\scripts\mobile\configure_platforms.py .`. This sets permissions, release signing and the iOS usage texts.

Crash reporting turns on with `--dart-define=SENTRY_DSN=<dsn>` and `--dart-define=APP_ENV=production`. Without a DSN nothing is sent, and personal details are masked either way.

## Chat and help (Phase 9a)

- **Messages:** conversations with customers about their bookings or orders (a **Message** button on each), with live delivery while the app is open. **Get help** next to it opens a support ticket about that booking or order.
- **Help & support:** answers from the help center, and your tickets with PetApp support (Business/Store tab).
- **Push:** new messages, bookings and orders are pushed when Firebase is configured: `--dart-define=FIREBASE_API_KEY=… --dart-define=FIREBASE_APP_ID=… --dart-define=FIREBASE_SENDER_ID=… --dart-define=FIREBASE_PROJECT_ID=…`. Without them the app works, without push.
- **New packages:** `web_socket_channel`, `firebase_core`, `firebase_messaging`. Run `flutter pub get`.

## Reviews (Phase 9b)
- **Reviews** on the Business tab: your rating with a star breakdown, and every review (filters: needs a reply, stars, photos). Reply once, publicly; hidden reviews are marked and can't be replied to. A push opens the screen when a new review arrives.
- `lib/features/reviews/business_reviews.dart` is the same file in the partner and seller apps; `reviews_logic.dart` is shared with the customer app (`scripts/check_reviews_mirrors.py` checks both).
- **Tests:** `test/reviews_test.dart`, against fixtures recorded by `apps/customer-mobile/tool/record_review_fixtures.py`.
