# Store releases (Google Play and the App Store)

Three apps ship to the stores. Their IDs come from `flutter create --org …`; change them before the first upload if you want different ones, because they can't be changed afterwards.

| App | Android package / iOS bundle ID | Store name (suggested) |
|---|---|---|
| `apps/customer-mobile` | `com.petapp.petapp` | PetApp |
| `apps/service-partner-mobile` | `com.petapp.partner.petapp_partner` | PetApp Partners |
| `apps/product-partner-mobile` | `com.petapp.seller.petapp_seller` | PetApp Sellers |

## Building
1. **Run the workflow.** In GitHub, open **Actions → mobile release → Run workflow**, then pick the app, a build number higher than the last upload, and the platforms.
2. **What it does:**
   - checks the code (`flutter analyze`, `flutter test`)
   - generates the platform folders and applies PetApp's settings with `scripts/mobile/configure_platforms.py`: permissions, app links, release signing, iOS usage texts
   - builds a signed App Bundle and an iOS archive, with obfuscation (the symbol files are kept as artifacts, so crash reports can be read)
3. **Uploading:** builds go to Play internal testing and to TestFlight when those keys are set; the secrets are listed at the top of `.github/workflows/mobile-release.yml`. Without the keys, download the artifacts and upload them by hand.
4. **Promote** from internal testing or TestFlight to production in the store consoles once testers are happy.

**To build on your own machine,** generate the platform folders once and apply the settings:

```powershell
cd apps\customer-mobile
flutter create . --org com.petapp --project-name petapp --platforms android,ios
python ..\..\scripts\mobile\configure_platforms.py . --domain petapp.in
flutter build appbundle --release --dart-define=API_BASE_URL=https://api.petapp.in --dart-define=SHARE_BASE_URL=https://petapp.in --dart-define=APP_ENV=production
```

**Signing keys:**
- **Android:** create the upload key once with `keytool -genkey -v -keystore upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload`, and use Play App Signing. Keep `upload.jks` and its passwords in your password manager and the CI secrets, never in the repository (`key.properties` and `*.jks` are git-ignored).
- **iOS:** the distribution certificate and an App Store provisioning profile come from the Apple Developer account. The customer app's App ID needs the **Associated Domains** capability (for `applinks:`) and **Push Notifications**.

## Crash reporting
- **How it's switched on:** builds report crashes and errors to Sentry (or GlitchTip) when `SENTRY_DSN_MOBILE` is set (`--dart-define=SENTRY_DSN`). Use a separate Sentry project per app.
- **What reports leave out:** no IP addresses, user details or screenshots are sent, and phone numbers, emails and tokens are masked in messages (`lib/services/crash_reporting.dart`).
- **Readable stack traces:** upload the symbol files from the build artifacts to Sentry (`sentry-cli debug-files upload build/symbols`).

## Store listing checklist
- **Content and ratings:**
  - **Content rating:** answer the questionnaire. User-generated content, user-to-user sharing, and digital purchases (contest entries, the shop).
  - **Target audience:** 18 and over (the Terms say so). Don't select children's age groups.
- **Accounts and policies:**
  - **Account deletion:** in the app, under **Settings → Your data and privacy → Delete account**.
  - **Deletion web link** (Play asks for it): `https://<your site>/account-deletion`. Set `SUPPORT_EMAIL` on the website.
  - **Support URL** (the App Store asks for one): `https://<your site>/help`. Publish the help center's questions in the dashboard first.
- **Privacy policy URL:** `https://<your site>/legal/privacy-policy`, once published.
- **Payments:** contest entries, shop orders and bookings are paid through Razorpay. Physical goods and real-world services are allowed outside the stores' billing. Contest entry fees for skill-based contests: confirm with your lawyer and with each store's current policy before launch.
- **Store assets:** screenshots (phone, 6.7" and 5.5" iPhone), a 512×512 icon, a 1024×500 Play feature graphic, a short and a full description.
- **App Review sign-in:** a demo account the reviewers can sign in with. Phone OTP needs a test number; Play and Apple both allow notes with sign-in steps.

### Google Play: Data safety form

| Data | Collected | Shared | Why | Optional |
|---|---|---|---|---|
| Name, email, phone number | Yes | With service partners and sellers you book or buy from | Account, orders and bookings | Email optional |
| Approximate and precise location | Yes | No | Nearby services | Yes |
| Photos and videos | Yes | Public posts are visible to others | Posts, pet profiles, documents | Yes |
| Purchase history | Yes | With the seller or partner | Orders, bookings, invoices | No |
| Financial info (bank account or UPI for payouts and prizes) | Yes (partners, sellers, prize winners) | Payout provider | Payouts | — |
| App interactions (views in shop and services) | Yes | No | Recommendations (can be switched off) | Yes |
| Crash logs and diagnostics | Yes, when crash reporting is on | Sentry | App stability | — |
| Messages to PetApp Assistant | Yes | AI provider, when enabled | Answers | Yes |
| Messages with partners, sellers and support (text, photos) | Yes | With the person you're talking to | Chat and support | Yes |
| Reviews (stars, text, photos) | Yes | Public, with first name and initial | Reviews of products and services | Yes |
| Reports and their screenshots | Yes | No (PetApp's moderators only) | Safety | Yes |

**The other questions:**
- **Encrypted in transit:** yes.
- **Can people ask for deletion:** yes, both in the app and on the web.
- **Data sold:** none.

### App Store: privacy "nutrition label"
- **Linked to the person:** contact info, location (customer and partner apps), user content, purchases, identifiers (user ID), usage data (product interaction) and diagnostics (crash data).
- **Tracking:** none. PetApp doesn't track people across other companies' apps or websites.

## Before each release
- Bump `version:` in the app's `pubspec.yaml` (and `AppConfig.appVersion`) for user-visible releases. Every upload needs a new build number.
- Check that the API is already serving the endpoints this app version uses. It always is when the backend deploys first; never the other way round.
- Try the release build on a real phone against production: sign in, a payment in test mode, a deep link (`adb shell am start -d "https://petapp.in/pet/…"`).
