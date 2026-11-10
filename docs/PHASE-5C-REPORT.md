# Phase 5c — Seller app: report

## 1. Implemented

### Seller app (`apps/product-partner-mobile`, Flutter)

| Area | What sellers can do |
|---|---|
| **Set up the store** | Checklist: store details (name, registered name, GSTIN, phone, email, pickup address), ID proof, and a GST certificate when a GSTIN is given. Submit for approval. The status and any reason are shown. Details are locked only while under review |
| **Home** | A to-do row (to pack, to ship, in transit, returns) that opens Orders on that stage. Sales and earnings for today, the last 7 days and the last 30 days (India time). Stock alerts with a quick restock. Product counts by status |
| **Products** | Photos (cover first, up to 10), category, name, brand, description and variants (SKU, MRP, GST-inclusive price, GST rate, opening stock, weight, on sale or not). Save as a draft, go live (the server checks for a photo and an active variant) or pause. Inventory status per variant. Blocked products show PetApp's reason |
| **Orders** | Filter by stage, newest first, paged. Each parcel shows its items, the buyer's name, address and phone for the courier label (copy or call), what the customer paid, PetApp's fee and what the seller earns. Mark packed → shipped (courier and tracking) → delivered, or cancel before shipping with a reason |
| **Returns** | Approve, or decline with a note the customer sees. Then confirm the item came back (optional condition note), which triggers the refund |
| **Coupons** | Percent (with a cap) or rupees off, minimum spend, total and per-customer limits, a start and end, pause. Seller-funded, and they apply only to the seller's items |
| **Earnings** | From delivered orders after the fee, what's on its way, month by month, and the payout note |

A suspended store keeps the workspace so it can finish parcels that are already paid for; the API stops it listing or editing products.

### API additions for sellers

| Endpoint / change | Purpose |
|---|---|
| `GET /vendor/dashboard` | To-do counts, sales windows from midnight India time, products by status, the low-stock level, and stock alerts (lowest first) |
| `GET/POST/PATCH /vendor/coupons` | The seller's own coupons. The seller is always the funder (a `vendorId` in the body is refused). Another seller's coupon returns 404. Unapproved stores are refused |
| `GET /vendor/products` | Each variant now has an `inventoryStatus` (in stock, low, out, not sold). Products now include viewable `images` in the seller's order |
| Setting `marketplace.lowStockThreshold` (default 5) | One number drives the seller's stock alerts and the shopper's "Only N left" |

## 2. Verification

| Check | Result |
|---|---|
| API end-to-end | **97 passed** in 7 suites. Marketplace now has 10 tests, including new ones for the seller dashboard, inventory status and seller coupons |
| API unit | **103 passed** (new: inventory status rules) |
| Lint, types, build (API, dashboard, types) | Clean |
| Seller app ↔ API contract | **29 calls and 167 fields across 20 models** match real responses. 28 fixtures were recorded from a real seller journey: onboarding, a refused submit, approval, a photo upload, a product with two sizes, going live, a stock change, two coupons, three paid orders, pack, ship, deliver, a seller cancellation, and a return approved then received |
| Contract check catches mistakes | Mutation test: a renamed field, a wrong nested key, a wrong endpoint and a wrong HTTP method were all reported |
| Seller app tests | Model tests on the recorded responses, plus API-client tests (paging, a refused submit with its reasons, request bodies). Expected values were recomputed from the fixtures |
| Independent review of the Dart code | A separate reviewer read the whole app for compile errors and found none. It found one test that would fail and four runtime bugs, all fixed (see §3) |
| Customer and partner app contracts | Still match the regenerated API spec |

## 3. Problems found and fixed

1. **Product photos couldn't be uploaded with Reels switched off.** Image uploads were tied to the Reels switch, so a marketplace-only launch would have blocked every product photo. Images are now allowed when Reels or the Marketplace is on; videos still need Reels. An end-to-end test covers it.
2. **Saving a product could undo sales.** Saving the product form wrote each variant's stock back from the form, so orders placed while a seller was editing would have their stock decrements overwritten. Existing variants now keep their stock when a product is saved; stock changes only through its own endpoint. Tested.
3. **Courier labels had the wrong name.** The parcel's "ship to" name was the address label ("Home"). It now carries the buyer's name and phone, keeping the label separately. Orders placed before this change keep the old snapshot.
4. **Partial coupon edits skipped validation.** Changing only the value or only one date wasn't checked against the saved coupon (e.g. 150% off, or an end before the start). Edits are now merged with the saved coupon before checking.
5. **A flaky race test.** The "last units" test sometimes saw a 400 instead of a 409. Both are correct refusals, depending on timing. The test now accepts either refusal and still requires exactly one winner and no negative stock.
6. **Found in the review of the app:**
   - "Save and go live" could create a duplicate draft if going live was refused.
   - The product list could show the previous account's catalogue after switching accounts.
   - An order action finishing after the screen closed would have thrown.
   - The GST dropdown would fail on an unusual rate.
   - An old coupon's date picker could fail to open.
   - One test compared maps inside a record, which would always fail.

## 4. Known limitations

- **The seller app hasn't been compiled here** (no Flutter SDK). CI's new `seller-app` job runs analyze and tests.
- **Payouts and invoices aren't built yet.** Earnings are recorded per delivered parcel; refunds are queued. Both are Phase 6.
- **No bulk tools:** no CSV catalogue import, no bulk stock edit, no printable shipping labels or courier API integration. Couriers and tracking numbers are entered by hand.
- **Sellers can't reorder photos** beyond choosing the cover.
- **Seller ratings** stay at zero until product reviews exist.

## 5. Next: Phase 6, finance

Double-entry ledger, refund execution through the payment provider, seller and partner payouts, GST/TDS/TCS invoices, and reconciliation.
