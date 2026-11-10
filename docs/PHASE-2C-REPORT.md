# Phase 2c — Flutter customer app: report

## 1. Implemented

`apps/customer-mobile` is a Flutter app for Android and iOS, built with Riverpod, go_router and Dio. It has 27 source files and about 3,200 lines of code.

- **Sign-in:**
  - Phone number, then a 6-digit code with a resend countdown that matches the server's cooldown, then your name.
  - The server's error messages are shown as written, e.g. "Incorrect code. 2 attempts left."
  - Tokens are stored in the iOS Keychain or Android Keystore.
  - When the session expires, it refreshes once even if several requests fail at the same moment.
  - Signing out unregisters this phone from push first.
- **Home:** a Following feed and a Discover feed. Photo carousels, inline HLS video, likes and saves that update instantly and roll back on failure, comments, the share sheet, report and block, delete your own posts, and tappable #hashtags (including Indian scripts, using the same rules as the API).
- **Reels:** a full-screen vertical feed where only the visible reel plays. Double-tap to like, a view is counted after one second, and the next page loads early.
- **Create:**
  - **Picking:** up to 10 photos (exported as JPEG, so HEIC never reaches the API) or a reel of up to 60 seconds.
  - **Details:** caption, pet tags, and a followers-only option.
  - **Upload:** straight to storage via signed URLs, with a progress bar. The post is created right away; reels go live when processing finishes, and the user is notified.
- **Pets:** add a pet (species, breed filtered by species, gender, birthday, about) and a pet profile with follow, report and a posts grid. The microchip number is shown only to the owner, and the API never sends it to anyone else.
- **Alerts:** grouped notifications with an unread badge, refreshed every minute and when the app is reopened. Tapping a notification or a push opens the right post, pet or person. Opening the screen marks everything read.
- **Me:** your posts, saved posts and pets. Other people's profiles have follow, report and block. Settings has the six notification switches, the blocked list with unblock, sign out, and account deletion behind an explicit confirmation.
- **Feature switches:** the Reels and Create tabs show "Coming soon" when **Reels and posts** is off in the dashboard.
- **Links:** `petapp://app/post/<id>` (and `/pet`, `/user`) and shared `…/p/<id>` links open the right screen.

## 2. How it was verified without Flutter

The Flutter SDK and pub.dev can't be downloaded in this build environment, so **the app has not been compiled**. In its place:

| Check | Result |
|---|---|
| **Contract: endpoints.** Each of the app's 52 API calls exists in the API spec with the same method | Pass |
| **Contract: fields.** Each of the 104 JSON fields the models read appears in real responses recorded from the running API (48 fixtures) | Pass |
| Both contract checkers are mutation-tested: a wrong endpoint and a wrong field name are both caught | Pass |
| Every assertion in the Dart tests that depends on fixture data (20) holds against the recorded data | Pass |
| Every import resolves, no file is unused, and every package used is declared | Pass |
| Bracket and string balance in all 31 Dart files (a Dart-aware checker, mutation-tested on 3 kinds of mistake) | Pass |

**Still unverified:** Dart type errors and API typos in Flutter packages. Expect a short fix-up pass on the first `flutter analyze`. **CI now runs `flutter analyze` and `flutter test`** in a new `mobile` job, so GitHub's runners give the real compiler check.

## 3. Bugs found in the backend while building the app

1. **Sign-in leaked an internal session ID.** The sign-in response included the session's internal `sessionId`, which refresh already stripped. It's now removed everywhere, and a unit test locks the token contract to exactly four fields. Recording real responses caught this.
2. **HLS video couldn't play through signed URLs.** A playlist references its segments by relative path, and per-file signatures can't cover those segments. Phase 2a's test fetched the playlist but never a segment.
   - **Fix:** processed media is served from a public, CDN-style base URL. Local MinIO now makes only the `media/` prefix public; originals stay private. `MEDIA_PUBLIC_BASE_URL` is documented as required for video, and the API warns at startup when it's missing.

## 4. Tests added

| Test file | What it covers |
|---|---|
| `models_test.dart` | Every model parses real responses: feeds, a reel with HLS, pets with and without owner-only fields, comments and replies, notifications, upload tickets |
| `api_client_test.dart` | Envelope unwrapping, readable errors, the token is never sent to auth endpoints, three parallel 401s cause **one** refresh and three successful retries, a rejected refresh signs out |
| `helpers_test.dart` | Phone rules (same as the API), accepted media types, relative times and counts, notification routing |

## 5. Setup

See `apps/customer-mobile/README.md`:

1. Run `flutter create .` to generate the `android/` and `ios/` folders.
2. Add the listed manifest and Info.plist entries.
3. `flutter run --dart-define=API_BASE_URL=…`
4. Firebase is optional; push activates only when its settings are passed.

## 6. Known limitations

- **Not compiled here** (see section 2).
- **Camera capture** isn't wired in; posts are chosen from the gallery. Adding `ImageSource.camera` is a one-line change once the platform permissions are added.
- **No resumable uploads.** A dropped connection means retrying the upload. Multipart resumable upload is planned with production hardening (Phase 8).
- **No editing** of profile photos, pet photos or post captions in the app yet. The API supports caption editing.
- **No offline cache** of feeds. The app works online and shows clear offline errors with retry.
- **Light theme only.** Dark mode is planned for the Phase 8 polish pass.

## 7. Next

**Phase 3: contests and challenges.** This covers the contest builder, paid registration through Razorpay, tasks and submissions, public and judge voting with anti-fraud checks, leaderboards, winners and prize workflow, and challenges with streaks and badges. Real-money contests stay locked until the legal-review gate is cleared.
