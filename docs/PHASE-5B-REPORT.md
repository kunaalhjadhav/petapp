# Phase 5b — Marketplace screens: report

## 1. Implemented

### Admin dashboard (new "Shop" menu)

| Screen | What staff can do |
|---|---|
| **Vendors** | A queue by status (waiting for review, approved, changes needed, suspended, not submitted). The review page has private document links, a decision per document with notes, and approve, ask for changes, suspend or reinstate (with a reason the vendor sees). It also shows the checklist of what's missing, the store details, the commission (agreed rate or each category's), product and order counts, and the history |
| **Products** | Search and filter by status or vendor; price range, stock and variants. Block with a reason (the product leaves the shop and carts at once) or unblock (it returns to the vendor as hidden) |
| **Orders** | Every parcel across vendors, filterable by status and vendor, with the customer, items, total, PetApp fee and tracking |
| **Coupons** | Create platform coupons (percent or rupees, cap, minimum order, window, total and per-customer limits). See whether each is live and how many uses it has; pause or resume. Start and end times use the admin's own time zone |
| **Categories** | Parent and child categories with commission; add, edit, show or hide |

The audit log now describes vendor, product, coupon, order and return events in plain language, e.g. "Approved the store" or "Blocked a product".

### Customer app

- **Shop** (bag icon on Home, shown when the Marketplace feature is on): search, category chips, sort, and product tiles with price, "% off" and out-of-stock.
- **Product page:** photos, size and variant chips, MRP crossed out with the discount, "Inclusive of all taxes", "Only N left", a quantity picker and Add to cart.
- **Cart:**
  - **Lines:** quantity steppers, with problems shown per line exactly as the server words them ("Only 1 left. Lower the quantity to continue.").
  - **Totals:** a coupon field, items, coupon, shipping ("Free") and total. Orders with more than one seller say "Ships in 2 parcels".
  - **Checkout:** choose or add an address, then pay with Razorpay. If the customer closes the checkout, the order stays available with **Pay now** until the 30-minute hold ends.
- **My orders and order page:**
  - **Per parcel:** status, courier and tracking, cancellation reasons, return status in plain words, and Cancel (before packing) or Return (within the window).
  - **Money:** totals and refund status.
- **Notifications:** order notifications open the order, and parcel updates open My orders.

## 2. Verification

| Check | Result |
|---|---|
| Dashboard browser tests | **14 passed**. New: approve a vendor with a document decision, add a category (15%), create a coupon (shown as "10% off, up to ₹100", live, funded by PetApp, start time filled in the browser's time zone), block a product with a reason, and check the history says "Approved the store" |
| Dashboard build, types, lint | Clean |
| Customer app ↔ API contract | **93 calls and 372 fields across 56 models** match real responses. 13 new shop fixtures came from a real journey: vendor approval, a product with a processed photo, cart, bad and good coupon, checkout, payment, shipping, delivery, a return request, a cancelled second order with its refund, and an out-of-stock cart |
| Customer app fixture assertions | **31 of 31** hold, e.g. the return refund is ₹6,597 (items ₹6,897 minus the ₹300 coupon; shipping isn't refunded) |
| Customer app brackets | 42 files, no problems |
| API | Unchanged since 5a (102 unit, 95 end-to-end) |

## 3. Problems caught in review before testing

1. **Coupon dates would have shifted by 5½ hours in India.** The defaults were computed on the server in UTC but read by the form as local time. They're now filled in by the browser.
2. **Build-breaking export:** status labels were exported from a Next.js page file (the same mistake as in Phase 3c). They were moved to a labels module.
3. **Hedged test assertions:** two browser-test checks accepted either of two texts. They now assert the exact labels, and plain-language audit wording was added so the history reads "Approved the store".

## 4. Known limitations

- **The Flutter app still isn't compiled here.** CI's `mobile` job compiles and tests it.
- **Parcel notifications open My orders** rather than the exact order, because they carry the parcel ID. A small API addition (order ID in the notification) would fix it.
- **No editing of saved addresses** in the app yet (add and choose only).
- **No product reviews or ratings yet.**
- **Vendors can't create their own coupons from a screen yet** — that comes with the vendor portal (5c).

## 5. Next: Phase 5c, the vendor portal

Store onboarding, products and stock, orders to pack and ship, returns, earnings and vendor coupons.
