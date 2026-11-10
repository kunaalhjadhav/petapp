# PetApp for Sellers (Flutter)

The app for product sellers — pet food, treats, toys and supplies — to get their store approved, list products, keep stock right, fulfil orders and returns, run their own coupons, and see what they've earned.

> **Build status:** written against the real API in an environment that can't download the Flutter SDK, so **it has not been compiled yet**.
>
> **Verified here:**
> - Every API call (29) exists in the API spec.
> - Every JSON field the models read (167, across 20 models) appears in responses recorded from the running API through a seller's full journey: onboarding, approval, a product with photos and two sizes, coupons, three paid orders, packing, shipping, delivery, a cancellation and a return (`test/fixtures`).
> - The fixture-dependent test expectations were checked against those recordings.
> - Brackets balance in every file; every import resolves.
>
> The first `flutter analyze` may flag small issues. CI's `seller-app` job runs analyze and tests on every push.

## What sellers can do

| Area | Features |
|---|---|
| **Set up the store** | Checklist: store details (name, registered name, GSTIN, phone, email, pickup address), ID proof, and the GST certificate when a GSTIN is given. Submit for approval; the review status and any reason are shown. Details are locked only while under review |
| **Documents** | Take a photo, choose a photo or a PDF. Uploaded straight to private storage; only the verification team sees them. Accepted documents can't be removed |
| **Home** | What to do now (to pack, to ship, in transit, returns) with one tap into that list; sales and earnings today, last 7 and last 30 days (India time); stock alerts at or below the low-stock level set by PetApp, with a quick restock; product counts by status |
| **Products** | Photos (up to 10, cover first, processed and stripped of location data by the server), category, name, brand, description, and variants — size/weight/colour with SKU, MRP, selling price (GST included), GST rate, opening stock, packed weight, on sale or not. Save as draft, go live (the server checks there's a photo and an active variant), pause. Inventory status per variant. Blocked products show PetApp's reason and can't be edited |
| **Stock** | Set the units you have from the product or a stock alert. Saving a product never writes an old count back: orders move stock while you edit, so stock changes only through its own action |
| **Orders** | Filter by stage. Each parcel shows the items, the customer's address and phone for the courier label (copy or call), what the customer paid, PetApp's fee and what you earn. Mark packed → shipped (courier and tracking number) → delivered, or cancel before it ships with a reason (the customer is refunded for the parcel and stock goes back) |
| **Returns** | Approve, or decline with a note the customer sees; then confirm the item came back (with an optional condition note), which refunds the customer |
| **Coupons** | Percent off (with an optional cap) or rupees off, minimum spend, total and per-customer limits, start and end, pause. They only discount your products, and you fund them |
| **Money** | What's ready to be paid and what's still in the return window; where it's paid (with the safety hold on a new account); recent payouts with their bank reference (UTR) and anything not paid. **Statement:** every sale with PetApp's fee, TCS and TDS, every return and payout. **Invoices:** tax invoices issued to customers in your name, credit notes for returns, and PetApp's monthly fee invoices, opened as PDFs in the browser. Then earnings from delivered orders, month by month |
| **Payout account** | Add or change the bank account (IFSC, account number typed twice) or UPI ID you're paid to. It's checked with your bank straight away, which shows the name it has; a refused account says why. Only the last 4 digits are ever shown |
| **Store** | Status and rating, coupons, details, documents, PetApp fee, GSTIN, sign out |

New and unapproved sellers only see the setup checklist. A paused (suspended) store keeps the workspace so it can finish parcels already paid for; the API stops it listing or editing products.

## Setup (Windows PowerShell)

```powershell
cd apps\product-partner-mobile
flutter create . --org com.petapp.seller --project-name petapp_seller --platforms android,ios
flutter pub get
flutter test
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4000   # Android emulator
```

The **Marketplace** feature switch must be on in the admin dashboard, and at least one product category must exist.

### Android: `android/app/src/main/AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.CAMERA"/>
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
<key>NSCameraUsageDescription</key><string>Photograph your products and verification documents.</string>
<key>NSPhotoLibraryUsageDescription</key><string>Choose photos of your products and verification documents.</string>
<key>LSApplicationQueriesSchemes</key><array><string>tel</string></array>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
```

## Tests and checks

```powershell
flutter test                          # models parse real API responses; paging, errors, request bodies; money helpers
python tool\contract_check.py         # app <-> API, no Flutter needed
python tool\balance_check.py          # bracket balance
python tool\record_fixtures.py        # re-record from a running API, worker and storage (full seller journey; needs redis-cli, so run it in WSL or CI)
python ..\..\scripts\record_money_fixtures.py   # re-record the money fixtures for all three apps (same needs, plus psql)
python ..\..\scripts\check_money_mirrors.py     # the money tests' expectations, checked in Python against the fixtures
python ..\..\scripts\dart_names_check.py .      # imports exist and no name comes from two places
```

## Shared code

The API client (envelope, readable errors, single-flight token refresh), secure session storage, phone rules, theme and formatting helpers are **copied** from the partner app, which copied them from the customer app, so all three behave the same. The seller copy adds `getPaged` (items plus "is there another page") and a few money helpers. If one copy changes, update the others. A shared Dart package is planned in Phase 8.


## Release builds and crash reporting

Release builds for the stores come from the **mobile release** workflow; see `docs/STORE-RELEASE.md`. To build one yourself:
1. Generate the platform folders: `flutter create . --org com.petapp.seller --project-name petapp_seller --platforms android,ios`.
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
