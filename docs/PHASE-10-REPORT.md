# Phase 10 — Hardening: report

Phase 10 covers:
- **10a:** two-factor sign-in for staff (authenticator app and recovery codes)
- **10b:** offline handling and friendly errors in the apps (spec §84–85)
- dependency security updates

## 1. Implemented

### 10a: Two-factor sign-in for staff
- **Setting it up** (**Your account → Two-factor sign-in**):
  1. Type your password.
  2. Scan the QR code with any authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), or type the key by hand.
  3. Type the 6-digit code it shows.
  4. You get **ten recovery codes**, shown once. Each one works once, for when your phone isn't with you.

  Turning it on signs out your other sessions.
- **Signing in:** after the password, the dashboard asks for the 6-digit code, or a recovery code.
  - **The ticket:** the password step gives a 5-minute ticket with 5 tries. It is kept only as a hash.
  - **No reuse:** a code can't be used twice.
  - **Recovery codes:** using one emails the owner.
  - **Audit log:** records how each person signed in (password, password + code, or password + recovery code).
- **Managing it:**
  - **New recovery codes:** made with a current code; the old ones stop working.
  - **Turning it off:** needs your password and a code.
  - **A lost phone:** an admin can reset it from the person's page under **People** ("Reset two-factor", which needs `users.roles.assign`). Nobody can reset their own.
- **Requiring it for everyone:** turn on the setting `security.requireStaffMfa`.
  - Staff without two-factor can then only reach **Your account** to set it up. The API answers anything else with 403 `MFA_SETUP_REQUIRED`, and the dashboard takes them to the set-up panel with a banner.
  - It can't be turned off while it's required.
- **Storage:**
  - **Authenticator secrets:** encrypted with `MFA_DATA_KEY` (AES-GCM, a separate key from bank details). It is required in staging and production.
  - **Recovery codes:** stored only as hashes.
- **Codes:** they follow RFC 6238 (30-second steps, one step of clock drift allowed), checked against the standard's test vectors.

### 10b: Offline and errors in the apps (spec §84–85)
- **Saved screens (customer app):**
  - **What's kept:** the last answer of key screens: profile, pets, home, feeds, notifications, contests, challenges, bookings, orders, addresses, membership and feature switches.
  - **Offline:** these screens show the saved copy, with a bar saying "You're offline · showing what was saved 5 min ago". The bar goes away as soon as the connection is back.
  - **Never kept:** payments, chats and the cart.
  - **Limits and clearing:** at most 40 answers of 256 KB each. Everything is deleted at sign-out, when the session ends, and at account deletion.
- **Retries:** a read that loses its connection is tried twice more. Writes aren't retried, because the app can't know whether the server already did them.
- **Payments interrupted after paying ("payment success but API failure"):**
  - **What the app says:** if the gateway took the money but the app couldn't tell PetApp, the app says "Payment verification is pending… You won't be charged twice", instead of an error that invites paying again.
  - **Confirming later:** the payment is confirmed automatically when the app starts or comes back to the foreground ("Your payment is confirmed").
  - **Safe to repeat:** confirming is idempotent on the server, and the gateway's webhook settles the payment there anyway. A pending confirmation is dropped after 3 days, or at once if the server refuses it.
- **Friendly errors:**
  - **All three apps:** server faults read "Something went wrong on our side. Please try again in a moment", without the server's internal details.
  - **Kept as written:** messages that people can act on (validation, "not available here", limits).
  - **Connection problems:** slow connections and gateway timeouts get their own message, and a send timeout now also counts as being offline.

### Other fixes
- **An unreadable two-factor secret** (for example after `MFA_DATA_KEY` changes) now refuses the code as wrong and logs the problem, instead of failing with a server error. Recovery codes keep working.
- **Dependency updates** (`npm audit` is clean):
  - Next.js 15.5.28 in the dashboard and website
  - zod 4.6.7
  - multer, body-parser and fast-uri pinned to fixed versions

## 2. Verification

| Check | Result |
|---|---|
| API unit tests | 239 pass (4 new: TOTP against the RFC 6238 vectors, recovery codes) |
| API end-to-end tests | 276 pass, 21 suites (5 new in `accounts.e2e`). Covers: <br>• setting up two-factor <br>• signing in with a code, and replay refused <br>• recovery codes once each, with the email <br>• the 5-try ticket <br>• new recovery codes and turning it off <br>• an admin reset and its permission <br>• requiring it for everyone |
| Dashboard browser tests | 38 pass (1 new: set up two-factor from the shown key, sign out, sign in with a recovery code, then with a code) |
| Dashboard unit tests | 24 pass |
| Website browser and unit tests | 13 and 13 pass (rebuilt on Next.js 15.5.28) |
| App ↔ API contract checks, all three apps | Pass |
| Python mirrors of the Dart tests | 12 sets pass (new: `check_offline_mirrors.py`, which also checks that every saved screen is one the app really reads) |
| Lint, typecheck, bracket and name checks, schema drift, `npm audit` | Pass |
| API reference | Regenerated: 442 operations |

## 3. Known limitations
- **The Flutter apps weren't compiled here,** because no SDK is available. CI's mobile jobs run `flutter analyze` and `flutter test`, including the new `offline_test.dart`. The rules are covered by the Python mirror.
- **Offline copies are read-only.** Liking, commenting or booking still needs a connection; the app says so. Actions aren't queued to send later.
- **The partner and seller apps** got the friendly messages, but not saved screens or retries.
- **Two-factor uses authenticator apps only.** There are no SMS codes (weaker) and no passkeys yet.
- **The dashboard doesn't remember a trusted browser,** so a code is asked at every sign-in.

## 4. Final release (after Phase 10)
- **Partner and seller apps:** they now also keep saved copies of their key screens offline (profile, bookings or orders, services or products, dashboard), with the same "You're offline" bar and retries. Saved copies are cleared at sign-out. Money screens and chats are never kept. Covered by `test/offline_test.dart` in each app and by `check_offline_mirrors.py`, which also checks that the three apps use the same rules.
- **Maps (spec §19):**
  - **The provider:** a `MapProvider` with two settings: `none` (the default) and `google` (Geocoding API, India).
  - **Place search:** the place picker searches PIN codes, cities and areas from PetApp's database, then landmarks and streets from the map provider.
  - **Named positions:** "Near you" becomes "Near Bandra West" when the area is known.
  - **Limits:** map answers are cached for a day, place search is limited to 30 requests a minute, and a maps outage never stops PetApp's own answers.
  - **Production:** production refuses `google` without a key, and refuses the console push provider.
- **Spec §85 messages, word for word:**
  - "This service is unavailable at this location" for home visits outside a partner's radius.
  - "Your video is still being processed" on the post, and when someone tries to submit a reel that is still processing to a contest or challenge.
- **Sign-off:** `docs/FINAL-VERIFICATION.md` maps every item of the spec's production checklist (§86) and deliverables (§89) to the code and the tests that prove it.
