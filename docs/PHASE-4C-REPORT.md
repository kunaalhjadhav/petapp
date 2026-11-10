# Phase 4c — Service partner app: report

## 1. Implemented

`apps/service-partner-mobile` is a Flutter app for Android and iOS (21 files) for groomers, vets, trainers, boarding, walkers and sitters.

- **Verification first:** new or unverified partners see only a checklist — business details, documents, services, hours — then submit for review. The review status and any rejection reason are shown. The workspace opens once an admin approves them.
- **Business details:** individual or business, address, "use my location" for the map pin, home-visit distance and GSTIN.
- **Documents (KYC):** take or choose a photo, or choose a PDF. Files are uploaded straight to **private** storage through a signed link, and the server checks file signatures. Status is shown per document; accepted documents can't be removed.
- **Services:** category, name, price in rupees (converted to paise exactly), duration, the gap after each booking, at-centre and/or home visit, and pause. Each service shows **PetApp's fee as the API computes it**.
- **Hours and time off:** weekly opening hours in India time, and closed days with a reason.
- **Bookings:** upcoming and past, with the customer, pet, note, home-visit address and **what the partner earns after the fee**. Call, start, complete, no-show (only after the start time), or cancel with a reason for the customer (full refund, clearly stated).
- **Earnings:** earned so far, billed and fees, upcoming expected earnings, no-shows, and a month-by-month breakdown in India time.
- **Business tab:** rating, details, documents, fee and sign out.

**Backend:** a new `GET /partner/earnings` endpoint (completed, upcoming, no-shows, by month in India time), with an end-to-end test. The API now has 185 operations.

## 2. Verification (Flutter can't be downloaded here)

| Check | Result |
|---|---|
| **Recorded fixtures:** a full partner journey on the real API — onboarding, document upload, refused early submit, services, an edited price, hours, time off, submit, admin approval, two customers booking and paying, start, complete, a partner cancellation, a review reply, earnings | 20 fixtures |
| App ↔ API contract: endpoints | **26 of 26** match |
| App ↔ API contract: fields, including nested `customer.*`, `earnings.*`, `completed.*` and `upcoming.*` | **96 of 96** match |
| Contract checker mutation test (a wrong path and a wrong nested field are both caught) | Pass |
| Fixture-dependent Dart test assertions | **30 of 30** hold (after the fix below) |
| Imports resolve, no unused files, packages declared, brackets balance | Pass |
| Customer app contract re-checked against the updated API (278 fields across 43 models) | Pass |
| Backend services end-to-end tests, including the new earnings test | **12 of 12** |

**CI** now has a `partner-app` job: contract and bracket checks, then `flutter analyze` and `flutter test` on GitHub's runners.

## 3. Bugs found and fixed

1. **The app would have told partners "PetApp keeps 0%".** A partner's commission is `null` when the category's standard rate applies, and the model turned `null` into 0. A fixture assertion caught it. The app now applies the API's rule (agreed rate, otherwise the category's) and shows the fee on each service. This was cross-checked against a real booking: 15% of ₹849 = ₹127.35. The dashboard already handled this correctly.
2. **A compile error:** a `void` result was used inside a conditional expression. The bracket checker can't see this kind of error; it was caught in review and fixed.
3. **Flutter version compatibility:** a colour API from Flutter 3.27 was replaced so the app works on 3.24 and up, the minimum it declares.

## 4. Known limitations

- **Not compiled here.** The first build may need small fixes; CI compiles it.
- **One opening window per day** in the app. Split shifts are supported by the API and the dashboard.
- **Code is copied, not shared:** the API client, session storage and phone rules are copies of the customer app's. A shared Dart package is planned for Phase 8.
- **No partner push notifications yet.** New bookings appear on refresh. Partner push uses the existing notifications system and arrives with Phase 8's notification scheduler.
- **Payouts:** earnings are recorded; actual payouts to bank accounts arrive with Phase 6 (finance).

## 5. Phase 4 is complete

| Part | Delivered |
|---|---|
| 4a | Services API |
| 4b | Services screens in the dashboard and customer app |
| 4c | Partner app |

**Next is Phase 5, the product marketplace:** vendors, catalogue, variants, inventory, cart, orders split per vendor, fulfilment, returns, coupons and the vendor portal.
